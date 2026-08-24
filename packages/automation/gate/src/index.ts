/**
 * Generic gate-pipeline contract for automation routers.
 * @module @deepseek-ai/dsh-automation-gate
 */

/** Stable external item id as the upstream pipeline mints it. */
export type GateItemId = string

/** Port or lane the item originated from (e.g. a test-agent port). */
export type SourceLane = string

/**
 * Lifecycle states the router tracks per item; adapters map onto these.
 * `unmapped` covers foreign statuses with no routing semantics yet — never
 * silently collapse an unknown status onto a meaningful one.
 */
export type GateItemState =
  | 'queued'
  | 'testing'
  | 'passed'
  | 'rejected'
  | 'approved'
  | 'unmapped'

/** One item as an adapter reports it — plain data only. */
export interface GateItem {
  readonly id: GateItemId
  readonly sourceLane: SourceLane
  readonly title: string
  readonly state: GateItemState
  /** Rejection reason or review evidence; present on rejected/passed. */
  readonly detail?: string
}

/** Events the differ emits; one snapshot transition yields zero or more. */
export type GateEvent =
  | { readonly kind: 'item-submitted'; readonly item: GateItem }
  | { readonly kind: 'item-state-changed'; readonly id: GateItemId; readonly from: GateItemState; readonly to: GateItemState; readonly item: GateItem }

/**
 * Adapter over one concrete pipeline. Implementations translate foreign
 * snapshots into {@link GateItem} lists; the router never sees native shapes.
 */
export interface PipelineGateAdapter {
  /** Adapter name for logs and config binding. */
  readonly name: string
  /** Current snapshot, ordered by id for stable diffing. */
  listItems(): Promise<readonly GateItem[]>
}

/**
 * Optional adapter capability: resolve where a lane's work lives so the
 * router can wake it. Returns null when the lane has no known live target;
 * callers treat that as retry-later, not failure.
 */
export interface WakeTargetResolver {
  /** Resolve one source lane (e.g. a test-agent port) to a session id. */
  resolve(sourceLane: SourceLane): Promise<string | null>
}

/**
 * Diff two snapshots into events. Unknown-in-prev items emit submitted;
 * known items changing state emit state-changed. Ids must be unique within
 * each snapshot; duplicates throw — adapters normalize before calling.
 */
export function diffGateSnapshots(
  previous: readonly GateItem[],
  current: readonly GateItem[],
): GateEvent[] {
  const prevById = new Map(previous.map(item => [item.id, item]))
  if (prevById.size !== previous.length) {
    throw new TypeError('previous snapshot has duplicate ids')
  }

  const events: GateEvent[] = []
  const seen = new Set<string>()

  for (const item of current) {
    if (seen.has(item.id)) {
      throw new TypeError(`current snapshot has duplicate id: ${item.id}`)
    }
    seen.add(item.id)

    const before = prevById.get(item.id)
    if (before === undefined) {
      events.push({ kind: 'item-submitted', item })
      continue
    }
    if (before.state !== item.state) {
      events.push({
        kind: 'item-state-changed',
        id: item.id,
        from: before.state,
        to: item.state,
        item,
      })
    }
  }

  return events
}
