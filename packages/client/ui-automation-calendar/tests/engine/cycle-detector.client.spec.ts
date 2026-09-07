import { describe, expect, it } from 'vitest'
import { detectCycles } from '../../src/client/engine/cycle-detector.ts'
import type { AutomationTaskEntry } from '../../src/client/contract/calendar-model.ts'

const BASE = 1_700_000_000_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

let seq = 0
function task(startedAt: number, agentId: string): AutomationTaskEntry {
  return {
    id: `t${seq++}`,
    sessionId: 's',
    agentId,
    startedAt,
    endedAt: startedAt + 60_000,
    lastActivityAt: startedAt + 60_000,
    status: 'completed',
    resources: { durationMs: 60_000 },
  }
}

describe('cycle detector', () => {
  it('detects a strict hourly series as one fixed-interval group', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(BASE + i * HOUR, 'a'))
    const cycles = detectCycles(tasks)

    expect(cycles).toHaveLength(1)
    expect(cycles[0]!.pattern.type).toBe('interval')
    expect(cycles[0]!.pattern.intervalMs).toBe(HOUR)
    expect(cycles[0]!.mappedGranularity).toBe('hour')
  })

  it('maps a daily cadence onto the day granularity', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(BASE + i * DAY, 'daily'))
    const cycles = detectCycles(tasks)

    expect(cycles[0]!.mappedGranularity).toBe('day')
  })

  it('claims each task into at most one pattern (interval beats daily on ties)', () => {
    // A strict hourly series ALSO fires in the same hour every day; the
    // exclusivity pass must leave one group, not two overlapping ones.
    const tasks = Array.from({ length: 6 }, (_, i) => task(BASE + i * HOUR, 'b'))
    const cycles = detectCycles(tasks)

    expect(cycles).toHaveLength(1)
    const claimedIds = cycles.flatMap(c => c.tasks.map(t => t.id))
    expect(new Set(claimedIds).size).toBe(claimedIds.length)
  })

  it('detects a daily-hour cron for jittered intervals within one hour-of-day', () => {
    const MIN = 60_000
    const offsets = [0, DAY, 2 * DAY + 25 * MIN, 3 * DAY + 10 * MIN]
    const tasks = offsets.map(offset => task(BASE + offset, 'cron-b'))
    const cycles = detectCycles(tasks)

    // Jitter breaks fixed-interval; the shared hour-of-day carries the group.
    expect(cycles.some(c => c.pattern.type === 'cron')).toBe(true)
  })

  it('needs at least three tasks before calling anything', () => {
    expect(detectCycles([task(BASE, 'x'), task(BASE + HOUR, 'x')])).toHaveLength(0)
  })
})
