/**
 * @dsh-external/dsh-release-board — client 面板 (conversation.view slot)。
 * 发布看板: 直读 host /api/snapshot (queue.json 权威状态 + 8008-8028 端口探活)。
 * React 组件 (createElement, 与 automation-console ConsolePanel 同模式), 30s 自动轮询。
 */
import { createElement as h, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = Context & { slots: SlotsService }

export const inject = ['slots']

const SNAPSHOT_API = '/@dsh-external/dsh-release-board/api/snapshot'
const POLL_MS = 30000

interface SnapBucketItem {
  issue_id: string; title: string; change_type: string; source_port: number;
  updated_at: string; age_days: number | null;
  last_decision: { gate: string; decision: string; at: string; reason: string } | null;
}
interface SnapBucket { status: string; label: string; count: number; items: SnapBucketItem[] }
interface SnapInfra { port: number; env: string; up: boolean; http: number | null; note: string }
interface SnapAgent { port: number; agent_id: string; expires_at: string; expired: boolean }
interface Snap {
  generatedAt: string; queueMtime: string | null; parseError: string | null;
  counts: Record<string, number>; buckets: SnapBucket[];
  modules: Record<string, string>; agents: SnapAgent[]; infra: SnapInfra[];
}

const COL: Record<string, string> = {
  bg: '#1c2128', card: '#22272e', fg: '#adbac7', dim: '#768390', border: '#373e47',
  green: '#57ab5a', red: '#e5534b', amber: '#c69026', blue: '#316dca',
}

function fmtTime(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

function fmtDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) + ' ' + iso.slice(11, 19) : iso
}

function typeColor(t: string): string {
  if (t === 'bugfix') return COL.red
  if (t === 'feature') return COL.blue
  if (t === 'test' || t === 'docs') return COL.amber
  return COL.dim
}

function badge(text: string, color: string): React.ReactElement {
  return h('span', { style: { padding: '0px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, marginLeft: 6, background: color, color: '#ffffff', whiteSpace: 'nowrap' } }, text)
}

function bucketRows(bucket: SnapBucket): React.ReactElement[] {
  return bucket.items.map(item => {
    const line1 = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
      h('b', { style: { color: '#9fc3ff' } }, item.issue_id),
      badge(item.change_type, typeColor(item.change_type)),
      h('span', { style: { color: COL.dim, fontSize: 11 } }, 'src=' + String(item.source_port)),
      h('span', { style: { color: COL.dim, fontSize: 11 } }, fmtDate(item.updated_at)),
      item.age_days !== null && item.age_days > 0 && bucket.status === 'production_approved'
        ? h('span', { style: { color: COL.amber, fontSize: 11, fontWeight: 600 } }, '滞留' + String(item.age_days) + '天')
        : null,
    )
    const rows: React.ReactNode[] = [
      line1,
      h('div', { style: { color: COL.fg, fontSize: 12, marginTop: 2 } }, item.title),
    ]
    if (item.last_decision !== null && item.last_decision.decision !== 'approved') {
      rows.push(h('div', { style: { color: COL.red, fontSize: 11, marginTop: 2, whiteSpace: 'pre-wrap' } },
        item.last_decision.gate + ' ' + item.last_decision.decision + ': ' + item.last_decision.reason))
    }
    return h('div', { key: item.issue_id, style: { padding: '5px 0', borderBottom: '1px solid #2d333b' } }, rows)
  })
}

function BoardPanel(): React.ReactElement {
  const [snap, setSnap] = useState<Snap | null>(null)
  const [status, setStatus] = useState('加载中…')
  const load = async (): Promise<void> => {
    try {
      const res = await fetch(SNAPSHOT_API)
      if (!res.ok) throw new Error('http ' + String(res.status))
      const data = await res.json() as Snap
      setSnap(data)
      setStatus('已更新 ' + fmtTime(data.generatedAt) + (data.queueMtime !== null ? ' | queue.json ' + fmtDate(data.queueMtime) : ''))
    } catch (e) {
      setStatus('加载失败: ' + String(e instanceof Error ? e.message : e))
    }
  }
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [])
  const children: React.ReactNode[] = []
  children.push(h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 8 } },
    h('b', null, '🚀 发布看板'),
    h('button', { onClick: () => { void load() }, style: { background: COL.blue, color: '#ffffff', border: 'none', borderRadius: 4, padding: '3px 12px', fontSize: 12, cursor: 'pointer', marginLeft: 8 } }, '刷新'),
    h('span', { style: { color: COL.dim, fontSize: 11, marginLeft: 10 } }, '来源: data/release_control/queue.json (权威, 与 release_control MCP 同源)'),
  ))
  children.push(h('div', { style: { margin: '6px 0', color: COL.dim, fontSize: 12 } }, status))
  if (snap === null) {
    children.push(h('div', { style: { padding: 16, color: COL.dim } }, '…'))
  } else {
    if (snap.parseError !== null && snap.parseError !== '') {
      children.push(h('div', { style: { color: COL.red, marginBottom: 8, fontSize: 12 } }, '⚠️ ' + snap.parseError))
    }
    const infraRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 } },
      ...snap.infra.map(p => h('span', {
        key: String(p.port), title: p.note, style: {
          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: '#22272e',
          color: p.up ? (p.http === 200 ? COL.green : COL.amber) : COL.red, border: '1px solid ' + COL.border,
        },
      }, String(p.port) + ' ' + p.env + (p.up ? ' UP' : ' DOWN'))),
    )
    children.push(h('div', { style: { color: COL.dim, fontSize: 11, marginBottom: 4 } }, '门禁端口'))
    children.push(infraRow)
    const countsRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 } },
      ...Object.keys(snap.counts).map(status => {
        const count = snap.counts[status] ?? 0
        const label = snap.buckets.find(b => b.status === status)?.label ?? status
        const color = status === 'production_approved' ? COL.green : status.startsWith('rejected') ? COL.red : COL.blue
        return h('div', { key: status, style: { background: COL.card, border: '1px solid ' + COL.border, borderRadius: 8, padding: '6px 12px', minWidth: 120 } },
          h('div', { style: { fontSize: 22, fontWeight: 700, color } }, String(count)),
          h('div', { style: { fontSize: 11, color: COL.dim, marginTop: 2 } }, label),
        )
      }))
    children.push(countsRow)
    for (const bucket of snap.buckets) {
      children.push(h('details', { key: bucket.status, style: { marginBottom: 4 } },
        h('summary', { style: { cursor: 'pointer', padding: '4px 0', fontWeight: 600, fontSize: 13 } },
          String(bucket.label), ' (' + String(bucket.count) + ')'),
        h('div', { style: { marginLeft: 8, borderLeft: '2px solid ' + COL.border, paddingLeft: 10 } }, bucketRows(bucket)),
      ))
    }
    children.push(h('details', { key: 'agents' },
      h('summary', { style: { cursor: 'pointer', padding: '6px 0', fontWeight: 600, fontSize: 13 } }, 'Agent 注册 (' + String(snap.agents.length) + ')'),
      h('div', { style: { marginLeft: 8, borderLeft: '2px solid ' + COL.border, paddingLeft: 10 } },
        ...(snap.agents.length === 0 ? [h('div', { style: { color: COL.dim, fontSize: 12 } }, '无注册 agent')]
          : snap.agents.map(a => h('div', { key: String(a.port), style: { fontSize: 12, padding: '3px 0', color: a.expired ? COL.amber : COL.green } },
            String(a.port) + ' ' + a.agent_id + ' (过期=' + String(a.expired) + ', ' + fmtDate(a.expires_at) + ')'))),
      ),
    ))
    children.push(h('details', { key: 'modules' },
      h('summary', { style: { cursor: 'pointer', padding: '6px 0', fontWeight: 600, fontSize: 13 } }, '模块版本 (' + String(Object.keys(snap.modules).length) + ')'),
      h('div', { style: { marginLeft: 8, borderLeft: '2px solid ' + COL.border, paddingLeft: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '2px 12px' } },
        ...Object.entries(snap.modules).map(([name, version]) => h('div', { key: name, style: { fontSize: 11, color: COL.dim, padding: '1px 0' } }, name + '  ' + version))),
    ))
  }
  return h('div', { style: { padding: '12px 14px', fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13, color: COL.fg, background: COL.bg } }, children)
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: '@dsh-external/dsh-release-board-panel',
      order: 13,
      label: () => '🚀 发布看板',
    }, BoardPanel),
  ), '@dsh-external/dsh-release-board: panel')
}
