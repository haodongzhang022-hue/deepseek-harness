/**
 * Cordis function plugin: the router daemon. Binds the finance release-control
 * adapter to this context tool registry, runs the poll-diff-dispatch loop, and
 * selects the wake transport from config.
 * @module ui-automation-router/plugin
 */

import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GateItemState } from '@deepseek-ai/dsh-automation-gate'
import { FileLedger } from './ledger.ts'
import { RouterEngine } from './engine.ts'
import { LogWakeTransport, InProcessWakeTransport } from './wake-transport.ts'
import type { WakeTransport } from './wake-transport.ts'
import { ReleaseControlGateAdapter, INTEGRATION_8008_STATUS_MAP, STAGING_8027_STATUS_MAP, PRODUCTION_8028_STATUS_MAP } from './adapters/release-control.ts'
import type { RawRecord, ReleaseControlCaller } from './adapters/release-control.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'automation-router'

/** Services required by this plugin. */
export const inject = ['tools']

/** Valid MCP serverName the caller seam resolves against. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** One watched gate: its own namespace view, ledger, cadence, and wake policy. */
export interface GateWatchConfig {
  /** Stable gate name for logs; also the adapter name. */
  name: string
  /** MCP server namespace publishing the release-control tools. */
  serverName: string
  /** Durable ledger file for per-item state across restarts. */
  ledgerPath: string
  /** Poll cadence in milliseconds; also the retry delay for deferred wakes. */
  pollIntervalMs: number
  /** Wake delivery: log-only dry run, or same-context session followup. */
  transport: 'log' | 'in-process'
  /** States that wake their item once; defaults to rejections only. */
  wakeStates?: GateItemState[]
  /** Which gate vocabulary to watch; defaults to the 8008 integration gate. */
  gate?: 'integration-8008' | 'staging-8027' | 'production-8028'
}

/** Daemon configuration: one or more resident gate watchers. */
export interface RouterConfig {
  gates: GateWatchConfig[]
}

const GATE_VOCABULARIES = {
  'integration-8008': INTEGRATION_8008_STATUS_MAP,
  'staging-8027': STAGING_8027_STATUS_MAP,
  'production-8028': PRODUCTION_8028_STATUS_MAP,
} as const

function gateConfigSchema(): z<GateWatchConfig> {
  return z.object({
    name: z.string().required(),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    ledgerPath: z.string().required(),
    pollIntervalMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS).default(60_000),
    transport: z.union([z.const('log'), z.const('in-process')]).default('log'),
    wakeStates: z.array(String),
    gate: z.union([z.const('integration-8008'), z.const('staging-8027'), z.const('production-8028')]).default('integration-8008'),
  }) as unknown as z<GateWatchConfig>
}

export const Config: z<RouterConfig> = z.object({
  gates: z.array(gateConfigSchema()).min(1),
}) as unknown as z<RouterConfig>

/**
 * Pull raw records out of one executed tool result: MCP list payloads arrive
 * as JSON text blocks, either a bare array or an envelope holding one.
 * @param result - outcome of ctx.tools.execute for a release-control listing.
 * @returns the records when the payload parses, else an empty array.
 */
export function extractRecordsFromToolResult(result: unknown): RawRecord[] {
  if (typeof result !== 'object' || result === null) return []
  if ('isError' in result && result.isError === true) return []

  const content: unknown = 'content' in result ? result.content : undefined
  if (!Array.isArray(content)) return []

  const text = content
    .filter((block): block is ContentBlock => typeof block === 'object' && block !== null)
    .map(block => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('')

  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.filter(isRecord)
    if (typeof parsed === 'object' && parsed !== null) {
      for (const value of Object.values(parsed)) {
        if (Array.isArray(value)) return value.filter(isRecord)
      }
    }
    return []
  } catch {
    // Non-JSON text payloads carry no records; the tick logs the mismatch.
    return []
  }
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null
}

/** Caller seam over the registry public execute path, namespaced per server. */
function bindCaller(ctx: Context, serverName: string): ReleaseControlCaller {
  return async (toolName, args) => {
    const result = await ctx.tools.execute({
      callId: name + ':' + toolName + ':' + randomUUID() as never,
      name: 'mcp__' + serverName + '__' + toolName,
      arguments: args,
      signal: new AbortController().signal,
    })
    return extractRecordsFromToolResult(result)
  }
}

function resolveTransport(ctx: Context, watch: GateWatchConfig): WakeTransport {
  if (watch.transport !== 'in-process') return new LogWakeTransport()
  const agents = ctx.get('agents') as unknown
  if (!isAgentRegistry(agents)) {
    throw new Error('automation-router: transport "in-process" requires the agents service in this host')
  }
  const registry: Map<string, { followup(message: unknown): void }> = agents
  return new InProcessWakeTransport(sessionId => registry.get(sessionId))
}

/**
 * Start one resident watcher per configured gate: first tick inline for
 * startup evidence, then on its poll interval until disposal. Poll errors
 * log and defer to the next tick; they never tear down the loop.
 * @param ctx - plugin context carrying the tool registry and logger.
 * @param config - resolved daemon configuration.
 * @returns settles after every gate's first tick completes.
 */
export async function apply(ctx: Context, config: RouterConfig): Promise<void> {
  for (const watch of config.gates) {
    await startWatcher(ctx, watch)
  }
}

async function startWatcher(ctx: Context, watch: GateWatchConfig): Promise<void> {
  const vocabulary = GATE_VOCABULARIES[watch.gate ?? 'integration-8008']
  const adapter = new ReleaseControlGateAdapter(bindCaller(ctx, watch.serverName), { name: watch.name, statusMap: vocabulary })
  const ledger = new FileLedger(watch.ledgerPath)
  const transport = resolveTransport(ctx, watch)
  const wakeStates = (watch.wakeStates as readonly GateItemState[] | undefined) ?? ['rejected']
  const engine = new RouterEngine({ adapter, ledger, transport, wakeStates })

  const tick = async (): Promise<void> => {
    try {
      const summary = await engine.tick()
      ctx.logger.info('automation-router(%s): %d event(s), woke %d, failed %d', watch.name, summary.events.length, summary.woken.length, summary.failed.length)
      for (const failure of summary.failed) {
        ctx.logger.warn('automation-router: wake delivery failed for %s: %s', failure.id, failure.error)
      }
    } catch (error) {
      ctx.logger.error('automation-router: poll failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  await tick()
  ctx.effect(() => {
    const timer = setInterval(() => { void tick() }, watch.pollIntervalMs)
    return () => { clearInterval(timer) }
  }, 'automation-router.poll.' + watch.name)
}

/** Structural face of the agents registry the in-process transport needs. */
function isAgentRegistry(value: unknown): value is Map<string, { followup(message: unknown): void }> {
  return value instanceof Map
}
