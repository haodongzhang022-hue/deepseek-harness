/**
 * AutomationTriggerService: the cordis-service face over the trigger registry.
 * Provides CRUD on signals/triggers/*.json plus a manual runNow that bypasses
 * the schedule match. Other plugins (e.g. the automation console) inject this
 * service so management pages write through the same store as the pulse loop.
 * @module ui-automation-scheduler/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { buildMinutePulse } from './pulse.ts'
import { type SignalBus } from './bus.ts'
import { type StoredTrigger, type TriggerPatch, TriggerStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Writable registry + manual-run face for scheduled tasks. */
    automationTriggers: AutomationTriggerService
  }
}

/** The most recent clock-signal emission, for freshness watchdogs and panels. */
export interface ClockState {
  readonly pulseId: string
  readonly emittedAt: string
  readonly channels: readonly string[]
}

/** One in-flight dispatch as the panel shows it. */
export interface RunningDispatch {
  readonly trigger_id: string
  readonly elapsedMs: number
}

export class AutomationTriggerService extends Service {
  public readonly store: TriggerStore
  private readonly bus: (() => SignalBus | undefined) | undefined
  private readonly clock: (() => ClockState | undefined) | undefined

  constructor(ctx: Context, options: {
    store: TriggerStore
    bus?: () => SignalBus | undefined
    clock?: () => ClockState | undefined
  }) {
    super(ctx, 'automationTriggers')
    this.store = options.store
    this.bus = options.bus
    this.clock = options.clock
  }

  /** All triggers (registry content + filename). */
  list(): StoredTrigger[] {
    return this.store.list()
  }

  get(id: string): StoredTrigger | undefined {
    return this.store.get(id)
  }

  create(patch: TriggerPatch): StoredTrigger {
    return this.store.create(patch)
  }

  update(id: string, patch: TriggerPatch): StoredTrigger {
    return this.store.update(id, patch)
  }

  delete(id: string): void {
    this.store.delete(id)
  }

  /** Fire one trigger immediately, returning true when a run was started. */
  async runNow(id: string): Promise<{ ok: boolean; error?: string }> {
    const trigger = this.store.get(id)
    if (trigger === undefined) return { ok: false, error: 'not found: ' + id }
    const bus = this.bus?.()
    if (bus === undefined) return { ok: false, error: 'signal bus is not configured' }
    await bus.runNow(trigger, buildMinutePulse(Date.now()))
    return { ok: true }
  }

  /** In-flight dispatches right now (elapsed since each dispatch started). */
  runningSnapshot(nowMs: number): RunningDispatch[] {
    return this.bus?.()?.runningSnapshot(nowMs) ?? []
  }

  /** The most recent clock signal the pulse loop emitted, when the bus is enabled. */
  clockState(): ClockState | undefined {
    return this.clock?.()
  }
}