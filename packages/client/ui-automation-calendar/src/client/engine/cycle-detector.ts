/**
 * Cycle detection engine for identifying periodic tasks.
 * @module ui-automation-calendar/engine/cycle-detector
 */

import type {
  AutomationTaskEntry,
  CycleGroup,
  CyclePattern,
} from '../contract/calendar-model.ts'
import { getTimeGranularityEngine } from './time-granularity-engine.ts'

/** Minimum tasks required to detect a cycle. */
const MIN_TASKS_FOR_DETECTION = 3

/** Maximum deviation from mean interval to consider as cycle (fraction). */
const INTERVAL_DEVIATION_THRESHOLD = 0.2

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** Detect execution cycles for a list of tasks, grouped per agent. */
export function detectCycles(tasks: readonly AutomationTaskEntry[]): CycleGroup[] {
  const grouped = groupByAgent(tasks)
  const cycles: CycleGroup[] = []

  for (const [agentId, agentTasks] of grouped) {
    for (const pattern of detectPatternsForAgent(agentId, agentTasks)) {
      // Re-resolve member tasks through the pattern's claimed id set.
      const matchingTasks = agentTasks.filter(t => pattern.matchingTasks.includes(t.id))

      const engine = getTimeGranularityEngine()
      const mappedGranularity = pattern.intervalMs !== undefined
        ? engine.mapIntervalToGranularity(pattern.intervalMs)
        : 'hour'

      cycles.push({
        pattern,
        tasks: matchingTasks,
        mappedGranularity,
        displayLevel: 'visible',
      })
    }
  }

  return cycles
}

/** Group tasks by agent id, preset, or script path. */
function groupByAgent(tasks: readonly AutomationTaskEntry[]): Map<string, AutomationTaskEntry[]> {
  const grouped = new Map<string, AutomationTaskEntry[]>()

  for (const task of tasks) {
    const key = task.agentId ?? task.agentPreset ?? task.scriptPath ?? 'unknown'
    const group = grouped.get(key) ?? []
    group.push(task)
    grouped.set(key, group)
  }

  return grouped
}

/**
 * Detect patterns for one agent's tasks. One task belongs to at most one
 * pattern: a strict hourly series also "fires in the same hour" every day,
 * so candidates compete by confidence - strongest first keeps its members,
 * and a candidate dissolves when exclusivity leaves it too small.
 */
function detectPatternsForAgent(agentId: string, tasks: readonly AutomationTaskEntry[]): CyclePattern[] {
  if (tasks.length < MIN_TASKS_FOR_DETECTION) return []

  const sorted = [...tasks].sort((a, b) => a.startedAt - b.startedAt)

  const intervals: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const previous = sorted[i - 1]
    if (current === undefined || previous === undefined) continue
    intervals.push(current.startedAt - previous.startedAt)
  }

  const patterns: CyclePattern[] = []
  const candidates: CyclePattern[] = []

  const fixedPattern = detectFixedInterval(intervals, sorted, agentId)
  if (fixedPattern) candidates.push(fixedPattern)

  const cronPattern = detectCronPattern(sorted, agentId)
  if (cronPattern) candidates.push(cronPattern)

  candidates.sort((a, b) => b.confidence - a.confidence)

  const claimed = new Set<string>()
  for (const candidate of candidates) {
    candidate.matchingTasks = candidate.matchingTasks.filter(id => !claimed.has(id))
    if (candidate.matchingTasks.length < MIN_TASKS_FOR_DETECTION) continue
    for (const id of candidate.matchingTasks) claimed.add(id)
    patterns.push(candidate)
  }

  return patterns
}

/** Detect fixed-interval patterns; confidence rises as variance falls. */
function detectFixedInterval(
  intervals: readonly number[],
  tasks: readonly AutomationTaskEntry[],
  agentId: string,
): CyclePattern | null {
  if (intervals.length < 2) return null

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
  if (mean <= 0) return null

  const withinThreshold = intervals.every(interval =>
    Math.abs(interval - mean) / mean <= INTERVAL_DEVIATION_THRESHOLD,
  )
  if (!withinThreshold) return null

  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / intervals.length
  const stdDev = Math.sqrt(variance)
  const confidence = Math.max(0, 1 - stdDev / mean)

  if (confidence < 0.5) return null

  return {
    type: 'interval',
    intervalMs: Math.round(mean),
    confidence,
    agentId,
    matchingTasks: tasks.map(t => t.id),
  }
}

/** Detect cron-shaped daily/weekly dominance patterns. */
function detectCronPattern(
  tasks: readonly AutomationTaskEntry[],
  agentId: string,
): CyclePattern | null {
  if (tasks.length < MIN_TASKS_FOR_DETECTION) return null

  const daily = detectDailyPattern(tasks, agentId)
  if (daily) return daily

  return detectWeeklyPattern(tasks, agentId)
}

/** Daily pattern: one hour-of-day dominates the start times. */
function detectDailyPattern(
  tasks: readonly AutomationTaskEntry[],
  agentId: string,
): CyclePattern | null {
  const hourGroups = new Map<number, number>()
  for (const task of tasks) {
    const hour = new Date(task.startedAt).getHours()
    hourGroups.set(hour, (hourGroups.get(hour) ?? 0) + 1)
  }

  let maxCount = 0
  let dominantHour = 0
  for (const [hour, count] of hourGroups) {
    if (count > maxCount) {
      maxCount = count
      dominantHour = hour
    }
  }

  if (maxCount / tasks.length >= 0.6) {
    return {
      type: 'cron',
      expression: `0 ${dominantHour} * * *`,
      confidence: maxCount / tasks.length,
      agentId,
      matchingTasks: tasks
        .filter(t => new Date(t.startedAt).getHours() === dominantHour)
        .map(t => t.id),
    }
  }

  return null
}

/** Weekly pattern: one day-of-week dominates the start times. */
function detectWeeklyPattern(
  tasks: readonly AutomationTaskEntry[],
  agentId: string,
): CyclePattern | null {
  const dayGroups = new Map<number, number>()
  for (const task of tasks) {
    const day = new Date(task.startedAt).getDay()
    dayGroups.set(day, (dayGroups.get(day) ?? 0) + 1)
  }

  let maxCount = 0
  let dominantDay = 0
  for (const [day, count] of dayGroups) {
    if (count > maxCount) {
      maxCount = count
      dominantDay = day
    }
  }

  if (maxCount / tasks.length >= 0.5) {
    return {
      type: 'cron',
      expression: `0 9 * * ${DAY_NAMES[dominantDay]}`,
      confidence: maxCount / tasks.length,
      agentId,
      matchingTasks: tasks
        .filter(t => new Date(t.startedAt).getDay() === dominantDay)
        .map(t => t.id),
    }
  }

  return null
}

/** Attach the display level to each cycle (all visible today). */
export function hierarchizeCycles(cycles: readonly CycleGroup[]): CycleGroup[] {
  return cycles.map(cycle => ({ ...cycle, displayLevel: 'visible' as const }))
}
