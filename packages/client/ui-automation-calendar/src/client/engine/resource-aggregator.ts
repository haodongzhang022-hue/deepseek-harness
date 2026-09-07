/**
 * Resource aggregation engine for computing resource usage metrics.
 * @module ui-automation-calendar/engine/resource-aggregator
 */

import type {
  AutomationTaskEntry,
  CalendarSummary,
  DensityBucket,
  TokenUsage,
} from '../contract/calendar-model.ts'
import type { GranularityId, TimeRange } from '../contract/time-granularity.ts'
import { getTimeGranularityEngine } from './time-granularity-engine.ts'

/** Aggregate total token usage per bucket across a time range. */
export function aggregateTokenUsage(
  tasks: readonly AutomationTaskEntry[],
  timeRange: TimeRange,
  granularity: GranularityId,
): { timestamp: number; usage: TokenUsage }[] {
  const engine = getTimeGranularityEngine()
  const buckets = engine.createBuckets(timeRange, granularity)

  for (const task of tasks) {
    const bucketIndex = engine.findBucketIndex(task.startedAt, buckets)
    const bucket = bucketIndex >= 0 ? buckets[bucketIndex] : undefined
    if (bucket !== undefined && task.resources.tokenUsage !== undefined) {
      bucket.totalTokens += task.resources.tokenUsage.total
    }
  }

  return buckets.map(bucket => ({
    timestamp: bucket.start,
    usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: bucket.totalTokens },
  }))
}

/** Compute density buckets (task counts + normalized intensity) for the heatmap. */
export function computeDensityBuckets(
  tasks: readonly AutomationTaskEntry[],
  timeRange: TimeRange,
  granularity: GranularityId,
): DensityBucket[] {
  const engine = getTimeGranularityEngine()
  const buckets = engine.createBuckets(timeRange, granularity)

  for (const task of tasks) {
    const bucketIndex = engine.findBucketIndex(task.startedAt, buckets)
    const bucket = bucketIndex >= 0 ? buckets[bucketIndex] : undefined
    if (bucket !== undefined) {
      bucket.taskCount++
      if (task.status === 'running') bucket.activeCount++
      if (task.status === 'failed') bucket.failedCount++
      // Stuck reads as failure pressure in the density view.
      if (task.status === 'stuck') bucket.failedCount++
    }
  }

  const maxTokens = Math.max(...buckets.map(b => b.totalTokens), 1)
  const maxDuration = Math.max(...buckets.map(b => b.totalDurationMs), 1)

  return buckets.map(bucket => ({
    slot: { start: bucket.start, end: bucket.end, granularity },
    totalTasks: bucket.taskCount,
    activeTasks: bucket.activeCount,
    failedTasks: bucket.failedCount,
    stuckTasks: 0,
    resourceIntensity: Math.min(1, (bucket.totalTokens / maxTokens + bucket.totalDurationMs / maxDuration) / 2),
    tokenUsage: bucket.totalTokens,
    ...(bucket.avgCpuPercent === undefined ? {} : { cpuUsage: bucket.avgCpuPercent }),
  }))
}

/** Compute the whole-view summary statistics. */
export function computeCalendarSummary(
  tasks: readonly AutomationTaskEntry[],
  timeRange: TimeRange,
  granularity: GranularityId,
): CalendarSummary {
  const cpuTasks = tasks.filter(t => t.resources.cpu !== undefined)

  return {
    totalTasks: tasks.length,
    activeTasks: tasks.filter(t => t.status === 'running').length,
    completedTasks: tasks.filter(t => t.status === 'completed').length,
    failedTasks: tasks.filter(t => t.status === 'failed').length,
    stuckTasks: tasks.filter(t => t.status === 'stuck').length,
    totalTokens: tasks.reduce((sum, t) => sum + (t.resources.tokenUsage?.total ?? 0), 0),
    totalDurationMs: tasks.reduce((sum, t) => sum + t.resources.durationMs, 0),
    ...(cpuTasks.length > 0
      ? {
        averageCpuPercent: cpuTasks.reduce((sum, t) => sum + (t.resources.cpu?.averagePercent ?? 0), 0) / cpuTasks.length,
        peakCpuPercent: Math.max(...cpuTasks.map(t => t.resources.cpu?.peakPercent ?? 0)),
      }
      : {}),
    density: computeDensityBuckets(tasks, timeRange, granularity),
  }
}

/** Format a resource value with a unit-appropriate compact rendering. */
export function formatResourceValue(
  value: number,
  type: 'token' | 'cpu' | 'bytes' | 'duration',
): string {
  switch (type) {
    case 'token':
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
      if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
      return String(value)
    case 'cpu':
      return `${value.toFixed(1)}%`
    case 'bytes':
      if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(1)}GB`
      if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)}MB`
      if (value >= 1_024) return `${(value / 1_024).toFixed(1)}KB`
      return `${value}B`
    case 'duration':
      if (Math.abs(value) >= 3_600_000) return `${(value / 3_600_000).toFixed(1)}h`
      if (Math.abs(value) >= 60_000) return `${(value / 60_000).toFixed(1)}m`
      if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}s`
      return `${value}ms`
    default:
      return String(value)
  }
}
