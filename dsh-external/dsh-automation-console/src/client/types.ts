/** Shared client-side view types (snapshot face mirrors the host payload). */
export interface Snapshot {
  generatedAt: string
  jobs: Array<{ name: string; everyMs: number | null; target: string; lastRunAt: string | null; lastOk: boolean | null; lastDetail: string; nextDueApprox: string | null }>
  runs: Array<{ at: string; job: string; ok: boolean; detail: string; durationMs: number }>
  gates: Array<{ name: string; label: string; items: Array<{ id: string; sourceLane: string; title: string; lastState: string; notifyCount: number }> }>
  agents: Array<{ port: number; sessionId: string; live: boolean }>
  triggers: Array<{
    trigger_id: string
    channel: string
    matchText: string
    actionSummary: string
    enabled: boolean
    ownerSession: string
    lastReceiptAt: string | null
    lastReceiptStatus: string | null
    consecutiveInfo: string
  }>
  runningNow: Array<{ trigger_id: string; elapsedMs: number }>
  lastPulse: { pulseId: string; emittedAt: string; agoMs: number } | null
  externalClocks: Array<{ name: string; schedule: string; state: string }>
}

/** Raw registry trigger as the scheduler store returns it (GET /api/triggers). */
export interface RawTrigger {
  trigger_id: string
  owner_session: string
  enabled?: boolean
  match: {
    channel: 'minute' | 'hour' | 'day'
    atLocal?: { h: number; m: number }
    slot_m_mod?: number
    slot_h_mod?: number
    slot_weekday?: number
    slot_dom?: number
  }
  tzOffsetMin?: number
  action: { kind: string; cmd?: string[]; url?: string; method?: string; body?: string; session_id?: string; cwd?: string; timeout_s?: number }
  overlap?: 'skip' | { queue: number } | string
  dedup_key?: string
  failure_policy?: { consecutive_fail_notify: number; notify_transport: string; notify_target: string }
  filename?: string
}

/** Cadence unit of one trigger, per the management grouping. */
export type CadenceUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'custom'

/** One receipt event from the overview board (per-trigger window history). */
export interface ReceiptEvent {
  at: string
  status: string
  durationMs: number
  pulseId: string
}

/** One daily calendar cell mark for a trigger. */
export interface DayMark {
  triggerId: string
  /** Short label shown in the cell. */
  label: string
  /** Wall-clock stamp like 09:15, or 周期 for sub-day interval triggers. */
  stamp: string
  /** Color/health class derived from status. */
  status: 'ok' | 'fail' | 'timeout' | 'skipped' | 'scheduled' | 'next' | 'off'
  /** ISO instant of the occurrence (when known). */
  at: number | null
  /** Whether the occurrence is the next upcoming run. */
  isNext: boolean
  /** Cycle unit of the owning trigger, for the cell icon. */
  unit: CadenceUnit
}

/** Parsed cadence of one trigger, mirroring the scheduler match rules. */
export interface Cadence {
  unit: CadenceUnit
  /** Human label like 每5分钟 / 每天 09:15 / 每周二 09:00 / 每月15日 09:30. */
  label: string
}