/**
 * @dsh-external/dsh-automation-console — host half.
 * Read-side aggregator over the automation daemons' durable artifacts:
 * scheduler journal (runs), profile patch (job definitions), router ledgers
 * (gate items), the production pipeline API (lane-to-session mapping), and
 * the clock-signal ledger (pulses, receipts, registry, running dispatches).
 * Publishes snapshots through HTTP routes for the panel and a model tool
 * (automation_overview) so the agent reads the same truth without file access.
 * @module @dsh-external/dsh-automation-console/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import z from 'schemastery'

export const name = '@dsh-external/dsh-automation-console'
export const inject = ['tools']

/** One watched gate ledger on disk. */
export interface LedgerConfig {
  /** Gate key, e.g. integration-8008. */
  name: string
  /** Human label shown in the panel. */
  label: string
  /** Ledger JSON path written by the router daemon. */
  path: string
}

export interface ConsoleConfig {
  /** Scheduler NDJSON journal path. */
  journalPath: string
  /** Profile patch yml holding the scheduler job definitions. */
  patchYml: string
  /** Production pipeline API base for the lane-to-session map. */
  pipelineApiBase: string
  /** Gate ledgers to surface. */
  ledgers: LedgerConfig[]
}

export const Config = z.object({
  journalPath: z.string().default(''),
  patchYml: z.string().default(''),
  pipelineApiBase: z.string().default('http://localhost:8008'),
  ledgers: z.array(z.object({
    name: z.string(),
    label: z.string(),
    path: z.string(),
  })),
})

/** One configured scheduler job as the panel shows it. */
interface JobView {
  name: string
  everyMs: number | null
  jitterMs: number | null
  target: string
  lastRunAt: string | null
  lastOk: boolean | null
  lastDetail: string
  nextDueApprox: string | null
}

interface RunRecord { at: string; job: string; ok: boolean; detail: string; durationMs: number }

interface GateItemRow {
  id: string
  sourceLane: string
  title: string
  lastState: string
  notifiedState?: string
  notifyCount: number
  updatedAt: number
}

interface AgentRow { port: number; sessionId: string; live: boolean }

/** Time-series levels: one trading-style timeframe per pulse aggregation bucket. */
export type SeriesLevel = '1m' | '5m' | '15m' | '30m' | '1h' | '1d'

const LEVEL_MS: Readonly<Record<SeriesLevel, number>> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
}

/** Human label for one level, stable across languages (the client keeps its own dictionary). */
export const LEVEL_LABEL: Readonly<Record<SeriesLevel, string>> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '1d': '1d',
}

interface ReceiptRow {
  pulse_id: string
  trigger_id: string
  status: string
  started_at: string
  duration_ms: number
  error?: string
}

interface PulseRow {
  pulse_id: string
  emitted_at: string
  matched_trigger_ids?: string[]
}

/** One aggregated timeframe bucket (the "financial bar" of the calendar). */
export interface SeriesBin {
  start: number
  end: number
  /** Clock pulses landing inside this bucket. */
  pulses: number
  /** Trigger matches recorded across those pulses. */
  matched: number
  /** Dispatch attempts (every receipt row: ok/fail/timeout/skipped). */
  dispatched: number
  /** Matched triggers that produced no receipt: deduped or in-flight. */
  deduped: number
  ok: number
  fail: number
  skipped: number
  timeout: number
  avgDurationMs: number
  /** Unique triggers with a receipt inside this bucket. */
  fired: string[]
  /** Failure/timeout details, capped per bucket. */
  errors: Array<{ triggerId: string; status: string; durationMs: number; error: string }>
}

/** One registered trigger as the board shows it. */
interface TriggerRowView {
  trigger_id: string
  level: SeriesLevel
  channel: string
  matchText: string
  actionSummary: string
  enabled: boolean
  ownerSession: string
  lastReceipt: { status: string; at: string } | null
  /** Receipt events inside the requested window (sorted, capped). */
  events: Array<{ at: string; status: string; durationMs: number; pulseId: string }>
}

interface TriggerBoardView {
  /** All triggers of the registry, level-tagged. */
  triggers: TriggerRowView[]
  /** Timestamps (ms) of clock pulses inside the window, for axis markers. */
  pulseEvents: number[]
  runningNow: Array<{ triggerId: string; elapsedMs: number }>
  lastPulse: { pulseId: string; emittedAt: string; agoMs: number } | null
}

interface OverviewPayload {
  generatedAt: string
  level: SeriesLevel
  binMs: number
  windowStart: number
  windowEnd: number
  bins: SeriesBin[]
  board: TriggerBoardView
  jobs: JobView[]
  runs: RunRecord[]
  gates: Array<{ name: string; label: string; items: GateItemRow[] }>
  agents: AgentRow[]
}

interface Snapshot {
  generatedAt: string
  jobs: JobView[]
  runs: RunRecord[]
  gates: Array<{ name: string; label: string; items: GateItemRow[] }>
  agents: AgentRow[]
  /** Trigger-registry view: every registered automation incl. disabled ones. */
  triggers: Array<{ trigger_id: string; level: SeriesLevel; channel: string; matchText: string; actionSummary: string; enabled: boolean; ownerSession: string; lastReceiptAt: string | null; lastReceiptStatus: string | null; consecutiveInfo: string }>
  /** In-flight dispatches right now. */
  runningNow: Array<{ triggerId: string; elapsedMs: number }>
  lastPulse: { pulseId: string; emittedAt: string; agoMs: number } | null
  /** External (pre-bus) clock sources kept for the 未触发/外部 section. */
  externalClocks: Array<{ name: string; schedule: string; state: string }>
}

/** Local mirror of the bus registry face (kept decoupled from the scheduler package). */
interface BusTrigger {
  trigger_id: string
  owner_session: string
  enabled?: boolean
  match: { channel: string; atLocal?: { h: number; m: number }; slot_m_mod?: number; slot_h_mod?: number; slot_weekday?: number; slot_dom?: number }
  tzOffsetMin?: number
  action: { kind: string; cmd?: string[]; url?: string; method?: string; session_id?: string }
}

/** Default local-timezone offset used when a trigger omits one: Asia/Shanghai (UTC+8). */
const DEFAULT_TZ_OFFSET_MIN = 480

/** Split one deterministic pulse id like 20260830T0300Z-minute into slot/channel fields. */
function parsePulseId(pulseId: string): { y: number; mo: number; d: number; h: number; m: number; channel: string } | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z-(minute|hour|day)$/.exec(pulseId)
  if (m === null) return undefined
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), m: Number(m[5]), channel: m[6] }
}

/** Mirror of the scheduler's pure match rule over pulse id + trigger (registry is the audit truth). */
function matchesPulse(pulseId: string, t: BusTrigger): boolean {
  if (t.enabled === false) return false
  const slot = parsePulseId(pulseId)
  if (slot === undefined || slot.channel !== t.match.channel) return false
  const offsetMin = t.tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN
  const localMinutes = (((slot.h * 60 + slot.m + offsetMin) % 1440) + 1440) % 1440
  if (t.match.atLocal !== undefined && localMinutes !== t.match.atLocal.h * 60 + t.match.atLocal.m) return false
  if (t.match.slot_m_mod !== undefined && slot.m % t.match.slot_m_mod !== 0) return false
  if (t.match.slot_h_mod !== undefined && slot.h % t.match.slot_h_mod !== 0) return false
  if (t.match.slot_weekday !== undefined) {
    const utcMs = Date.UTC(slot.y, slot.mo - 1, slot.d, slot.h, slot.m)
    const localWeekday = new Date(utcMs + offsetMin * 60_000).getUTCDay()
    if (localWeekday !== t.match.slot_weekday) return false
  }
  if (t.match.slot_dom !== undefined) {
    const utcMs = Date.UTC(slot.y, slot.mo - 1, slot.d, slot.h, slot.m)
    if (new Date(utcMs + offsetMin * 60_000).getUTCDate() !== t.match.slot_dom) return false
  }
  return true
}

interface ReceiptLike {
  pulse_id?: string
  trigger_id?: string
  status?: string
  started_at?: string
  duration_ms?: number
  error?: string
}

/** Minimal local face of the scheduler trigger service (kept decoupled). */
interface TriggersFace {
  list(): BusTrigger[]
  get(id: string): BusTrigger | undefined
  create(input: Record<string, unknown>): BusTrigger
  update(id: string, input: Record<string, unknown>): BusTrigger
  delete(id: string): void
  runNow(id: string): Promise<{ ok: boolean; error?: string }>
  runningSnapshot(nowMs: number): Array<{ trigger_id: string; elapsedMs: number }>
  clockState?(): { pulseId: string; emittedAt: string; channels: unknown[] } | undefined
}

/** Body-reading face of an incoming request (event-stream contract only). */
type ReqLike = { on(event: 'data', cb: (chunk: Buffer) => void): unknown; on(event: 'end', cb: () => void): unknown; on(event: 'error', cb: (error: Error) => void): unknown }

/** Read the full request body as a string (the webserver leaves body reading to handlers). */
function readBody(req: ReqLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Load every *.json under dir as one BusTrigger; malformed files fail loud naming the file. */
function loadBusTriggers(dir: string): BusTrigger[] {
  if (!existsSync(dir)) return []
  const out: BusTrigger[] = []
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as BusTrigger
      if (typeof parsed.trigger_id !== 'string' || parsed.trigger_id === '') throw new Error('missing trigger_id')
      out.push(parsed)
    } catch (error) {
      throw new Error('trigger registry: invalid ' + file + ': ' + String(error instanceof Error ? error.message : error))
    }
  }
  return out
}

/** The timeframe bucket a trigger registers on, from its match rule. */
function triggerLevel(t: BusTrigger): SeriesLevel {
  const m = t.match
  if (m.channel === 'day') return '1d'
  if (m.channel === 'hour') return '1h'
  if (m.atLocal !== undefined) return '1d'
  if (m.slot_h_mod === 1) return '1h'
  if (m.slot_m_mod === 5) return '5m'
  if (m.slot_m_mod === 15) return '15m'
  if (m.slot_m_mod === 30) return '30m'
  return '1m'
}

/** Human-readable cadence for one trigger's match rule. */
function describeMatch(t: BusTrigger): string {
  const parts: string[] = []
  const at = t.match.atLocal
  if (at !== undefined) {
    const hh = String(at.h).padStart(2, '0')
    const mm = String(at.m).padStart(2, '0')
    const stamp = ' @' + hh + ':' + mm + ' 本地'
    if (t.match.slot_weekday !== undefined) parts.push('每周' + '日一二三四五六'.charAt(t.match.slot_weekday) + stamp)
    else if (t.match.slot_dom !== undefined) parts.push('每月第' + String(t.match.slot_dom) + '日' + stamp)
    else parts.push('每天' + stamp)
  } else if (t.match.slot_m_mod !== undefined) parts.push('每' + String(t.match.slot_m_mod) + '分钟')
  else if (t.match.slot_h_mod !== undefined) parts.push('每' + String(t.match.slot_h_mod) + '小时')
  else if (t.match.channel === 'day') parts.push('每天')
  else if (t.match.channel === 'hour') parts.push('每小时')
  else parts.push(String(t.match.channel))
  if (at === undefined && t.match.slot_h_mod !== undefined && t.match.slot_m_mod !== undefined) parts.push('(h%' + String(t.match.slot_h_mod) + ')')
  if (at === undefined && t.match.slot_weekday !== undefined) parts.push('(周' + '日一二三四五六'.charAt(t.match.slot_weekday) + ')')
  if (at === undefined && t.match.slot_dom !== undefined) parts.push('(每月第' + String(t.match.slot_dom) + '日)')
  return parts.join(' ')
}

/** Compact action line for the panel row. */
function describeAction(t: BusTrigger): string {
  if (t.action.kind === 'exec') return (t.action.cmd ?? []).join(' ').slice(0, 90)
  if (t.action.kind === 'http') return (t.action.method ?? 'POST') + ' ' + String(t.action.url ?? '').slice(0, 70)
  return 'prompt → ' + String(t.action.session_id ?? '').slice(0, 24)
}

/** Tail-read one NDJSON/JSONL ledger into parsed rows; malformed lines are skipped. */
function readLedger(path: string): unknown[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line) as unknown } catch { return null } })
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
}

/** Parse the scheduler jobs block out of the profile patch yml (narrow reader over our own stable format). */
function parsePatchJobs(patchYmlPath: string): Array<Record<string, unknown>> {
  if (!existsSync(patchYmlPath)) return []
  const lines = readFileSync(patchYmlPath, 'utf8').split('\n')
  const jobs: Array<Record<string, unknown>> = []
  let inScheduler = false
  let inJobs = false
  let current: Record<string, unknown> | undefined
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (/^\s*- id:\s*automation-scheduler\s*$/.test(line)) { inScheduler = true; continue }
    if (inScheduler && /^- insert:|^\s*- id:/.test(line) && !/automation-scheduler/.test(line)) { inScheduler = false; inJobs = false; current = undefined; continue }
    if (!inScheduler) continue
    if (/^\s+jobs:\s*$/.test(line)) { inJobs = true; continue }
    if (!inJobs) continue
    const nameMatch = line.match(/^\s+- name:\s*(.+)$/)
    if (nameMatch) {
      current = { name: nameMatch[1].trim(), everyMs: null, jitterMs: null, target: '' }
      jobs.push(current)
      continue
    }
    if (current === undefined) continue
    const every = line.match(/^\s+everyMs:\s*(\d+)/)
    if (every) { current.everyMs = Number(every[1]); continue }
    const jitter = line.match(/^\s+jitterMs:\s*(\d+)/)
    if (jitter) { current.jitterMs = Number(jitter[1]); continue }
    const url = line.match(/^\s+url:\s*'([^']+)'/)
    if (url) { current.target = url[1]; continue }
    const command = line.match(/^\s+command:\s*'([^']+)'/)
    if (command) { current.target = command[1]; continue }
  }
  return jobs
}

function readJournalTail(path: string, limit: number): RunRecord[] {
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
  const runs: RunRecord[] = []
  for (const line of lines.slice(-limit)) {
    try {
      const parsed = JSON.parse(line) as Partial<RunRecord>
      runs.push({
        at: String(parsed.at ?? ''),
        job: String(parsed.job ?? '?'),
        ok: parsed.ok === true,
        detail: String(parsed.detail ?? ''),
        durationMs: Number(parsed.durationMs ?? 0),
      })
    } catch { /* skip malformed journal line */ }
  }
  return runs
}

function readLedgerItems(path: string): GateItemRow[] {
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { items?: Record<string, GateItemRow> }
    return Object.values(parsed.items ?? {})
  } catch { return [] }
}

async function fetchAgents(base: string): Promise<AgentRow[]> {
  try {
    const response = await fetch(base + '/api/v3/pipeline/status', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return []
    const payload = await response.json() as { active_agents?: Array<{ port?: unknown; status?: unknown; session_id?: unknown }> }
    return (payload.active_agents ?? []).map(a => ({
      port: Number(a.port ?? 0),
      sessionId: String(a.session_id ?? ''),
      live: a.status === 'available',
    }))
  } catch { return [] }
}

/** Aggregate ledger rows into one timeframe bucket series (the financial-style bar chart input). */
export function buildSeries(
  pulseRows: PulseRow[],
  receiptRows: ReceiptRow[],
  level: SeriesLevel,
  bins: number,
  nowMs: number,
  registry: BusTrigger[],
  triggerFilter?: string,
): { bins: SeriesBin[]; windowStart: number; windowEnd: number } {
  const binMs = LEVEL_MS[level]
  const count = Math.max(16, Math.min(bins, 288))
  const windowEnd = Math.floor(nowMs / binMs) * binMs
  const windowStart = windowEnd - count * binMs
  const bucket = new Map<number, SeriesBin>()
  for (let i = 0; i < count; i += 1) {
    const start = windowStart + i * binMs
    bucket.set(start, {
      start, end: start + binMs,
      pulses: 0, matched: 0, dispatched: 0, deduped: 0,
      ok: 0, fail: 0, skipped: 0, timeout: 0,
      avgDurationMs: 0, fired: [], errors: [],
    })
  }
  // Pass 1: pulses. Matched counts are recomputed from the registry (the ledger's
  // recorded list predates exact matching and can over-count channel-only).
  const receiptsPerPulse = new Map<string, number>()
  for (const r of receiptRows) {
    if (r.pulse_id !== undefined) receiptsPerPulse.set(r.pulse_id, (receiptsPerPulse.get(r.pulse_id) ?? 0) + 1)
  }
  const hasReceipt = (pulseId: string): number => receiptsPerPulse.get(pulseId) ?? 0
  for (const p of pulseRows) {
    const t = Date.parse(p.emitted_at)
    const start = Math.floor(t / binMs) * binMs
    const bin = bucket.get(start)
    if (bin === undefined || t < windowStart || t >= windowEnd) continue
    bin.pulses += 1
    let matchedCount = 0
    if (triggerFilter === undefined) {
      for (const trigger of registry) if (matchesPulse(p.pulse_id, trigger)) matchedCount += 1
    } else {
      const target = registry.find(t2 => t2.trigger_id === triggerFilter)
      if (target !== undefined && matchesPulse(p.pulse_id, target)) matchedCount = 1
    }
    if (matchedCount === 0) continue
    bin.matched += matchedCount
    bin.deduped += Math.max(0, matchedCount - hasReceipt(p.pulse_id))
  }
  // Pass 2: receipts. Status counts, durations, fired set, error details.
  let durationSum = 0
  let durationCount = 0
  for (const r of receiptRows) {
    if (triggerFilter !== undefined && r.trigger_id !== triggerFilter) continue
    const t = Date.parse(r.started_at)
    const start = Math.floor(t / binMs) * binMs
    const bin = bucket.get(start)
    if (bin === undefined || t < windowStart || t >= windowEnd) continue
    bin.dispatched += 1
    const status = r.status ?? '?'
    if (status === 'ok') bin.ok += 1
    else if (status === 'fail') bin.fail += 1
    else if (status === 'skipped') bin.skipped += 1
    else if (status === 'timeout') bin.timeout += 1
    const durationMs = Number(r.duration_ms ?? 0)
    durationSum += durationMs
    durationCount += 1
    if (!bin.fired.includes(r.trigger_id)) bin.fired.push(r.trigger_id)
    if ((status === 'fail' || status === 'timeout') && r.error !== undefined && bin.errors.length < 10) {
      bin.errors.push({ triggerId: r.trigger_id, status, durationMs, error: r.error })
    }
  }
  const binsOut = Array.from(bucket.values())
  for (const b of binsOut) {
    b.avgDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : 0
  }
  return { bins: binsOut, windowStart, windowEnd }
}

export function apply(ctx: Context & { webServer?: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void }): () => void } }, rawConfig: ConsoleConfig): void {
  // Empty config fields resolve against DSH_HOME so the injector channel can
  // mount the plugin with no config block at all.
  const dshHome = process.env.DSH_HOME ?? 'E:/1shuju/dsh-home'
  const dataDir = dshHome.replace(/\\/g, '/') + '/data/automation'
  const config: ConsoleConfig = {
    journalPath: rawConfig.journalPath !== '' ? rawConfig.journalPath : dataDir + '/scheduler-journal.ndjson',
    patchYml: rawConfig.patchYml !== '' ? rawConfig.patchYml : dshHome.replace(/\\/g, '/') + '/profiles/web/cordis.patch.yml',
    pipelineApiBase: rawConfig.pipelineApiBase,
    ledgers: (rawConfig.ledgers ?? []).length > 0 ? rawConfig.ledgers : [
      { name: 'integration-8008', label: '8008 集成门禁', path: dataDir + '/router-8008.json' },
      { name: 'staging-8027', label: '8027 预发布门禁', path: dataDir + '/router-8027.json' },
    ],
  }

  const getTriggerService = (): TriggersFace | undefined => ctx.get('automationTriggers', false) as TriggersFace | undefined

  const buildJobs = (runs: RunRecord[]): JobView[] => {
    const definitions = parsePatchJobs(config.patchYml)
    return definitions.map(def => {
      const name = String(def.name ?? '?')
      const last = [...runs].reverse().find(r => r.job === name)
      const everyMs = typeof def.everyMs === 'number' ? def.everyMs : null
      const nextDueApprox = last !== undefined && everyMs !== null
        ? new Date(new Date(last.at).getTime() + everyMs).toISOString()
        : null
      return {
        name,
        everyMs,
        jitterMs: typeof def.jitterMs === 'number' ? def.jitterMs : null,
        target: String(def.target ?? ''),
        lastRunAt: last?.at ?? null,
        lastOk: last?.ok ?? null,
        lastDetail: last?.detail ?? '',
        nextDueApprox,
      }
    })
  }

  /** Live running dispatches from the scheduler service (in-memory truth). */
  const runningNow = (): Array<{ triggerId: string; elapsedMs: number }> => {
    const service = getTriggerService()
    try {
      return service?.runningSnapshot(Date.now()).map(r => ({ triggerId: r.trigger_id, elapsedMs: r.elapsedMs })) ?? []
    } catch { return [] }
  }

  /** Most recent clock pulse: service clock state first, else the ledger tail. */
  const lastPulse = (): { pulseId: string; emittedAt: string; agoMs: number } | null => {
    const service = getTriggerService()
    const clock = service?.clockState?.()
    const fallback = readLedger(dataDir + '/logs/clock_pulses.jsonl').slice(-1)[0] as PulseRow | undefined
    const pulseId = clock?.pulseId ?? fallback?.pulse_id ?? undefined
    const emittedAt = clock?.emittedAt ?? fallback?.emitted_at ?? undefined
    if (pulseId === undefined || emittedAt === undefined) return null
    return { pulseId, emittedAt, agoMs: Date.now() - Date.parse(emittedAt) }
  }

  /** Trigger registry view with level tags, last receipt, and window events. */
  const buildBoard = (windowStart: number, windowEnd: number, receiptRows: ReceiptRow[]): TriggerBoardView => {
    const busTriggers = loadBusTriggers(dataDir + '/signals/triggers')
    const lastReceiptByTrigger = new Map<string, { status: string; at: string }>()
    for (const row of receiptRows) {
      const r = row as ReceiptLike
      if (typeof r.trigger_id === 'string' && typeof r.started_at === 'string' && typeof r.status === 'string') {
        lastReceiptByTrigger.set(r.trigger_id, { at: r.started_at, status: r.status })
      }
    }
    const triggers = busTriggers.map(t => {
      const inWindow = receiptRows
        .filter(r => r.trigger_id === t.trigger_id)
        .filter(r => {
          const tMs = Date.parse(r.started_at)
          return tMs >= windowStart && tMs < windowEnd
        })
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .slice(-60)
        .map(r => ({ at: r.started_at, status: r.status, durationMs: Number(r.duration_ms ?? 0), pulseId: r.pulse_id }))
      return {
        trigger_id: t.trigger_id,
        level: triggerLevel(t),
        channel: t.match.channel,
        matchText: describeMatch(t),
        actionSummary: describeAction(t),
        enabled: t.enabled !== false,
        ownerSession: t.owner_session,
        lastReceipt: lastReceiptByTrigger.get(t.trigger_id) ?? null,
        events: inWindow,
      }
    })
    const pulseEvents = readLedger(dataDir + '/logs/clock_pulses.jsonl')
      .map(row => (row as PulseRow).emitted_at)
      .filter((at): at is string => typeof at === 'string')
      .map(at => Date.parse(at))
      .filter(tMs => tMs >= windowStart && tMs < windowEnd)
    return { triggers, pulseEvents, runningNow: runningNow(), lastPulse: lastPulse() }
  }

  /** Full overview payload: series bins + board + jobs/gates/agents in one fetch. */
  const buildOverview = async (level: SeriesLevel, bins: number, triggerFilter: string | undefined): Promise<OverviewPayload> => {
    const nowMs = Date.now()
    const pulseRows = readLedger(dataDir + '/logs/clock_pulses.jsonl') as PulseRow[]
    const receiptRows = readLedger(dataDir + '/logs/signal_receipts.jsonl') as ReceiptRow[]
    const registry = loadBusTriggers(dataDir + '/signals/triggers')
    const { bins: seriesBins, windowStart, windowEnd } = buildSeries(pulseRows, receiptRows, level, bins, nowMs, registry, triggerFilter)
    const runs = readJournalTail(config.journalPath, 60)
    const gates = config.ledgers.map(l => ({ name: l.name, label: l.label, items: readLedgerItems(l.path) }))
    return {
      generatedAt: new Date().toISOString(),
      level,
      binMs: LEVEL_MS[level],
      windowStart,
      windowEnd,
      bins: seriesBins,
      board: buildBoard(windowStart, windowEnd, receiptRows),
      jobs: buildJobs(runs),
      runs,
      gates,
      agents: await fetchAgents(config.pipelineApiBase),
    }
  }

  /** Compact snapshot used by the model tool and the legacy /snapshot route. */
  const buildSnapshot = async (): Promise<Snapshot> => {
    const runs = readJournalTail(config.journalPath, 60)
    const gates = config.ledgers.map(l => ({ name: l.name, label: l.label, items: readLedgerItems(l.path) }))
    const receiptRows = readLedger(dataDir + '/logs/signal_receipts.jsonl') as ReceiptRow[]
    const board = buildBoard(0, Date.now(), receiptRows)
    return {
      generatedAt: new Date().toISOString(),
      jobs: buildJobs(runs),
      runs,
      gates,
      agents: await fetchAgents(config.pipelineApiBase),
      triggers: board.triggers.map(t => ({
        trigger_id: t.trigger_id,
        level: t.level,
        channel: t.channel,
        matchText: t.matchText,
        actionSummary: t.actionSummary,
        enabled: t.enabled,
        ownerSession: t.ownerSession,
        lastReceiptAt: t.lastReceipt?.at ?? null,
        lastReceiptStatus: t.lastReceipt?.status ?? null,
        consecutiveInfo: '',
      })),
      runningNow: board.runningNow,
      lastPulse: board.lastPulse,
      externalClocks: [
        { name: 'OmniReleaseAutopilot (schtasks)', schedule: '每2分钟', state: '已停用（由 release-autopilot-review 触发器接棒）' },
      ],
    }
  }

  // Model-facing overview: the agent reads pipeline truth without file access.
  ctx.tools.register(defineTool({
    name: 'automation_overview',
    description: 'Read the automation gate-pipeline state: configured scheduler jobs with last/next run, recent run results, pulse clock freshness, running dispatches, and per-gate tracked items (rejected/queued/testing). Use this instead of reading journal or ledger files directly.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { summary: { type: 'string', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: typeof (value as { summary?: string }).summary === 'string' ? (value as { summary: string }).summary : JSON.stringify(value),
      }],
    },
    execute: async () => {
      const snap = await buildSnapshot()
      const jobLines = snap.jobs.map(j =>
        '- ' + j.name + ': every=' + String(j.everyMs) + 'ms last=' + (j.lastRunAt ?? 'never')
        + ' ok=' + String(j.lastOk) + ' (' + j.lastDetail + ') next~=' + (j.nextDueApprox ?? '?'))
      const runLines = snap.runs.slice(-12).map(r =>
        '- ' + r.at + ' ' + r.job + ' ' + (r.ok ? 'OK' : 'FAIL') + ' ' + r.detail)
      const gateLines = snap.gates.flatMap(g => g.items.map(i =>
        '- [' + g.name + '] ' + i.id + ' lane=' + i.sourceLane + ' state=' + i.lastState
        + ' notified=' + String(i.notifyCount) + 'x :: ' + i.title))
      const agentLines = snap.agents.map(a => '- port ' + String(a.port) + ' -> ' + a.sessionId + (a.live ? ' (live)' : ''))
      const pulseLine = snap.lastPulse === null
        ? '- clock: no pulse recorded'
        : '- clock: last pulse ' + snap.lastPulse.pulseId + ' at ' + snap.lastPulse.emittedAt + ' (' + String(Math.round(snap.lastPulse.agoMs / 1000)) + 's ago)'
      const runningLines = snap.runningNow.map(r =>
        '- running: ' + r.triggerId + ' (' + String(Math.round(r.elapsedMs / 1000)) + 's)')
      const levelLines = [...new Set(snap.triggers.map(t => t.level))].sort().map(level =>
        '- [' + level + '] ' + snap.triggers.filter(t => t.level === level).map(t => t.trigger_id + (t.enabled ? '' : '(off)')).join(', '))
      return {
        summary: [
          '== Scheduler jobs (' + String(snap.jobs.length) + ') ==', ...jobLines,
          '== Registered triggers by level ==', ...levelLines,
          '== Clock ==', pulseLine, ...(runningLines.length > 0 ? runningLines : ['- no dispatch in flight']),
          '== Recent runs (last ' + String(Math.min(12, snap.runs.length)) + ') ==', ...runLines,
          '== Gate items (' + String(snap.gates.reduce((n, g) => n + g.items.length, 0)) + ') ==', ...gateLines,
          '== Live agents ==', ...(agentLines.length > 0 ? agentLines : ['- none registered']),
        ].join('\n'),
      }
    },
  }))

  // Panel HTTP API: same snapshot as JSON.
  const webServer = ctx.get('webServer') as { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void } | undefined
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/@dsh-external/dsh-automation-console/api/snapshot',
      handler: async (_req, res) => {
        const response = res as { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }
        try {
          const body = JSON.stringify(await buildSnapshot())
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(body)
        } catch (error) {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(String(error instanceof Error ? error.message : error))
        }
      },
    }), 'console:snapshot-api')

    // Time-series overview: binned pulse/receipt aggregates at a selectable level.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/@dsh-external/dsh-automation-console/api/overview',
      handler: async (req, res) => {
        const response = res as { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }
        try {
          const url = new URL((req as { url?: string }).url ?? '/', 'http://x')
          const levelRaw = url.searchParams.get('level') ?? '5m'
          const level: SeriesLevel = levelRaw in LEVEL_MS ? levelRaw as SeriesLevel : '5m'
          const bins = Number(url.searchParams.get('bins') ?? '96')
          const trigger = url.searchParams.get('trigger') ?? undefined
          const body = JSON.stringify(await buildOverview(level, Number.isFinite(bins) ? bins : 96, trigger === '' ? undefined : trigger))
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(body)
        } catch (error) {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(String(error instanceof Error ? error.message : error))
        }
      },
    }), 'console:overview-api')

    // Trigger CRUD + manual-run: delegate to the scheduler trigger service.
    // Resolve lazily per-request (not once at apply) so ordering and active-fiber
    // timing cannot leave the face captured as undefined.
    const writeJson = (res: unknown, status: number, body: string): void => {
      const response = res as { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      response.end(body)
    }
    const fail = (res: unknown, message: string): void => {
      writeJson(res, 500, JSON.stringify({ ok: false, error: message }))
    }
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/@dsh-external/dsh-automation-console/api/triggers',
      handler: async (req, res) => {
        const triggerService = getTriggerService()
        if (triggerService === undefined) { fail(res, 'automationTriggers service unavailable (scheduler bus disabled?)'); return }
        const method = (req as { method?: string }).method ?? 'GET'
        const pathname = new URL((req as { url?: string }).url ?? '/', 'http://x').pathname
        const base = '/@dsh-external/dsh-automation-console/api/triggers'
        const rest = pathname.slice(base.length) // '', '/<id>', '/<id>/run'
        const isList = rest === '' || rest === '/'
        try {
          if (method === 'GET' && isList) { writeJson(res, 200, JSON.stringify(triggerService.list())); return }
          const idMatch = /^\/([^/]+)(\/run)?$/.exec(rest)
          if (idMatch !== null) {
            const id = decodeURIComponent(idMatch[1])
            const isRun = idMatch[2] !== undefined
            if (method === 'GET' && !isRun) { const t = triggerService.get(id); writeJson(res, t === undefined ? 404 : 200, JSON.stringify(t === undefined ? { ok: false, error: 'not found' } : t)); return }
            if (method === 'DELETE' && !isRun) { triggerService.delete(id); writeJson(res, 200, JSON.stringify({ ok: true })); return }
            if (method === 'POST' && isRun) { const r = await triggerService.runNow(id); writeJson(res, r.ok ? 200 : 409, JSON.stringify(r)); return }
            if (method === 'PUT' && !isRun) { const patch = JSON.parse(await readBody(req as ReqLike)) as Record<string, unknown>; writeJson(res, 200, JSON.stringify(triggerService.update(id, patch))); return }
          }
          if (method === 'POST' && isList) { const input = JSON.parse(await readBody(req as ReqLike)) as Record<string, unknown>; writeJson(res, 200, JSON.stringify(triggerService.create(input))); return }
          fail(res, 'unhandled ' + method + ' ' + pathname)
        } catch (error) {
          fail(res, error instanceof Error ? error.message : String(error))
        }
      },
    }), 'console:triggers-api')
  }
}