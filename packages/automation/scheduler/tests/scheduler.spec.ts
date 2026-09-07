import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SchedulerEngine } from '../src/engine.ts'
import type { ActionRunner, ActionResult } from '../src/action.ts'

function runner(outcomes: ActionResult[]): ActionRunner & { calls: number } {
  const state = { calls: 0 }
  return {
    get calls() { return state.calls },
    run: async () => {
      state.calls += 1
      return outcomes[Math.min(state.calls - 1, outcomes.length - 1)]!
    },
  }
}

function journalPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'scheduler-spec-')), 'journal.ndjson')
}

describe('SchedulerEngine', () => {
  it('fires immediately on first sweep and journals the outcome', async () => {
    let now = 1_000_000
    const r = runner([{ ok: true, detail: 'http 200' }])
    const path = journalPath()
    const engine = new SchedulerEngine({
      jobs: [{ name: 'dispatch', everyMs: 60_000 }],
      buildRunner: () => r,
      journalPath: path,
      now: () => now,
    })

    const first = await engine.sweep()
    expect(first.fired).toEqual([{ job: 'dispatch', ok: true }])
    expect(r.calls).toBe(1)

    // Same instant again: interval not elapsed, no double fire.
    await engine.sweep()
    expect(r.calls).toBe(1)

    now += 60_001
    await engine.sweep()
    expect(r.calls).toBe(2)

    const lines = readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { job: string; ok: boolean; detail: string; at: string })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ job: 'dispatch', ok: true, detail: 'http 200' })
    expect(lines[0]?.at).toContain('T')
  })

  it('backs off multiplicatively while a job keeps failing', async () => {
    let now = 2_000_000
    const r = runner([{ ok: false, detail: 'connect ECONNREFUSED' }])
    const engine = new SchedulerEngine({
      jobs: [{ name: 'flaky', everyMs: 10_000 }],
      buildRunner: () => r,
      journalPath: journalPath(),
      now: () => now,
    })

    await engine.sweep()
    expect(r.calls).toBe(1)

    // Failure 1: next due at +20s (base doubled). +11s is too early.
    now += 11_000
    await engine.sweep()
    expect(r.calls).toBe(1)
    now += 10_000
    await engine.sweep()
    expect(r.calls).toBe(2)

    // Failure 2: +40s. +41s fires.
    now += 41_000
    await engine.sweep()
    expect(r.calls).toBe(3)
  })

  it('recovers cleanly after a success resets the failure count', async () => {
    let now = 3_000_000
    const r = runner([{ ok: false, detail: 'boom' }, { ok: true, detail: 'exit 0' }])
    const engine = new SchedulerEngine({
      jobs: [{ name: 'j', everyMs: 5_000 }],
      buildRunner: () => r,
      journalPath: journalPath(),
      now: () => now,
    })

    await engine.sweep()
    now += 11_000 // after failure backoff
    await engine.sweep()
    expect(r.calls).toBe(2)

    // Success reset: next fire at plain +5s.
    now += 6_000
    await engine.sweep()
    expect(r.calls).toBe(3)
  })

  it('fires a one-time job exactly once at its onceAt and never again', async () => {
    let now = 4_000_000
    const r = runner([{ ok: true, detail: 'exit 0' }])
    const path = journalPath()
    const engine = new SchedulerEngine({
      jobs: [{ name: 'once', onceAt: 5_000_000 }],
      buildRunner: () => r,
      journalPath: path,
      now: () => now,
    })

    // Before the due instant: no fire, and the engine reports the wait.
    await engine.sweep()
    expect(r.calls).toBe(0)
    expect(engine.msUntilNextDue()).toBe(1_000_000)

    // At the due instant: fires exactly once.
    now = 5_000_000
    await engine.sweep()
    expect(r.calls).toBe(1)

    // Far past due: never fires again on repeated sweeps.
    now += 3_600_000
    await engine.sweep()
    await engine.sweep()
    expect(r.calls).toBe(1)

    const lines = readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { job: string; ok: boolean })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ job: 'once', ok: true })
  })
})
