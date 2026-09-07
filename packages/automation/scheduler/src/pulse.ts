/**
 * Pulse source: the single clock of the automation bus. Emits deterministic
 * clock.pulse signals on the minute channel (hour/day derived, never separate
 * timers), appends each pulse to an append-only ledger, and keeps
 * last_pulse_at on disk for watchdogs. Iron rule A: this module is the only
 * place a clock signal may be created.
 * @module ui-automation-scheduler/pulse
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** One clock.pulse signal; refs stay references so pulses remain cheap. */
export interface ClockPulse {
  readonly type: 'clock.pulse'
  /** Deterministic: UTC time-slot concatenation — same slot, same id, downstream dedups for free. */
  readonly pulse_id: string
  readonly channel: 'minute' | 'hour' | 'day'
  readonly emitted_at: string
  readonly slot: { readonly y: number; readonly mo: number; readonly d: number; readonly h: number; readonly m: number }
}

/** Derive the UTC minute slot fields from a timestamp. */
export function utcSlot(ms: number): ClockPulse['slot'] {
  const d = new Date(ms)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes() }
}

/** Build the deterministic pulse id for one minute slot. */
export function minutePulseId(slot: ClockPulse['slot']): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${slot.y}${pad(slot.mo)}${pad(slot.d)}T${pad(slot.h)}${pad(slot.m)}Z-minute`
}

/** The minute-channel pulse for one timestamp (pure; same ms-in-minute, same pulse). */
export function buildMinutePulse(ms: number): ClockPulse {
  const slot = utcSlot(ms)
  return {
    type: 'clock.pulse',
    pulse_id: minutePulseId(slot),
    channel: 'minute',
    emitted_at: new Date(ms).toISOString(),
    slot,
  }
}

/** Derived channels fire from the same minute tick, never from their own timers. */
export function derivedChannels(slot: ClockPulse['slot']): Array<ClockPulse['channel']> {
  const derived: Array<ClockPulse['channel']> = []
  if (slot.m === 0) derived.push('hour')
  if (slot.m === 0 && slot.h === 0) derived.push('day')
  return derived
}

/** Persistence face of the pulse source: ledger + freshness stamp. */
export class PulseLedger {
  constructor(private readonly options: {
    readonly ledgerPath: string
    readonly lastPulsePath: string
    readonly maxLedgerLines?: number
  }) {}

  /** Append one pulse to the audit ledger and refresh the freshness stamp. */
  record(pulse: ClockPulse, matchedTriggerIds: readonly string[]): void {
    appendFileSync(this.options.ledgerPath, JSON.stringify({
      pulse_id: pulse.pulse_id,
      emitted_at: pulse.emitted_at,
      matched_trigger_ids: matchedTriggerIds,
    }) + '\n')
    writeFileSync(this.options.lastPulsePath, new Date().toISOString())
  }

  /** Ensure parent directories exist before the first record call. */
  ensureDirs(): void {
    for (const p of [this.options.ledgerPath, this.options.lastPulsePath]) {
      mkdirSync(dirname(p), { recursive: true })
    }
  }
}
