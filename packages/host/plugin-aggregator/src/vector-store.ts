/**
 * LanceDB vector store for plugin semantic search.
 * @module @deepseek-ai/dsh-host-plugin-aggregator/vector-store
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, type Connection, type Table } from '@lancedb/lancedb'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AggregatedPlugin,
  SemanticQuery,
  SearchResult,
  AggregatorConfig,
  ValidatedAggregatorConfig,
  PluginSourceType,
} from './types.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** LanceDB table schema for plugins. */
export interface PluginVectorRow {
  id: number                    // LanceDB internal row ID
  vector: number[]              // Embedding vector
  pluginId: string              // AggregatedPluginId
  primaryName: string           // Canonical name
  description: string           // Full description
  category: string              // PluginCategory
  tags: string                  // JSON array of tags
  popularityScore: number       // 0-1
  qualityScore: number          // 0-1
  activityScore: number         // 0-1
  compositeScore: number        // Weighted composite
  installCommand: string        // Best install command
  sources: string               // JSON array of source types
  lastAggregated: string        // ISO date
  metadata: string              // JSON metadata
}

/** Vector store service. */
export class PluginVectorStore {
  private db: Connection | null = null
  private table: Table | null = null
  private readonly dataDir: string
  private readonly tableName = 'plugins'
  private readonly embeddingDimensions: number

  constructor(dataDir: string, embeddingDimensions: number) {
    this.dataDir = dataDir
    this.embeddingDimensions = embeddingDimensions
  }

  /** Initialize the database and table. */
  async initialize(): Promise<void> {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }

    this.db = await connect(this.dataDir)
    
    // Check if table exists
    const tableNames = await this.db.tableNames()
    
    if (tableNames.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName)
    } else {
      // Create table with empty data to establish schema
      this.table = await this.db.createTable(this.tableName, [{
        id: 0,
        vector: new Array(this.embeddingDimensions).fill(0),
        pluginId: '',
        primaryName: '',
        description: '',
        category: 'other',
        tags: '[]',
        popularityScore: 0,
        qualityScore: 0,
        activityScore: 0,
        compositeScore: 0,
        installCommand: '',
        sources: '[]',
        lastAggregated: new Date().toISOString(),
        metadata: '{}',
      }])
      // Remove the dummy row
      await this.table.delete('id = 0')
    }
  }

  /** Ensure table is initialized. */
  private ensureTable(): Table {
    if (!this.table) {
      throw new Error('Vector store not initialized. Call initialize() first.')
    }
    return this.table
  }

  /** Upsert plugins with their embeddings. */
  async upsertPlugins(plugins: AggregatedPlugin[], embeddings: number[][]): Promise<number> {
    const table = this.ensureTable()
    const rows: PluginVectorRow[] = []

    for (let i = 0; i < plugins.length; i++) {
      const plugin = plugins[i]
      const vector = embeddings[i] || new Array(this.embeddingDimensions).fill(0)
      
      rows.push({
        id: plugin.vectorId || Date.now() + i,
        vector,
        pluginId: plugin.id,
        primaryName: plugin.primaryName,
        description: plugin.mergedDescription,
        category: plugin.category,
        tags: JSON.stringify(plugin.tags),
        popularityScore: plugin.popularityScore,
        qualityScore: plugin.qualityScore,
        activityScore: plugin.activityScore,
        compositeScore: plugin.compositeScore,
        installCommand: plugin.installCommand,
        sources: JSON.stringify(plugin.sources.map(s => s.source)),
        lastAggregated: plugin.lastAggregated,
        metadata: JSON.stringify({
          sources: plugin.sources.map(s => ({
            source: s.source,
            sourceId: s.sourceId,
            sourceUrl: s.sourceUrl,
            stars: s.stars,
            version: s.version,
          })),
        }),
      })
    }

    // Use upsert on pluginId
    await table.upsert(rows, 'pluginId')
    return rows.length
  }

  /** Semantic search with optional filters. */
  async search(query: SemanticQuery, queryEmbedding: number[]): Promise<SearchResult[]> {
    const table = this.ensureTable()
    const limit = query.limit || 20
    const offset = query.offset || 0

    let searchQuery = table.search(queryEmbedding).limit(limit + offset)

    // Apply category filter
    if (query.category) {
      searchQuery = searchQuery.where(`category = '${query.category}'`)
    }

    // Apply popularity filter
    if (query.minPopularity !== undefined) {
      searchQuery = searchQuery.where(`popularityScore >= ${query.minPopularity}`)
    }

    // Apply quality filter
    if (query.minQuality !== undefined) {
      searchQuery = searchQuery.where(`qualityScore >= ${query.minQuality}`)
    }

    // Apply tag filter (simple contains check on JSON array)
    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(tag => `tags LIKE '%"${tag}"%'`).join(' OR ')
      searchQuery = searchQuery.where(`(${tagConditions})`)
    }

    const results = await searchQuery.toArray() as PluginVectorRow[]

    // Skip offset manually (LanceDB offset support varies)
    const sliced = results.slice(offset, offset + limit)

    return sliced.map(row => ({
      plugin: this.rowToPlugin(row),
      relevanceScore: 1 - (row._distance || 0), // LanceDB returns distance, convert to similarity
      matchReason: `Semantic match to "${query.text}"`,
      matchedFields: ['description', 'tags', 'category'],
    }))
  }

  /** Get popular plugins (by composite score). */
  async getPopular(limit = 20, category?: PluginCategory): Promise<AggregatedPlugin[]> {
    const table = this.ensureTable()
    let query = table.query().limit(limit).sort('compositeScore', 'desc')
    
    if (category) {
      query = query.where(`category = '${category}'`)
    }

    const rows = await query.toArray() as PluginVectorRow[]
    return rows.map(row => this.rowToPlugin(row))
  }

  /** Get plugins by category. */
  async getByCategory(category: PluginCategory, limit = 50): Promise<AggregatedPlugin[]> {
    const table = this.ensureTable()
    const rows = await table.query()
      .where(`category = '${category}'`)
      .limit(limit)
      .sort('compositeScore', 'desc')
      .toArray() as PluginVectorRow[]
    
    return rows.map(row => this.rowToPlugin(row))
  }

  /** Get plugin by ID. */
  async getById(pluginId: string): Promise<AggregatedPlugin | null> {
    const table = this.ensureTable()
    const rows = await table.query()
      .where(`pluginId = '${pluginId}'`)
      .limit(1)
      .toArray() as PluginVectorRow[]
    
    return rows.length > 0 ? this.rowToPlugin(rows[0]) : null
  }

  /** Get total plugin count. */
  async count(): Promise<number> {
    const table = this.ensureTable()
    return table.countRows()
  }

  /** Get statistics. */
  async getStats(): Promise<{
    total: number
    byCategory: Record<string, number>
    bySource: Record<string, number>
    lastUpdated: string | null
  }> {
    const table = this.ensureTable()
    const total = await table.countRows()
    
    const allRows = await table.query().toArray() as PluginVectorRow[]
    
    const byCategory: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    let lastUpdated: string | null = null

    for (const row of allRows) {
      byCategory[row.category] = (byCategory[row.category] || 0) + 1
      try {
        const sources = JSON.parse(row.sources) as string[]
        for (const src of sources) {
          bySource[src] = (bySource[src] || 0) + 1
        }
      } catch {}
      if (!lastUpdated || row.lastAggregated > lastUpdated) {
        lastUpdated = row.lastAggregated
      }
    }

    return { total, byCategory, bySource, lastUpdated }
  }

  /** Delete plugins by IDs. */
  async deletePlugins(pluginIds: string[]): Promise<number> {
    const table = this.ensureTable()
    if (pluginIds.length === 0) return 0
    const condition = pluginIds.map(id => `pluginId = '${id}'`).join(' OR ')
    await table.delete(condition)
    return pluginIds.length
  }

  /** Convert LanceDB row to AggregatedPlugin. */
  private rowToPlugin(row: PluginVectorRow): AggregatedPlugin {
    let sources: any[] = []
    let tags: string[] = []
    let metadata: any = {}

    try { sources = JSON.parse(row.sources) } catch {}
    try { tags = JSON.parse(row.tags) } catch {}
    try { metadata = JSON.parse(row.metadata) } catch {}

    return {
      id: row.pluginId as any,
      primaryName: row.primaryName,
      aliases: [],
      sources: sources.map(s => ({ source: s.source as any, sourceId: s.sourceId, sourceUrl: s.sourceUrl, stars: s.stars, version: s.version } as any)),
      mergedDescription: row.description,
      category: row.category as any,
      popularityScore: row.popularityScore,
      qualityScore: row.qualityScore,
      activityScore: row.activityScore,
      compositeScore: row.compositeScore,
      installCommand: row.installCommand,
      tags,
      vectorId: row.id,
      lastAggregated: row.lastAggregated,
      metadata,
    }
  }

  /** Close the database connection. */
  async close(): Promise<void> {
    // LanceDB doesn't require explicit close for local DB
    this.db = null
    this.table = null
  }
}

/** Service registration. */
export const name = 'plugin-aggregator-vector-store'
export const inject = ['settings'] as const

export interface Config {
  /** Override data directory. */
  dataDir?: string
}

let storeInstance: PluginVectorStore | null = null

export function apply(ctx: Context, config: Config): PluginVectorStore {
  if (storeInstance) return storeInstance

  const settings = ctx.settings
  const aggregatorConfig = settings.get('plugin-aggregator') as ValidatedAggregatorConfig | undefined
  const dataDir = config.dataDir || aggregatorConfig?.dataDir || join(process.env.DSH_HOME || process.cwd(), 'plugin-aggregator', 'lancedb')
  const dimensions = aggregatorConfig?.embeddingDimensions || 384

  storeInstance = new PluginVectorStore(dataDir, dimensions)
  
  // Initialize asynchronously
  storeInstance.initialize().catch(err => {
    console.error('[plugin-aggregator] Failed to initialize vector store:', err)
  })

  return storeInstance
}
