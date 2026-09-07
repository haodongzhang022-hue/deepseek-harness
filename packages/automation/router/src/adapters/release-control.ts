/**
 * Adapter binding the omni-meta finance release-control pipeline
 * (ports 8009-8016 test agents, 8008 integration gate) onto the generic gate
 * contract. Foreign payloads arrive as plain records; every status this file
 * does not explicitly map lands on 'unmapped' rather than guessing.
 * @module ui-automation-router/adapters/release-control
 */

import type { GateItem, GateItemState, PipelineGateAdapter, SourceLane, WakeTargetResolver } from '@deepseek-ai/dsh-automation-gate'

/** Minimal call seam the composition root binds to ctx.tools.execute. */
export type ReleaseControlCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>

/** Statuses this pipeline reports; the union the mapper below owns. */
const QUEUED = 'queued_8008'
const TESTING = 'testing_8008'
const REJECTED_8008 = 'rejected_8008'
const REJECTED_8027 = 'rejected_8027'
const APPROVED_8008 = 'approved_8008'

/** Map one foreign status onto the generic state; unknown reads as unmapped. */
export function mapReleaseStatus(status: string): GateItemState {
  switch (status) {
    case QUEUED: return 'queued'
    case TESTING: return 'testing'
    case REJECTED_8008:
    case REJECTED_8027: return 'rejected'
    case APPROVED_8008: return 'approved'
    default: return 'unmapped'
  }
}

/** One raw issue/agent record as list_release_state returns it. */
export type RawRecord = Record<string, unknown>

function str(record: RawRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Pull the most recent rejection reason off a record: the gate-results trail
 * is authoritative (last rejected decision wins), the feedback trail is the
 * fallback, and a flat legacy field comes last.
 */
export function extractRejectionDetail(record: RawRecord): string | undefined {
  const gates = record.gate_results
  if (Array.isArray(gates)) {
    const rejected = gates.filter(isRecord).filter(g => g.decision === 'rejected')
    const last = rejected[rejected.length - 1]
    const reason = last === undefined ? undefined : str(last, 'rejection_reason')
    if (reason !== undefined) return reason
  }

  const feedback = record.feedback
  if (Array.isArray(feedback)) {
    const last = feedback.filter(isRecord)[feedback.length - 1]
    const reason = last === undefined ? undefined : str(last, 'reason')
    if (reason !== undefined) return reason
  }

  return str(record, 'rejection_reason') ?? str(record, 'summary')
}

/**
 * Project raw issue records onto generic items using one gate's mapping;
 * ids missing from a record drop, and statuses outside the map land on
 * `unmapped` rather than guessing.
 */
export function toGateItems(issues: readonly RawRecord[], statusMap?: ReadonlyMap<string, GateItemState>): GateItem[] {
  const items: GateItem[] = []
  for (const issue of issues) {
    const id = str(issue, 'issue_id')
    if (id === undefined) continue
    const status = str(issue, 'status') ?? ''
    const state = statusMap !== undefined
      ? statusMap.get(status) ?? 'unmapped'
      : mapReleaseStatus(status)
    // Only rejections carry a reason worth shipping in the wake message.
    const detail = state === 'rejected' ? extractRejectionDetail(issue) : undefined
    items.push({
      id,
      sourceLane: typeof issue.source_port === 'string' || typeof issue.source_port === 'number' ? String(issue.source_port) : 'unknown',
      title: str(issue, 'title') ?? id,
      state,
      ...(detail !== undefined ? { detail } : {}),
    })
  }
  return items
}

/** One gate's foreign-status vocabulary mapped onto generic states. */
export interface StatusMap {
  readonly queued?: readonly string[]
  readonly testing?: readonly string[]
  /** Every listed rejected status wakes eligible items. */
  readonly rejected: readonly string[]
  readonly approved?: readonly string[]
}

/** The 801x-source integration gate (8008) vocabulary observed in production. */
export const INTEGRATION_8008_STATUS_MAP: StatusMap = {
  queued: [QUEUED],
  testing: [TESTING],
  rejected: [REJECTED_8008, REJECTED_8027],
  approved: [APPROVED_8008],
}

/** Staging verification gate (8027): its own test/reject cycle before promotion. */
export const STAGING_8027_STATUS_MAP: StatusMap = {
  testing: ['testing_8027'],
  rejected: ['rejected_8027'],
  approved: ['approved_8027', 'passed_8027'],
}

/** Production promotion gate (8028): observation only; terminal rows stay unlisted by default. */
export const PRODUCTION_8028_STATUS_MAP: StatusMap = {
  rejected: [],
  approved: ['production_approved'],
}

/**
 * Full adapter for one gate: lists items across that gate's configured
 * statuses and resolves a source lane (test-agent port) to the registered
 * live session id.
 */
export class ReleaseControlGateAdapter implements PipelineGateAdapter, WakeTargetResolver {
  readonly name: string
  private readonly watchStatuses: string[]
  private readonly statusToState: Map<string, GateItemState>

  constructor(private readonly caller: ReleaseControlCaller, options: { name?: string; statusMap?: StatusMap } = {}) {
    const map = options.statusMap ?? INTEGRATION_8008_STATUS_MAP
    this.name = options.name ?? 'release-control-finance'
    this.statusToState = new Map()
    for (const [state, names] of Object.entries(map)) {
      for (const foreign of names as readonly string[]) {
        this.statusToState.set(foreign, state as GateItemState)
      }
    }
    this.watchStatuses = [...this.statusToState.keys()]
  }

  async listItems(): Promise<GateItem[]> {
    const snapshots = await Promise.all(this.watchStatuses.map(status => this.caller('list_release_state', { status })))
    return toGateItems(snapshots.flatMap(extractRecords), this.statusToState)
  }

  async resolve(sourceLane: SourceLane): Promise<string | null> {
    const registry = await this.caller('list_release_state', { agents: true })
    const port = Number(sourceLane)
    const match = extractRecords(registry).find(agent => agent.port === port && agent.live === true)
    const sessionId = match === undefined ? undefined : str(match, 'session_id')
    return sessionId ?? null
  }
}

/** Default per-request timeout for the REST data channel. */
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000

/** One agent row from GET /api/v3/pipeline/status active_agents. */
interface PipelineStatusAgent {
  port?: unknown
  status?: unknown
  session_id?: unknown
}

/** One issue summary row from issues_by_status. */
interface PipelineStatusIssue extends RawRecord {}

/** Payload face of GET /api/v3/pipeline/status this caller consumes. */
interface PipelineStatusPayload {
  active_agents?: PipelineStatusAgent[]
  issues_by_status?: Record<string, PipelineStatusIssue[]>
}

/**
 * REST data channel against the pipeline HTTP API. Speaks the same call seam
 * as the MCP path so one adapter serves both; listing answers arrive as bare
 * record arrays with the grouping status written back onto each row.
 */
export class HttpReleaseControlCaller {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS
  }

  /** ReleaseControlCaller face; only the listing tool exists over REST. */
  readonly call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name !== 'list_release_state') {
      throw new Error('http channel supports list_release_state only, got ' + name)
    }
    const response = await this.fetchImpl(this.baseUrl + '/api/v3/pipeline/status', {
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error('pipeline status http ' + String(response.status))
    const payload = await response.json() as PipelineStatusPayload
    if (args.agents === true) {
      return (payload.active_agents ?? []).map(agent => ({
        port: agent.port,
        live: agent.status === 'available',
        session_id: agent.session_id,
      }))
    }
    const status = typeof args.status === 'string' ? args.status : ''
    const issues = payload.issues_by_status?.[status] ?? []
    return issues.map(issue => ({ ...issue, status }))
  }
}

/** Accept both bare-array payloads and { ...: array } envelopes. */
function extractRecords(payload: unknown): RawRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (payload !== null && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) return value.filter(isRecord)
    }
  }
  return []
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null
}
