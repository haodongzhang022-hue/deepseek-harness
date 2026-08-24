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

/** Project raw issue records onto generic items; ids missing from a record drop. */
export function toGateItems(issues: readonly RawRecord[]): GateItem[] {
  const items: GateItem[] = []
  for (const issue of issues) {
    const id = str(issue, 'issue_id')
    if (id === undefined) continue
    const status = str(issue, 'status') ?? ''
    const detail = str(issue, 'rejection_reason') ?? str(issue, 'summary')
    items.push({
      id,
      sourceLane: String(issue.source_port ?? 'unknown'),
      title: str(issue, 'title') ?? id,
      state: mapReleaseStatus(status),
      ...(detail !== undefined ? { detail } : {}),
    })
  }
  return items
}

/**
 * Full adapter: lists items across the pipeline's known statuses and resolves
 * a source lane (test-agent port) to the registered live session id.
 */
export class ReleaseControlGateAdapter implements PipelineGateAdapter, WakeTargetResolver {
  readonly name = 'release-control-finance'

  constructor(private readonly caller: ReleaseControlCaller) {}

  async listItems(): Promise<GateItem[]> {
    // Terminal production_approved rows are deliberately not listed: they
    // would grow the ledger forever without adding routing decisions.
    const statuses = [QUEUED, TESTING, REJECTED_8008, REJECTED_8027, APPROVED_8008]
    const snapshots = await Promise.all(statuses.map(status => this.caller('list_release_state', { status })))
    return toGateItems(snapshots.flatMap(extractRecords))
  }

  async resolve(sourceLane: SourceLane): Promise<string | null> {
    const registry = await this.caller('list_release_state', { agents: true })
    const port = Number(sourceLane)
    const match = extractRecords(registry).find(agent => agent.port === port && agent.live === true)
    const sessionId = match === undefined ? undefined : str(match, 'session_id')
    return sessionId ?? null
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
