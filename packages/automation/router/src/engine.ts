/**
 * Router engine: poll, diff, dispatch. Pure orchestration over injected
 * adapter, ledger, resolver, and transport — every collaborator is an
 * interface, so tests drive it entirely with fakes.
 *
 * Wake need is derived declaratively from the CURRENT snapshot plus the
 * ledger (state === rejected and not yet notified), never from the one-shot
 * diff event stream — so a failed or deferred delivery retries on later
 * ticks instead of being lost when the ledger already advanced.
 *
 * @module ui-automation-router/engine
 */

import { diffGateSnapshots } from '@deepseek-ai/dsh-automation-gate'
import type { GateEvent, GateItem, PipelineGateAdapter, WakeTargetResolver } from '@deepseek-ai/dsh-automation-gate'
import type { FileLedger } from './ledger.ts'
import type { WakeTransport } from './wake-transport.ts'

/** Outcome of one poll cycle; returned for logs and tests. */
export interface TickSummary {
  readonly events: readonly GateEvent[]
  /** Items whose rejection wake was dispatched this tick. */
  readonly woken: readonly string[]
  /** Wake attempts that threw; the item stays un-notified and retries next tick. */
  readonly failed: readonly { id: string; error: string }[]
}

export interface RouterEngineOptions {
  readonly adapter: PipelineGateAdapter
  readonly ledger: FileLedger
  readonly transport: WakeTransport
  /** Absent on pipelines without wake addressing; rejections then only track. */
  readonly resolver?: WakeTargetResolver
  /** States that trigger a wake; each state wakes its item once. Default: rejections only. */
  readonly wakeStates?: readonly GateItemState[]
}

/** Drives one gate pipeline. */
export class RouterEngine {
  private readonly wakeStates: ReadonlySet<GateItemState>

  constructor(private readonly options: RouterEngineOptions) {
    this.wakeStates = new Set(options.wakeStates ?? ['rejected'])
  }

  async tick(): Promise<TickSummary> {
    const current = await this.options.adapter.listItems()
    const previous = this.options.ledger.all().map(toSnapshotItem)
    // Informational: surfaced in the summary for logs/tests.
    const events: readonly GateEvent[] = diffGateSnapshots(previous, current)

    for (const item of current) {
      this.options.ledger.track(item)
    }

    const woken: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const item of current) {
      if (!needsWake(this, this.options.ledger, item)) continue

      const target = await this.resolveTarget(item.sourceLane)
      if (target === null) continue

      try {
        await this.options.transport.deliver(target, item)
      } catch (error) {
        failed.push({ id: item.id, error: errorMessage(error) })
        continue
      }
      this.options.ledger.markNotified(item.id, item.state)
      woken.push(item.id)
    }

    return { events, woken, failed }
  }

  /** Whether this engine wakes items in the given state. */
  wantsWakeFor(state: GateItemState): boolean {
    return this.wakeStates.has(state)
  }

  private async resolveTarget(lane: string): Promise<string | null> {
    const resolver: WakeTargetResolver | undefined = this.options.resolver
    if (resolver === undefined) return null
    return resolver.resolve(lane)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function needsWake(engine: RouterEngine, ledger: FileLedger, item: GateItem): boolean {
  if (!engine.wantsWakeFor(item.state)) return false
  const entry = ledger.get(item.id)
  return entry === undefined || entry.notifiedState !== item.state
}

function toSnapshotItem(entry: import('./ledger.ts').LedgerEntry): GateItem {
  return {
    id: entry.id,
    sourceLane: entry.sourceLane,
    title: entry.title,
    state: entry.lastState,
  }
}
