/**
 * Trigger registry: the signal library's declarative automation inventory.
 * Files live under signals/triggers/*.json (git-managed — the diff is the
 * audit). Matching is a pure function of signal content only; anything that
 * needs external state belongs inside the executor.
 * @module ui-automation-scheduler/triggers
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ClockPulse } from './pulse.ts'

/** Delivery overlap policy: skip (default) or queue up to N pending fires. */
export type OverlapPolicy = 'skip' | { readonly queue: number }

/** The three sanctioned action kinds; nothing else ships without a rule revision. */
export type TriggerAction =
  | { readonly kind: 'exec'; readonly cmd: readonly string[]; readonly timeout_s: number; readonly cwd?: string }
  | { readonly kind: 'http'; readonly url: string; readonly method?: string; readonly body?: string; readonly timeout_s: number }
  | { readonly kind: 'dsh-prompt'; readonly session_id: string; readonly text: string }

/** Failure escalation: notify the owner session after N consecutive failures. */
export interface FailurePolicy {
  readonly consecutive_fail_notify: number
  /** Only dsh-session.prompt ships in v1. */
  readonly notify_transport: 'dsh-session.prompt'
  /** Target session id (the owner). */
  readonly notify_target: string
}

/** Default local-timezone offset used by atLocal rules when a trigger omits one: Asia/Shanghai (UTC+8). */
export const DEFAULT_TZ_OFFSET_MIN = 480

/** One registered automation. */
export interface Trigger {
  readonly trigger_id: string
  readonly owner_session: string
  /** Disabled triggers stay listed (the panel shows them under 未触发) but never route. Default true. */
  readonly enabled?: boolean
  readonly match: {
    readonly channel: ClockPulse['channel']
    /** Fire only at the local wall-clock minute matching this (channel usually 'minute'). */
    readonly atLocal?: { readonly h: number; readonly m: number }
    readonly slot_m_mod?: number
    readonly slot_h_mod?: number
    /** Local-timezone weekday gate (0=Sunday..6=Saturday), combined with the other filters. */
    readonly slot_weekday?: number
    /** Local-timezone day-of-month gate (1..31), combined with the other filters — the monthly cadence unit. */
    readonly slot_dom?: number
  }
  /** Local-timezone offset in minutes east of UTC for atLocal matching (east positive). @default DEFAULT_TZ_OFFSET_MIN */
  readonly tzOffsetMin?: number
  readonly action: TriggerAction
  readonly overlap?: OverlapPolicy
  /** Template with {pulse_id} interpolation; defaults to trigger_id:{pulse_id}. */
  readonly dedup_key?: string
  readonly failure_policy?: FailurePolicy
}

/**
 * Pure match: channel equality, optional atLocal wall-clock minute equality
 * (UTC slot shifted by tzOffsetMin), and optional modular slot filters. Reads
 * no external state — the property that keeps routing auditable and replayable.
 */
export function matches(pulse: Pick<ClockPulse, 'channel' | 'slot'>, t: Trigger): boolean {
  if (t.enabled === false) return false
  if (t.match.channel !== pulse.channel) return false
  const atLocal = t.match.atLocal
  if (atLocal !== undefined) {
    const offsetMin = t.tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN
    const localMinutes = mod(pulse.slot.h * 60 + pulse.slot.m + offsetMin, 24 * 60)
    if (localMinutes !== atLocal.h * 60 + atLocal.m) return false
  }
  if (t.match.slot_m_mod !== undefined && pulse.slot.m % t.match.slot_m_mod !== 0) return false
  if (t.match.slot_h_mod !== undefined && pulse.slot.h % t.match.slot_h_mod !== 0) return false
  if (t.match.slot_weekday !== undefined && localWeekday(pulse.slot, t.tzOffsetMin) !== t.match.slot_weekday) return false
  if (t.match.slot_dom !== undefined && localDom(pulse.slot, t.tzOffsetMin) !== t.match.slot_dom) return false
  return true
}

/** Local-timezone weekday (0=Sunday..6=Saturday) of one UTC slot, using the trigger offset. */
function localWeekday(slot: ClockPulse['slot'], tzOffsetMin: number | undefined): number {
  const offsetMin = tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN
  const utcMs = Date.UTC(slot.y, slot.mo - 1, slot.d, slot.h, slot.m)
  return new Date(utcMs + offsetMin * 60_000).getUTCDay()
}

/** Local-timezone day-of-month (1..31) of one UTC slot, using the trigger offset. */
function localDom(slot: ClockPulse['slot'], tzOffsetMin: number | undefined): number {
  const offsetMin = tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN
  const utcMs = Date.UTC(slot.y, slot.mo - 1, slot.d, slot.h, slot.m)
  return new Date(utcMs + offsetMin * 60_000).getUTCDate()
}

/** Euclidean-ish modulo that yields non-negative results for negative dividends. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Interpolate the dedup key template for one pulse ({pulse_id} today). */
export function dedupKeyFor(t: Trigger, pulseId: string): string {
  const template = t.dedup_key ?? `${t.trigger_id}:{pulse_id}`
  return template.replaceAll('{pulse_id}', pulseId)
}

/** Load every *.json under dir as one Trigger; malformed files fail loud naming the file. */
export function loadTriggers(dir: string): Trigger[] {
  if (!existsSync(dir)) return []
  const triggers: Trigger[] = []
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const path = join(dir, file)
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Trigger
      if (typeof parsed.trigger_id !== 'string' || parsed.trigger_id === '') {
        throw new Error('missing trigger_id')
      }
      if (parsed.action === undefined || typeof parsed.action.kind !== 'string') {
        throw new Error('missing action.kind')
      }
      triggers.push(parsed)
    } catch (error) {
      throw new Error(`trigger registry: invalid ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return triggers
}
