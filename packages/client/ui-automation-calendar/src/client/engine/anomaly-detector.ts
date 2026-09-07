/**
 * Structured anomaly detection over a task window: duration outliers and
 * failure bursts, each as a typed finding.
 * @module ui-automation-calendar/engine/anomaly-detector
 */

import type { AutomationTaskEntry } from '../contract/calendar-model.ts'
import type { TimeRange } from '../contract/time-granularity.ts'

/** Discriminated anomaly findings. Merge-extensible via documented default. */
export type AnomalyFinding =
  | {
    readonly kind: 'duration-outlier'
    readonly taskId: string
    /** Robust z of the task's duration against its series. */
    readonly deviation: number
    readonly durationMs: number
    readonly medianDurationMs: number
  }
  | {
    readonly kind: 'failure-burst'
    /** Failed tasks inside the burst window. */
    readonly taskIds: readonly string[]
    readonly failedCount: number
    readonly windowMs: number
  }

/** Whole-window anomaly report consumed by the alert banner. */
export interface AnomalyReport {
  readonly findings: readonly AnomalyFinding[]
}

/** Robust z above which a duration counts as an outlier. */
const DURATION_Z_THRESHOLD = 2

/** Consecutive failures that constitute a burst. */
const FAILURE_BURST_COUNT = 3

/** Too few samples to call anything. */
const MIN_SERIES_SAMPLES = 5

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const middle = sorted[mid]
  if (middle === undefined) return 0
  if (sorted.length % 2 === 1) return middle
  const beforeMiddle = sorted[mid - 1]
  return beforeMiddle === undefined ? middle : (beforeMiddle + middle) / 2
}

/** Detect structured anomalies in one time-ordered task window. */
export function detectAnomalies(
  tasks: readonly AutomationTaskEntry[],
  timeRange: TimeRange,
): AnomalyReport {
  if (tasks.length < MIN_SERIES_SAMPLES) return { findings: [] }

  return {
    findings: [...durationOutliers(tasks), ...failureBursts(tasks, timeRange)],
  }
}

/** Completed tasks whose duration deviates > 2 robust-z from the series center. */
function durationOutliers(tasks: readonly AutomationTaskEntry[]): AnomalyFinding[] {
  const completed = tasks.filter(t => t.status === 'completed')
  if (completed.length < MIN_SERIES_SAMPLES) return []

  const durations = completed.map(t => t.resources.durationMs)
  const center = median(durations)
  const mad = median(durations.map(d => Math.abs(d - center)))

  // Zero MAD means every sample matches the median exactly - nothing to flag.
  if (mad === 0) return []

  // Robust z-score: 0.6745 sigma ~= MAD for normal data.
  return completed
    .map((task, i) => {
      const duration = durations[i]
      return { task, z: duration === undefined ? 0 : (0.6745 * (duration - center)) / mad }
    })
    .filter(({ z }) => Math.abs(z) > DURATION_Z_THRESHOLD)
    .map(({ task, z }) => ({
      kind: 'duration-outlier' as const,
      taskId: task.id,
      deviation: Math.abs(z),
      durationMs: task.resources.durationMs,
      medianDurationMs: center,
    }))
}

/** Runs of FAILURE_BURST_COUNT+ consecutive failures inside the window. */
function failureBursts(
  tasks: readonly AutomationTaskEntry[],
  timeRange: TimeRange,
): AnomalyFinding[] {
  const ordered = [...tasks].sort((a, b) => a.startedAt - b.startedAt)
  const findings: AnomalyFinding[] = []
  let burst: AutomationTaskEntry[] = []

  const flush = (): void => {
    const last = burst[burst.length - 1]
    const first = burst[0]
    if (burst.length >= FAILURE_BURST_COUNT && last !== undefined && first !== undefined) {
      findings.push({
        kind: 'failure-burst',
        taskIds: burst.map(t => t.id),
        failedCount: burst.length,
        windowMs: last.startedAt - first.startedAt,
      })
    }
    burst = []
  }

  for (const task of ordered) {
    if (task.startedAt < timeRange.start || task.startedAt > timeRange.end) continue
    if (task.status === 'failed') {
      burst.push(task)
    } else {
      flush()
    }
  }
  flush()

  return findings
}
