/**
 * Embedding service for semantic search.
 * Supports local (fast, no API key) and remote (OpenAI, custom) models.
 * @module @deepseek-ai/dsh-host-plugin-aggregator/embedding
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ValidatedAggregatorConfig } from './types.ts'

/** Embedding provider interface. */
export interface EmbeddingProvider {
  readonly name: string
  readonly dimensions: number
  /** Generate embeddings for multiple texts. */
  embed(texts: string[]): Promise<number[][]>
  /** Generate embedding for single text. */
  embedOne(text: string): Promise<number[]>
}

/** Local embedding using a simple TF-IDF + SVD approach (no external deps).
 * For production, consider using @xenova/transformers with a small model like
 * 'Xenova/all-MiniLM-L6-v2' (384 dims, ~22MB) or 'Xenova/bge-small-en-v1.5' (384 dims). */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local'
  readonly dimensions: number
  
  private readonly vocabulary = new Map<string, number>()
  private readonly idf = new Map<string, number>()
  private docCount = 0
  private readonly stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
  ])

  constructor(dimensions = 384) {
    this.dimensions = dimensions
  }

  /** Simple tokenizer. */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !this.stopWords.has(t))
  }

  /** Build vocabulary from texts (call before embed). */
  buildVocabulary(texts: string[]): void {
    const docFreq = new Map<string, number>()
    
    for (const text of texts) {
      const tokens = new Set(this.tokenize(text))
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1)
      }
      this.docCount++
    }

    // Assign vocabulary indices
    let idx = 0
    for (const [token] of docFreq) {
      this.vocabulary.set(token, idx++)
    }

    // Compute IDF
    for (const [token, freq] of docFreq) {
      this.idf.set(token, Math.log(this.docCount / freq) + 1)
    }
  }

  /** Convert text to TF-IDF vector. */
  private textToVector(text: string): number[] {
    const tokens = this.tokenize(text)
    const tf = new Map<string, number>()
    
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1)
    }

    const vocabSize = this.vocabulary.size
    const vector = new Array(Math.min(vocabSize, this.dimensions)).fill(0)
    
    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token)
      if (idx !== undefined && idx < this.dimensions) {
        const idf = this.idf.get(token) || 1
        vector[idx] = (count / tokens.length) * idf
      }
    }

    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
    return norm > 0 ? vector.map(v => v / norm) : vector
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Build vocabulary if not built
    if (this.vocabulary.size === 0) {
      this.buildVocabulary(texts)
    }
    return texts.map(t => this.textToVector(t))
  }

  async embedOne(text: string): Promise<number[]> {
    const vectors = await this.embed([text])
    return vectors[0]
  }
}

/** OpenAI-compatible embedding provider. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai'
  readonly dimensions: number
  
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly model: string

  constructor(endpoint: string, apiKey: string, model = 'text-embedding-3-small', dimensions = 1536) {
    this.endpoint = endpoint.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.model = model
    this.dimensions = dimensions
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.endpoint}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        encoding_format: 'float',
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.status} ${await response.text()}`)
    }

    const data = await response.json() as { data: { embedding: number[] }[] }
    return data.data.map(d => d.embedding)
  }

  async embedOne(text: string): Promise<number[]> {
    const vectors = await this.embed([text])
    return vectors[0]
  }
}

/** Custom embedding provider (any HTTP-compatible endpoint). */
export class CustomEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'custom'
  readonly dimensions: number
  
  private readonly endpoint: string
  private readonly headers: Record<string, string>

  constructor(endpoint: string, dimensions: number, headers: Record<string, string> = {}) {
    this.endpoint = endpoint.replace(/\/+$/, '')
    this.dimensions = dimensions
    this.headers = { 'Content-Type': 'application/json', ...headers }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ texts }),
    })

    if (!response.ok) {
      throw new Error(`Custom embedding failed: ${response.status} ${await response.text()}`)
    }

    const data = await response.json() as { embeddings: number[][] }
    return data.embeddings
  }

  async embedOne(text: string): Promise<number[]> {
    const vectors = await this.embed([text])
    return vectors[0]
  }
}

/** Create embedding provider from config. */
export function createEmbeddingProvider(config: ValidatedAggregatorConfig): EmbeddingProvider {
  switch (config.embeddingModel) {
    case 'local':
      return new LocalEmbeddingProvider(config.embeddingDimensions)
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY || process.env.DSH_OPENAI_API_KEY
      if (!apiKey) throw new Error('OpenAI API key required for openai embedding model')
      return new OpenAIEmbeddingProvider(
        config.embeddingEndpoint || 'https://api.openai.com/v1',
        apiKey,
        'text-embedding-3-small',
        config.embeddingDimensions
      )
    }
    case 'custom': {
      if (!config.embeddingEndpoint) throw new Error('Custom embedding endpoint required')
      return new CustomEmbeddingProvider(config.embeddingEndpoint, config.embeddingDimensions)
    }
  }
}

/** Service registration. */
export const name = 'plugin-aggregator-embedding'
export const inject = ['settings'] as const

export interface Config {
  /** Override embedding model from settings. */
  model?: 'local' | 'openai' | 'custom'
}

export function apply(ctx: Context, config: Config): EmbeddingProvider {
  // Settings will be read at runtime when needed
  const settings = ctx.settings
  const embeddingConfig = settings.get('plugin-aggregator') as ValidatedAggregatorConfig | undefined
  const model = config.model || embeddingConfig?.embeddingModel || 'local'
  
  if (model === 'local') {
    return new LocalEmbeddingProvider(embeddingConfig?.embeddingDimensions || 384)
  }
  
  // For remote models, create lazily when first used
  return {
    name: model,
    dimensions: embeddingConfig?.embeddingDimensions || (model === 'openai' ? 1536 : 384),
    async embed(texts: string[]) {
      const provider = createEmbeddingProvider(embeddingConfig || DEFAULT_CONFIG)
      return provider.embed(texts)
    },
    async embedOne(text: string) {
      const provider = createEmbeddingProvider(embeddingConfig || DEFAULT_CONFIG)
      return provider.embedOne(text)
    },
  }
}

// Re-export DEFAULT_CONFIG for lazy creation
import { DEFAULT_CONFIG } from './types.ts'
