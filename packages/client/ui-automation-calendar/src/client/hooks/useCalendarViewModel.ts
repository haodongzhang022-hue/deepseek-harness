/**
 * Hook computing the calendar view model from the conversation snapshot.
 * @module ui-automation-calendar/client/hooks/useCalendarViewModel
 */

import { useMemo } from 'react'
import type {
  AutomationTaskEntry,
  CalendarRow,
  CalendarViewModel,
  StuckTask,
  TaskStatus,
} from '../contract/calendar-model.ts'
import type { GranularityId, TimeRange } from '../contract/time-granularity.ts'
import { getTimeGranularityEngine } from '../engine/time-granularity-engine.ts'
import { detectCycles, hierarchizeCycles } from '../engine/cycle-detector.ts'
import { computeCalendarSummary } from '../engine/resource-aggregator.ts'
import { detectStuckTasks } from '../engine/error-analyzer.ts'
import { detectAnomalies } from '../engine/anomaly-detector.ts'
import type { AnomalyReport } from '../engine/anomaly-detector.ts'

const STATUS_COLORS: Record<TaskStatus, string> = {
  running: '#4CAF50',
  completed: '#8BC34A',
  failed: '#F44336',
  stuck: '#FF9800',
  cancelled: '#9E9E9E',
}

/** One snapshot turn timing as the hook consumes it (decoupled from runtime types). */
export interface TurnTiming {
  readonly startTime: number
  readonly endTime?: number
}

/** Build task entries from the snapshot's authoritative turn timings. */
export function snapshotToTasks(
  turnTimings: readonly TurnTiming[],
  sessionId: string,
  running: boolean,
  lastAgentError: string | null,
): AutomationTaskEntry[] {
  const tasks: AutomationTaskEntry[] = []
  const now = Date.now()

  for (const [index, timing] of turnTimings.entries()) {
    const endedAt = timing.endTime
    const durationMs = (endedAt ?? now) - timing.startTime

    const status: TaskStatus = endedAt === undefined
      ? (running ? 'running' : 'cancelled')
      : 'completed'

    tasks.push({
      id: `turn-${index}-${timing.startTime}`,
      sessionId,
      startedAt: timing.startTime,
      endedAt,
      lastActivityAt: endedAt ?? now,
      status,
      label: `Turn ${index}`,
      resources: { durationMs },
      error: lastAgentError !== null && status === 'cancelled'
        ? { code: 'AGENT_ERROR', message: lastAgentError, timestamp: now }
        : undefined,
    })
  }

  return tasks.sort((a, b) => a.startedAt - b.startedAt)
}

/** Aggregate row-level resources from member entries. */
function aggregateRowResources(entries: readonly AutomationTaskEntry[]) {
  let totalTokens = 0
  let durationMs = 0
  for (const entry of entries) {
    durationMs += entry.resources.durationMs
    totalTokens += entry.resources.tokenUsage?.total ?? 0
  }
  return {
    durationMs,
    tokenUsage: totalTokens > 0
      ? { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: totalTokens }
      : undefined,
  }
}

function toEntry(task: AutomationTaskEntry, granularity: GranularityId, now: number) {
  return {
    task,
    slot: {
      start: task.startedAt,
      end: task.endedAt ?? Math.min(now, task.startedAt + Math.max(task.resources.durationMs, 1)),
      granularity,
    },
    visual: {
      color: STATUS_COLORS[task.status],
      opacity: 1,
      borderWidth: task.error !== undefined ? 2 : 0,
      borderColor: task.error !== undefined ? STATUS_COLORS.failed : undefined,
    },
  }
}

/** Group tasks into calendar rows: cycle groups first, then singles. */
export function groupTasksIntoRows(
  tasks: readonly AutomationTaskEntry[],
  granularity: GranularityId,
  expandedCycleGroups: ReadonlySet<string>,
): CalendarRow[] {
  const now = Date.now()
  const cycles = hierarchizeCycles(detectCycles(tasks))
  const rows: CalendarRow[] = []
  const claimed = new Set<string>()

  for (const cycle of cycles) {
    if (cycle.displayLevel === 'hidden') continue
    if (cycle.tasks.length === 0) continue

    const groupId = `cycle-${cycle.pattern.agentId}-${cycle.pattern.type}`
    const isExpanded = expandedCycleGroups.has(groupId)

    const childRows: CalendarRow[] = cycle.tasks.map(task => ({
      id: task.id,
      label: task.label ?? task.id,
      type: 'agent' as const,
      icon: '🤖',
      entries: [toEntry(task, granularity, now)],
      rowSummary: aggregateRowResources([task]),
      expanded: false,
    }))

    rows.push({
      id: groupId,
      label: `${cycle.pattern.agentId} (${cycle.pattern.type} · ${Math.round(cycle.pattern.confidence * 100)}%)`,
      type: 'cycle-group',
      icon: '🔄',
      entries: cycle.tasks.map(t => toEntry(t, granularity, now)),
      rowSummary: aggregateRowResources(cycle.tasks),
      expanded: isExpanded,
      children: isExpanded ? childRows : undefined,
      cycleLevel: cycle.mappedGranularity,
    })

    for (const task of cycle.tasks) claimed.add(task.id)
  }

  for (const task of tasks) {
    if (claimed.has(task.id)) continue
    rows.push({
      id: task.id,
      label: task.label ?? task.scriptPath ?? task.id,
      type: task.scriptPath !== undefined ? 'script' : 'agent',
      icon: task.scriptPath !== undefined ? '📜' : '🤖',
      entries: [toEntry(task, granularity, now)],
      rowSummary: aggregateRowResources([task]),
      expanded: false,
    })
  }

  return rows
}

/** Hook input: pre-selected snapshot slices (selector results keep renders cheap). */
export interface CalendarModelInput {
  readonly turnTimings: readonly TurnTiming[]
  readonly running: boolean
  readonly lastAgentError: string | null
  readonly sessionId: string
}

/** Compute the full calendar view model from snapshot slices. */
export function useCalendarViewModel(
  input: CalendarModelInput | undefined,
  timeRange: TimeRange,
  granularity: GranularityId,
  expandedCycleGroups: ReadonlySet<string>,
): {
  viewModel: CalendarViewModel
  stuckTasks: StuckTask[]
  anomalies: AnomalyReport
} {
  const engine = getTimeGranularityEngine()

  return useMemo(() => {
    if (input === undefined) {
      return {
        viewModel: {
          timeRange,
          granularity,
          rows: [],
          timeTicks: engine.generateTicks(timeRange, granularity),
          summary: computeCalendarSummary([], timeRange, granularity),
        },
        stuckTasks: [],
        anomalies: { findings: [] },
      }
    }

    const allTasks = snapshotToTasks(input.turnTimings, input.sessionId, input.running, input.lastAgentError)
    const tasks = allTasks.filter(t =>
      t.startedAt >= timeRange.start && t.startedAt <= timeRange.end,
    )

    const viewModel: CalendarViewModel = {
      timeRange,
      granularity,
      rows: groupTasksIntoRows(tasks, granularity, expandedCycleGroups),
      timeTicks: engine.generateTicks(timeRange, granularity),
      summary: computeCalendarSummary(tasks, timeRange, granularity),
    }

    return {
      viewModel,
      stuckTasks: detectStuckTasks(tasks),
      anomalies: detectAnomalies(tasks, timeRange),
    }
  }, [
    input?.turnTimings,
    input?.running,
    input?.lastAgentError,
    input?.sessionId,
    timeRange.start,
    timeRange.end,
    granularity,
    expandedCycleGroups,
    engine,
  ])
}
