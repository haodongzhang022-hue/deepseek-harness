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
}

export interface RouterEngineOptions {
  readonly adapter: PipelineGateAdapter
  readonly ledger: FileLedger
  readonly transport: WakeTransport
  /** Absent on pipelines without wake addressing; rejections then only track. */
  readonly resolver?: WakeTargetResolver
}

/** Drives one gate pipeline. */
export class RouterEngine {
  constructor(private readonly options: RouterEngineOptions) {}

  async tick(): Promise<TickSummary> {
    const current = await this.options.adapter.listItems()
    const previous = this.options.ledger.all().map(toSnapshotItem)
    // Informational: surfaced in the summary for logs/tests.
    const events: readonly GateEvent[] = diffGateSnapshots(previous, current)

    for (const item of current) {
      this.options.ledger.track(item)
    }

    const woken: string[] = []
    for (const item of current) {
      if (!needsWake(this.options.ledger, item)) continue

      const target = await this.resolveTarget(item.sourceLane)
      if (target === null) continue

      await this.options.transport.deliver(target, item)
      this.options.ledger.markNotified(item.id)
      woken.push(item.id)
    }

    return { events, woken }
  }

  private async resolveTarget(lane: string): Promise<string | null> {
    const resolver: WakeTargetResolver | undefined = this.options.resolver
    if (resolver === undefined) return null
    return resolver.resolve(lane)
  }
}

function needsWake(ledger: FileLedger, item: GateItem): boolean {
  if (item.state !== 'rejected') return false
  const entry = ledger.get(item.id)
  return entry === undefined || entry.notifiedState !== 'rejected'
}

function toSnapshotItem(entry: import('./ledger.ts').LedgerEntry): GateItem {
  return {
    id: entry.id,
    sourceLane: entry.sourceLane,
    title: entry.title,
    state: entry.lastState,
  }
}
