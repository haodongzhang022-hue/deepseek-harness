import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SignalBus } from '../src/bus.ts'
import { loadTriggers, matches } from '../src/triggers.ts'
import type { Trigger } from '../src/triggers.ts'
import { buildMinutePulse, minutePulseId, derivedChannels } from '../src/pulse.ts'

const T0 = Date.UTC(2026, 7, 26, 5, 20) // 2026-08-26T05:20Z

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'signal-bus-'))
}

const BASE_TRIGGER: Trigger = {
  trigger_id: 't-exec',
  owner_session: 's1',
  match: { channel: 'minute' },
  action: { kind: 'exec', cmd: ['node', '-e', 'process.exit(0)'], timeout_s: 5 },
}

function makeBus(dir: string, fetchImpl?: typeof fetch): SignalBus {
  return new SignalBus({
    receiptsPath: join(dir, 'receipts.jsonl'),
    dshApiBase: 'http://x',
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })
}

function receipts(dir: string): Array<Record<string, unknown>> {
  const p = join(dir, 'receipts.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>)
}

describe('pulse', () => {
  it('builds a deterministic id for the same minute slot', () => {
    expect(minutePulseId(buildMinutePulse(T0).slot)).toBe('20260826T0520Z-minute')
    expect(buildMinutePulse(T0 + 30_000).pulse_id).toBe(buildMinutePulse(T0).pulse_id)
    expect(buildMinutePulse(T0 + 60_000).pulse_id).not.toBe(buildMinutePulse(T0).pulse_id)
  })

  it('derives hour and day channels without separate timers', () => {
    const slot = buildMinutePulse(T0).slot
    expect(derivedChannels({ ...slot, m: 0 })).toEqual(['hour'])
    expect(derivedChannels({ ...slot, m: 0, h: 0 })).toEqual(['hour', 'day'])
    expect(derivedChannels(slot)).toEqual([])
    expect(derivedChannels({ ...slot, m: 7 })).toEqual([])
  })
})

describe('signal bus routing', () => {
  it('dispatches matching triggers in trigger_id order and writes ok receipts', async () => {
    const dir = tempDir()
    const bus = makeBus(dir)
    const t2: Trigger = { ...BASE_TRIGGER, trigger_id: 'z-second' }
    const t1: Trigger = { ...BASE_TRIGGER, trigger_id: 'a-first' }
    const pulse = { ...buildMinutePulse(T0), channel: 'minute' as const }
    const summary = await bus.route(pulse, [t2, t1])
    expect(summary.matched).toBe(2)
    await new Promise(r => setTimeout(r, 80))
    const rs = receipts(dir)
    expect(rs.map(r => r.trigger_id)).toEqual(['a-first', 'z-second'])
    expect(rs.every(r => r.status === 'ok')).toBe(true)
  })

  it('skips non-matching channels (pure match)', async () => {
    const dir = tempDir()
    const bus = makeBus(dir)
    const pulse = { ...buildMinutePulse(T0), channel: 'hour' as const }
    const summary = await bus.route(pulse, [BASE_TRIGGER])
    expect(summary.matched).toBe(0)
  })

  it('dedups the same pulse replay via receipt history', async () => {
    const dir = tempDir()
    const pulse = { ...buildMinutePulse(T0), channel: 'minute' as const }
    const first = makeBus(dir)
    await first.route(pulse, [BASE_TRIGGER])
    await new Promise(r => setTimeout(r, 80))
    // A fresh bus instance (restart) re-seeds from the ledger — no double fire.
    const second = makeBus(dir)
    const summary = await second.route(pulse, [BASE_TRIGGER])
    expect(summary.deduped).toBe(1)
    expect(summary.dispatched).toBe(0)
  })

  it('overlap skip: second concurrent dispatch records skipped', async () => {
    const dir = tempDir()
    const slow: Trigger = { ...BASE_TRIGGER, action: { kind: 'exec', cmd: ['node', '-e', 'setTimeout(() => {}, 300)'], timeout_s: 5 } }
    const bus = makeBus(dir)
    void bus.route(buildMinutePulse(T0), [slow])
    await new Promise(r => setTimeout(r, 60))
    await bus.route({ ...buildMinutePulse(T0 + 60_000), channel: 'minute' as const }, [slow])
    await new Promise(r => setTimeout(r, 450))
    const statuses = receipts(dir).map(r => r.status)
    expect(statuses).toContain('skipped')
  })

  it('escalates to the owner session after consecutive failures', async () => {
    const dir = tempDir()
    let prompted = 0
    const fetchImpl = (async (): Promise<Response> => { prompted += 1; return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
    const failing: Trigger = {
      ...BASE_TRIGGER,
      action: { kind: 'exec', cmd: ['node', '-e', 'process.exit(3)'], timeout_s: 5 },
      failure_policy: { consecutive_fail_notify: 2, notify_transport: 'dsh-session.prompt', notify_target: 'owner-s' },
    }
    const bus = makeBus(dir, fetchImpl)
    const p1 = { ...buildMinutePulse(T0), channel: 'minute' as const }
    const p2 = { ...buildMinutePulse(T0 + 60_000), channel: 'minute' as const }
    await bus.route(p1, [failing])
    await new Promise(r => setTimeout(r, 120))
    await bus.route(p2, [failing])
    await new Promise(r => setTimeout(r, 120))
    expect(prompted).toBe(1)
    const statuses = receipts(dir).map(r => r.status)
    expect(statuses.filter(s => s === 'fail')).toHaveLength(2)
  })

  it('registry hot-load picks up newly dropped trigger files', async () => {
    const dir = tempDir()
    const triggersDir = join(dir, 'triggers')
    mkdirSync(triggersDir, { recursive: true })
    const bus = makeBus(dir)
    const pulse = { ...buildMinutePulse(T0), channel: 'minute' as const }
    expect((await bus.route(pulse, loadTriggers(triggersDir))).matched).toBe(0)
    writeFileSync(join(triggersDir, 'late.json'), JSON.stringify(BASE_TRIGGER))
    expect((await bus.route({ ...buildMinutePulse(T0 + 60_000), channel: 'minute' as const }, loadTriggers(triggersDir))).matched).toBe(1)
  })

  it('dsh-prompt action posts sessionId/mode/content to the api', async () => {
    const dir = tempDir()
    const bodies: unknown[] = []
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}') as unknown)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const promptTrigger: Trigger = {
      trigger_id: 'p',
      owner_session: 's',
      match: { channel: 'minute' },
      action: { kind: 'dsh-prompt', session_id: 'sess-9', text: 'tick {pulse_id}' },
    }
    const bus = makeBus(dir, fetchImpl)
    await bus.route({ ...buildMinutePulse(T0), channel: 'minute' as const }, [promptTrigger])
    await new Promise(r => setTimeout(r, 60))
    expect(bodies[0]).toMatchObject({ sessionId: 'sess-9', mode: 'queue' })
  })

  it('exposes in-flight dispatches through runningSnapshot', async () => {
    const dir = tempDir()
    const slow: Trigger = { ...BASE_TRIGGER, action: { kind: 'exec', cmd: ['node', '-e', 'setTimeout(() => {}, 400)'], timeout_s: 5 } }
    const bus = makeBus(dir)
    const realStart = Date.now()
    void bus.route({ ...buildMinutePulse(T0), channel: 'minute' as const }, [slow])
    await new Promise(r => setTimeout(r, 80))
    const before = bus.runningSnapshot(realStart + 80)
    expect(before.map(r => r.trigger_id)).toEqual(['t-exec'])
    expect(before[0]!.elapsedMs).toBeGreaterThanOrEqual(0)
    await new Promise(r => setTimeout(r, 450))
    expect(bus.runningSnapshot(Date.now() + 600)).toEqual([])
  })
})

describe('trigger match gates', () => {
  it('slot_weekday filters by local-timezone weekday', () => {
    // 2026-08-30T05:20Z is a Sunday; +480min local keeps the same day (13:20).
    const sunday = buildMinutePulse(Date.UTC(2026, 7, 30, 5, 20))
    expect(matches(sunday, { ...BASE_TRIGGER, match: { channel: 'minute', slot_weekday: 0 } })).toBe(true)
    expect(matches(sunday, { ...BASE_TRIGGER, match: { channel: 'minute', slot_weekday: 1 } })).toBe(false)
    // 2026-08-26T05:20Z is a Wednesday.
    const wednesday = buildMinutePulse(Date.UTC(2026, 7, 26, 5, 20))
    expect(matches(wednesday, { ...BASE_TRIGGER, match: { channel: 'minute', slot_weekday: 3 } })).toBe(true)
    expect(matches(wednesday, { ...BASE_TRIGGER, match: { channel: 'minute', slot_weekday: 0 } })).toBe(false)
    // atLocal crossing a UTC day boundary still uses the local weekday (UTC 16:00 = local 00:00 next day).
    const utcLate = buildMinutePulse(Date.UTC(2026, 7, 30, 16, 0))
    expect(matches(utcLate, { ...BASE_TRIGGER, match: { channel: 'minute', slot_weekday: 1 } })).toBe(true)
  })
})
