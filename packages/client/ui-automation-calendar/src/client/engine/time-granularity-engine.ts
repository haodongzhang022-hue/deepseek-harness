/**
 * Time granularity engine for aggregating events into time buckets.
 * @module ui-automation-calendar/engine/time-granularity-engine
 */

import type {
  CustomGranularity,
  GranularityConfig,
  GranularityId,
  TimeRange,
  TimeTick,
} from '../contract/time-granularity.ts'
import { BUILTIN_GRANULARITIES } from '../contract/time-granularity.ts'

/** Time bucket with aggregated metrics. */
export interface TimeBucket {
  start: number
  end: number
  granularity: GranularityId
  taskCount: number
  activeCount: number
  failedCount: number
  totalTokens: number
  totalDurationMs: number
  avgCpuPercent?: number
}

/** localStorage key holding the persisted custom-granularity list. */
const CUSTOM_GRANULARITIES_STORAGE_KEY = 'dsh.automation-calendar.custom-granularities'

/** Read the persisted custom-granularity list; corrupt entries are dropped. */
function loadPersistedCustomGranularities(): CustomGranularity[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_GRANULARITIES_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is CustomGranularity =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as CustomGranularity).id === 'string'
      && typeof (entry as CustomGranularity).intervalMs === 'number'
      && (entry as CustomGranularity).intervalMs > 0,
    )
  } catch {
    // Private-mode quota errors or malformed JSON leave builtins only.
    return []
  }
}

/** Engine for time-based aggregation. */
export class TimeGranularityEngine {
  private readonly customGranularities = new Map<string, CustomGranularity>()

  constructor() {
    for (const config of loadPersistedCustomGranularities()) {
      this.customGranularities.set(config.id, config)
    }
  }

  /** Register a custom granularity (memory only). */
  registerCustomGranularity(config: CustomGranularity): () => void {
    this.customGranularities.set(config.id, config)
    return () => { this.customGranularities.delete(config.id) }
  }

  /**
   * Register AND persist a custom granularity across reloads.
   * @returns a disposer that also removes the persisted entry.
   */
  addPersistentCustomGranularity(config: CustomGranularity): () => void {
    this.registerCustomGranularity(config)
    try {
      const current = loadPersistedCustomGranularities().filter(c => c.id !== config.id)
      window.localStorage.setItem(
        CUSTOM_GRANULARITIES_STORAGE_KEY,
        JSON.stringify([...current, config]),
      )
    } catch {
      // Quota/private-mode failures keep the in-memory registration; the
      // level simply does not survive reload.
    }
    return () => {
      this.removePersistentCustomGranularity(config.id)
    }
  }

  /**
   * Remove a custom granularity from the registry AND persisted storage.
   * @returns true when an entry with that id existed.
   */
  removePersistentCustomGranularity(id: string): boolean {
    const existed = this.customGranularities.delete(id)
    try {
      window.localStorage.setItem(
        CUSTOM_GRANULARITIES_STORAGE_KEY,
        JSON.stringify(loadPersistedCustomGranularities().filter(c => c.id !== id)),
      )
    } catch {
      // Quota/private-mode failures keep other persisted entries untouched.
    }
    return existed
  }

  /** List currently registered custom granularities. */
  getCustomGranularities(): CustomGranularity[] {
    return Array.from(this.customGranularities.values())
  }

  /** Get all available granularities (builtin + custom), coarsest last. */
  getAvailableGranularities(): GranularityConfig[] {
    return [...Array.from(BUILTIN_GRANULARITIES.values()), ...this.getCustomGranularities()]
      .sort((a, b) => a.intervalMs - b.intervalMs)
  }

  /** Get granularity config by id (builtin or custom). */
  getConfig(id: GranularityId): GranularityConfig | undefined {
    return BUILTIN_GRANULARITIES.get(id as never) ?? this.customGranularities.get(id)
  }

  /** Create empty time buckets covering exactly one interval each. */
  createBuckets(timeRange: TimeRange, granularity: GranularityId): TimeBucket[] {
    const config = this.getConfig(granularity)
    if (!config) throw new Error(`Unknown granularity: ${granularity}`)

    const bucketCount = Math.ceil((timeRange.end - timeRange.start) / config.intervalMs)
    const buckets: TimeBucket[] = []

    for (let i = 0; i < bucketCount; i++) {
      buckets.push({
        start: timeRange.start + i * config.intervalMs,
        end: timeRange.start + (i + 1) * config.intervalMs,
        granularity,
        taskCount: 0,
        activeCount: 0,
        failedCount: 0,
        totalTokens: 0,
        totalDurationMs: 0,
      })
    }

    return buckets
  }

  /** Binary-search the bucket index holding a timestamp; -1 when outside. */
  findBucketIndex(timestamp: number, buckets: readonly TimeBucket[]): number {
    if (buckets.length === 0) return -1

    let low = 0
    let high = buckets.length - 1

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const bucket = buckets[mid]
      if (bucket === undefined) return -1

      if (timestamp < bucket.start) {
        high = mid - 1
      } else if (timestamp >= bucket.end) {
        low = mid + 1
      } else {
        return mid
      }
    }

    return -1
  }

  /** Generate ticks for axis rendering; every Nth tick carries its label. */
  generateTicks(timeRange: TimeRange, granularity: GranularityId, maxTicks = 20): TimeTick[] {
    const config = this.getConfig(granularity)
    if (!config || config.intervalMs <= 0) return []

    const ticks: TimeTick[] = []
    const majorEvery = Math.max(1, Math.floor(maxTicks / 5))

    let current = timeRange.start
    let index = 0

    while (current <= timeRange.end) {
      const isMajor = index % majorEvery === 0
      ticks.push({
        time: current,
        label: isMajor ? this.formatTickTime(current, config) : '',
        major: isMajor,
      })

      current += config.intervalMs
      index++
    }

    return ticks
  }

  /** Map an interval onto the smallest registered level at or above it. */
  mapIntervalToGranularity(intervalMs: number): GranularityId {
    const granularities = this.getAvailableGranularities()

    for (const g of granularities) {
      if (g.intervalMs >= intervalMs) {
        return g.id
      }
    }

    return granularities[granularities.length - 1]?.id ?? 'month'
  }

  /** Drill one bucket down into finer buckets (events are not re-split). */
  drillDown(bucket: TimeBucket, targetGranularity: GranularityId): TimeBucket[] {
    return this.createBuckets({ start: bucket.start, end: bucket.end }, targetGranularity)
  }

  /** Roll fine buckets up into one coarser bucket preserving totals. */
  rollUp(buckets: readonly TimeBucket[], targetGranularity: GranularityId): TimeBucket | null {
    if (buckets.length === 0) return null
    if (!this.getConfig(targetGranularity)) return null
    const first = buckets[0]
    const last = buckets[buckets.length - 1]
    if (first === undefined || last === undefined) return null

    return {
      start: first.start,
      end: last.end,
      granularity: targetGranularity,
      taskCount: buckets.reduce((sum, b) => sum + b.taskCount, 0),
      activeCount: buckets.reduce((sum, b) => sum + b.activeCount, 0),
      failedCount: buckets.reduce((sum, b) => sum + b.failedCount, 0),
      totalTokens: buckets.reduce((sum, b) => sum + b.totalTokens, 0),
      totalDurationMs: buckets.reduce((sum, b) => sum + b.totalDurationMs, 0),
    }
  }

  private formatTickTime(timestamp: number, config: GranularityConfig): string {
    const date = new Date(timestamp)

    if (config.tickFormat.includes('yyyy')) {
      return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`
    }
    if (config.tickFormat.includes('MM/dd')) {
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
    }
    if (config.tickFormat.includes('HH:mm')) {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }
    if (config.tickFormat.includes('HH')) {
      return `${String(date.getHours()).padStart(2, '0')}:00`
    }
    if (config.tickFormat.includes('mm')) {
      return `${String(date.getMinutes()).padStart(2, '0')}min`
    }
    if (config.tickFormat.includes('ss')) {
      return `${String(date.getSeconds()).padStart(2, '0')}s`
    }
    if (config.tickFormat.includes('SSS')) {
      return '${date.getMilliseconds()}ms'
    }

    return date.toLocaleTimeString()
  }
}

/** Singleton engine instance (object-layer state; no React identity). */
let engineInstance: TimeGranularityEngine | null = null

/** Get or create the singleton engine. */
export function getTimeGranularityEngine(): TimeGranularityEngine {
  if (!engineInstance) {
    engineInstance = new TimeGranularityEngine()
  }
  return engineInstance
}
