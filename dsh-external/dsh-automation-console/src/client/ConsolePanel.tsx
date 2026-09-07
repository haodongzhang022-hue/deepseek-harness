/**
 * ConsolePanel v3 — read + write automation console.
 * Keeps the read-only IA from v2 (running / calendar / activity / gates /
 * dormant) and adds a general scheduled-task CRUD layer: an editor to create
 * or edit a trigger (interval cadence or daily @H:MM local time; exec or HTTP
 * action) plus per-row run / edit / delete. All writes hit the scheduler's
 * trigger service through the console host's /api/triggers routes.
 * @module dsh-automation-console/client/ConsolePanel
 */

import { useEffect, useMemo, useState } from 'react'
import type { Snapshot } from './types.ts'

const SNAPSHOT_API = '/@dsh-external/dsh-automation-console/api/snapshot'
const TRIGGERS_API = '/@dsh-external/dsh-automation-console/api/triggers'
const POLL_MS = 15_000

const FREQ_ORDER = ['每天', '每1分钟', '每2分钟', '每5分钟', '每10分钟', '每15分钟', '每30分钟', '每小时']

/** Editor form model (string fields stay controlled by inputs). */
interface EditorForm {
  trigger_id: string
  owner_session: string
  channel: 'minute' | 'day'
  scheduleKind: 'atLocal' | 'interval'
  atH: string
  atM: string
  intervalMin: string
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
  channel: 'minute',
  scheduleKind: 'atLocal',
  atH: '09',
  atM: '15',
  intervalMin: '15',
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

function fmtTime(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('zh-CN', { hour12: false })
}

function groupByFrequency(triggers: Snapshot['triggers']): Array<{ key: string; items: Snapshot['triggers'] }> {
  const buckets = new Map<string, Snapshot['triggers']>()
  for (const t of triggers) {
    if (!buckets.has(t.matchText)) buckets.set(t.matchText, [])
    buckets.get(t.matchText)?.push(t)
  }
  return [...buckets.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([key, items]) => ({ key, items }))
}

function rank(label: string): number {
  const idx = FREQ_ORDER.indexOf(label)
  return idx === -1 ? 50 : idx
}

/** Build the scheduler trigger JSON from the form. */
function toPayload(form: EditorForm): Record<string, unknown> {
  const match: Record<string, unknown> = { channel: form.channel }
  if (form.scheduleKind === 'atLocal') {
    match.atLocal = { h: Number(form.atH), m: Number(form.atM) }
  } else {
    match.slot_m_mod = Number(form.intervalMin)
  }
  const action: Record<string, unknown> = form.actionKind === 'exec'
    ? { kind: 'exec', cmd: JSON.parse(form.cmd || '[]'), cwd: form.cwd || undefined, timeout_s: Number(form.timeout_s) }
    : { kind: 'http', url: form.url, method: form.method || 'POST', body: form.body || '{}', timeout_s: Number(form.timeout_s) }
  return {
    trigger_id: form.trigger_id,
    owner_session: form.owner_session,
    match,
    tzOffsetMin: 480,
    action,
    overlap: form.overlap,
    enabled: form.enabled,
  }
}

function StatusDot({ ok }: { ok: boolean | null }): React.ReactElement {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
      background: ok === true ? '#57ab5a' : ok === false ? '#e5534b' : '#768390',
    }} />
  )
}

function EnabledBadge({ enabled }: { enabled: boolean }): React.ReactElement {
  return (
    <span style={{
      padding: '0px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
      background: enabled ? '#2d4f8a' : '#444c56', color: enabled ? '#9fc3ff' : '#adbac7',
    }}>{enabled ? '启用' : '停用'}</span>
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

export function ConsolePanel(_props: Record<string, never>): React.ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState('加载中…')
  const [showEditor, setShowEditor] = useState(false)
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      const res = await fetch(SNAPSHOT_API)
      if (!res.ok) throw new Error('http ' + String(res.status))
      const data = await res.json() as Snapshot
      setSnapshot(data)
      setStatus('已更新 ' + fmtTime(data.generatedAt))
    } catch (e) {
      setStatus('加载失败: ' + String(e instanceof Error ? e.message : e))
    }
  }

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(SNAPSHOT_API)
        if (!res.ok) throw new Error('http ' + String(res.status))
        const data = await res.json() as Snapshot
        if (!alive) return
        setSnapshot(data)
        setStatus('已更新 ' + fmtTime(data.generatedAt))
      } catch (e) {
        if (alive) setStatus('加载失败: ' + String(e instanceof Error ? e.message : e))
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  const groups = useMemo(() => groupByFrequency(snapshot?.triggers ?? []), [snapshot])
  const disabled = (snapshot?.triggers ?? []).filter(t => !t.enabled)
  const runs = [...(snapshot?.runs ?? [])].slice(-8).reverse()

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
      const t = await res.json() as Record<string, unknown>
      const m = (t.match ?? {}) as Record<string, unknown>
      const a = (t.action ?? {}) as Record<string, unknown>
      const at = m.atLocal as { h?: number; m?: number } | undefined
      setForm({
        trigger_id: String(t.trigger_id ?? ''),
        owner_session: String(t.owner_session ?? ''),
        channel: m.channel === 'day' ? 'day' : 'minute',
        scheduleKind: at !== undefined ? 'atLocal' : 'interval',
        atH: String(at?.h ?? 9).padStart(2, '0'),
        atM: String(at?.m ?? 15).padStart(2, '0'),
        intervalMin: String(m.slot_m_mod ?? 15),
        actionKind: a.kind === 'http' ? 'http' : 'exec',
        cmd: Array.isArray(a.cmd) ? JSON.stringify(a.cmd, null, 0) : '[]',
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

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      const payload = toPayload(form)
      if (form.trigger_id.trim() === '' || form.owner_session.trim() === '') {
        throw new Error('trigger_id 与 owner_session 必填')
      }
      const editing = snapshot?.triggers.some(t => t.trigger_id === form.trigger_id) === true
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
      const r = await call('/' + encodeURIComponent(id) + '/run', { method: 'POST' })
      setStatus(r.ok ? '已触发运行 ' + id : '触发失败 ' + id)
    } catch (e) { setStatus('触发失败: ' + String(e instanceof Error ? e.message : e)) }
  }

  return (
    <div style={{ padding: 14, fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13, color: '#adbac7' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>⚙️ 自动化管道 · 时钟信号总线</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{status}</span>
        <span style={{ marginLeft: 'auto' }}>
          <button style={btnPrimary} onClick={() => void openCreate()}>➕ 新增任务</button>
        </span>
      </div>

      {showEditor && (
        <div style={{ border: '1px solid #444c56', borderRadius: 6, padding: 12, marginBottom: 10, background: '#22272e' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {form.trigger_id !== '' && snapshot?.triggers.some(t => t.trigger_id === form.trigger_id) ? '✎ 编辑任务 ' + form.trigger_id : '➕ 新增定时任务'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <label>trigger_id<input style={inputStyle} value={form.trigger_id} onChange={e => set({ trigger_id: e.target.value })} disabled={snapshot?.triggers.some(t => t.trigger_id === form.trigger_id)} /></label>
            <label>owner_session (02b-…-main)<input style={inputStyle} value={form.owner_session} onChange={e => set({ owner_session: e.target.value })} /></label>
            <label>channel<select style={inputStyle} value={form.channel} onChange={e => set({ channel: e.target.value as 'minute' | 'day' })}><option value="minute">minute（按分钟脉冲）</option><option value="day">day</option></select></label>
            <label>调度方式<select style={inputStyle} value={form.scheduleKind} onChange={e => set({ scheduleKind: e.target.value as 'atLocal' | 'interval' })}><option value="atLocal">每天 @HH:MM（本地）</option><option value="interval">每 N 分钟</option></select></label>
            {form.scheduleKind === 'atLocal'
              ? (<><label>小时 HH<input style={inputStyle} value={form.atH} onChange={e => set({ atH: e.target.value })} /></label><label>分钟 MM<input style={inputStyle} value={form.atM} onChange={e => set({ atM: e.target.value })} /></label></>)
              : (<label>每 N 分钟<input style={inputStyle} value={form.intervalMin} onChange={e => set({ intervalMin: e.target.value })} /></label>)}
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

      {/* ① 正在运行 */}
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

      {/* ② 任务日历 — 按频率分组 */}
      <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>📅 任务日历（当前 + 计划）</div>
      {groups.length === 0 && <div style={{ opacity: 0.5, fontStyle: 'italic' }}>注册表为空</div>}
      {groups.map(group => (
        <div key={group.key} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, opacity: 0.55, borderBottom: '1px solid #2d333b', paddingBottom: 2, marginBottom: 3 }}>
            ⏲ {group.key} · {String(group.items.length)} 个
          </div>
          {group.items.map(t => {
            const lastOk = t.lastReceiptStatus === 'ok' ? true : t.lastReceiptStatus === null ? null : false
            return (
              <div key={t.trigger_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <StatusDot ok={lastOk} />
                <span style={{ fontWeight: 600, minWidth: 170 }}>{t.trigger_id}</span>
                <span style={{ opacity: 0.75, fontSize: 12 }}>
                  上次 {fmtTime(t.lastReceiptAt)}{t.lastReceiptStatus !== null ? ' (' + t.lastReceiptStatus + ')' : ''} · {t.matchText}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.actionSummary}</span>
                <EnabledBadge enabled={t.enabled} />
                <span style={{ display: 'flex', gap: 4 }}>
                  <button style={btnStyle} title="立即运行" onClick={() => void runNow(t.trigger_id)}>▶ 运行</button>
                  <button style={btnStyle} title="编辑" onClick={() => void openEdit(t.trigger_id)}>✎ 编</button>
                  <button style={{ ...btnStyle, color: '#e5534b' }} title="删除" onClick={() => void remove(t.trigger_id)}>🗑 删</button>
                </span>
              </div>
            )
          })}
        </div>
      ))}

      {/* ③ 最近活动 */}
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

      {/* ④ 门禁管道 */}
      <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>🚦 门禁管道</div>
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
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>{item.title}</span>
              <span style={{ fontSize: 11, opacity: 0.5 }}>wake {String(item.notifyCount)}x</span>
            </div>
          ))}
        </div>
      ))}

      {/* ⑤ 未触发/已停用 */}
      {disabled.length > 0 && (
        <>
          <div style={{ fontWeight: 600, margin: '10px 0 4px', color: '#e5534b' }}>💤 已停用</div>
          {disabled.map(t => (
            <div key={t.trigger_id} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12, opacity: 0.75 }}>
              <span>⛔</span>
              <span style={{ fontWeight: 500, minWidth: 170 }}>{t.trigger_id}</span>
              <span>{t.matchText}</span>
              <EnabledBadge enabled={false} />
            </div>
          ))}
        </>
      )}
      {snapshot !== null && <div style={{ marginTop: 10, fontSize: 11, opacity: 0.45 }}>快照: {snapshot.generatedAt} · 脉冲源 SLA ≤90s</div>}
    </div>
  )
}