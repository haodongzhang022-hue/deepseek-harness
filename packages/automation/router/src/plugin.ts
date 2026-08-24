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
import { FileLedger } from './ledger.ts'
import { RouterEngine } from './engine.ts'
import { LogWakeTransport, InProcessWakeTransport } from './wake-transport.ts'
import type { WakeTransport } from './wake-transport.ts'
import { ReleaseControlGateAdapter } from './adapters/release-control.ts'
import type { RawRecord, ReleaseControlCaller } from './adapters/release-control.ts'

/** Plugin name used by loader diagnostics. */
export const name = 'automation-router'

/** Services required by this plugin. */
export const inject = ['tools']

/** Valid MCP serverName the caller seam resolves against. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Daemon configuration; every deployment-varying value is a field. */
export interface RouterConfig {
  /** MCP server namespace publishing the release-control tools. */
  serverName: string
  /** Durable ledger file for per-item state across restarts. */
  ledgerPath: string
  /** Poll cadence in milliseconds; also the retry delay for deferred wakes. */
  pollIntervalMs: number
  /** Wake delivery: log-only dry run, or same-context session followup. */
  transport: 'log' | 'in-process'
}

export const Config: z<RouterConfig> = z.object({
  serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
  ledgerPath: z.string().required(),
  pollIntervalMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS).default(60_000),
  transport: z.union([z.const('log'), z.const('in-process')]).default('log'),
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

/**
 * Start the daemon: first tick inline for startup evidence, then on the poll
 * interval until disposal. Poll errors log and defer to the next tick; they
 * never tear down the loop.
 * @param ctx - plugin context carrying the tool registry and logger.
 * @param config - resolved daemon configuration.
 * @returns settles after the first tick completes.
 */
export async function apply(ctx: Context, config: RouterConfig): Promise<void> {
  const adapter = new ReleaseControlGateAdapter(bindCaller(ctx, config.serverName))
  const ledger = new FileLedger(config.ledgerPath)

  let transport: WakeTransport
  if (config.transport === 'in-process') {
    const agents = ctx.get('agents') as unknown
    if (!isAgentRegistry(agents)) {
      throw new Error('automation-router: transport "in-process" requires the agents service in this host')
    }
    const registry = agents
    transport = new InProcessWakeTransport(sessionId => registry.get(sessionId))
  } else {
    transport = new LogWakeTransport()
  }

  const engine = new RouterEngine({ adapter, ledger, transport })

  const tick = async (): Promise<void> => {
    try {
      const summary = await engine.tick()
      ctx.logger.info('automation-router: %d event(s), woke %d, failed %d', summary.events.length, summary.woken.length, summary.failed.length)
      for (const failure of summary.failed) {
        ctx.logger.warn('automation-router: wake delivery failed for %s: %s', failure.id, failure.error)
      }
    } catch (error) {
      ctx.logger.error('automation-router: poll failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  await tick()
  ctx.effect(() => {
    const timer = setInterval(() => { void tick() }, config.pollIntervalMs)
    return () => { clearInterval(timer) }
  }, 'automation-router.poll')
}

/** Structural face of the agents registry the in-process transport needs. */
function isAgentRegistry(value: unknown): value is Map<string, { followup(message: unknown): void }> {
  return value instanceof Map
}
