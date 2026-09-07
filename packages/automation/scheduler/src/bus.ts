/**
 * Signal bus: match a pulse against the registry, dedup by receipt history,
 * dispatch each hit independently (trigger_id order for reproducible audits),
 * and append one receipt per attempt. Consecutive failures escalate to the
 * owner session through the dsh prompt API — never log-only.
 * @module ui-automation-scheduler/bus
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import type { ClockPulse } from './pulse.ts'
import { matches, type Trigger } from './triggers.ts'

/** Receipt status vocabulary (append-only receipts ledger). */
export type ReceiptStatus = 'ok' | 'fail' | 'skipped' | 'timeout'

/** One dispatched-attempt record. */
export interface Receipt {
  readonly pulse_id: string
  readonly trigger_id: string
  readonly status: ReceiptStatus
  readonly started_at: string
  readonly duration_ms: number
  readonly error?: string
}

export interface BusOptions {
  readonly receiptsPath: string
  /** Base URL of the local DSH web API for dsh-prompt actions and notifications. */
  readonly dshApiBase: string
  /** Injectable fetch for tests. */
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
}

/** Outcome of routing one pulse; surfaced for the tick log and tests. */
export interface RouteSummary {
  readonly pulse_id: string
  readonly matched: number
  readonly dispatched: number
  readonly deduped: number
}

export class SignalBus {
  /** In-flight triggers for overlap=skip (and queue occupancy counting). */
  private readonly running = new Map<string, number>()
  /** Start timestamp per in-flight trigger, for the panel's 正在运行 section. */
  private readonly runningSince = new Map<string, number>()
  private readonly consecutiveFailures = new Map<string, number>()
  /** Receipt dedup keys seen, seeded from the existing ledger at construction. */
  private readonly seenKeys = new Set<string>()

  constructor(private readonly options: BusOptions) {
    this.seedSeenKeys()
  }

  private seedSeenKeys(): void {
    const path = this.options.receiptsPath
    if (!existsSync(path)) return
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    // Bounded replay: only the tail can matter for recent dedup, but keys are
    // cheap strings and the ledger is pruned by rotation, so read it all.
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as Receipt
        if (r.status !== 'skipped') this.seenKeys.add(`${r.trigger_id}:${r.pulse_id}`)
      } catch { /* skip malformed historical line */ }
    }
  }

  private writeReceipt(receipt: Receipt): void {
    mkdirSync(dirname(this.options.receiptsPath), { recursive: true })
    appendFileSync(this.options.receiptsPath, JSON.stringify(receipt) + '\n')
  }

  /**
   * Route one pulse: registry is passed in (hot-reloaded by the caller each
   * pulse), matching is pure, dispatch is per-trigger independent.
   */
  async route(pulse: ClockPulse, triggers: readonly Trigger[]): Promise<RouteSummary> {
    const now = this.time()
    const hits = triggers.filter(t => matches(pulse, t))
      .sort((a, b) => a.trigger_id.localeCompare(b.trigger_id))
    let dispatched = 0
    let deduped = 0
    for (const trigger of hits) {
      const key = `${trigger.trigger_id}:${pulse.pulse_id}`
      if (this.seenKeys.has(key)) { deduped += 1; continue }
      this.seenKeys.add(key)
      void this.dispatch(trigger, pulse)
      dispatched += 1
    }
    void now
    return { pulse_id: pulse.pulse_id, matched: hits.length, dispatched, deduped }
  }

  /**
   * Fire one trigger immediately (manual run, bypasses match + receipt dedup).
   * Still respects the overlap limit so a manual run while one is in flight
   * records a skip. Writes a normal receipt for the audit ledger.
   */
  async runNow(t: Trigger, pulse: ClockPulse): Promise<void> {
    await this.dispatch(t, pulse)
  }

  /** Fire one trigger's action without blocking the tick; writes the receipt on settle. */
  private async dispatch(t: Trigger, pulse: ClockPulse): Promise<void> {
    const overlapLimit = t.overlap === undefined || t.overlap === 'skip' ? 1 : (typeof t.overlap === 'object' ? t.overlap.queue + 1 : 1)
    const inflight = this.running.get(t.trigger_id) ?? 0
    const startedAt = new Date().toISOString()
    const start = this.time()
    if (inflight >= overlapLimit) {
      this.writeReceipt({ pulse_id: pulse.pulse_id, trigger_id: t.trigger_id, status: 'skipped', started_at: startedAt, duration_ms: 0 })
      return
    }
    this.running.set(t.trigger_id, inflight + 1)
    if (inflight === 0) this.runningSince.set(t.trigger_id, start)
    try {
      const outcome = await this.runAction(t, pulse)
      const durationMs = this.time() - start
      this.writeReceipt({
        pulse_id: pulse.pulse_id,
        trigger_id: t.trigger_id,
        status: outcome.ok ? 'ok' : outcome.timedOut === true ? 'timeout' : 'fail',
        started_at: startedAt,
        duration_ms: durationMs,
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      })
      this.bumpFailures(t, outcome.ok || outcome.timedOut === true ? undefined : outcome.error ?? 'fail')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.writeReceipt({ pulse_id: pulse.pulse_id, trigger_id: t.trigger_id, status: 'fail', started_at: startedAt, duration_ms: this.time() - start, error: message })
      this.bumpFailures(t, message)
    } finally {
      const left = (this.running.get(t.trigger_id) ?? 1) - 1
      if (left <= 0) {
        this.running.delete(t.trigger_id)
        this.runningSince.delete(t.trigger_id)
      } else {
        this.running.set(t.trigger_id, left)
      }
    }
  }

  private async runAction(t: Trigger, pulse: ClockPulse): Promise<{ ok: boolean; error?: string; timedOut?: boolean }> {
    switch (t.action.kind) {
      case 'exec': {
        const [file, ...args] = t.action.cmd
        if (file === undefined) return { ok: false, error: 'empty cmd' }
        const timeoutMs = t.action.timeout_s * 1000
        const cwd = t.action.cwd
        // No shell, no console window: the child inherits the daemon's headless context.
        return await new Promise((resolve) => {
          const child = spawn(file, args, {
            stdio: 'ignore',
            signal: AbortSignal.timeout(timeoutMs),
            ...(cwd === undefined ? {} : { cwd }),
            // Headless daemon discipline: never allocate a visible console.
            windowsHide: true,
          })
          child.on('error', (error) => { resolve({ ok: false, error: error.message }) })
          child.on('exit', (code, signalName) => {
            if (signalName === 'SIGTERM') resolve({ ok: false, timedOut: true, error: 'timeout' })
            else if (code === 0) resolve({ ok: true })
            else resolve({ ok: false, error: 'exit ' + String(code) })
          })
        })
      }
      case 'http': {
        try {
          const res = await fetch(t.action.url, {
            method: t.action.method ?? 'POST',
            ...(t.action.body === undefined ? {} : { body: t.action.body }),
            signal: AbortSignal.timeout(t.action.timeout_s * 1000),
          })
          return res.ok ? { ok: true } : { ok: false, error: 'http ' + String(res.status) }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, error: message, timedOut: message.includes('abort') }
        }
      }
      case 'dsh-prompt': {
        try {
          const text = t.action.text.replaceAll('{pulse_id}', pulse.pulse_id)
          const res = await (this.options.fetchImpl ?? fetch)(this.options.dshApiBase + '/api/session.prompt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: t.action.session_id, mode: 'queue', content: [{ type: 'text', text }] }),
            signal: AbortSignal.timeout(30_000),
          })
          return res.ok ? { ok: true } : { ok: false, error: 'prompt http ' + String(res.status) }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
    }
  }

  /** Increment consecutive failures and notify the owner past the threshold. */
  private bumpFailures(t: Trigger, error: string | undefined): void {
    const policy = t.failure_policy
    if (policy === undefined) return
    const next = error === undefined ? 0 : (this.consecutiveFailures.get(t.trigger_id) ?? 0) + 1
    this.consecutiveFailures.set(t.trigger_id, next)
    if (error === undefined || policy.consecutive_fail_notify <= 0 || next < policy.consecutive_fail_notify) return
    this.consecutiveFailures.set(t.trigger_id, 0)
    void this.notifyOwner(policy.notify_target, `[automation-bus] 触发器 ${t.trigger_id} 连续失败 ${String(next)} 次，最近错误: ${error ?? '?'}`)
  }

  private async notifyOwner(sessionId: string, text: string): Promise<void> {
    try {
      await (this.options.fetchImpl ?? fetch)(this.options.dshApiBase + '/api/session.prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: 'queue', content: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch { /* notification transport failure must not crash the bus; receipt already records the failure */ }
  }

  /** In-flight dispatches for the panel's 正在运行 section. */
  runningSnapshot(nowMs: number): Array<{ trigger_id: string; elapsedMs: number }> {
    return [...this.runningSince.entries()].map(([trigger_id, since]) => ({ trigger_id, elapsedMs: nowMs - since }))
  }

  private time(): number { return this.options.now?.() ?? Date.now() }
}
