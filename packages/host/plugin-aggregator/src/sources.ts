/**
 * Source adapters for fetching plugin data from multiple sources.
 * @module @deepseek-ai/dsh-host-plugin-aggregator/sources
 */

import type { RawPluginEntry, PluginSourceType, AggregatorConfig } from './types.ts'

/** Base interface for source adapters. */
export interface PluginSourceAdapter {
  readonly sourceType: PluginSourceType
  readonly name: string
  /** Fetch plugins from this source. */
  fetch(config: AggregatorConfig): Promise<RawPluginEntry[]>
  /** Check if source is available/configured. */
  isAvailable(config: AggregatorConfig): boolean
}

/** 1024 Store API adapter. */
export class Store1024Adapter implements PluginSourceAdapter {
  readonly sourceType = '1024store' as const
  readonly name = 'DeepSeek 1024 Store'

  async fetch(config: AggregatorConfig): Promise<RawPluginEntry[]> {
    const endpoint = config.store1024Endpoint || 'https://api.deepseek1024.com/v1/plugins/search'
    const plugins: RawPluginEntry[] = []
    let page = 1
    const perPage = 100
    const maxPages = Math.ceil((config.maxPluginsPerSource || 5000) / perPage)

    while (page <= maxPages) {
      try {
        const response = await fetch(`${endpoint}?page=${page}&per_page=${perPage}&sortBy=stars`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          console.warn(`[1024store] API error: ${response.status}`)
          break
        }

        const data = await response.json() as { data?: any[], plugins?: any[] }
        const items = data.data || data.plugins || []
        
        if (items.length === 0) break

        for (const item of items) {
          plugins.push(this.transformItem(item))
        }

        page++
      } catch (error) {
        console.warn(`[1024store] Fetch failed on page ${page}:`, error)
        break
      }
    }

    return plugins
  }

  isAvailable(config: AggregatorConfig): boolean {
    return config.enabledSources.includes('1024store') && !!config.store1024Endpoint
  }

  private transformItem(item: any): RawPluginEntry {
    return {
      source: '1024store',
      sourceId: String(item.id || item.name),
      sourceUrl: item.url || `https://www.bilibili.com/toy/dsh-1024store/detail.html?name=${encodeURIComponent(item.name)}`,
      name: item.name,
      description: item.description || item.shortDescription || '',
      shortDescription: item.shortDescription,
      author: item.author,
      repository: item.repository,
      homepage: item.homepage,
      license: item.license,
      stars: item.stars || item.stargazers_count,
      downloads: item.downloads,
      version: item.version,
      tags: item.tags || item.keywords || [],
      category: this.inferCategory(item.tags, item.description),
      installCommand: item.installCommand,
      dependencies: item.dependencies,
      compatibility: item.compatibility,
      lastUpdated: item.updatedAt || item.lastUpdated,
      createdAt: item.createdAt,
      metadata: { raw: item },
    }
  }

  private inferCategory(tags: string[] = [], description = ''): RawPluginEntry['category'] {
    const text = [...tags, description].join(' ').toLowerCase()
    if (text.includes('memory') || text.includes('记忆')) return 'memory'
    if (text.includes('tool') || text.includes('工具')) return 'tool'
    if (text.includes('workflow') || text.includes('工作流') || text.includes('flow')) return 'workflow'
    if (text.includes('code') || text.includes('代码') || text.includes('coding')) return 'code'
    if (text.includes('dev') || text.includes('开发') || text.includes('debug')) return 'dev'
    if (text.includes('chat') || text.includes('聊天') || text.includes('conversation')) return 'chat'
    if (text.includes('ui') || text.includes('界面') || text.includes('frontend')) return 'ui'
    if (text.includes('agent') || text.includes('团队') || text.includes('team') || text.includes('swarm')) return 'agent-team'
    if (text.includes('integration') || text.includes('集成') || text.includes('bridge') || text.includes('gateway')) return 'integration'
    return 'other'
  }
}

/** GitHub Topics adapter (searches repos with dsh-plugin topic). */
export class GitHubTopicsAdapter implements PluginSourceAdapter {
  readonly sourceType = 'github-topics' as const
  readonly name = 'GitHub Topics (dsh-plugin)'

  async fetch(config: AggregatorConfig): Promise<RawPluginEntry[]> {
    const token = config.githubToken || process.env.GITHUB_TOKEN || process.env.DSH_GITHUB_TOKEN
    const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const minStars = config.githubMinStars || 10
    const query = `topic:dsh-plugin stars:>${minStars}`
    const perPage = 100
    const maxPages = Math.ceil((config.maxPluginsPerSource || 5000) / perPage)
    const plugins: RawPluginEntry[] = []

    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await fetch(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}&page=${page}`,
          { headers, signal: AbortSignal.timeout(30000) }
        )

        if (!response.ok) {
          if (response.status === 403) {
            console.warn('[github-topics] Rate limited, consider setting GITHUB_TOKEN')
          }
          break
        }

        const data = await response.json() as { items: any[], total_count: number }
        if (!data.items || data.items.length === 0) break

        for (const repo of data.items) {
          plugins.push(this.transformRepo(repo))
        }

        if (data.items.length < perPage) break
      } catch (error) {
        console.warn(`[github-topics] Fetch failed on page ${page}:`, error)
        break
      }
    }

    return plugins
  }

  isAvailable(config: AggregatorConfig): boolean {
    return config.enabledSources.includes('github-topics')
  }

  private transformRepo(repo: any): RawPluginEntry {
    const description = repo.description || ''
    const topics = repo.topics || []
    const readme = repo.readme || ''

    return {
      source: 'github-topics',
      sourceId: repo.full_name,
      sourceUrl: repo.html_url,
      name: repo.name,
      description: this.extractDescription(readme, description),
      shortDescription: description,
      author: repo.owner?.login,
      repository: repo.html_url,
      homepage: repo.homepage || undefined,
      license: repo.license?.spdx_id,
      stars: repo.stargazers_count,
      downloads: 0,
      version: repo.releases?.[0]?.tag_name || repo.default_branch,
      tags: topics.filter((t: string) => t !== 'dsh-plugin'),
      category: this.inferCategory(topics, description),
      installCommand: `dsh plugin --profile web add github:${repo.full_name}`,
      dependencies: [],
      compatibility: [],
      lastUpdated: repo.pushed_at,
      createdAt: repo.created_at,
      metadata: { 
        fullName: repo.full_name,
        forks: repo.forks_count,
        openIssues: repo.open_issues_count,
        language: repo.language,
        defaultBranch: repo.default_branch,
      },
    }
  }

  private extractDescription(readme: string, fallback: string): string {
    if (!readme || readme.length < 50) return fallback
    // Extract first meaningful paragraph
    const lines = readme.split('\n').filter(l => l.trim().length > 20 && !l.startsWith('#') && !l.startsWith('!['))
    return lines[0]?.substring(0, 500) || fallback
  }

  private inferCategory(topics: string[] = [], description = ''): RawPluginEntry['category'] {
    const text = [...topics, description].join(' ').toLowerCase()
    if (text.includes('memory') || text.includes('记忆') || text.includes('mneme') || text.includes('mnemon')) return 'memory'
    if (text.includes('tool') || text.includes('工具') || text.includes('ssh') || text.includes('browser')) return 'tool'
    if (text.includes('workflow') || text.includes('工作流') || text.includes('flow') || text.includes('pipeline')) return 'workflow'
    if (text.includes('code') || text.includes('代码') || text.includes('coding') || text.includes('review')) return 'code'
    if (text.includes('dev') || text.includes('开发') || text.includes('debug') || text.includes('test')) return 'dev'
    if (text.includes('chat') || text.includes('聊天') || text.includes('conversation') || text.includes('timeline')) return 'chat'
    if (text.includes('ui') || text.includes('界面') || text.includes('frontend') || text.includes('theme') || text.includes('sidebar')) return 'ui'
    if (text.includes('agent') || text.includes('团队') || text.includes('team') || text.includes('swarm') || text.includes('crew') || text.includes('orchestrat')) return 'agent-team'
    if (text.includes('integration') || text.includes('集成') || text.includes('bridge') || text.includes('gateway') || text.includes('im') || text.includes('lark') || text.includes('wechat') || text.includes('discord')) return 'integration'
    return 'other'
  }
}

/** npm Registry adapter (packages with dsh-plugin keyword). */
export class NpmRegistryAdapter implements PluginSourceAdapter {
  readonly sourceType = 'npm-registry' as const
  readonly name = 'npm Registry'

  async fetch(config: AggregatorConfig): Promise<RawPluginEntry[]> {
    const registry = config.npmRegistry || 'https://registry.npmjs.org'
    const plugins: RawPluginEntry[] = []

    try {
      // Search for packages with dsh-plugin keyword
      const searchUrl = `${registry}/-/v1/search?text=keywords:dsh-plugin&size=${config.maxPluginsPerSource || 5000}`
      const response = await fetch(searchUrl, { signal: AbortSignal.timeout(30000) })
      
      if (!response.ok) {
        console.warn(`[npm-registry] Search failed: ${response.status}`)
        return plugins
      }

      const data = await response.json() as { objects: any[] }
      
      for (const obj of data.objects) {
        const pkg = obj.package
        plugins.push(this.transformPackage(pkg))
      }
    } catch (error) {
      console.warn('[npm-registry] Fetch failed:', error)
    }

    return plugins
  }

  isAvailable(config: AggregatorConfig): boolean {
    return config.enabledSources.includes('npm-registry')
  }

  private transformPackage(pkg: any): RawPluginEntry {
    const keywords = pkg.keywords || []
    const description = pkg.description || ''
    const repo = pkg.repository?.url || pkg.repository?.directory || ''

    return {
      source: 'npm-registry',
      sourceId: pkg.name,
      sourceUrl: `https://www.npmjs.com/package/${pkg.name}`,
      name: pkg.name.replace(/^@deepseek-ai\/dsh-/, '').replace(/^dsh-/, ''),
      description: description,
      shortDescription: description.substring(0, 200),
      author: pkg.author?.name || pkg.maintainers?.[0]?.name,
      repository: repo.replace(/^git\+/, '').replace(/\.git$/, ''),
      homepage: pkg.homepage,
      license: pkg.license,
      stars: 0,
      downloads: pkg.downloads?.lastMonth || 0,
      version: pkg.version,
      tags: keywords.filter((k: string) => k !== 'dsh-plugin'),
      category: this.inferCategory(keywords, description),
      installCommand: `dsh plugin --profile web add npm:${pkg.name}`,
      dependencies: Object.keys(pkg.dependencies || {}).filter(d => d.startsWith('@deepseek-ai/dsh-') || d.startsWith('dsh-')),
      compatibility: pkg.engines?.node ? [`node >=${pkg.engines.node}`] : [],
      lastUpdated: pkg.date || pkg.time?.modified,
      createdAt: pkg.time?.created,
      metadata: { 
        scope: pkg.name.startsWith('@') ? pkg.name.split('/')[0].slice(1) : undefined,
        maintainers: pkg.maintainers?.map((m: any) => m.name),
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
      },
    }
  }

  private inferCategory(keywords: string[] = [], description = ''): RawPluginEntry['category'] {
    const text = [...keywords, description].join(' ').toLowerCase()
    if (text.includes('memory') || text.includes('记忆')) return 'memory'
    if (text.includes('tool') || text.includes('工具')) return 'tool'
    if (text.includes('workflow') || text.includes('工作流') || text.includes('flow')) return 'workflow'
    if (text.includes('code') || text.includes('代码') || text.includes('coding')) return 'code'
    if (text.includes('dev') || text.includes('开发') || text.includes('debug')) return 'dev'
    if (text.includes('chat') || text.includes('聊天') || text.includes('conversation')) return 'chat'
    if (text.includes('ui') || text.includes('界面') || text.includes('frontend') || text.includes('theme')) return 'ui'
    if (text.includes('agent') || text.includes('团队') || text.includes('team') || text.includes('swarm')) return 'agent-team'
    if (text.includes('integration') || text.includes('集成') || text.includes('bridge') || text.includes('gateway')) return 'integration'
    return 'other'
  }
}

/** dsh-market adapter (in-app marketplace). */
export class DshMarketAdapter implements PluginSourceAdapter {
  readonly sourceType = 'dsh-market' as const
  readonly name = 'DSH In-App Marketplace'

  async fetch(config: AggregatorConfig): Promise<RawPluginEntry[]> {
    // This would connect to the dsh-market plugin's internal API
    // For now, return empty - the market plugin would need to expose an API
    // or we could read from its local cache
    console.log('[dsh-market] Adapter not yet implemented - requires dsh-market plugin API')
    return []
  }

  isAvailable(config: AggregatorConfig): boolean {
    return config.enabledSources.includes('dsh-market')
  }
}

/** Manual/curated entries adapter. */
export class ManualAdapter implements PluginSourceAdapter {
  readonly sourceType = 'manual' as const
  readonly name = 'Manual Curation'

  private readonly entries: RawPluginEntry[]

  constructor(entries: RawPluginEntry[] = []) {
    this.entries = entries
  }

  async fetch(): Promise<RawPluginEntry[]> {
    return [...this.entries]
  }

  isAvailable(): boolean {
    return true
  }

  addEntry(entry: RawPluginEntry): void {
    this.entries.push(entry)
  }
}

/** Registry of all source adapters. */
export const SOURCE_ADAPTERS: Record<PluginSourceType, PluginSourceAdapter> = {
  '1024store': new Store1024Adapter(),
  'github-topics': new GitHubTopicsAdapter(),
  'npm-registry': new NpmRegistryAdapter(),
  'dsh-market': new DshMarketAdapter(),
  'manual': new ManualAdapter(),
}

/** Get enabled adapters from config. */
export function getEnabledAdapters(config: AggregatorConfig): PluginSourceAdapter[] {
  return config.enabledSources
    .map(type => SOURCE_ADAPTERS[type])
    .filter((adapter): adapter is PluginSourceAdapter => adapter !== undefined && adapter.isAvailable(config))
}

/** Fetch from all enabled sources in parallel. */
export async function fetchFromAllSources(config: AggregatorConfig): Promise<Record<PluginSourceType, RawPluginEntry[]>> {
  const adapters = getEnabledAdapters(config)
  const results = await Promise.allSettled(
    adapters.map(adapter => adapter.fetch(config).then(plugins => ({ source: adapter.sourceType, plugins })))
  )

  const merged: Record<PluginSourceType, RawPluginEntry[]> = {
    '1024store': [],
    'github-topics': [],
    'npm-registry': [],
    'dsh-market': [],
    'manual': [],
  }

  for (const result of results) {
    if (result.status === 'fulfilled') {
      merged[result.value.source] = result.value.plugins
    } else {
      console.error('[plugin-aggregator] Source fetch failed:', result.reason)
    }
  }

  return merged
}
