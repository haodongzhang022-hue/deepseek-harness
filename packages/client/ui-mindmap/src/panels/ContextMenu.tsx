/**
 * Mind-Map Context Menu - Node right-click menu
 * @module @deepseek-ai/dsh-client-ui-mindmap/panels/ContextMenu
 */

import React, { useEffect, useRef } from 'react'
import type { MindMapNode, NodeKind } from '../contract/types.ts'
import type { MindMapCanvasApi } from '../contract/slots.ts'

// ──────────────────────────────────────────────
// Context Menu Props
// ──────────────────────────────────────────────

export interface ContextMenuProps {
  node: MindMapNode
  x: number
  y: number
  api: MindMapCanvasApi
  onClose: () => void
}

// ──────────────────────────────────────────────
// 菜单项定义
// ──────────────────────────────────────────────

interface MenuItem {
  label: string
  icon: string
  action: (node: MindMapNode, api: MindMapCanvasApi) => Promise<void> | void
  kinds?: NodeKind[]
  statuses?: string[]
  dividerAfter?: boolean
  danger?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  {
    label: 'Spawn Subagent Here',
    icon: '🤖',
    kinds: ['issue', 'pr', 'research'],
    action: async (node, api) => { await api.spawnSubagentForNode(node.id) },
  },
  {
    label: 'Create Child Issue',
    icon: '🐛',
    kinds: ['issue', 'meta'],
    action: async (node, api) => {
      const childId = await api.createNode({
        kind: 'issue',
        title: `Sub-issue: ${node.title}`,
        position: { x: node.position.x + 280, y: node.position.y + 80 },
        parentIds: [node.id],
        edgeTypes: ['derives_from'],
      })
      await api.createEdge(node.id, childId, 'derives_from')
    },
  },
  {
    label: 'Create PR from Issue',
    icon: '🔀',
    kinds: ['issue'],
    action: async (node, api) => {
      const prId = await api.createNode({
        kind: 'pr',
        title: `PR: ${node.title}`,
        position: { x: node.position.x + 280, y: node.position.y },
        parentIds: [node.id],
        edgeTypes: ['derives_from'],
      })
      await api.createEdge(node.id, prId, 'derives_from')
    },
  },
  {
    label: 'Record Decision',
    icon: '📔',
    action: async (node, api) => {
      const decisionId = await api.createNode({
        kind: 'decision',
        title: `Decision: ${node.title}`,
        position: { x: node.position.x + 200, y: node.position.y + 160 },
        parentIds: [node.id],
        edgeTypes: ['relates_to'],
      })
      await api.createEdge(node.id, decisionId, 'relates_to')
    },
  },
  {
    label: 'Add Test',
    icon: '🧪',
    kinds: ['pr'],
    action: async (node, api) => {
      const testId = await api.createNode({
        kind: 'test',
        title: `Test: ${node.title}`,
        position: { x: node.position.x + 200, y: node.position.y + 160 },
        parentIds: [node.id],
        edgeTypes: ['tests'],
      })
      await api.createEdge(testId, node.id, 'tests')
    },
  },
  {
    label: 'Link to Goal',
    icon: '🎯',
    action: async (node, api) => {
      const goalId = prompt('Enter Goal ID:')
      if (goalId) await api.linkNodeToGoal(node.id, goalId)
    },
  },
  { label: 'divider', icon: '', action: () => {}, dividerAfter: true },
  {
    label: 'Duplicate',
    icon: '📋',
    action: async (node, api) => { await api.duplicateNode(node.id) },
  },
  {
    label: 'Pin/Unpin',
    icon: '📌',
    action: async (node, api) => { await api.updateNode(node.id, { pinned: !node.pinned }) },
  },
  {
    label: 'Delete',
    icon: '🗑',
    danger: true,
    action: async (node, api) => { if (confirm(`Delete "${node.title}"?`)) await api.deleteNode(node.id) },
  },
]

// ──────────────────────────────────────────────
// Context Menu 组件
// ──────────────────────────────────────────────

export const ContextMenu: React.FC<ContextMenuProps> = ({ node, x, y, api, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // 过滤适用当前节点的菜单项
  const items = MENU_ITEMS.filter((item) => {
    if (item.label === 'divider') return true
    if (item.kinds && !item.kinds.includes(node.kind)) return false
    if (item.statuses && !item.statuses.includes(node.status)) return false
    return true
  })

  // 边界检测
  const menuWidth = 220
  const menuHeight = items.length * 36
  const left = Math.min(x, window.innerWidth - menuWidth - 8)
  const top = Math.min(y, window.innerHeight - menuHeight - 8)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        minWidth: menuWidth,
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 8px 32px #000a',
        zIndex: 2000,
      }}
    >
      {items.map((item, i) => {
        if (item.label === 'divider') {
          return <div key={i} style={{ height: 1, background: '#334155', margin: '4px 0' }} />
        }
        return (
          <div
            key={i}
            onClick={async () => { await item.action(node, api); onClose() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              borderRadius: 6, cursor: 'pointer', color: item.danger ? '#EF4444' : '#e2e8f0',
              fontSize: 13,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = item.danger ? '#EF444422' : '#334155')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}