/**
 * Cordis function plugin: the scheduler daemon. Sweeps on a fixed tick and
 * fires configured exec/HTTP jobs when due; the sweep cadence is one config
 * value while each job carries its own schedule.
 * @module ui-automation-scheduler/plugin
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { ExecRunner, HttpRunner } from './action.ts'
import { SchedulerEngine } from './engine.ts'
import type { ScheduledJob } from './engine.ts'
import { PulseLedger, buildMinutePulse, derivedChannels, utcSlot, minutePulseId } from './pulse.ts'
import { loadTriggers, matches } from './triggers.ts'
import { SignalBus } from './bus.ts'
import { TriggerStore } from './store.ts'
import { AutomationTriggerService, type ClockState } from './service.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'automation-scheduler'

/** Services required by this plugin. */
export const inject: string[] = []

/** One configured job; kind selects the runner and its fields. */
export interface JobConfig {
  readonly name: string
  /** One-shot fire at this exact timestamp (ms since epoch). Mutually exclusive with everyMs. */
  readonly onceAt?: number
  readonly everyMs?: number
  readonly jitterMs?: number
  readonly action: { kind: 'exec'; command: string; args?: string[]; cwd?: string } | { kind: 'http'; url: string; method?: string; body?: string }
  /** Per-fire timeout for both runner kinds. */
  readonly timeoutMs?: number
}

/** Clock-signal bus configuration; all paths empty = bus disabled (legacy jobs only). */
export interface BusConfig {
  /** Directory of signals/triggers/*.json, hot-reloaded every pulse. */
  readonly triggersDir: string
  /** Append-only pulse ledger (clock_pulses.jsonl). */
  readonly pulsesPath: string
  /** Append-only receipts ledger (signal_receipts.jsonl). */
  readonly receiptsPath: string
  /** Freshness stamp for watchdogs (last_pulse_at). */
  readonly lastPulsePath: string
  /** Local DSH web API base for dsh-prompt actions and owner notifications. */
  readonly dshApiBase: string
}

/** Daemon configuration. */
export interface SchedulerConfig {
  readonly jobs: JobConfig[]
  /** Sweep cadence; job due times are checked at most this often. */
  readonly sweepIntervalMs: number
  /** NDJSON audit journal path. */
  readonly journalPath: string
  /** Clock-signal bus; omitted = disabled. */
  readonly bus?: BusConfig
}

const JOB_SCHEMA: z<JobConfig> = z.object({
  name: z.string().required(),
  onceAt: z.number().min(0),
  everyMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS),
  jitterMs: z.number().min(0).max(MAX_TIMER_DELAY_MS),
  timeoutMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS),
  action: z.union([
    z.object({ kind: z.const('exec'), command: z.string().required(), args: z.array(String), cwd: z.string() }),
    z.object({ kind: z.const('http'), url: z.string().required(), method: z.string().default('POST'), body: z.string() }),
  ]),
}) as unknown as z<JobConfig>

const BUS_SCHEMA: z<BusConfig> = z.object({
  triggersDir: z.string().required(),
  pulsesPath: z.string().required(),
  receiptsPath: z.string().required(),
  lastPulsePath: z.string().required(),
  dshApiBase: z.string().required(),
}) as unknown as z<BusConfig>

export const Config: z<SchedulerConfig> = z.object({
  jobs: z.array(JOB_SCHEMA).min(0),
  sweepIntervalMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS).default(30_000),
  journalPath: z.string().required(),
  bus: BUS_SCHEMA,
}) as unknown as z<SchedulerConfig>

/** Default per-fire timeout when a job omits one. */
const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Start the daemon: sweep once inline for startup evidence, then on the
 * sweep interval until disposal.
 * @param ctx - plugin context providing the logger.
 * @param config - resolved scheduler configuration.
 * @returns settles after the first sweep completes.
 */
export async function apply(ctx: Context, config: SchedulerConfig): Promise<void> {
  for (const job of config.jobs) {
    // A job schedules itself exactly one way: one-shot at onceAt, or recurring at everyMs.
    if ((job.onceAt === undefined) === (job.everyMs === undefined)) {
      throw new Error(`automation-scheduler: job '${job.name}' must configure exactly one of onceAt or everyMs`)
    }
  }
  const byName = new Map(config.jobs.map(job => [job.name, job] as const))
  const engine = new SchedulerEngine({
    jobs: config.jobs.map(toScheduledJob),
    buildRunner: (job) => {
      const found = byName.get(job.name)
      if (found === undefined) {
        throw new Error('automation-scheduler: runner requested for unknown job ' + job.name)
      }
      return makeRunner(found)
    },
    journalPath: config.journalPath,
  })

  const sweep = async (): Promise<void> => {
    try {
      const summary = await engine.sweep()
      if (summary.fired.length > 0) {
        ctx.logger.info('automation-scheduler: fired %d job(s): %s', summary.fired.length, summary.fired.map(f => f.job + (f.ok ? '' : '(FAILED)')).join(', '))
      }
    } catch (error) {
      ctx.logger.error('automation-scheduler: sweep failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  await sweep()

  // Clock-signal bus: the plugin's own interval is the pulse source (rule A —
  // no child process, no schtasks, no console window ever). Each tick checks
  // the current UTC minute slot and emits exactly one pulse per slot.
  const busConfig = config.bus
  let lastPulseId = ''
  let bus: SignalBus | undefined
  let ledger: PulseLedger | undefined
  /** Freshness + last channels for watchdogs and panels; updated by every pulse tick. */
  const clockState: ClockState = { pulseId: '', emittedAt: '', channels: [] }
  if (busConfig !== undefined) {
    ledger = new PulseLedger({ ledgerPath: busConfig.pulsesPath, lastPulsePath: busConfig.lastPulsePath })
    ledger.ensureDirs()
    bus = new SignalBus({ receiptsPath: busConfig.receiptsPath, dshApiBase: busConfig.dshApiBase })
    // Writable registry + manual-run face for management pages; the pulse loop
    // re-reads the same directory each minute, so CRUD here is live, no restart.
    const store = new TriggerStore(busConfig.triggersDir)
    // AutomationTriggerService's Service base constructor self-registers
    // (ctx.reflect.provide); constructing it is the only registration — an
    // extra ctx.provide would collide with that same service name.
    new AutomationTriggerService(ctx, { store, bus: () => bus, clock: () => clockState })
  }

  const pulseTick = async (): Promise<void> => {
    if (ledger === undefined || bus === undefined || busConfig === undefined) return
    const nowMs = Date.now()
    const slot = utcSlot(nowMs)
    const id = minutePulseId(slot)
    if (id === lastPulseId) return
    lastPulseId = id
    const channels = ['minute' as const, ...derivedChannels(slot)]
    const triggers = loadTriggers(busConfig.triggersDir)
    const matchedIds: string[] = []
    for (const channel of channels) {
      const base = buildMinutePulse(nowMs)
      const pulse = { ...base, channel } as const
      const hits = triggers.filter(t => matches(pulse, t))
      for (const hit of hits) matchedIds.push(hit.trigger_id)
      try {
        const summary = await bus.route(pulse, hits)
        if (summary.dispatched > 0 || summary.matched > 0) {
          ctx.logger.info('automation-bus: %s matched %d dispatched %d deduped %d', summary.pulse_id, summary.matched, summary.dispatched, summary.deduped)
        }
      } catch (error) {
        ctx.logger.error('automation-bus: route failed for %s: %s', pulse.pulse_id, error instanceof Error ? error.message : String(error))
      }
    }
    ledger.record(buildMinutePulse(nowMs), matchedIds)
    clockState.pulseId = id
    clockState.emittedAt = new Date(nowMs).toISOString()
    clockState.channels = channels
  }

  await pulseTick()
  ctx.effect(() => {
    const timer = setInterval(() => { void sweep(); void pulseTick() }, config.sweepIntervalMs)
    return () => { clearInterval(timer) }
  }, 'automation-scheduler.tick')
}

function toScheduledJob(config: JobConfig): ScheduledJob {
  return {
    name: config.name,
    ...(config.onceAt === undefined ? {} : { onceAt: config.onceAt }),
    ...(config.everyMs === undefined ? {} : { everyMs: config.everyMs }),
    ...(config.jitterMs === undefined ? {} : { jitterMs: config.jitterMs }),
  }
}

function makeRunner(config: JobConfig): ExecRunner | HttpRunner {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (config.action.kind === 'exec') {
    return new ExecRunner({
      command: config.action.command,
      timeoutMs,
      ...(config.action.args === undefined ? {} : { args: config.action.args }),
      ...(config.action.cwd === undefined ? {} : { cwd: config.action.cwd }),
    })
  }
  return new HttpRunner({
    url: config.action.url,
    method: config.action.method ?? 'POST',
    timeoutMs,
    ...(config.action.body === undefined ? {} : { body: config.action.body }),
  })
}
