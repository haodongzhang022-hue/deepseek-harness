/**
 * Core aggregation logic: merge, deduplicate, score, and index plugins.
 * @module @deepseek-ai/dsh-host-plugin-aggregator/aggregator
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  RawPluginEntry,
  AggregatedPlugin,
  AggregatorConfig,
  ValidatedAggregatorConfig,
  PluginSourceType,
  AggregationJobStatus,
  SemanticQuery,
  SearchResult,
  PopularityRanking,
  RecommendationContext,
  PluginRecommendation,
} from './types.ts'
import { EmbeddingProvider, createEmbeddingProvider } from './embedding.ts'
import { PluginVectorStore } from './vector-store.ts'
import { fetchFromAllSources, getEnabledAdapters } from './sources.ts'

/** Plugin deduplication key. */
function dedupKey(entry: RawPluginEntry): string {
  // Normalize name for comparison
  const normalized = entry.name
    .toLowerCase()
    .replace(/[@\/]/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${entry.source}:${normalized}`
}

/** Merge plugins from multiple sources by similarity. */
function mergePlugins(entries: RawPluginEntry[]): AggregatedPlugin[] {
  const groups = new Map<string, RawPluginEntry[]>()

  // Group by normalized name
  for (const entry of entries) {
    const key = dedupKey(entry)
    const existing = groups.get(key) || []
    existing.push(entry)
    groups.set(key, existing)
  }

  const merged: AggregatedPlugin[] = []
  let idCounter = 0

  for (const [, group] of groups) {
    if (group.length === 0) continue

    // Sort by source priority (manual > 1024store > github-topics > npm-registry > dsh-market)
    const sourcePriority: Record<PluginSourceType, number> = {
      manual: 5,
      '1024store': 4,
      'github-topics': 3,
      'npm-registry': 2,
      'dsh-market': 1,
    }
    group.sort((a, b) => (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0))

    const primary = group[0]
    const aliases = [...new Set(group.flatMap(e => [e.name, ...(e.tags || [])]))].filter(a => a !== primary.name)

    // Merge descriptions - prefer longest non-empty
    const descriptions = group.map(e => e.description).filter(Boolean)
    const mergedDescription = descriptions.reduce((a, b) => a.length > b.length ? a : b, primary.description)

    // Merge tags
    const allTags = [...new Set(group.flatMap(e => e.tags || []))]

    // Compute scores
    const popularityScore = computePopularityScore(group)
    const qualityScore = computeQualityScore(group)
    const activityScore = computeActivityScore(group)

    // Best install command (prefer explicit, then github, then npm)
    let installCommand = primary.installCommand
    if (!installCommand) {
      const githubEntry = group.find(e => e.source === 'github-topics' && e.repository)
      if (githubEntry) {
        installCommand = `dsh plugin --profile web add github:${githubEntry.repository.replace('https://github.com/', '')}`
      } else {
        const npmEntry = group.find(e => e.source === 'npm-registry')
        if (npmEntry) {
          installCommand = `dsh plugin --profile web add npm:${npmEntry.sourceId}`
        }
      }
    }

    const now = new Date().toISOString()
    const latestUpdate = group.map(e => e.lastUpdated).filter(Boolean).sort().reverse()[0] || now

    merged.push({
      id: `plugin-${idCounter++}` as any,
      primaryName: primary.name,
      aliases,
      sources: group,
      mergedDescription,
      category: primary.category || 'other',
      popularityScore,
      qualityScore,
      activityScore,
      compositeScore: 0, // Will be computed after weights are known
      installCommand: installCommand || `# No install command for ${primary.name}`,
      tags: allTags,
      lastAggregated: now,
      metadata: {
        sourceCount: group.length,
        sources: group.map(e => e.source),
      },
    })
  }

  return merged
}

/** Compute popularity score (0-1) from GitHub stars, downloads, etc. */
function computePopularityScore(group: RawPluginEntry[]): number {
  let maxStars = 0
  let maxDownloads = 0

  for (const entry of group) {
    if (entry.stars !== undefined) maxStars = Math.max(maxStars, entry.stars)
    if (entry.downloads !== undefined) maxDownloads = Math.max(maxDownloads, entry.downloads)
  }

  // Logarithmic scaling: 10 stars ≈ 0.3, 100 ≈ 0.5, 1000 ≈ 0.7, 10000 ≈ 0.9
  const starScore = maxStars > 0 ? Math.min(1, Math.log10(maxStars + 1) / 4) : 0
  const downloadScore = maxDownloads > 0 ? Math.min(1, Math.log10(maxDownloads + 1) / 6) : 0

  return Math.max(starScore, downloadScore * 0.5)
}

/** Compute quality score (0-1) from documentation, tests, maintenance signals. */
function computeQualityScore(group: RawPluginEntry[]): number {
  let score = 0
  let factors = 0

  for (const entry of group) {
    // Has description
    if (entry.description && entry.description.length > 50) { score += 0.2; factors++ }
    // Has repository
    if (entry.repository) { score += 0.15; factors++ }
    // Has license
    if (entry.license) { score += 0.1; factors++ }
    // Has homepage
    if (entry.homepage) { score += 0.1; factors++ }
    // Has version
    if (entry.version) { score += 0.1; factors++ }
    // Has install command
    if (entry.installCommand) { score += 0.15; factors++ }
    // Has dependencies listed
    if (entry.dependencies && entry.dependencies.length > 0) { score += 0.1; factors++ }
    // Has compatibility info
    if (entry.compatibility && entry.compatibility.length > 0) { score += 0.1; factors++ }
  }

  return factors > 0 ? Math.min(1, score / factors) : 0.3
}

/** Compute activity score (0-1) from recent updates. */
function computeActivityScore(group: RawPluginEntry[]): number {
  const now = Date.now()
  let maxRecency = 0

  for (const entry of group) {
    if (entry.lastUpdated) {
      const age = now - new Date(entry.lastUpdated).getTime()
      const days = age / (1000 * 60 * 60 * 24)
      // 1 day ago = 1.0, 7 days = 0.7, 30 days = 0.4, 90 days = 0.2, 365 days = 0.05
      const recency = Math.max(0, 1 - Math.log10(days + 1) / 2.5)
      maxRecency = Math.max(maxRecency, recency)
    }
    if (entry.createdAt) {
      const age = now - new Date(entry.createdAt).getTime()
      const days = age / (1000 * 60 * 60 * 24)
      // Newer projects get slight boost
      if (days < 30) maxRecency = Math.max(maxRecency, 0.3)
    }
  }

  return maxRecency
}

/** Compute composite score from weights. */
function computeCompositeScore(
  plugin: AggregatedPlugin,
  weights: ValidatedAggregatorConfig['weights']
): number {
  return (
    plugin.popularityScore * weights.popularity +
    plugin.qualityScore * weights.quality +
    plugin.activityScore * weights.activity
  )
}

/** Main aggregator service. */
export class PluginAggregator {
  private readonly config: ValidatedAggregatorConfig
  private readonly embeddingProvider: EmbeddingProvider
  private readonly vectorStore: PluginVectorStore
  private readonly jobStatus = new Map<string, AggregationJobStatus>()
  private aggregationTimer?: ReturnType<typeof setInterval>
  private isAggregating = false

  constructor(
    config: ValidatedAggregatorConfig,
    embeddingProvider: EmbeddingProvider,
    vectorStore: PluginVectorStore
  ) {
    this.config = config
    this.embeddingProvider = embeddingProvider
    this.vectorStore = vectorStore
  }

  /** Start periodic aggregation. */
  startPeriodicAggregation(): void {
    if (this.aggregationTimer) return
    
    const intervalMs = this.config.updateIntervalHours * 60 * 60 * 1000
    this.aggregationTimer = setInterval(() => {
      this.runAggregation().catch(err => console.error('[plugin-aggregator] Periodic aggregation failed:', err))
    }, intervalMs)

    // Run once on start
    this.runAggregation().catch(err => console.error('[plugin-aggregator] Initial aggregation failed:', err))
  }

  /** Stop periodic aggregation. */
  stopPeriodicAggregation(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer)
      this.aggregationTimer = undefined
    }
  }

  /** Run full aggregation cycle. */
  async runAggregation(): Promise<AggregationJobStatus> {
    if (this.isAggregating) {
      return { jobId: '', status: 'failed', source: '1024store', startedAt: new Date().toISOString(), pluginsFetched: 0, pluginsNew: 0, pluginsUpdated: 0, error: 'Already running' }
    }

    this.isAggregating = true
    const jobId = `agg-${Date.now()}`
    const startedAt = new Date().toISOString()
    let totalFetched = 0, totalNew = 0, totalUpdated = 0

    try {
      // Fetch from all sources
      const sourceResults = await fetchFromAllSources(this.config)
      const allEntries: RawPluginEntry[] = []
      
      for (const [source, plugins] of Object.entries(sourceResults)) {
        totalFetched += plugins.length
        allEntries.push(...plugins)
      }

      // Merge and deduplicate
      const merged = mergePlugins(allEntries)

      // Compute composite scores
      for (const plugin of merged) {
        plugin.compositeScore = computeCompositeScore(plugin, this.config.weights)
      }

      // Generate embeddings for new/updated plugins
      const texts = merged.map(p => `${p.primaryName}. ${p.mergedDescription}. ${p.tags.join(' ')}`)
      const embeddings = await this.embeddingProvider.embed(texts)

      // Assign vector IDs and embeddings
      for (let i = 0; i < merged.length; i++) {
        merged[i].vectorId = i + 1 // Simple assignment, real impl would track
        merged[i].embedding = embeddings[i]
      }

      // Upsert to vector store
      const upserted = await this.vectorStore.upsertPlugins(merged, embeddings)
      totalNew = upserted // Simplified

      const status: AggregationJobStatus = {
        jobId,
        status: 'completed',
        source: 'all',
        startedAt,
        completedAt: new Date().toISOString(),
        pluginsFetched: totalFetched,
        pluginsNew: totalNew,
        pluginsUpdated: totalUpdated,
      }
      this.jobStatus.set(jobId, status)
      return status
    } catch (error) {
      const status: AggregationJobStatus = {
        jobId,
        status: 'failed',
        source: 'all',
        startedAt,
        completedAt: new Date().toISOString(),
        pluginsFetched: totalFetched,
        pluginsNew: totalNew,
        pluginsUpdated: totalUpdated,
        error: String(error),
      }
      this.jobStatus.set(jobId, status)
      throw error
    } finally {
      this.isAggregating = false
    }
  }

  /** Get aggregation job status. */
  getJobStatus(jobId: string): AggregationJobStatus | undefined {
    return this.jobStatus.get(jobId)
  }

  /** Get recent job statuses. */
  getRecentJobs(limit = 10): AggregationJobStatus[] {
    return [...this.jobStatus.values()]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit)
  }

  /** Semantic search. */
  async search(query: SemanticQuery): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingProvider.embedOne(query.text)
    return this.vectorStore.search(query, queryEmbedding)
  }

  /** Get popular plugins. */
  async getPopular(limit = 20, category?: string): Promise<AggregatedPlugin[]> {
    return this.vectorStore.getPopular(limit, category as any)
  }

  /** Get plugins by category. */
  async getByCategory(category: string, limit = 50): Promise<AggregatedPlugin[]> {
    return this.vectorStore.getByCategory(category as any, limit)
  }

  /** Get plugin by ID. */
  async getById(pluginId: string): Promise<AggregatedPlugin | null> {
    return this.vectorStore.getById(pluginId)
  }

  /** Get popularity rankings. */
  async getRankings(period: 'daily' | 'weekly' | 'monthly' | 'all-time' = 'all-time', limit = 50): Promise<PopularityRanking[]> {
    const plugins = await this.vectorStore.getPopular(limit * 2)
    
    return plugins.slice(0, limit).map((plugin, index) => ({
      plugin,
      rank: index + 1,
      score: plugin.compositeScore,
      trend: 'stable' as const, // Would need historical data
      period,
    }))
  }

  /** Get recommendations based on context. */
  async getRecommendations(context: RecommendationContext): Promise<PluginRecommendation[]> {
    if (!this.config.recommendations.enabled) return []

    const recommendations: PluginRecommendation[] = []
    const installedSet = new Set(context.currentPlugins.map(p => p.toLowerCase()))

    // Strategy 1: Semantic search based on intent/errors/tools
    const queryParts: string[] = []
    if (context.intent) queryParts.push(context.intent)
    if (context.recentErrors && context.recentErrors.length > 0) queryParts.push(...context.recentErrors.slice(0, 3))
    if (context.recentTools && context.recentTools.length > 0) queryParts.push(...context.recentTools.slice(0, 5))
    if (context.projectType) queryParts.push(context.projectType)

    if (queryParts.length > 0) {
      const queryText = queryParts.join(' ')
      const results = await this.search({ text: queryText, limit: this.config.recommendations.maxRecommendations * 2 })
      
      for (const result of results) {
        if (installedSet.has(result.plugin.primaryName.toLowerCase())) continue
        if (result.relevanceScore < this.config.recommendations.minConfidence) continue

        recommendations.push({
          plugin: result.plugin,
          confidence: result.relevanceScore,
          reason: `Matches your ${context.intent ? 'intent' : 'recent activity'}: ${result.matchReason}`,
          matchedContext: queryParts,
          installCommand: result.plugin.installCommand,
        })
      }
    }

    // Strategy 2: Popular plugins in categories you don't have
    const userCategories = new Set(
      (await Promise.all(
        context.currentPlugins.map(async name => {
          const plugin = await this.getById(name)
          return plugin?.category
        })
      )).filter(Boolean) as string[]
    )

    const allCategories = ['memory', 'tool', 'workflow', 'code', 'dev', 'chat', 'ui', 'agent-team', 'integration']
    const missingCategories = allCategories.filter(c => !userCategories.has(c))

    for (const cat of missingCategories.slice(0, 3)) {
      const popular = await this.getByCategory(cat, 3)
      for (const plugin of popular) {
        if (installedSet.has(plugin.primaryName.toLowerCase())) continue
        if (recommendations.some(r => r.plugin.id === plugin.id)) continue

        recommendations.push({
          plugin,
          confidence: 0.4,
          reason: `Popular ${cat} plugin you don't have yet`,
          matchedContext: [`missing-category:${cat}`],
          installCommand: plugin.installCommand,
        })
      }
    }

    // Sort by confidence and limit
    return recommendations
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.recommendations.maxRecommendations)
  }

  /** Get statistics. */
  async getStats() {
    return this.vectorStore.getStats()
  }
}

/** Service registration. */
export const name = 'plugin-aggregator'
export const inject = ['settings', 'plugin-aggregator-embedding', 'plugin-aggregator-vector-store'] as const

export interface Config {
  /** Override config from settings. */
  config?: Partial<ValidatedAggregatorConfig>
}

let aggregatorInstance: PluginAggregator | null = null

export function apply(ctx: Context, config: Config): PluginAggregator {
  if (aggregatorInstance) return aggregatorInstance

  const settings = ctx.settings
  const baseConfig = settings.get('plugin-aggregator') as ValidatedAggregatorConfig | undefined
  const mergedConfig = { ...baseConfig, ...config.config } as ValidatedAggregatorConfig

  const embeddingProvider = ctx.get('plugin-aggregator-embedding') as EmbeddingProvider
  const vectorStore = ctx.get('plugin-aggregator-vector-store') as PluginVectorStore

  aggregatorInstance = new PluginAggregator(mergedConfig, embeddingProvider, vectorStore)
  
  // Initialize vector store
  vectorStore.initialize().then(() => {
    aggregatorInstance!.startPeriodicAggregation()
  }).catch(err => {
    console.error('[plugin-aggregator] Failed to start:', err)
  })

  // Cleanup on dispose
  ctx.effect(() => () => {
    aggregatorInstance?.stopPeriodicAggregation()
  }, 'plugin-aggregator-cleanup')

  return aggregatorInstance
}
