import { describe, expect, it } from 'vitest'
import { analyzeError, detectStuckTasks } from '../../src/client/engine/error-analyzer.ts'
import type { AutomationTaskEntry, TaskError } from '../../src/client/contract/calendar-model.ts'

const MIN = 60_000

function err(message: string): TaskError {
  return { code: 'X', message, timestamp: 0 }
}

function runningTask(startedAt: number, id = 'r'): AutomationTaskEntry {
  return {
    id,
    sessionId: 's',
    startedAt,
    status: 'running',
    resources: { durationMs: 0 },
  }
}

describe('error analyzer', () => {
  it('matches rate-limit errors to the increase-interval action', () => {
    const analysis = analyzeError(err('HTTP 429 too many requests, rate limit hit'))
    expect(analysis.patterns[0]?.id).toBe('rate-limit')
    expect(analysis.autoActions).toContain('increase-interval')
    expect(analysis.severity).toBe('warning')
  })

  it('matches token-limit errors to compaction', () => {
    const analysis = analyzeError(err('context length exceeded: max tokens'))
    expect(analysis.autoActions).toContain('enable-compaction')
    expect(analysis.error.category ?? analysis.patterns[0]?.category).toBe('model')
  })

  it('classifies connection refusal as critical with an ops alert', () => {
    const analysis = analyzeError(err('connect ECONNREFUSED 127.0.0.1:3080'))
    expect(analysis.severity).toBe('critical')
    expect(analysis.autoActions).toContain('alert-ops')
  })

  it('falls back to the error code when no pattern matches', () => {
    const analysis = analyzeError(err('something entirely novel happened'))
    expect(analysis.patterns).toHaveLength(0)
    expect(analysis.rootCause).toBe('error:x')
  })

  it('flags running tasks past the default threshold, longest first', () => {
    const now = 60 * MIN
    const tasks = [
      { ...runningTask(now - 10 * MIN, 'young') },
      { ...runningTask(now - 40 * MIN, 'old') },
      { ...runningTask(now - 90 * MIN, 'older') },
      { ...runningTask(now - 5 * MIN, 'done'), status: 'completed' as const, endedAt: now },
    ]

    const stuck = detectStuckTasks(tasks, undefined, now)
    expect(stuck.map(s => s.task.id)).toEqual(['older', 'old'])
    // 40min past a 30min threshold reads as warning; 90min (3x) as critical.
    expect(stuck[1]!.severity).toBe('warning')
    expect(stuck[0]!.severity).toBe('critical')
  })

  it('accepts custom thresholds and injectable clock for replay', () => {
    const now = 100 * MIN
    const task = { ...runningTask(now - 4 * MIN) }
    // Default threshold would not fire; a tight custom one does.
    const stuck = detectStuckTasks([task], { tool_call: MIN, assistant_response: MIN, default: 2 * MIN }, now)
    expect(stuck).toHaveLength(1)
    expect(detectStuckTasks([task], undefined, now)).toHaveLength(0)
  })
})
