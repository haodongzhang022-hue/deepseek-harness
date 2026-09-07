/**
 * Type definitions for multi-source plugin aggregation.
 * @module @deepseek-ai/dsh-host-plugin-aggregator/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Unique identifier for a plugin from a specific source. */
export type PluginSourceId = Branded<'PluginSourceId'>

/** Unique identifier for an aggregated plugin entry. */
export type AggregatedPluginId = Branded<'AggregatedPluginId'>

/** Source of plugin data. */
export type PluginSourceType = 
  | '1024store'           // DeepSeek 1024 Store API
  | 'github-topics'       // GitHub repositories with dsh-plugin topic
  | 'npm-registry'        // npm packages with dsh-plugin keyword
  | 'dsh-market'          // In-app marketplace
  | 'manual'              // Manually curated entries

/** Plugin category classification. */
export type PluginCategory = 
  | 'memory'
  | 'tool'
  | 'workflow'
  | 'code'
  | 'dev'
  | 'chat'
  | 'ui'
  | 'agent-team'
  | 'integration'
  | 'other'

/** Raw plugin data from any source. */
export interface RawPluginEntry {
  readonly source: PluginSourceType
  readonly sourceId: string                 // Original ID from source
  readonly sourceUrl: string                // Link to source entry
  readonly name: string                     // Display name
  readonly description: string              // Full description
  readonly shortDescription?: string        // Brief summary
  readonly author?: string                  // Author/org name
  readonly repository?: string              // GitHub repo URL
  readonly homepage?: string                // Project homepage
  readonly license?: string                 // License identifier
  readonly stars?: number                   // GitHub stars / popularity
  readonly downloads?: number               // npm downloads
  readonly version?: string                 // Latest version
  readonly tags?: string[]                  // Keywords/tags
  readonly category?: PluginCategory        // Classified category
  readonly installCommand?: string          // DSH install command
  readonly dependencies?: string[]          // Required DSH packages
  readonly compatibility?: string[]         // DSH version constraints
  readonly lastUpdated?: string             // ISO date
  readonly createdAt?: string               // ISO date
  readonly metadata?: Record<string, unknown> // Source-specific extras
}

/** Aggregated plugin with merged data from multiple sources. */
export interface AggregatedPlugin {
  readonly id: AggregatedPluginId
  readonly primaryName: string              // Canonical name
  readonly aliases: string[]                // Alternative names from sources
  readonly sources: Readonly<RawPluginEntry[]> // All source entries
  readonly mergedDescription: string        // Best/merged description
  readonly category: PluginCategory
  readonly popularityScore: number          // 0-1 normalized score
  readonly qualityScore: number             // 0-1 based on maintenance, docs, etc.
  readonly activityScore: number            // 0-1 based on recent updates
  readonly compositeScore: number           // Weighted composite for ranking
  readonly installCommand: string           // Best install command
  readonly tags: string[]                   // Deduplicated tags
  readonly vectorId?: number                // LanceDB row ID for embedding
  readonly lastAggregated: string           // ISO date
  readonly embedding?: number[]             // Semantic embedding (when stored)
}

/** Semantic search query. */
export interface SemanticQuery {
  readonly text: string                     // Natural language query
  readonly category?: PluginCategory        // Optional category filter
  readonly tags?: string[]                  // Optional tag filters
  readonly minPopularity?: number           // Minimum popularity threshold
  readonly minQuality?: number              // Minimum quality threshold
  readonly limit?: number                   // Max results
  readonly offset?: number                  // Pagination
}

/** Search result with relevance scoring. */
export interface SearchResult {
  readonly plugin: AggregatedPlugin
  readonly relevanceScore: number           // Semantic similarity 0-1
  readonly matchReason: string              // Why this matched
  readonly matchedFields: string[]          // Which fields matched
}

/** Popularity ranking entry. */
export interface PopularityRanking {
  readonly plugin: AggregatedPlugin
  readonly rank: number
  readonly score: number
  readonly trend: 'rising' | 'stable' | 'declining'
  readonly period: 'daily' | 'weekly' | 'monthly' | 'all-time'
}

/** Recommendation context from user's development activity. */
export interface RecommendationContext {
  readonly sessionId?: string
  readonly currentPlugins: string[]         // Installed plugin names
  readonly recentErrors?: string[]          // Recent error patterns
  readonly recentTools?: string[]           // Recently used tools
  readonly projectType?: string             // Detected project type
  readonly dependencies?: string[]          // Project dependencies
  readonly intent?: string                  // Expressed user intent
}

/** Recommendation with reasoning. */
export interface PluginRecommendation {
  readonly plugin: AggregatedPlugin
  readonly confidence: number               // 0-1
  readonly reason: string                   // Human-readable explanation
  readonly matchedContext: string[]         // Context elements that triggered this
  readonly installCommand: string
}

/** Aggregation job status. */
export interface AggregationJobStatus {
  readonly jobId: string
  readonly status: 'pending' | 'running' | 'completed' | 'failed'
  readonly source: PluginSourceType
  readonly startedAt: string
  readonly completedAt?: string
  readonly pluginsFetched: number
  readonly pluginsNew: number
  readonly pluginsUpdated: number
  readonly error?: string
}

/** Configuration for the aggregator. */
export interface AggregatorConfig {
  /** Enable/disable aggregation. Default: true */
  enabled: boolean
  /** Data directory for LanceDB. Default: <harness-home>/plugin-aggregator */
  dataDir?: string
  /** Embedding model to use. Default: 'local' (uses built-in) */
  embeddingModel: 'local' | 'openai' | 'custom'
  /** Custom embedding endpoint (when embeddingModel=custom) */
  embeddingEndpoint?: string
  /** Embedding dimensions. Default: 384 (local) */
  embeddingDimensions: number
  /** Update interval in hours. Default: 6 */
  updateIntervalHours: number
  /** Sources to enable. Default: all */
  enabledSources: PluginSourceType[]
  /** 1024Store API endpoint */
  store1024Endpoint?: string
  /** GitHub token for topic search (optional, higher rate limit) */
  githubToken?: string
  /** npm registry endpoint. Default: https://registry.npmjs.org */
  npmRegistry?: string
  /** Maximum plugins per source. Default: 5000 */
  maxPluginsPerSource: number
  /** Minimum stars for GitHub source. Default: 10 */
  githubMinStars: number
  /** Popularity score weights */
  weights: {
    popularity: number   // GitHub stars, downloads
    quality: number      // Documentation, tests, maintenance
    activity: number     // Recent commits, releases
    relevance: number    // Semantic match to query
  }
  /** Recommendation settings */
  recommendations: {
    enabled: boolean
    maxRecommendations: number
    minConfidence: number
    contextWindowSize: number // How many recent events to consider
  }
}

/** Default configuration. */
export const DEFAULT_CONFIG: AggregatorConfig = {
  enabled: true,
  embeddingModel: 'local',
  embeddingDimensions: 384,
  updateIntervalHours: 6,
  enabledSources: ['1024store', 'github-topics', 'npm-registry', 'dsh-market'],
  npmRegistry: 'https://registry.npmjs.org',
  maxPluginsPerSource: 5000,
  githubMinStars: 10,
  weights: {
    popularity: 0.3,
    quality: 0.2,
    activity: 0.2,
    relevance: 0.3,
  },
  recommendations: {
    enabled: true,
    maxRecommendations: 10,
    minConfidence: 0.3,
    contextWindowSize: 50,
  },
}

/** Zod schema for config validation. */
import z from '@deepseek-ai/schemastery'
export const AggregatorConfigSchema: z<Readonly<AggregatorConfig>> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().optional(),
  embeddingModel: z.enum(['local', 'openai', 'custom']).default('local'),
  embeddingEndpoint: z.string().url().optional(),
  embeddingDimensions: z.number().int().positive().default(384),
  updateIntervalHours: z.number().int().positive().default(6),
  enabledSources: z.array(z.enum(['1024store', 'github-topics', 'npm-registry', 'dsh-market', 'manual'])).default(['1024store', 'github-topics', 'npm-registry', 'dsh-market']),
  store1024Endpoint: z.string().url().optional(),
  githubToken: z.string().optional(),
  npmRegistry: z.string().url().default('https://registry.npmjs.org'),
  maxPluginsPerSource: z.number().int().positive().default(5000),
  githubMinStars: z.number().int().nonnegative().default(10),
  weights: z.object({
    popularity: z.number().min(0).max(1).default(0.3),
    quality: z.number().min(0).max(1).default(0.2),
    activity: z.number().min(0).max(1).default(0.2),
    relevance: z.number().min(0).max(1).default(0.3),
  }).default(DEFAULT_CONFIG.weights),
  recommendations: z.object({
    enabled: z.boolean().default(true),
    maxRecommendations: z.number().int().positive().default(10),
    minConfidence: z.number().min(0).max(1).default(0.3),
    contextWindowSize: z.number().int().positive().default(50),
  }).default(DEFAULT_CONFIG.recommendations),
})

export type ValidatedAggregatorConfig = z.infer<typeof AggregatorConfigSchema>
