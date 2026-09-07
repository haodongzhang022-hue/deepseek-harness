import { describe, expect, it } from 'vitest'
import { detectAnomalies } from '../../src/client/engine/anomaly-detector.ts'
import type { AutomationTaskEntry } from '../../src/client/contract/calendar-model.ts'

const BASE = 1_700_000_000_000
const WINDOW = { start: BASE - 1, end: BASE + 10 * 60 * 60_000 }

let seq = 0
function completed(startedAt: number, durationMs: number): AutomationTaskEntry {
  return {
    id: `c${seq++}`,
    sessionId: 's',
    startedAt,
    endedAt: startedAt + durationMs,
    lastActivityAt: startedAt + durationMs,
    status: 'completed',
    resources: { durationMs },
  }
}

function failed(startedAt: number): AutomationTaskEntry {
  return {
    id: `f${seq++}`,
    sessionId: 's',
    startedAt,
    endedAt: startedAt + 500,
    lastActivityAt: startedAt + 500,
    status: 'failed',
    resources: { durationMs: 500 },
    error: { code: 'E', message: 'boom', timestamp: startedAt },
  }
}

describe('anomaly detector', () => {
  it('reports nothing below the minimum sample count', () => {
    const report = detectAnomalies([completed(BASE, 100), completed(BASE + 1000, 100)], WINDOW)
    expect(report.findings).toHaveLength(0)
  })

  it('flags a completed task far beyond the series median duration', () => {
    const normal = [1000, 1100, 900, 1050, 950, 1000]
    const tasks = normal.map((ms, i) => completed(BASE + i * 2000, ms))
    tasks.push(completed(BASE + 20_000, 120_000))

    const report = detectAnomalies(tasks, WINDOW)
    const outliers = report.findings.filter(f => f.kind === 'duration-outlier')
    expect(outliers).toHaveLength(1)
    const outlier = outliers[0]
    if (outlier?.kind !== 'duration-outlier') throw new Error('unreachable narrowing')
    expect(outlier.durationMs).toBe(120_000)
    expect(outlier.deviation).toBeGreaterThan(2)
  })

  it('detects failure bursts of three or more consecutive failures', () => {
    const tasks = [
      failed(BASE + 0),
      failed(BASE + 1000),
      completed(BASE + 2000, 100), // success breaks any later run
      failed(BASE + 3000),
      failed(BASE + 4000),
      failed(BASE + 5000),
      failed(BASE + 6000),
    ]

    const report = detectAnomalies(tasks, WINDOW)
    const bursts = report.findings.filter(f => f.kind === 'failure-burst')
    expect(bursts).toHaveLength(1)
    const burst = bursts[0]
    if (burst?.kind !== 'failure-burst') throw new Error('unreachable narrowing')
    expect(burst.failedCount).toBe(4)
  })

  it('ignores tasks outside the queried window', () => {
    const before = [failed(WINDOW.start - 5000), failed(WINDOW.start - 4000), failed(WINDOW.start - 3000)]
    expect(detectAnomalies(before, WINDOW).findings).toHaveLength(0)
  })
})
