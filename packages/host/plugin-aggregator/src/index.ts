/**
 * Multi-source Plugin Aggregator with LanceDB Semantic Search.
 * 
 * Aggregates plugins from:
 * - DeepSeek 1024 Store API
 * - GitHub repositories with dsh-plugin topic
 * - npm packages with dsh-plugin keyword
 * - In-app dsh-market (future)
 * - Manual curation
 * 
 * Features:
 * - LanceDB vector store for semantic search
 * - Popularity/quality/activity scoring
 * - Context-aware recommendations
 * - Periodic auto-update
 * @module @deepseek-ai/dsh-host-plugin-aggregator
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'

// Types
export type * from './types.ts'

// Embedding
export { EmbeddingProvider, LocalEmbeddingProvider, OpenAIEmbeddingProvider, CustomEmbeddingProvider, createEmbeddingProvider } from './embedding.ts'
export { name as embeddingName, apply as applyEmbedding } from './embedding.ts'

// Vector Store
export { PluginVectorStore } from './vector-store.ts'
export { name as vectorStoreName, apply as applyVectorStore } from './vector-store.ts'

// Sources
export { 
  PluginSourceAdapter, 
  Store1024Adapter, 
  GitHubTopicsAdapter, 
  NpmRegistryAdapter, 
  DshMarketAdapter, 
  ManualAdapter,
  SOURCE_ADAPTERS,
  getEnabledAdapters,
  fetchFromAllSources,
} from './sources.ts'

// Aggregator
export { PluginAggregator, mergePlugins, computePopularityScore, computeQualityScore, computeActivityScore, computeCompositeScore } from './aggregator.ts'

// Main service
import { PluginAggregator } from './aggregator.ts'
import type { ValidatedAggregatorConfig, SemanticQuery, SearchResult, PopularityRanking, RecommendationContext, PluginRecommendation, AggregationJobStatus } from './types.ts'

/** Remote service for plugin aggregation queries. */
export class PluginAggregatorGateway extends TypertRemoteService {
  static inject = ['plugin-aggregator'] as const

  constructor(ctx: Context) {
    super(ctx, 'pluginAggregator')
  }

  @Remote('search')
  async search(query: SemanticQuery): Promise<SearchResult[]> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.search(query)
  }

  @Remote('getPopular')
  async getPopular(limit?: number, category?: string): Promise<any[]> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.getPopular(limit, category)
  }

  @Remote('getByCategory')
  async getByCategory(category: string, limit?: number): Promise<any[]> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.getByCategory(category, limit)
  }

  @Remote('getById')
  async getById(pluginId: string): Promise<any> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.getById(pluginId)
  }

  @Remote('getRankings')
  async getRankings(period?: 'daily' | 'weekly' | 'monthly' | 'all-time', limit?: number): Promise<PopularityRanking[]> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.getRankings(period, limit)
  }

  @Remote('getRecommendations')
  async getRecommendations(context: RecommendationContext): Promise<PluginRecommendation[]> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.getRecommendations(context)
  }

  @Remote('getStats')
  async getStats(): Promise<any> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.getStats()
  }

  @Remote('getJobStatus')
  async getJobStatus(jobId?: string): Promise<AggregationJobStatus | AggregationJobStatus[]> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    if (jobId) return aggregator.getJobStatus(jobId) || { jobId, status: 'failed', source: 'all', startedAt: '', pluginsFetched: 0, pluginsNew: 0, pluginsUpdated: 0, error: 'Not found' }
    return aggregator.getRecentJobs()
  }

  @Remote('triggerAggregation')
  async triggerAggregation(): Promise<AggregationJobStatus> {
    const aggregator = this.ctx.pluginAggregator as PluginAggregator
    return aggregator.runAggregation()
  }
}

/** Main plugin entry point. */
export const name = 'plugin-aggregator'
export const inject = ['settings'] as const

export interface Config {
  /** Configuration override (merged with settings). */
  config?: Partial<ValidatedAggregatorConfig>
}

export function apply(ctx: Context, config: Config): void {
  // Register embedding provider
  ctx.plugin('plugin-aggregator-embedding', (ctx: Context) => {
    const { apply: applyEmbedding } = require('./embedding.ts')
    return applyEmbedding(ctx, {})
  })

  // Register vector store
  ctx.plugin('plugin-aggregator-vector-store', (ctx: Context) => {
    const { apply: applyVectorStore } = require('./vector-store.ts')
    return applyVectorStore(ctx, {})
  })

  // Register main aggregator
  ctx.plugin('plugin-aggregator', (ctx: Context) => {
    const { apply: applyAggregator } = require('./aggregator.ts')
    return applyAggregator(ctx, config)
  })

  // Register remote gateway
  ctx.plugin(PluginAggregatorGateway)
}

export default apply
