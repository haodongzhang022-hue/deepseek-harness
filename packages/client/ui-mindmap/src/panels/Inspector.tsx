/**
 * Mind-Map Inspector - Node detail editor
 * @module @deepseek-ai/dsh-client-ui-mindmap/panels/Inspector
 */

import React, { useState, useEffect } from 'react'
import { useMindMapStore } from '../store/mindmap.ts'
import { useSelectedNodes, useMindMapActions } from '../integration/projectionHooks.ts'
import type { MindMapNode, NodeStatus, EdgeType, ULID } from '../contract/types.ts'
import { NODE_KIND_COLORS, NODE_STATUS_LABELS, EDGE_TYPE_LABELS } from '../contract/types.ts'

// ──────────────────────────────────────────────
// Inspector Props
// ──────────────────────────────────────────────

export interface InspectorProps {
  onClose?: () => void
}

// ──────────────────────────────────────────────
// Inspector 组件
// ──────────────────────────────────────────────

export const Inspector: React.FC<InspectorProps> = ({ onClose }) => {
  const selectedNodes = useSelectedNodes()
  const { deleteNode } = useMindMapActions()
  const allNodes = useMindMapStore((s) => Array.from(s.nodes.values()))

  if (selectedNodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
        <div style={{ fontSize: 13 }}>Select a node to inspect</div>
      </div>
    )
  }

  if (selectedNodes.length > 1) {
    return (
      <div style={{ padding: 24 }}>
        <h3 style={{ margin: '0 0 12px', color: '#e2e8f0' }}>{selectedNodes.length} nodes selected</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {selectedNodes.map((n) => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#1e293b', borderRadius: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: n.color || NODE_KIND_COLORS[n.kind] }} />
              <span style={{ flex: 1, color: '#e2e8f0', fontSize: 13 }}>{n.title}</span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{n.kind}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button onClick={() => selectedNodes.forEach(n => deleteNode(n.id))} style={dangerBtn}>
            Delete All
          </button>
        </div>
      </div>
    )
  }

  const node = selectedNodes[0]!
  return <NodeInspector node={node} allNodes={allNodes} {...(onClose ? { onClose } : {})} />
}

// ──────────────────────────────────────────────
// 单节点 Inspector
// ──────────────────────────────────────────────

const NodeInspector: React.FC<{ node: MindMapNode; allNodes: MindMapNode[]; onClose?: () => void }> = ({ node, allNodes, onClose }) => {
  const { updateNode, deleteNode, createEdge, openNodeSession, spawnSubagentForNode, linkNodeToGoal } = useMindMapActions()
  const [title, setTitle] = useState(node.title)
  const [body, setBody] = useState(node.body)
  const [status, setStatus] = useState<NodeStatus>(node.status)
  const [labels, setLabels] = useState(node.labels.join(', '))
  const [connectTarget, setConnectTarget] = useState('')
  const [connectType, setConnectType] = useState<EdgeType>('derives_from')

  // 同步外部变更
  useEffect(() => {
    setTitle(node.title)
    setBody(node.body)
    setStatus(node.status)
    setLabels(node.labels.join(', '))
  }, [node.id])

  const save = () => {
    updateNode(node.id, {
      title,
      body,
      status,
      labels: labels.split(',').map(l => l.trim()).filter(Boolean),
    })
  }

  const color = node.color || NODE_KIND_COLORS[node.kind]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #334155' }}>
        <span style={{ width: 20, height: 20, borderRadius: 4, background: color }} />
        <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>{node.kind}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>v{node.version}</span>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>×</button>
        )}
      </div>

      {/* 表单 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 标题 */}
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
            style={inputStyle}
          />
        </Field>

        {/* 状态 */}
        <Field label="Status">
          <select value={status} onChange={(e) => { setStatus(e.target.value as NodeStatus); updateNode(node.id, { status: e.target.value as NodeStatus }) }} style={inputStyle}>
            {(Object.keys(NODE_STATUS_LABELS) as NodeStatus[]).map((s) => (
              <option key={s} value={s}>{NODE_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </Field>

        {/* 标签 */}
        <Field label="Labels (comma-separated)">
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            onBlur={save}
            placeholder="bug, auth, urgent"
            style={inputStyle}
          />
        </Field>

        {/* 正文 */}
        <Field label="Description">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            rows={6}
            placeholder="Markdown supported..."
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
        </Field>

        {/* DSH 能力 */}
        <Section title="DSH Capabilities">
          <CapabilityRow icon="💬" label="Session" value={node.sessionId || '—'} onClick={() => node.sessionId && openNodeSession(node.id)} />
          <CapabilityRow icon="🎯" label="Goal" value={node.goalId || '—'} onClick={() => { const gid = prompt('Goal ID:'); if (gid) linkNodeToGoal(node.id, gid) }} />
          <CapabilityRow icon="⚙️" label="Tool Calls" value={String(node.toolCalls.length)} />
          <CapabilityRow icon="✅" label="Approvals" value={String(node.approvals.length)} />
          <CapabilityRow icon="📁" label="Files" value={String(node.files.length)} />
        </Section>

        {/* 连接管理 */}
        <Section title="Connections">
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={connectType} onChange={(e) => setConnectType(e.target.value as EdgeType)} style={{ ...inputStyle, flex: '0 0 120px' }}>
              {(Object.keys(EDGE_TYPE_LABELS) as EdgeType[]).map((t) => (
                <option key={t} value={t}>{EDGE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <select value={connectTarget} onChange={(e) => setConnectTarget(e.target.value)} style={inputStyle}>
              <option value="">Select target node...</option>
              {allNodes.filter(n => n.id !== node.id).map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </div>
          <button
            disabled={!connectTarget}
            onClick={() => { if (connectTarget) { createEdge(node.id, connectTarget as ULID, connectType); setConnectTarget('') } }}
            style={{ ...actionBtn, opacity: connectTarget ? 1 : 0.5, marginTop: 8 }}
          >
            + Add Edge
          </button>
        </Section>

        {/* 子节点 */}
        {node.childIds.length > 0 && (
          <Section title={`Children (${node.childIds.length})`}>
            {node.childIds.map((cid) => {
              const child = allNodes.find(n => n.id === cid)
              if (!child) return null
              return (
                <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: child.color || NODE_KIND_COLORS[child.kind] }} />
                  <span style={{ fontSize: 12, color: '#e2e8f0' }}>{child.title}</span>
                </div>
              )
            })}
          </Section>
        )}
      </div>

      {/* 底部操作 */}
      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #334155' }}>
        <button onClick={() => openNodeSession(node.id)} style={{ ...actionBtn, flex: 1 }}>💬 Open Session</button>
        <button onClick={() => spawnSubagentForNode(node.id)} style={{ ...actionBtn, flex: 1, background: '#3B82F6' }}>🤖 Spawn Agent</button>
        <button onClick={() => { if (confirm(`Delete "${node.title}"?`)) deleteNode(node.id) }} style={{ ...dangerBtn }}>🗑</button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 子组件
// ──────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{label}</label>
    {children}
  </div>
)

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
    {children}
  </div>
)

const CapabilityRow: React.FC<{ icon: string; label: string; value: string; onClick?: () => void }> = ({ icon, label, value, onClick }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
      background: '#1e293b', borderRadius: 6, cursor: onClick ? 'pointer' : 'default',
    }}
  >
    <span>{icon}</span>
    <span style={{ fontSize: 12, color: '#94a3b8', flex: 1 }}>{label}</span>
    <span style={{ fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
  </div>
)

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 13,
  outline: 'none',
  width: '100%',
}

const actionBtn: React.CSSProperties = {
  padding: '8px 12px',
  background: '#2563EB',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
}

const dangerBtn: React.CSSProperties = {
  padding: '8px 12px',
  background: '#EF4444',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
}