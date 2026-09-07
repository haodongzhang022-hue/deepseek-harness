/**
 * Scheduler engine: fires each configured job when due, appends one audit
 * journal line per fire, and backs off multiplicatively while a job keeps
 * failing. The clock is injected so tests drive time explicitly.
 * @module ui-automation-scheduler/engine
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ActionRunner } from './action.ts'

/** One scheduled job as configured. */
export interface ScheduledJob {
  /** Stable name for logs, journal lines, and backoff state. */
  readonly name: string
  /** One-shot: fire at this exact timestamp (ms since epoch), then stop. */
  readonly onceAt?: number
  /** Recurring: fire cadence in milliseconds. Mutually exclusive with onceAt. */
  readonly everyMs?: number
  /** Maximum random start-of-interval shift, for fleet de-synchronization. */
  readonly jitterMs?: number
}

/** One journal record: append-only NDJSON, the audit trail of every fire. */
export interface JournalEntry {
  readonly at: string
  readonly job: string
  readonly ok: boolean
  readonly detail: string
  readonly durationMs: number
}

export interface SchedulerEngineOptions {
  readonly jobs: readonly ScheduledJob[]
  /** Builds the runner per job; composition binds exec/http by config kind. */
  readonly buildRunner: (job: ScheduledJob) => ActionRunner
  /** NDJSON audit file; created on first fire. */
  readonly journalPath: string
  /** Injectable clock (Date.now by default). */
  readonly now?: () => number
  /** Injectable randomness source for jitter (Math.random by default). */
  readonly random?: () => number
}

/** Result of one scheduler sweep, returned for tests and tick logging. */
export interface SweepSummary {
  readonly fired: readonly { job: string; ok: boolean }[]
}

export class SchedulerEngine {
  private readonly nextDueAt = new Map<string, number>()
  private readonly consecutiveFailures = new Map<string, number>()

  constructor(private readonly options: SchedulerEngineOptions) {}

  /** Fires every job whose due time has arrived; safe to call on any cadence. */
  async sweep(): Promise<SweepSummary> {
    const now = this.time()
    const fired: { job: string; ok: boolean }[] = []
    for (const job of this.options.jobs) {
      if (this.dueAt(job) > now) continue
      const outcome = await this.fire(job, now)
      fired.push({ job: job.name, ok: outcome.ok })
    }
    return { fired }
  }

  /** Milliseconds until the earliest pending due time (0 when something is due). */
  msUntilNextDue(): number {
    const now = this.time()
    let min = Number.POSITIVE_INFINITY
    for (const job of this.options.jobs) {
      min = Math.min(min, Math.max(0, this.dueAt(job) - now))
    }
    return min === Number.POSITIVE_INFINITY ? 0 : min
  }

  /** When this job next fires: its fixed onceAt, or the backoff-tracked next interval. */
  private dueAt(job: ScheduledJob): number {
    if (job.onceAt !== undefined) {
      // Once fired, the next-due marker (Infinity) takes over from onceAt.
      return this.nextDueAt.get(job.name) ?? job.onceAt
    }
    return this.nextDueAt.get(job.name) ?? 0
  }

  private async fire(job: ScheduledJob, startedAt: number): Promise<ActionResult0> {
    const began = this.time()
    let result
    try {
      result = await this.options.buildRunner(job).run()
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    const failures = result.ok ? 0 : (this.consecutiveFailures.get(job.name) ?? 0) + 1
    this.consecutiveFailures.set(job.name, failures)

    if (job.onceAt !== undefined) {
      // One-shot: never fire again, regardless of outcome.
      this.nextDueAt.set(job.name, Number.POSITIVE_INFINITY)
    } else {
      // Backoff doubles per consecutive failure up to eight intervals; jitter
      // shifts every interval so multiple deployments do not fire in lockstep.
      const base = (job.everyMs ?? 0) * Math.min(2 ** failures, 8)
      const jitter = job.jitterMs === undefined ? 0 : Math.floor(this.rand() * job.jitterMs)
      this.nextDueAt.set(job.name, startedAt + base + jitter)
    }

    const entry: JournalEntry = {
      at: new Date(began).toISOString(),
      job: job.name,
      ok: result.ok,
      detail: result.detail,
      durationMs: this.time() - began,
    }
    this.appendJournal(entry)
    return result
  }

  private appendJournal(entry: JournalEntry): void {
    mkdirSync(dirname(this.options.journalPath), { recursive: true })
    appendFileSync(this.options.journalPath, JSON.stringify(entry) + '\n', 'utf8')
  }

  private time(): number {
    return (this.options.now ?? Date.now)()
  }

  private rand(): number {
    return (this.options.random ?? Math.random)()
  }
}

/** Local alias keeping the fire signature readable. */
type ActionResult0 = Awaited<ReturnType<ActionRunner['run']>>
