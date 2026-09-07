/**
 * Calendar data model types for the automation task visualization.
 * @module ui-automation-calendar/contract/calendar-model
 */

import type { GranularityId, TimeRange, TimeSlot, TimeTick } from './time-granularity.ts'

/** Task execution status. */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'stuck' | 'cancelled'

/** Task cycle configuration. */
export interface TaskCycle {
  type: 'once' | 'interval' | 'cron'
  intervalMs?: number
  cronExpression?: string
  parentCycleId?: string
}

/** Token usage for a task. */
export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

/** Resource usage for a task. */
export interface TaskResourceUsage {
  tokenUsage?: TokenUsage
  cpu?: {
    averagePercent: number
    peakPercent: number
    durationMs: number
  }
  gpu?: {
    averagePercent: number
    memoryUsedMB: number
    memoryTotalMB: number
  }
  storage?: {
    readBytes: number
    writeBytes: number
  }
  network?: {
    bytesIn: number
    bytesOut: number
  }
  durationMs: number
}

/** Error information for a failed task. */
export interface TaskError {
  code: string
  message: string
  timestamp: number
  category?: 'api' | 'model' | 'network' | 'infra' | 'resource' | 'auth'
  severity?: 'warning' | 'error' | 'critical'
  suggestion?: string
}

/** One automation task entry in the calendar. */
export interface AutomationTaskEntry {
  id: string
  sessionId: string
  agentId?: string
  agentPreset?: string
  scriptPath?: string

  scheduledAt?: number
  startedAt: number
  endedAt?: number
  lastActivityAt?: number

  status: TaskStatus

  cycle?: TaskCycle

  resources: TaskResourceUsage

  error?: TaskError

  label?: string
  description?: string
}

/** Visual properties for rendering a task cell. */
export interface TaskCellVisual {
  color: string
  opacity: number
  borderWidth: number
  borderColor?: string
  icon?: string
}

/** A task entry positioned in the calendar. */
export interface CalendarEntry {
  task: AutomationTaskEntry
  slot: TimeSlot
  visual: TaskCellVisual
}

/** A row in the calendar (agent, script, or cycle group). */
export interface CalendarRow {
  id: string
  label: string
  type: 'agent' | 'script' | 'cycle-group'
  icon?: string

  entries: CalendarEntry[]
  rowSummary: TaskResourceUsage

  expanded: boolean
  children?: CalendarRow[]
  cycleLevel?: GranularityId
}

/** Density bucket for heatmap. */
export interface DensityBucket {
  slot: TimeSlot
  totalTasks: number
  activeTasks: number
  failedTasks: number
  stuckTasks: number
  resourceIntensity: number
  tokenUsage?: number
  cpuUsage?: number
}

/** Summary statistics for the calendar view. */
export interface CalendarSummary {
  totalTasks: number
  activeTasks: number
  completedTasks: number
  failedTasks: number
  stuckTasks: number

  totalTokens: number
  totalDurationMs: number
  averageCpuPercent?: number
  peakCpuPercent?: number

  density: DensityBucket[]
}

/** Top-level calendar view model. */
export interface CalendarViewModel {
  timeRange: TimeRange
  granularity: GranularityId
  rows: CalendarRow[]
  timeTicks: TimeTick[]
  summary: CalendarSummary
}

/** Stuck task detection result. */
export interface StuckTask {
  task: AutomationTaskEntry
  stuckDuration: number
  threshold: number
  severity: 'warning' | 'critical'
  lastActivity: number
  recommendation: string
}

/** Error pattern definition. */
export interface ErrorPatternDefinition {
  id: string
  pattern: RegExp
  severity: 'warning' | 'error' | 'critical'
  category: TaskError['category']
  suggestion: string
  autoAction?: string
}

/** Error analysis result. */
export interface ErrorAnalysis {
  error: TaskError
  patterns: ErrorPatternDefinition[]
  severity: 'warning' | 'error' | 'critical'
  rootCause?: string
  suggestions: string[]
  autoActions: string[]
}

/** Detected execution pattern. */
export interface CyclePattern {
  type: 'interval' | 'cron' | 'business'
  intervalMs?: number
  expression?: string
  confidence: number
  agentId: string
  matchingTasks: string[]
}

/** Cycle group for display. */
export interface CycleGroup {
  pattern: CyclePattern
  tasks: AutomationTaskEntry[]
  mappedGranularity: GranularityId
  displayLevel: 'visible' | 'collapsed' | 'hidden'
}
