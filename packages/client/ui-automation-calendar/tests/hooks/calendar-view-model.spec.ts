import { describe, expect, it, vi } from 'vitest'
// The hook composes over useMemo; outside a renderer we inline the factory.
vi.mock('react', () => ({ useMemo: <T>(factory: () => T) => factory() }))

import { snapshotToTasks, groupTasksIntoRows, useCalendarViewModel } from '../../src/client/hooks/useCalendarViewModel.ts'
import type { CalendarModelInput, TurnTiming } from '../../src/client/hooks/useCalendarViewModel.ts'

const MIN = 60_000
const HOUR = 3_600_000
const BASE = 1_700_000_000_000

function timing(startTime: number, endTime?: number): TurnTiming {
  return { startTime, endTime }
}

function input(turnTimings: TurnTiming[], overrides: Partial<CalendarModelInput> = {}): CalendarModelInput {
  return { turnTimings, running: false, lastAgentError: null, sessionId: 'sess-1', ...overrides }
}

describe('snapshotToTasks', () => {
  it('maps closed turns to completed entries with real durations', () => {
    const tasks = snapshotToTasks([timing(BASE, BASE + 5000)], 's1', false, null)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      sessionId: 's1',
      status: 'completed',
      startedAt: BASE,
      endedAt: BASE + 5000,
      resources: { durationMs: 5000 },
    })
  })

  it('marks an open turn running while the session is live', () => {
    const tasks = snapshotToTasks([timing(BASE)], 's1', true, null)
    expect(tasks[0]!.status).toBe('running')
  })

  it('marks an open turn cancelled with AGENT_ERROR when the session died on error', () => {
    const tasks = snapshotToTasks([timing(BASE)], 's1', false, 'boom: model exploded')

    expect(tasks[0]!.status).toBe('cancelled')
    expect(tasks[0]!.error).toMatchObject({ code: 'AGENT_ERROR', message: 'boom: model exploded' })
  })
})

describe('groupTasksIntoRows', () => {
  it('keeps non-periodic tasks as plain agent rows', () => {
    const rows = groupTasksIntoRows(
      snapshotToTasks([timing(BASE, BASE + 100), timing(BASE + 9 * HOUR, BASE + 9 * HOUR + 100)], 's', false, null),
      'hour',
      new Set(),
    )

    expect(rows.every(r => r.type !== 'cycle-group')).toBe(true)
  })

  it('folds a strict hourly series into one cycle-group row claiming its members', () => {
    const tasks = snapshotToTasks(
      Array.from({ length: 5 }, (_, i) => timing(BASE + i * HOUR, BASE + i * HOUR + 100)),
      's',
      false,
      null,
    )
    const rows = groupTasksIntoRows(tasks, 'hour', new Set())

    const groups = rows.filter(r => r.type === 'cycle-group')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.id).toMatch(/^cycle-.+-interval$/)
    expect(groups[0]!.entries).toHaveLength(5)
    // Members must not also appear as duplicate single rows.
    expect(rows).toHaveLength(1)
  })

  it('expands a cycle group into child rows only when its id is in the expanded set', () => {
    const tasks = snapshotToTasks(
      Array.from({ length: 4 }, (_, i) => timing(BASE + i * HOUR, BASE + i * HOUR + 100)),
      's',
      false,
      null,
    )
    const collapsed = groupTasksIntoRows(tasks, 'hour', new Set())
    const groupId = collapsed.find(r => r.type === 'cycle-group')!.id

    const expanded = groupTasksIntoRows(tasks, 'hour', new Set([groupId]))
    const expandedGroup = expanded.find(r => r.id === groupId)!
    expect(expandedGroup.children).toHaveLength(4)
  })
})

describe('useCalendarViewModel', () => {
  it('returns an empty model for absent input', () => {
    const { viewModel, stuckTasks, anomalies } = useCalendarViewModel(undefined, { start: 0, end: HOUR }, 'hour', new Set())

    expect(viewModel.rows).toHaveLength(0)
    expect(viewModel.timeTicks.length).toBeGreaterThan(0)
    expect(stuckTasks).toHaveLength(0)
    expect(anomalies.findings).toHaveLength(0)
  })

  it('filters tasks to the queried window and surfaces stuck running turns', () => {
    const now = Date.now()
    const inside = timing(now - 60 * MIN, now - 59 * MIN)
    const outside = timing(now - 48 * HOUR, now - 47 * HOUR)
    const stillRunning = timing(now - 45 * MIN) // open + running → stuck vs 30min default

    const result = useCalendarViewModel(
      input([inside, outside, stillRunning], { running: true }),
      { start: now - 2 * HOUR, end: now },
      'hour',
      new Set(),
    )

    expect(result.viewModel.summary.totalTasks).toBe(2)
    expect(result.stuckTasks.map(s => s.task.label)).toContain('Turn 2')
  })
})
