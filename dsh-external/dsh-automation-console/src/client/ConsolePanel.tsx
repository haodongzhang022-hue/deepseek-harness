/**
 * ConsolePanel v4 — integrated automation management surface.
 * Two complementary representations of the automation registry, per the
 * calendar/frequency split: 「📅 日历」lays low-frequency automations (每天 /
 * 每周 / 每月) onto a rolling day grid so they stay continuously visible,
 * while 「⏲ 频次」groups every trigger by its cycle unit (每N分钟 / 每N小时 /
 * 每天 / 每周 / 每月) with next-run, health history, and one-click actions.
 * 「📡 运行」holds in-flight dispatches, the run journal, disabled triggers,
 * and the clock state; 「🚦 门禁」keeps the gate pipeline board.
 * All schedule math mirrors the scheduler's pure match rules over the raw
 * trigger registry (GET /api/triggers); receipt history comes from the
 * overview endpoint (GET /api/overview?level=1d&bins=N).
 * @module dsh-automation-console/client/ConsolePanel
 */

import { useEffect, useMemo, useState } from 'react'
import type { Cadence, CadenceUnit, DayMark, RawTrigger, ReceiptEvent, Snapshot } from './types.ts'

const SNAPSHOT_API = '/@dsh-external/dsh-automation-console/api/snapshot'
const TRIGGERS_API = '/@dsh-external/dsh-automation-console/api/triggers'
const OVERVIEW_API = '/@dsh-external/dsh-automation-console/api/overview'
const POLL_MS = 15_000
const TICK_MS = 30_000
const DEFAULT_TZ_OFFSET_MIN = 480
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
/** Rolling calendar window choices (days). */
const WINDOW_DAYS = [14, 35, 63] as const

/** Editor form model (string fields stay controlled by inputs). */
interface EditorForm {
  trigger_id: string
  owner_session: string
  scheduleKind: 'interval' | 'hourly' | 'atLocal' | 'weekly' | 'monthly'
  intervalN: string
  atH: string
  atM: string
  weekday: string
  dom: string
  actionKind: 'exec' | 'http'
  cmd: string
  cwd: string
  url: string
  method: string
  body: string
  timeout_s: string
  overlap: 'skip' | 'queue'
  enabled: boolean
}

const EMPTY_FORM: EditorForm = {
  trigger_id: '',
  owner_session: '',
  scheduleKind: 'atLocal',
  intervalN: '15',
  atH: '09',
  atM: '15',
  weekday: '1',
  dom: '1',
  actionKind: 'exec',
  cmd: '["D:/1ruanjian/1.kaifa/conda251011/envs/bian/python.exe","E:/1shuju/omni-meta/scripts/__REPLACE__.py"]',
  cwd: 'E:/1shuju/omni-meta',
  url: 'http://localhost:8008/api/v3/pipeline/rejections/dispatch_once',
  method: 'POST',
  body: '{}',
  timeout_s: '900',
  overlap: 'skip',
  enabled: true,
}

type ViewTab = 'calendar' | 'freq' | 'ops' | 'gates'

const TAB_ORDER: Array<{ id: ViewTab; label: string }> = [
  { id: 'calendar', label: '📅 日历' },
  { id: 'freq', label: '⏲ 频次' },
  { id: 'ops', label: '📡 运行' },
  { id: 'gates', label: '🚦 门禁' },
]

interface SlotFields { y: number; mo: number; d: number; h: number; m: number }

function utcSlotOf(ms: number): SlotFields {
  const d = new Date(ms)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes() }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Mirror of the scheduler's pure match rule over a UTC slot + trigger match. */
function matchSlot(
  m: RawTrigger['match'],
  slot: SlotFields,
  offsetMin: number,
): boolean {
  const localMinutes = mod(slot.h * 60 + slot.m + offsetMin, 24 * 60)
  if (m.atLocal !== undefined && localMinutes !== m.atLocal.h * 60 + m.atLocal.m) return false
  if (m.slot_m_mod !== undefined && slot.m % m.slot_m_mod !== 0) return false
  if (m.slot_h_mod !== undefined && slot.h % m.slot_h_mod !== 0) return false
  const utcMs = Date.UTC(slot.y, slot.mo - 1, slot.d, slot.h, slot.m)
  if (m.slot_weekday !== undefined && new Date(utcMs + offsetMin * 60_000).getUTCDay() !== m.slot_weekday) return false
  if (m.slot_dom !== undefined && new Date(utcMs + offsetMin * 60_000).getUTCDate() !== m.slot_dom) return false
  return true
}

/** Human cadence label for one trigger's match rule. */
function cadenceOf(t: RawTrigger): Cadence {
  const m = t.match
  const stamp = (h: number, mm: number): string => ' @' + String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
  if (m.atLocal !== undefined) {
    if (m.slot_weekday !== undefined) return { unit: 'week', label: '每周' + WEEKDAY_CN[m.slot_weekday] + stamp(m.atLocal.h, m.atLocal.m) }
    if (m.slot_dom !== undefined) return { unit: 'month', label: '每月第' + String(m.slot_dom) + '日' + stamp(m.atLocal.h, m.atLocal.m) }
    return { unit: 'day', label: '每天' + stamp(m.atLocal.h, m.atLocal.m) }
  }
  if (m.slot_m_mod !== undefined) return { unit: 'minute', label: '每' + String(m.slot_m_mod) + '分钟' }
  if (m.slot_h_mod !== undefined) return { unit: 'hour', label: '每' + String(m.slot_h_mod) + '小时' }
  if (m.channel === 'day') {
    if (m.slot_dom !== undefined) return { unit: 'month', label: '每月第' + String(m.slot_dom) + '日' }
    return { unit: 'day', label: '每天' }
  }
  if (m.channel === 'hour') return { unit: 'hour', label: '每小时' }
  return { unit: 'custom', label: '自定义(' + m.channel + ')' }
}

/** Upcoming occurrence instants (ms) of one trigger inside the horizon, mirroring the pulse loop. */
function nextOccurrences(t: RawTrigger, nowMs: number, horizonDays: number, limit: number): number[] {
  const m = t.match
  const offset = t.tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN
  const horizon = nowMs + horizonDays * 86_400_000
  const out: number[] = []
  const push = (ms: number): void => { if (out.length < limit && ms <= horizon) out.push(ms) }

  if (m.atLocal !== undefined) {
    const localNow = new Date(nowMs + offset * 60_000)
    for (let i = 0; i <= horizonDays + 2; i += 1) {
      const wall = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + i, m.atLocal.h, m.atLocal.m)
      const ms = wall - offset * 60_000
      if (ms <= nowMs) continue
      if (ms > horizon) break
      const d = new Date(ms)
      const slot: SlotFields = { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes() }
      if (!matchSlot(m, slot, offset)) continue
      push(ms)
    }
    return out
  }
  if (m.slot_m_mod !== undefined) {
    const k = Math.max(1, m.slot_m_mod)
    const cur = utcSlotOf(nowMs)
    let t = nowMs + ((k - (cur.m % k)) % k) * 60_000
    while (t <= horizon && out.length < limit) { push(t); t += k * 60_000 }
    return out
  }
  if (m.slot_h_mod !== undefined || m.channel === 'hour') {
    const k = Math.max(1, m.slot_h_mod ?? 1)
    const cur = utcSlotOf(nowMs)
    if (cur.m !== 0) {
      // Walk hour boundaries only; the pulse loop emits hour pulses at minute 0.
      const nextHour = Date.UTC(cur.y, cur.mo - 1, cur.d, cur.h + 1, 0) / 1
      let t = nextHour
      while (t <= horizon && out.length < limit) {
        const s = utcSlotOf(t)
        if (s.h % k !== 0) { t += 3_600_000; continue }
        push(t)
        t += k * 3_600_000
      }
      return out
    }
    // Now sits at an hour boundary: the current hour already fires (h % k === 0 means due now).
    let t = Date.UTC(cur.y, cur.mo - 1, cur.d, cur.h, 0) / 1
    if (cur.h % k !== 0) {
      t = Date.UTC(cur.y, cur.mo - 1, cur.d, cur.h + (k - (cur.h % k)), 0) / 1
    } else {
      t = nowMs
    }
    while (t <= horizon && out.length < limit) { push(t); t += k * 3_600_000 }
    return out
  }
  if (m.channel === 'day') {
    const cur = utcSlotOf(nowMs)
    const dayStart = Date.UTC(cur.y, cur.mo - 1, cur.d, 0, 0) / 1
    const first = dayStart > nowMs ? dayStart : dayStart + 86_400_000
    for (let t = first; t <= horizon && out.length < limit; t += 86_400_000) {
      const d = new Date(t)
      const slot: SlotFields = { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: 0, m: 0 }
      if (!matchSlot(m, slot, offset)) continue
      push(t)
      // MatchSlot already applied day gates; advance one day at a time.
    }
    return out
  }
  // Bare minute channel or custom: the next minute pulse.
  push(nowMs + 60_000)
  return out
}

function fmtTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('zh-CN', { hour12: false })
}

function fmtStamp(ms: number): string {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/** Local date key (yyyy-mm-dd) of an instant, for grid placement. */
function localDateKeyOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function relFuture(ms: number, nowMs: number): string {
  const diff = ms - nowMs
  if (diff <= 0) return '本分钟到期'
  const min = Math.round(diff / 60_000)
  if (min < 60) return min + ' 分钟后'
  const hours = Math.floor(min / 60)
  if (hours < 24) return hours + ' 小时 ' + (min % 60) + ' 分后'
  return Math.round(hours / 24) + ' 天后'
}

const UNIT_ICON: Record<CadenceUnit, string> = {
  minute: '⏱', hour: '🔁', day: '🕐', week: '🔂', month: '📅', custom: '⚙',
}

/** Compact absolute-time label: 今天 08:00 / 明天 05:35 / 9/15 09:30. */
function fmtNext(ms: number, nowMs: number): string {
  const d = new Date(ms)
  const today = new Date(nowMs)
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  if (localDateKeyOf(ms) === localDateKeyOf(nowMs)) return '今天 ' + hhmm
  if (localDateKeyOf(ms) === localDateKeyOf(tomorrow.getTime())) return '明天 ' + hhmm
  return String(d.getMonth() + 1) + '/' + String(d.getDate()) + ' ' + hhmm
}

function statusOf(raw: string | undefined): DayMark['status'] {
  if (raw === 'ok') return 'ok'
  if (raw === 'fail') return 'fail'
  if (raw === 'timeout') return 'timeout'
  if (raw === 'skipped') return 'skipped'
  return 'scheduled'
}

const STATUS_COLOR: Record<DayMark['status'], string> = {
  ok: '#57ab5a', fail: '#e5534b', timeout: '#d29922', skipped: '#768390',
  scheduled: '#316dca', next: '#d8a657', off: '#444c56',
}

function shortName(id: string): string {
  const cut = id.replace(/^omni-/, 'omni.').replace(/^daily-/, 'd.')
  return cut.length > 14 ? cut.slice(0, 13) + '…' : cut
}

/** Build a rolling day grid (current local week's Monday onward) with scheduled occurrences + past receipts. */
function buildCalendar(
  raw: RawTrigger[],
  eventsByTrigger: Map<string, ReceiptEvent[]>,
  nowMs: number,
  windowDays: number,
): Array<{ key: string; date: Date; marks: DayMark[]; intervalCount: number; isToday: boolean }> {
  const today = new Date(nowMs)
  const gridStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  const gridDays = Math.ceil(Math.max(7, windowDays) / 7) * 7
  const todayKey = localDateKeyOf(nowMs)
  const cells: Array<{ key: string; date: Date; marks: DayMark[]; intervalCount: number; isToday: boolean }> = []
  const byKey = new Map<string, { marks: DayMark[]; intervalCount: number }>()
  for (let i = 0; i < gridDays; i += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    const key = localDateKeyOf(date.getTime())
    byKey.set(key, { marks: [], intervalCount: 0 })
    cells.push({ key, date, marks: [], intervalCount: 0, isToday: key === todayKey })
  }
  const enabled = raw.filter(t => t.enabled !== false)
  const subDay = enabled.filter(t => {
    const u = cadenceOf(t).unit
    return u === 'minute' || u === 'hour' || u === 'custom'
  })
  for (const cell of cells) cell.intervalCount = subDay.length
  for (const t of enabled) {
    const unit = cadenceOf(t).unit
    if (unit === 'minute' || unit === 'hour' || unit === 'custom') continue
    const occ = nextOccurrences(t, nowMs, windowDays + 2, 40)
    for (const ms of occ) {
      const cell = byKey.get(localDateKeyOf(ms))
      if (cell === undefined) continue
      cell.marks.push({
        triggerId: t.trigger_id,
        label: shortName(t.trigger_id),
        stamp: fmtStamp(ms),
        status: ms === occ[0] ? 'next' : 'scheduled',
        at: ms,
        isNext: ms === occ[0],
        unit,
      })
    }
  }
  // Past-day receipts: real outcomes shown on the day they happened.
  const todayStartMs = new Date(todayKey + 'T00:00:00').getTime()
  for (const [tid, evts] of eventsByTrigger) {
    for (const ev of evts) {
      const ms = Date.parse(ev.at)
      if (Number.isNaN(ms) || ms >= todayStartMs) continue
      const cell = byKey.get(localDateKeyOf(ms))
      if (cell === undefined) continue
      const owner = raw.find(r => r.trigger_id === tid)
      cell.marks.push({
        triggerId: tid,
        label: shortName(tid),
        stamp: fmtStamp(ms),
        status: statusOf(ev.status),
        at: ms,
        isNext: false,
        unit: owner !== undefined ? cadenceOf(owner).unit : 'custom',
      })
    }
  }
  for (const cell of cells) {
    const rawCell = byKey.get(cell.key)
    cell.marks = rawCell?.marks ?? []
    cell.intervalCount = rawCell?.intervalCount ?? 0
  }
  return cells
}

/** Trailing consecutive failure count from the newest events. */
function consecutiveFails(evts: ReceiptEvent[]): number {
  let n = 0
  for (let i = evts.length - 1; i >= 0; i -= 1) {
    const s = evts[i]?.status
    if (s === 'fail' || s === 'timeout') n += 1
    else if (s !== undefined) break
  }
  return n
}

function EventDots({ events }: { events: ReceiptEvent[] }): React.ReactElement {
  const tail = events.slice(-8)
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }} title={'近 ' + String(tail.length) + ' 次: ' + tail.map(e => e.status).join(', ')}>
      {tail.map((e, i) => (
        <span key={String(i)} style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: STATUS_COLOR[statusOf(e.status)] }} />
      ))}
      {events.length === 0 && <span style={{ opacity: 0.4, fontSize: 10 }}>无记录</span>}
    </span>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#1c2128', color: '#adbac7', border: '1px solid #444c56',
  borderRadius: 4, padding: '3px 6px', fontSize: 12, width: '100%', boxSizing: 'border-box',
}
const btnStyle: React.CSSProperties = {
  background: 'transparent', color: '#adbac7', border: '1px solid #444c56',
  borderRadius: 4, padding: '1px 8px', fontSize: 11, cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = { ...btnStyle, background: '#2d4f8a', color: '#fff', borderColor: '#2d4f8a' }

function EnabledBadge({ enabled }: { enabled: boolean }): React.ReactElement {
  return (
    <span style={{
      padding: '0px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
      background: enabled ? '#2d4f8a' : '#444c56', color: enabled ? '#9fc3ff' : '#adbac7',
    }}>{enabled ? '启用' : '停用'}</span>
  )
}

export function ConsolePanel(_props: Record<string, never>): React.ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [raw, setRaw] = useState<RawTrigger[]>([])
  const [eventsByTrigger, setEventsByTrigger] = useState<Map<string, ReceiptEvent[]>>(new Map())
  const [status, setStatus] = useState('加载中…')
  const [tab, setTab] = useState<ViewTab>('calendar')
  const [windowDays, setWindowDays] = useState<number>(35)
  const [now, setNow] = useState(() => Date.now())
  const [showEditor, setShowEditor] = useState(false)
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [health, setHealth] = useState<{ snapshot: boolean; triggers: boolean; overview: boolean }>({ snapshot: false, triggers: false, overview: false })

  const refresh = async (): Promise<void> => {
    const load = async (): Promise<void> => {
      const [snapRes, trigRes, ovRes] = await Promise.allSettled([
        fetch(SNAPSHOT_API),
        fetch(TRIGGERS_API),
        fetch(OVERVIEW_API + '?level=1d&bins=' + String(Math.max(16, windowDays))),
      ])
      const next: { snapshot: boolean; triggers: boolean; overview: boolean } = { snapshot: false, triggers: false, overview: false }
      if (snapRes.status === 'fulfilled' && snapRes.value.ok) {
        const data = await snapRes.value.json() as Snapshot
        setSnapshot(data)
        next.snapshot = true
      }
      if (trigRes.status === 'fulfilled' && trigRes.value.ok) {
        const data = await trigRes.value.json() as RawTrigger[]
        setRaw(Array.isArray(data) ? data : [])
        next.triggers = true
      }
      if (ovRes.status === 'fulfilled' && ovRes.value.ok) {
        const data = await ovRes.value.json() as { board?: { triggers?: Array<{ trigger_id: string; events: ReceiptEvent[] }> } }
        const map = new Map<string, ReceiptEvent[]>()
        for (const t of data.board?.triggers ?? []) map.set(t.trigger_id, t.events)
        setEventsByTrigger(map)
        next.overview = true
      }
      setHealth(next)
      const okCount = Object.values(next).filter(Boolean).length
      const hour = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      setStatus(okCount === 3 ? '已更新 ' + hour : '部分失败 ' + hour + ' (快照' + (next.snapshot ? '✓' : '✗') + ' 注册表' + (next.triggers ? '✓' : '✗') + ' 回执' + (next.overview ? '✓' : '✗') + ')')
    }
    try {
      await load()
    } catch (e) {
      setStatus('加载失败: ' + String(e instanceof Error ? e.message : e))
    }
  }

  useEffect(() => {
    const poll = window.setInterval(() => { void refresh() }, POLL_MS)
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
    void refresh()
    return () => { window.clearInterval(poll); window.clearInterval(tick) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays])

  const calendarCells = useMemo(() => buildCalendar(raw, eventsByTrigger, now, windowDays), [raw, eventsByTrigger, now, windowDays])
  const freqGroups = useMemo(() => {
    const unitRank: Record<string, number> = { minute: 0, hour: 10, day: 20, week: 30, month: 40, custom: 50 }
    const buckets = new Map<string, { unit: string; label: string; items: RawTrigger[] }>()
    for (const t of raw) {
      const cad = cadenceOf(t)
      const key = t.enabled === false ? 'disabled' : cad.label
      if (!buckets.has(key)) buckets.set(key, { unit: cad.unit, label: t.enabled === false ? '已停用' : cad.label, items: [] })
      buckets.get(key)?.items.push(t)
    }
    return [...buckets.entries()]
      .sort((a, b) => (a[1].unit === 'disabled' ? 99 : unitRank[a[1].unit] ?? 50) - (b[1].unit === 'disabled' ? 99 : unitRank[b[1].unit] ?? 50))
      .map(([, v]) => v)
  }, [raw])

  /** Recent failure count inside a frequency group (window receipts). */
  const groupFails = (items: RawTrigger[]): number => {
    let n = 0
    for (const t of items) {
      for (const ev of eventsByTrigger.get(t.trigger_id) ?? []) {
        if (ev.status === 'fail' || ev.status === 'timeout') n += 1
      }
    }
    return n
  }

  /** Next upcoming run per non-minute automation, sorted, for the timeline strip. */
  const nextUp = useMemo(() => {
    const items: Array<{ triggerId: string; at: number; unit: CadenceUnit; cadLabel: string; rel: string }> = []
    for (const t of raw) {
      if (t.enabled === false) continue
      const unit = cadenceOf(t).unit
      if (unit === 'minute' || unit === 'custom') continue
      const occ = nextOccurrences(t, now, 3, 1)
      if (occ.length === 0) continue
      items.push({ triggerId: t.trigger_id, at: occ[0]!, unit, cadLabel: cadenceOf(t).label, rel: relFuture(occ[0]!, now) })
    }
    return items.sort((a, b) => a.at - b.at).slice(0, 10)
  }, [raw, now])

  const nextRunOf = (t: RawTrigger): { at: number | null; rel: string } => {
    const occ = nextOccurrences(t, now, Math.max(windowDays, 63), 1)
    if (occ.length === 0) return { at: null, rel: '—' }
    return { at: occ[0]!, rel: relFuture(occ[0]!, now) }
  }

  const set = (patch: Partial<EditorForm>): void => setForm(f => ({ ...f, ...patch }))

  const call = async (path: string, init: RequestInit): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch(TRIGGERS_API + path, init)
    if (!res.ok) {
      let message = 'http ' + String(res.status)
      try { message = (await res.json() as { error?: string }).error ?? message } catch { /* keep status */ }
      throw new Error(message)
    }
    return { ok: true }
  }

  const openCreate = (): void => {
    setForm({ ...EMPTY_FORM })
    setShowEditor(true)
    setError('')
  }

  const openEdit = async (id: string): Promise<void> => {
    setError('')
    try {
      const res = await fetch(TRIGGERS_API + '/' + encodeURIComponent(id))
      if (!res.ok) throw new Error('http ' + String(res.status))
      const t = await res.json() as RawTrigger
      const m = t.match
      const a = t.action
      const at = m.atLocal
      let scheduleKind: EditorForm['scheduleKind'] = 'atLocal'
      if (at !== undefined && m.slot_weekday !== undefined) scheduleKind = 'weekly'
      else if (at !== undefined && m.slot_dom !== undefined) scheduleKind = 'monthly'
      else if (at !== undefined) scheduleKind = 'atLocal'
      else if (m.slot_h_mod !== undefined) scheduleKind = 'hourly'
      else if (m.slot_m_mod !== undefined) scheduleKind = 'interval'
      setForm({
        trigger_id: t.trigger_id,
        owner_session: t.owner_session,
        scheduleKind,
        intervalN: String(m.slot_m_mod ?? m.slot_h_mod ?? 15),
        atH: String(at?.h ?? 9).padStart(2, '0'),
        atM: String(at?.m ?? 15).padStart(2, '0'),
        weekday: String(m.slot_weekday ?? 1),
        dom: String(m.slot_dom ?? 1),
        actionKind: a.kind === 'http' ? 'http' : 'exec',
        cmd: Array.isArray(a.cmd) ? JSON.stringify(a.cmd) : '[]',
        cwd: String(a.cwd ?? ''),
        url: String(a.url ?? ''),
        method: String(a.method ?? 'POST'),
        body: String(a.body ?? '{}'),
        timeout_s: String(a.timeout_s ?? 900),
        overlap: t.overlap === 'queue' ? 'queue' : 'skip',
        enabled: t.enabled !== false,
      })
      setShowEditor(true)
    } catch (e) {
      setError('加载失败: ' + String(e instanceof Error ? e.message : e))
    }
  }

  const toPayload = (f: EditorForm): Record<string, unknown> => {
    const match: Record<string, unknown> = { channel: 'minute' }
    if (f.scheduleKind === 'interval') match.slot_m_mod = Math.max(1, Number(f.intervalN) || 1)
    else if (f.scheduleKind === 'hourly') match.slot_h_mod = Math.max(1, Number(f.intervalN) || 1)
    else if (f.scheduleKind === 'weekly') { match.atLocal = { h: Number(f.atH), m: Number(f.atM) }; match.slot_weekday = Number(f.weekday) }
    else if (f.scheduleKind === 'monthly') { match.atLocal = { h: Number(f.atH), m: Number(f.atM) }; match.slot_dom = Math.min(31, Math.max(1, Number(f.dom) || 1)) }
    else match.atLocal = { h: Number(f.atH), m: Number(f.atM) }
    const action: Record<string, unknown> = f.actionKind === 'exec'
      ? { kind: 'exec', cmd: JSON.parse(f.cmd || '[]'), cwd: f.cwd || undefined, timeout_s: Number(f.timeout_s) }
      : { kind: 'http', url: f.url, method: f.method || 'POST', body: f.body || '{}', timeout_s: Number(f.timeout_s) }
    return {
      trigger_id: f.trigger_id,
      owner_session: f.owner_session,
      match,
      tzOffsetMin: 480,
      action,
      overlap: f.overlap,
      enabled: f.enabled,
    }
  }

  const validateForm = (f: EditorForm): string => {
    if (f.trigger_id.trim() === '') return 'trigger_id 必填'
    if (f.owner_session.trim() === '') return 'owner_session 必填'
    if (f.scheduleKind === 'atLocal' || f.scheduleKind === 'weekly' || f.scheduleKind === 'monthly') {
      const h = Number(f.atH); const mm = Number(f.atM)
      if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(mm) || mm < 0 || mm > 59) return '时刻必须 h∈[0,23] m∈[0,59]'
    }
    if (f.scheduleKind === 'interval' || f.scheduleKind === 'hourly') {
      const n = Number(f.intervalN)
      if (!Number.isInteger(n) || n < 1 || n > 23) return '间隔必须为 1..23 的整数'
    }
    if (f.scheduleKind === 'monthly') {
      const dom = Number(f.dom)
      if (!Number.isInteger(dom) || dom < 1 || dom > 31) return '每月日期必须为 1..31'
    }
    if (f.actionKind === 'exec') {
      try { JSON.parse(f.cmd || '[]') } catch { return 'cmd 必须是 JSON 数组' }
    }
    return ''
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const invalid = validateForm(form)
      if (invalid !== '') throw new Error(invalid)
      const payload = toPayload(form)
      const editing = raw.some(t => t.trigger_id === form.trigger_id)
      if (editing) await call('/' + encodeURIComponent(form.trigger_id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      else await call('', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      setShowEditor(false)
      await refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('删除触发器 ' + id + '？')) return
    try {
      await call('/' + encodeURIComponent(id), { method: 'DELETE' })
      await refresh()
    } catch (e) { setStatus('删除失败: ' + String(e instanceof Error ? e.message : e)) }
  }

  const runNow = async (id: string): Promise<void> => {
    try {
      await call('/' + encodeURIComponent(id) + '/run', { method: 'POST' })
      setStatus('已触发运行 ' + id)
    } catch (e) { setStatus('触发失败: ' + String(e instanceof Error ? e.message : e)) }
  }

  const disabledTriggers = raw.filter(t => t.enabled === false)
  const runs = [...(snapshot?.runs ?? [])].slice(-10).reverse()

  return (
    <div style={{ padding: 14, fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13, color: '#adbac7' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>⚙️ 自动化管理 · 时钟信号总线</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{status}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={btnStyle} onClick={() => void refresh()}>⟳ 刷新</button>
          <button style={btnPrimary} onClick={openCreate}>➕ 新增任务</button>
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2d333b', marginBottom: 10 }}>
        {TAB_ORDER.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...btnStyle,
              border: 'none',
              borderRadius: 0,
              fontSize: 13,
              padding: '5px 12px',
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? '#9fc3ff' : '#adbac7',
              borderBottom: tab === t.id ? '2px solid #316dca' : '2px solid transparent',
            }}
          >{t.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 4 }}>
          <span style={{ fontSize: 11, opacity: 0.6 }}>窗口</span>
          <select style={inputStyle} value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}>
            {WINDOW_DAYS.map(d => <option key={d} value={d}>{d >= 28 ? Math.round(d / 7) + ' 周' : '2 周'}</option>)}
          </select>
        </span>
      </div>

      {showEditor && (
        <div style={{ border: '1px solid #444c56', borderRadius: 6, padding: 12, marginBottom: 10, background: '#22272e' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {form.trigger_id !== '' && raw.some(t => t.trigger_id === form.trigger_id) ? '✎ 编辑任务 ' + form.trigger_id : '➕ 新增定时任务'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <label>trigger_id<input style={inputStyle} value={form.trigger_id} onChange={e => set({ trigger_id: e.target.value })} disabled={raw.some(t => t.trigger_id === form.trigger_id)} /></label>
            <label>owner_session<input style={inputStyle} value={form.owner_session} onChange={e => set({ owner_session: e.target.value })} /></label>
            <label>调度方式<select style={inputStyle} value={form.scheduleKind} onChange={e => set({ scheduleKind: e.target.value as EditorForm['scheduleKind'] })}>
              <option value="interval">每 N 分钟</option>
              <option value="hourly">每 N 小时</option>
              <option value="atLocal">每天 @HH:MM（本地）</option>
              <option value="weekly">每周 @星期几 HH:MM（本地）</option>
              <option value="monthly">每月 @第N日 HH:MM（本地）</option>
            </select></label>
            {(form.scheduleKind === 'interval' || form.scheduleKind === 'hourly') && (
              <label>{form.scheduleKind === 'hourly' ? '每 N 小时' : '每 N 分钟'}<input style={inputStyle} type="number" min={1} max={23} value={form.intervalN} onChange={e => set({ intervalN: e.target.value })} /></label>
            )}
            {(form.scheduleKind === 'atLocal' || form.scheduleKind === 'weekly' || form.scheduleKind === 'monthly') && (
              <>
                <label>小时 HH<input style={inputStyle} type="number" min={0} max={23} value={form.atH} onChange={e => set({ atH: e.target.value })} /></label>
                <label>分钟 MM<input style={inputStyle} type="number" min={0} max={59} value={form.atM} onChange={e => set({ atM: e.target.value })} /></label>
              </>
            )}
            {form.scheduleKind === 'weekly' && (
              <label>星期几<select style={inputStyle} value={form.weekday} onChange={e => set({ weekday: e.target.value })}>
                {WEEKDAY_CN.map((w, i) => <option key={i} value={i}>{w}</option>)}
              </select></label>
            )}
            {form.scheduleKind === 'monthly' && (
              <label>每月第 N 日<input style={inputStyle} type="number" min={1} max={31} value={form.dom} onChange={e => set({ dom: e.target.value })} /></label>
            )}
            <label>action<select style={inputStyle} value={form.actionKind} onChange={e => set({ actionKind: e.target.value as 'exec' | 'http' })}><option value="exec">exec（隐藏窗口）</option><option value="http">http</option></select></label>
            <label>timeout_s<input style={inputStyle} value={form.timeout_s} onChange={e => set({ timeout_s: e.target.value })} /></label>
            <label>overlap<select style={inputStyle} value={form.overlap} onChange={e => set({ overlap: e.target.value as 'skip' | 'queue' })}><option value="skip">skip（遇重跳过）</option><option value="queue">queue</option></select></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })} /> 启用</label>
          </div>
          {form.actionKind === 'exec' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label>cmd（JSON 数组）<textarea style={{ ...inputStyle, minHeight: 44, fontFamily: 'monospace' }} value={form.cmd} onChange={e => set({ cmd: e.target.value })} /></label>
              <label>cwd<input style={inputStyle} value={form.cwd} onChange={e => set({ cwd: e.target.value })} /></label>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label>url<input style={inputStyle} value={form.url} onChange={e => set({ url: e.target.value })} /></label>
              <label>method<input style={inputStyle} value={form.method} onChange={e => set({ method: e.target.value })} /></label>
              <label>body<input style={inputStyle} value={form.body} onChange={e => set({ body: e.target.value })} /></label>
            </div>
          )}
          {error !== '' && <div style={{ color: '#e5534b', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
            <button style={btnStyle} onClick={() => setShowEditor(false)}>取消</button>
          </div>
        </div>
      )}

      {/* 📅 日历 — low-frequency automations stay visible day by day */}
      {tab === 'calendar' && (
        <div>
          {/* 接下来 — next-run timeline so low-frequency automations stay visible */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, margin: '2px 0 4px' }}>🕘 接下来（按下次触发排序）</div>
            {nextUp.length === 0 && <div style={{ opacity: 0.5, fontStyle: 'italic', fontSize: 12 }}>没有待触发的日历级任务</div>}
            {nextUp.map(item => (
              <div key={item.triggerId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: 12 }}>
                <span style={{ fontFamily: 'monospace', color: '#d8a657', fontWeight: 600, minWidth: 130 }}>{fmtNext(item.at, now)}</span>
                <span>{UNIT_ICON[item.unit]}</span>
                <span style={{ fontWeight: 500 }}>{item.triggerId}</span>
                <span style={{ opacity: 0.6 }}>{item.cadLabel}</span>
                <span style={{ marginLeft: 'auto', opacity: 0.75, fontSize: 11 }}>{item.rel}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600 }}>📅 自动化日历</span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>
              每天/每周/每月任务按触发日排布 · 高频周期任务合并为 {calendarCells[0]?.intervalCount ?? 0} 个/日 · 金色边框 = 下次运行
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
            {WEEKDAY_CN.map(w => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11, opacity: 0.6, padding: '2px 0' }}>{w}</div>
            ))}
            {calendarCells.map(cell => (
              <div
                key={cell.key}
                style={{
                  border: cell.isToday ? '1px solid #316dca' : '1px solid #2d333b',
                  borderRadius: 4,
                  minHeight: 84,
                  padding: 3,
                  background: cell.isToday ? '#1f2c40' : '#1c2128',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
                  <span>{cell.date.getDate()}</span>
                  {cell.isToday && <span style={{ color: '#9fc3ff' }}>今天</span>}
                </div>
                {cell.intervalCount > 0 && (
                  <div style={{ fontSize: 10, background: '#22272e', borderRadius: 3, padding: '0 3px', marginBottom: 1, border: '1px dashed #444c56', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={'高频周期任务 ' + String(cell.intervalCount) + ' 个今日触发'}>
                    ⏲ {String(cell.intervalCount)} 个周期
                  </div>
                )}
                {cell.marks.slice(0, 6).map((mk, i) => (
                  <div
                    key={String(i)}
                    title={mk.triggerId + ' ' + mk.stamp + (mk.status !== 'scheduled' && mk.status !== 'next' ? ' · ' + mk.status : '')}
                    style={{
                      fontSize: 10,
                      display: 'flex',
                      gap: 3,
                      alignItems: 'center',
                      padding: '0 3px',
                      marginBottom: 1,
                      borderRadius: 3,
                      background: '#22272e',
                      border: mk.isNext ? '1px solid ' + STATUS_COLOR.next : '1px solid transparent',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: STATUS_COLOR[mk.status], flexShrink: 0 }} />
                    <span style={{ flexShrink: 0 }}>{mk.stamp}</span>
                    <span style={{ flexShrink: 0, opacity: 0.8 }}>{UNIT_ICON[mk.unit]}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mk.label}</span>
                  </div>
                ))}
                {cell.marks.length > 6 && <div style={{ fontSize: 10, opacity: 0.6, paddingLeft: 3 }}>+{String(cell.marks.length - 6)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ⏲ 频次 — periodic triggers grouped by cycle unit */}
      {tab === 'freq' && (
        <div>
          <div style={{ fontWeight: 600, margin: '2px 0 6px' }}>⏲ 频次视图（按触发周期分组）</div>
          {freqGroups.length === 0 && <div style={{ opacity: 0.5, fontStyle: 'italic' }}>注册表为空</div>}
          {freqGroups.map(group => {
            const fails = groupFails(group.items)
            return (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, opacity: 0.55, borderBottom: '1px solid #2d333b', paddingBottom: 2, marginBottom: 3 }}>
                ⏲ {group.label} · {String(group.items.length)} 个{fails > 0 && <span style={{ color: '#e5534b', marginLeft: 6 }}>近窗失败 {fails}</span>}
              </div>
              {group.items.map(t => {
                const nr = nextRunOf(t)
                const evts = eventsByTrigger.get(t.trigger_id) ?? []
                const lastEvt = evts[evts.length - 1]
                const fails = consecutiveFails(evts)
                const disabled = t.enabled === false
                return (
                  <div key={t.trigger_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', opacity: disabled ? 0.6 : 1 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: disabled ? '#444c56' : STATUS_COLOR[lastEvt === undefined ? 'scheduled' : statusOf(lastEvt.status)] }} />
                    <span style={{ fontWeight: 600, minWidth: 170 }}>{t.trigger_id}</span>
                    <span style={{ fontSize: 12, opacity: 0.75, minWidth: 130 }}>上次 {lastEvt !== undefined ? fmtTime(lastEvt.at) + ' (' + lastEvt.status + ')' : '—'}</span>
                    <span style={{ fontSize: 12, color: nr.at !== null ? '#d8a657' : undefined, minWidth: 130 }}>
                      下次 {nr.at !== null ? fmtNext(nr.at, now) + ' · ' + nr.rel : '—'}
                    </span>
                    {fails > 0 && <span style={{ fontSize: 10, color: '#e5534b', background: '#3a1720', borderRadius: 8, padding: '0 6px', fontWeight: 600 }}>连败 {fails}</span>}
                    <EventDots events={evts} />
                    <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.action.kind + ' ' + (Array.isArray(t.action.cmd) ? t.action.cmd.join(' ') : t.action.url ?? '')}>
                      {t.action.kind}
                    </span>
                    <EnabledBadge enabled={!disabled} />
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button style={btnStyle} title="立即运行" disabled={disabled} onClick={() => void runNow(t.trigger_id)}>▶ 运行</button>
                      <button style={btnStyle} title="编辑" onClick={() => void openEdit(t.trigger_id)}>✎ 编</button>
                      <button style={{ ...btnStyle, color: '#e5534b' }} title="删除" onClick={() => void remove(t.trigger_id)}>🗑 删</button>
                    </span>
                  </div>
                )
              })}
            </div>
            )
          })}
        </div>
      )}

      {/* 📡 运行 — in-flight, journal, clock, disabled */}
      {tab === 'ops' && (
        <div>
          <div style={{ fontWeight: 600, margin: '4px 0 4px', color: '#d29922' }}>
            ⏱ 正在运行 {(snapshot?.runningNow ?? []).length}
          </div>
          {(snapshot?.runningNow ?? []).map(r => (
            <div key={r.trigger_id} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
              <span style={{ color: '#d29922' }}>▶</span>
              <span style={{ fontWeight: 500 }}>{r.trigger_id}</span>
              <span style={{ opacity: 0.6 }}>已运行 {String(Math.round(r.elapsedMs / 1000))}s</span>
            </div>
          ))}
          {snapshot?.lastPulse !== null && snapshot?.lastPulse !== undefined && (
            <div style={{ fontSize: 11, opacity: 0.6, padding: '2px 0' }}>
              🕐 时钟脉冲 {snapshot.lastPulse.pulseId} · {fmtTime(snapshot.lastPulse.emittedAt)}（{String(Math.round(snapshot.lastPulse.agoMs / 1000))}s 前）
            </div>
          )}

          <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>⚡ 最近活动</div>
          {runs.length === 0 && <div style={{ opacity: 0.5, fontStyle: 'italic' }}>暂无记录</div>}
          {runs.map((run, i) => (
            <div key={run.at + String(i)} style={{ display: 'flex', gap: 8, padding: '1px 0', fontSize: 12 }}>
              <span style={{ color: run.ok ? '#57ab5a' : '#e5534b', minWidth: 30 }}>{run.ok ? '✓' : '✗'}</span>
              <span style={{ opacity: 0.6, minWidth: 80 }}>{fmtTime(run.at)}</span>
              <span style={{ fontWeight: 500, minWidth: 150 }}>{run.job}</span>
              <span style={{ opacity: 0.7 }}>{run.detail}</span>
            </div>
          ))}

          {disabledTriggers.length > 0 && (
            <>
              <div style={{ fontWeight: 600, margin: '10px 0 4px', color: '#e5534b' }}>💤 已停用</div>
              {disabledTriggers.map(t => (
                <div key={t.trigger_id} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12, opacity: 0.75 }}>
                  <span>⛔</span>
                  <span style={{ fontWeight: 500, minWidth: 170 }}>{t.trigger_id}</span>
                  <span>{cadenceOf(t).label}</span>
                  <EnabledBadge enabled={false} />
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button style={btnStyle} title="编辑" onClick={() => void openEdit(t.trigger_id)}>✎ 编</button>
                    <button style={{ ...btnStyle, color: '#e5534b' }} title="删除" onClick={() => void remove(t.trigger_id)}>🗑 删</button>
                  </span>
                </div>
              ))}
            </>
          )}
          {(snapshot?.externalClocks ?? []).map(c => (
            <div key={c.name} style={{ fontSize: 11, opacity: 0.55, padding: '1px 0' }}>↻ {c.name} · {c.schedule} · {c.state}</div>
          ))}
        </div>
      )}

      {/* 🚦 门禁 — gate pipeline board */}
      {tab === 'gates' && (
        <div>
          {(snapshot?.gates ?? []).map(gate => (
            <div key={gate.name} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{gate.label}</span>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{gate.items.length} 条</span>
              </div>
              {gate.items.map(item => (
                <div key={item.id} style={{ display: 'flex', gap: 8, padding: '2px 6px', margin: '1px 0', background: '#22272e', borderRadius: 4, alignItems: 'center' }}>
                  <span style={{ padding: '0px 7px', borderRadius: 9, fontSize: 11, fontWeight: 600, background: item.lastState === 'rejected' ? '#e5534b' : item.lastState.includes('approv') || item.lastState.includes('pass') ? '#57ab5a' : '#768390', color: '#1c2128' }}>{item.lastState}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.id}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }} title={item.title}>{item.title}</span>
                  <span style={{ fontSize: 11, opacity: 0.5 }}>wake {String(item.notifyCount)}x</span>
                </div>
              ))}
            </div>
          ))}
          {snapshot !== null && snapshot.gates.length === 0 && <div style={{ opacity: 0.5, fontStyle: 'italic' }}>无门禁配置</div>}
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.45 }}>
        注册 {String(raw.length)} 个触发器 · 快照 {snapshot?.generatedAt ?? '—'} · 脉冲源 SLA ≤90s · 每月调度需调度器 ≥slot_dom 版本（重启后生效）
      </div>
    </div>
  )
}