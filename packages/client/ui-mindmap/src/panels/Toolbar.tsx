/**
 * Mind-Map Toolbar - Top action bar
 * @module @deepseek-ai/dsh-client-ui-mindmap/panels/Toolbar
 */

import React, { useState, useRef, useEffect } from 'react'
import { useMindMapStore, useCanUndo, useCanRedo } from '../store/mindmap.ts'
import type { MindMapCanvasApi } from '../contract/slots.ts'
import { LAYOUT_ALGORITHMS } from '../canvas/layout.ts'
import type { NodeKind } from '../contract/types.ts'
import { NODE_KIND_LABELS, NODE_KIND_ICONS } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 工具栏 Props
// ──────────────────────────────────────────────

export interface ToolbarProps {
  api: MindMapCanvasApi
  onToggleOutline?: () => void
  onToggleSearch?: () => void
  onToggleHistory?: () => void
  outlineOpen?: boolean
  searchOpen?: boolean
  historyOpen?: boolean
}

// ──────────────────────────────────────────────
// 工具栏组件
// ──────────────────────────────────────────────

export const Toolbar: React.FC<ToolbarProps> = ({
  api,
  onToggleOutline,
  onToggleSearch,
  onToggleHistory,
  outlineOpen,
  searchOpen,
  historyOpen,
}) => {
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const nodeCount = useMindMapStore((s) => s.nodes.size)
  const edgeCount = useMindMapStore((s) => s.edges.size)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const nodeMenuRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) setLayoutMenuOpen(false)
      if (nodeMenuRef.current && !nodeMenuRef.current.contains(e.target as Node)) setNodeMenuOpen(false)
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setExportMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const createNodeAtCenter = (kind: NodeKind) => {
    const vp = api.viewport
    const center = {
      x: -vp.x / vp.zoom + window.innerWidth / 2 / vp.zoom,
      y: -vp.y / vp.zoom + (window.innerHeight - 100) / 2 / vp.zoom,
    }
    api.createNode({ kind, title: `New ${NODE_KIND_LABELS[kind]}`, position: center })
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      background: '#0f172a', borderBottom: '1px solid #334155', boxShadow: '0 2px 8px #0004'
    }}>
      {/* 左侧：视图操作 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <ToolButton onClick={() => api.fitView()} title="Fit View (Space)">🔍</ToolButton>
        <div style={{ position: 'relative' }} ref={layoutMenuRef}>
          <ToolButton onClick={() => setLayoutMenuOpen(!layoutMenuOpen)} title="Auto Layout">📐 ▾</ToolButton>
          {layoutMenuOpen && (
            <Dropdown>
              {LAYOUT_ALGORITHMS.map((algo) => (
                <DropdownItem
                  key={algo.id}
                  onClick={() => { api.applyLayout({ algorithm: algo.id }); setLayoutMenuOpen(false) }}
                >
                  <strong>{algo.label}</strong>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{algo.description}</span>
                </DropdownItem>
              ))}
            </Dropdown>
          )}
        </div>
        <ToolButton onClick={api.undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</ToolButton>
        <ToolButton onClick={api.redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">↷</ToolButton>
      </div>

      <Divider />

      {/* 中间：创建节点 */}
      <div style={{ position: 'relative' }} ref={nodeMenuRef}>
        <ToolButton onClick={() => setNodeMenuOpen(!nodeMenuOpen)} title="Create Node" primary>+ New ▾</ToolButton>
        {nodeMenuOpen && (
          <Dropdown>
            {(Object.keys(NODE_KIND_LABELS) as NodeKind[]).map((kind) => (
              <DropdownItem key={kind} onClick={() => { createNodeAtCenter(kind); setNodeMenuOpen(false) }}>
                <span style={{ fontSize: 16 }}>{NODE_KIND_ICONS[kind]}</span>
                <span>{NODE_KIND_LABELS[kind]}</span>
              </DropdownItem>
            ))}
          </Dropdown>
        )}
      </div>

      <Divider />

      {/* 右侧：面板切换 + 导出 */}
      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        <ToolButton onClick={onToggleOutline ?? (() => {})} {...(outlineOpen !== undefined ? { active: outlineOpen } : {})} title="Outline">📋</ToolButton>
        <ToolButton onClick={onToggleSearch ?? (() => {})} {...(searchOpen !== undefined ? { active: searchOpen } : {})} title="Search">🔍</ToolButton>
        <ToolButton onClick={onToggleHistory ?? (() => {})} {...(historyOpen !== undefined ? { active: historyOpen } : {})} title="History">🕐</ToolButton>

        <Divider />

        <div style={{ position: 'relative' }} ref={exportMenuRef}>
          <ToolButton onClick={() => setExportMenuOpen(!exportMenuOpen)} title="Export">📤 ▾</ToolButton>
          {exportMenuOpen && (
            <Dropdown align="right">
              <DropdownItem onClick={() => { api.exportCanvas('json').then(b => download(b, 'mindmap.json')); setExportMenuOpen(false) }}>
                JSON
              </DropdownItem>
              <DropdownItem onClick={() => { api.exportCanvas('mermaid').then(b => download(b, 'mindmap.mmd')); setExportMenuOpen(false) }}>
                Mermaid
              </DropdownItem>
              <DropdownItem onClick={() => { api.exportCanvas('plantuml').then(b => download(b, 'mindmap.puml')); setExportMenuOpen(false) }}>
                PlantUML
              </DropdownItem>
              <DropdownItem onClick={() => { api.exportCanvas('graphml').then(b => download(b, 'mindmap.graphml')); setExportMenuOpen(false) }}>
                GraphML
              </DropdownItem>
            </Dropdown>
          )}
        </div>
        <ToolButton onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.json,.mmd,.graphml'
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0]
            if (!file) return
            const format = file.name.endsWith('.json') ? 'json' :
              file.name.endsWith('.mmd') ? 'mermaid' : 'graphml'
            if (format === 'json' || format === 'mermaid' || format === 'graphml') {
              await api.importCanvas(file, format)
            }
          }
          input.click()
        }} title="Import">📥</ToolButton>
      </div>

      {/* 统计 */}
      <Divider />
      <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {nodeCount} nodes · {edgeCount} edges
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────
// 子组件
// ──────────────────────────────────────────────

const ToolButton: React.FC<{
  onClick: () => void
  title?: string
  disabled?: boolean
  active?: boolean
  primary?: boolean
  children: React.ReactNode
}> = ({ onClick, title, disabled, active, primary, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      padding: '6px 10px',
      background: active ? '#3B82F6' : primary ? '#2563EB' : '#1e293b',
      border: '1px solid #334155',
      borderRadius: 6,
      color: disabled ? '#475569' : '#e2e8f0',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 13,
      opacity: disabled ? 0.5 : 1,
      transition: 'all 0.15s',
    }}
  >
    {children}
  </button>
)

const Divider: React.FC = () => (
  <div style={{ width: 1, height: 24, background: '#334155', margin: '0 4px' }} />
)

const Dropdown: React.FC<{ children: React.ReactNode; align?: 'left' | 'right' }> = ({ children, align = 'left' }) => (
  <div style={{
    position: 'absolute', top: '100%', [align]: 0, marginTop: 4, minWidth: 200,
    background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 4,
    boxShadow: '0 8px 24px #0008', zIndex: 1000,
  }}>
    {children}
  </div>
)

const DropdownItem: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px',
      borderRadius: 6, cursor: 'pointer', color: '#e2e8f0',
    }}
    onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
  >
    {children}
  </div>
)

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}