/**
 * Mind-Map Node Component - Generic node renderer for all NodeKind
 * @module @deepseek-ai/dsh-client-ui-mindmap/nodes/MindMapNode
 */

import React, { useState, useRef } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useMindMapStore } from '../store/mindmap.ts'
import type { MindMapNode as MindMapNodeType, NodeKind, NodeStatus, ULID } from '../contract/types.ts'
import { NODE_KIND_COLORS, NODE_KIND_ICONS, NODE_KIND_LABELS, NODE_STATUS_LABELS } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 状态颜色映射
// ──────────────────────────────────────────────

const STATUS_COLORS: Record<NodeStatus, string> = {
  open: '#6B7280',
  in_progress: '#3B82F6',
  review: '#F59E0B',
  merged: '#10B981',
  closed: '#6B7280',
  blocked: '#EF4444',
  cancelled: '#9CA3AF',
}

// ──────────────────────────────────────────────
// 节点 Props (运行时由 React Flow 注入；data 从 Record 转回领域类型)
// ──────────────────────────────────────────────

export interface MindMapNodeProps {
  id: string
  data: MindMapNodeType
  selected?: boolean
}

// ──────────────────────────────────────────────
// 主节点组件
// ──────────────────────────────────────────────

export const MindMapNode: React.FC<MindMapNodeProps> = ({ data: rawData, selected }) => {
  const data = rawData as MindMapNodeType
  const { updateNode, deleteNode, setHoverNode, setDraggingNode, openNodeSession, spawnSubagentForNode } = useMindMapStore()
  const [expanded, setExpanded] = useState(!data.collapsed)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(data.title)
  const nodeRef = useRef<HTMLDivElement>(null)

  const color = data.color || NODE_KIND_COLORS[data.kind]
  const icon = NODE_KIND_ICONS[data.kind]
  const statusColor = STATUS_COLORS[data.status] || '#6B7280'
  const readOnly = useMindMapStore((s) => s.readOnly)

  const handleDoubleClick = () => {
    if (!editing && !readOnly) setEditing(true)
  }

  const handleBlur = () => {
    if (editing && editTitle !== data.title) {
      updateNode(data.id, { title: editTitle })
    }
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleBlur()
    if (e.key === 'Escape') { setEditTitle(data.title); setEditing(false) }
  }

  const handleDragStart = () => setDraggingNode(data.id as ULID)
  const handleDragEnd = () => setDraggingNode(undefined)

  const handleMouseEnter = () => setHoverNode(data.id as ULID)
  const handleMouseLeave = () => setHoverNode(undefined)

  return (
    <div
      ref={nodeRef}
      className={`mindmap-node ${selected ? 'selected' : ''} ${data.collapsed ? 'collapsed' : ''} ${data.pinned ? 'pinned' : ''}`}
      style={{
        background: `linear-gradient(135deg, ${color}dd, ${color})`,
        border: `2px solid ${selected ? '#fff' : 'transparent'}`,
        borderRadius: 12,
        boxShadow: selected ? `0 0 0 2px ${color}, 0 8px 24px ${color}66` : '0 4px 12px #0004',
        minWidth: data.size?.w || 240,
        maxWidth: data.size?.w || 340,
        opacity: data.collapsed ? 0.65 : 1,
        transition: 'all 0.2s ease',
        cursor: data.pinned ? 'default' : 'grab',
      }}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleDragStart}
      onMouseUp={handleDragEnd}
    >
      {/* 折叠/展开按钮 */}
      {data.childIds.length > 0 && (
        <button
          className="collapse-btn"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); updateNode(data.id, { collapsed: !expanded }) }}
          style={{
            position: 'absolute', top: 8, right: 8, width: 24, height: 24,
            background: '#0003', color: '#fff', border: 'none', borderRadius: 6,
            cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          {expanded ? '−' : '+'}
        </button>
      )}

      {/* 固定图标 */}
      {data.pinned && (
        <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 12 }}>📌</span>
      )}

      {/* 状态指示器 */}
      <div
        style={{
          position: 'absolute', bottom: -4, left: -4, width: 16, height: 16,
          background: statusColor, borderRadius: '50%', border: '3px solid #fff',
          boxShadow: '0 2px 4px #0004'
        }}
        title={NODE_STATUS_LABELS[data.status]}
      />

      {/* 主内容 */}
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: data.childIds.length ? 28 : 0 }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
          {editing ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{
                flex: 1, background: '#fff2', border: 'none', color: '#fff', fontSize: 14,
                fontWeight: 600, outline: 'none', borderRadius: 4, padding: '2px 4px'
              }}
            />
          ) : (
            <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {data.title}
            </span>
          )}
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 9999, background: '#fff3', color: '#fff', textTransform: 'uppercase', flexShrink: 0 }}>
            {NODE_KIND_LABELS[data.kind]}
          </span>
        </div>

        {/* 描述预览 */}
        {data.body && expanded && (
          <div style={{ fontSize: 12, color: '#fffd', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {data.body}
          </div>
        )}

        {/* 底部元信息 */}
        {expanded && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#fffb' }}>
            {data.labels.map((l) => (
              <span key={l} style={{ background: '#fff2', padding: '2px 8px', borderRadius: 9999 }}>{l}</span>
            ))}
            {data.assignee && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {data.assignee.type === 'subagent' ? '🤖' : data.assignee.type === 'skill' ? '⚡' : '👤'}
                {data.assignee.displayName || data.assignee.id}
              </span>
            )}
            {data.goalId && <span title="Linked Goal">🎯</span>}
            {data.sessionId && <span title="Has Session">💬</span>}
            {data.toolCalls.length > 0 && <span title="Tool Calls">⚙️ {data.toolCalls.length}</span>}
            {data.approvals.length > 0 && (
              <span title="Approvals">
                ✅ {data.approvals.filter(a => a.status === 'approved').length}/{data.approvals.length}
              </span>
            )}
            {data.files.length > 0 && <span title="Files">📁 {data.files.length}</span>}
          </div>
        )}

        {/* 操作按钮 */}
        {expanded && !readOnly && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4, paddingTop: 8, borderTop: '1px solid #fff2' }}>
            <button
              onClick={() => openNodeSession(data.id)}
              title="Open Session"
              style={actionBtn('#fff2')}
            >
              💬 Open
            </button>
            <button
              onClick={() => spawnSubagentForNode(data.id)}
              title="Spawn Subagent"
              style={actionBtn('#3B82F6')}
            >
              🤖 Agent
            </button>
            <button
              onClick={() => { if (confirm(`Delete "${data.title}"?`)) deleteNode(data.id) }}
              title="Delete"
              style={actionBtn('#EF4444')}
            >
              🗑
            </button>
          </div>
        )}
      </div>

      {/* 连接句柄 */}
      {!readOnly && !data.collapsed && (
        <>
          <Handle type="source" position={Position.Right} id="source" style={{ background: color, border: '2px solid #fff', width: 10, height: 10 }} />
          <Handle type="target" position={Position.Left} id="target" style={{ background: color, border: '2px solid #fff', width: 10, height: 10 }} />
        </>
      )}
    </div>
  )
}

const actionBtn = (bg: string): React.CSSProperties => ({
  flex: 1,
  padding: '6px',
  background: bg,
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 500,
  transition: 'filter 0.15s',
})

actionBtn.toString = () => '' // 避免 unused 警告

// ──────────────────────────────────────────────
// 专用节点变体 (可选扩展)
// ──────────────────────────────────────────────

/** Issue 节点 - 带优先级标记 */
export const IssueNode: React.FC<MindMapNodeProps> = (props) => {
  return <MindMapNode {...props} />
}

/** PR 节点 - 带分支状态 */
export const PRNode: React.FC<MindMapNodeProps> = (props) => {
  return <MindMapNode {...props} />
}

/** Decision 节点 - 带 ADR 链接 */
export const DecisionNode: React.FC<MindMapNodeProps> = (props) => {
  return <MindMapNode {...props} />
}

/** Review 节点 - 带审批状态 */
export const ReviewNode: React.FC<MindMapNodeProps> = (props) => {
  return <MindMapNode {...props} />
}

// ──────────────────────────────────────────────
// 节点注册表
// ──────────────────────────────────────────────

export const NODE_COMPONENTS: Record<NodeKind, React.FC<MindMapNodeProps>> = {
  issue: IssueNode,
  pr: PRNode,
  decision: DecisionNode,
  research: MindMapNode,
  review: ReviewNode,
  test: MindMapNode,
  deploy: MindMapNode,
  incident: MindMapNode,
  meta: MindMapNode,
}

export function getNodeComponent(kind: NodeKind): React.FC<MindMapNodeProps> {
  return NODE_COMPONENTS[kind] || MindMapNode
}