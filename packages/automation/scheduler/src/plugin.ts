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

/** Plugin name used by loader diagnostics. */
export const name = 'automation-scheduler'

/** Services required by this plugin. */
export const inject: string[] = []

/** One configured job; kind selects the runner and its fields. */
export interface JobConfig {
  readonly name: string
  readonly everyMs: number
  readonly jitterMs?: number
  readonly action: { kind: 'exec'; command: string; args?: string[]; cwd?: string } | { kind: 'http'; url: string; method?: string; body?: string }
  /** Per-fire timeout for both runner kinds. */
  readonly timeoutMs?: number
}

/** Daemon configuration. */
export interface SchedulerConfig {
  readonly jobs: JobConfig[]
  /** Sweep cadence; job due times are checked at most this often. */
  readonly sweepIntervalMs: number
  /** NDJSON audit journal path. */
  readonly journalPath: string
}

const JOB_SCHEMA: z<JobConfig> = z.intersect([
  z.object({
    name: z.string().required(),
    everyMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS),
    jitterMs: z.number().min(0).max(MAX_TIMER_DELAY_MS),
  }),
  z.union([
    z.object({ kind: z.const('exec'), command: z.string().required(), args: z.array(String), cwd: z.string() }),
    z.object({ kind: z.const('http'), url: z.string().required(), method: z.string().default('POST'), body: z.string() }),
  ]),
]) as unknown as z<JobConfig>

export const Config: z<SchedulerConfig> = z.object({
  jobs: z.array(JOB_SCHEMA).min(0),
  sweepIntervalMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS).default(30_000),
  journalPath: z.string().required(),
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
  ctx.effect(() => {
    const timer = setInterval(() => { void sweep() }, config.sweepIntervalMs)
    return () => { clearInterval(timer) }
  }, 'automation-scheduler.tick')
}

function toScheduledJob(config: JobConfig): ScheduledJob {
  return { name: config.name, everyMs: config.everyMs, jitterMs: config.jitterMs }
}

function makeRunner(config: JobConfig): ExecRunner | HttpRunner {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (config.action.kind === 'exec') {
    return new ExecRunner({ command: config.action.command, args: config.action.args, cwd: config.action.cwd, timeoutMs })
  }
  return new HttpRunner({ url: config.action.url, method: config.action.method ?? 'POST', body: config.action.body, timeoutMs })
}
