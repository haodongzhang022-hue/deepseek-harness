/**
 * Mind-Map Canvas - Main React Flow based renderer with panels
 * @module @deepseek-ai/dsh-client-ui-mindmap/canvas/MindMapCanvas
 */

import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type Viewport as RFViewport,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  BackgroundVariant,
  ConnectionLineType,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useMindMapStore } from '../store/mindmap.ts'
import { useMindMapActions } from '../integration/projectionHooks.ts'
import type { MindMapNode, MindMapEdge, ULID, Viewport } from '../contract/types.ts'
import { NODE_KIND_COLORS, EDGE_TYPE_STYLES, EDGE_TYPE_DIRECTIONAL } from '../contract/types.ts'
import { MindMapNode as MindMapNodeComponent } from '../nodes/MindMapNode.tsx'
import { MindMapEdge as MindMapEdgeComponent } from '../edges/MindMapEdge.tsx'
import { Toolbar } from '../panels/Toolbar.tsx'
import { Inspector } from '../panels/Inspector.tsx'
import { ContextMenu } from '../panels/ContextMenu.tsx'
import { computeLayout, animateLayout } from './layout.ts'
import type { MindMapCanvasApi } from '../contract/slots.ts'

// ──────────────────────────────────────────────
// Canvas Props
// ──────────────────────────────────────────────

export interface MindMapCanvasProps {
  sessionId: string
  readOnly?: boolean
  initialViewport?: Viewport
  onNodeClick?: (node: MindMapNode) => void
  onNodeDoubleClick?: (node: MindMapNode) => void
  onEdgeClick?: (edge: MindMapEdge) => void
  onSelectionChange?: (nodeIds: ULID[]) => void
  onViewportChange?: (viewport: Viewport) => void
}

// ──────────────────────────────────────────────
// 内部 Canvas (需要 ReactFlowProvider 包裹)
// ──────────────────────────────────────────────

const MindMapCanvasInner: React.FC<MindMapCanvasProps> = (props) => {
  const { sessionId, readOnly = false, initialViewport } = props

  const store = useMindMapStore()
  const { nodes, edges, selection } = store
  const actions = useMindMapActions()
  const rf = useReactFlow()

  const [outlineOpen, setOutlineOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ node: MindMapNode; x: number; y: number } | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<ULID | null>(null)
  const [connectionPreview, setConnectionPreview] = useState<{ x: number; y: number } | null>(null)

  const initialized = useRef(false)

  // 初始化
  useEffect(() => {
    if (!initialized.current) {
      store.initialize(sessionId, readOnly)
      if (initialViewport) store.setViewport(initialViewport)
      initialized.current = true
    }
  }, [sessionId, readOnly])

  // 构建 Canvas API (使用 getter 保持状态实时性)
  const canvasApi = useMemo<MindMapCanvasApi>(() => ({
    get sessionId() { return sessionId },
    get nodes() { return useMindMapStore.getState().nodes },
    get edges() { return useMindMapStore.getState().edges },
    get viewport() { return useMindMapStore.getState().viewport },
    get selection() { return useMindMapStore.getState().selection },
    createNode: actions.createNode,
    updateNode: (nodeId: string, patch) => actions.updateNode(nodeId as ULID, patch),
    deleteNode: (nodeId: string) => actions.deleteNode(nodeId as ULID),
    duplicateNode: (nodeId: string, offset?: { x: number; y: number }) => actions.duplicateNode(nodeId as ULID, offset),
    createEdge: (sourceId: string, targetId: string, type) => actions.createEdge(sourceId as ULID, targetId as ULID, type),
    updateEdge: (edgeId: string, patch) => actions.updateEdge(edgeId as ULID, patch),
    deleteEdge: (edgeId: string) => actions.deleteEdge(edgeId as ULID),
    batch: actions.batch,
    setSelection: (nodeIds: string[], replace) => actions.setSelection(nodeIds.map((id) => id as ULID), replace),
    setViewport: actions.setViewport,
    fitView: (nodeIds?: string[], padding?: number) => actions.fitView(nodeIds?.map((id) => id as ULID), padding),
    centerOn: (nodeId: string) => actions.centerOn(nodeId as ULID),
    applyLayout: actions.applyLayout,
    autoArrange: (nodeIds?: string[]) => actions.autoArrange(nodeIds?.map((id) => id as ULID)),
    search: actions.search,
    setFilter: actions.setSearchQuery,
    clearFilter: actions.clearFilter,
    undo: actions.undo,
    redo: actions.redo,
    canUndo: actions.canUndo,
    canRedo: actions.canRedo,
    jumpToHistory: actions.jumpToHistory,
    openNodeSession: (nodeId: string) => actions.openNodeSession(nodeId as ULID),
    spawnSubagentForNode: (nodeId: string, config) => actions.spawnSubagentForNode(nodeId as ULID, config),
    linkNodeToGoal: (nodeId: string, goalId) => actions.linkNodeToGoal(nodeId as ULID, goalId),
    attachFilesToNode: (nodeId: string, files) => actions.attachFilesToNode(nodeId as ULID, files),
    exportCanvas: actions.exportCanvas,
    importCanvas: actions.importCanvas,
    inviteCollaborator: actions.inviteCollaborator,
    shareLink: actions.shareLink,
  }), [sessionId, actions])

  // 转换为 React Flow 格式
  const reactFlowNodes = useMemo((): Node[] => {
    return Array.from(nodes.values()).map((n) => ({
      id: n.id,
      type: 'mindmap',
      position: n.position,
      data: n as unknown as Record<string, unknown>,
      draggable: !readOnly && !n.pinned,
      selectable: true,
      deletable: !readOnly,
      style: { width: n.size?.w || 240 },
    }))
  }, [nodes, readOnly])

  const reactFlowEdges = useMemo((): Edge[] => {
    return Array.from(edges.values()).map((e) => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: 'mindmap',
      data: e as unknown as Record<string, unknown>,
      animated: e.type === 'derives_from' || e.type === 'fixes',
      ...(EDGE_TYPE_DIRECTIONAL[e.type] ? {
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: EDGE_TYPE_STYLES[e.type].color,
          width: 18,
          height: 18,
        },
      } : {}),
    }))
  }, [edges, readOnly])

  // 视口变更
  const onViewportChange = useCallback((vp: RFViewport) => {
    store.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom })
    props.onViewportChange?.({ x: vp.x, y: vp.y, zoom: vp.zoom })
  }, [store, props])

  // 选择变更
  const onSelectionChange = useCallback((params: { nodes: Node[] }) => {
    const ids = params.nodes.map((n) => n.id as ULID)
    store.setSelection(ids, true)
    props.onSelectionChange?.(ids)
    setInspectorOpen(ids.length > 0)
  }, [store, props])

  // 节点点击
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    props.onNodeClick?.(node.data as unknown as MindMapNode)
  }, [props])

  // 节点双击
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    props.onNodeDoubleClick?.(node.data as unknown as MindMapNode)
  }, [props])

  // 边点击
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    props.onEdgeClick?.(edge.data as unknown as MindMapEdge)
  }, [props])

  // 连线开始
  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleId: string | null }) => {
    if (readOnly || !params.nodeId) return
    setConnectingFrom(params.nodeId as ULID)
  }, [readOnly])

  // 连线中
  const onConnectMove = useCallback((event: MouseEvent | React.MouseEvent) => {
    if (!connectingFrom) return
    const pos = rf.screenToFlowPosition({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY })
    setConnectionPreview(pos)
  }, [connectingFrom, rf])

  // 连线结束
  const onConnectEnd = useCallback(() => {
    setConnectingFrom(null)
    setConnectionPreview(null)
  }, [])

  // 建立连接
  const onConnect = useCallback((params: Connection) => {
    if (readOnly || !params.source || !params.target || params.source === params.target) return
    actions.createEdge(params.source as ULID, params.target as ULID, 'derives_from')
    setConnectingFrom(null)
    setConnectionPreview(null)
  }, [readOnly, actions])

  // 右键菜单
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    if (readOnly) return
    setContextMenu({ node: node.data as unknown as MindMapNode, x: event.clientX, y: event.clientY })
  }, [readOnly])

  // 键盘快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const sel = Array.from(selection)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) { if (store.canRedo()) store.redo() } else { if (store.canUndo()) store.undo() }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.length > 0) sel.forEach((id) => store.deleteNode(id))
      }
      if (e.key === ' ') { e.preventDefault(); store.fitView() }
      if (e.key === 'l') { applyAutoLayout() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selection, store])

  // 自动布局 (带动画)
  const applyAutoLayout = useCallback(async (options?: Partial<Parameters<typeof actions.applyLayout>[0]>) => {
    const currentPositions = new Map<ULID, { x: number; y: number }>()
    nodes.forEach((n) => currentPositions.set(n.id, n.position))

    const result = computeLayout(
      Array.from(nodes.values()),
      Array.from(edges.values()),
      { algorithm: 'hierarchical', direction: 'TB', nodeSep: 240, rankSep: 160, animate: true, duration: 300, fitView: true, center: true, ...options }
    )

    if (options?.animate === false) {
      await actions.applyLayout(options)
    } else {
      // 动画插值
      const cancel = animateLayout(
        currentPositions,
        result,
        options?.duration || 300,
        (positions) => {
          positions.forEach((pos, id) => {
            const node = nodes.get(id)
            if (node) store.updateNode(id, { position: pos })
          })
        },
        () => {
          // 完成后适配视图
          setTimeout(() => store.fitView(Array.from(nodes.keys())), 50)
        }
      )
      return cancel
    }
  }, [nodes, edges, actions, store])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* 工具栏 */}
      <Toolbar
        api={canvasApi}
        onToggleOutline={() => setOutlineOpen(!outlineOpen)}
        onToggleSearch={() => setSearchOpen(!searchOpen)}
        onToggleHistory={() => setHistoryOpen(!historyOpen)}
        outlineOpen={outlineOpen}
        searchOpen={searchOpen}
        historyOpen={historyOpen}
      />

      {/* 主体 */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {/* 左侧面板 */}
        {(outlineOpen || searchOpen || historyOpen) && (
          <div style={{ width: 280, background: '#0f172a', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>
            {outlineOpen && <OutlinePanel sessionId={sessionId} onSelectNode={(id) => { store.centerOn(id as ULID); store.setSelection([id as ULID]) }} />}
            {searchOpen && <SearchPanel sessionId={sessionId} onResultSelect={(id) => { store.centerOn(id as ULID); store.setSelection([id as ULID]) }} />}
            {historyOpen && <HistoryPanel sessionId={sessionId} />}
          </div>
        )}

        {/* 画布 */}
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={reactFlowNodes}
            edges={reactFlowEdges}
            nodeTypes={{ mindmap: MindMapNodeComponent as any }}
            edgeTypes={{ mindmap: MindMapEdgeComponent as any }}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineStyle={{ stroke: '#3B82F6', strokeWidth: 2, strokeDasharray: '6,4' }}
            defaultViewport={initialViewport || { x: 0, y: 0, zoom: 1 }}
            onViewportChange={onViewportChange}
            onSelectionChange={onSelectionChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeClick={onEdgeClick}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onConnect={onConnect}
            onNodeContextMenu={onNodeContextMenu}
            onPaneMouseMove={onConnectMove}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            multiSelectionKeyCode="Shift"
            deleteKeyCode={readOnly ? null : 'Delete'}
            minZoom={0.1}
            maxZoom={2.5}
            snapToGrid
            snapGrid={[20, 20]}
            proOptions={{ hideAttribution: true }}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} color="#334155" gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => {
                const mn = n.data as unknown as MindMapNode
                return mn?.color || (mn ? NODE_KIND_COLORS[mn.kind] : '#64748B')
              }}
              maskColor="rgba(15, 23, 42, 0.85)"
              style={{ background: '#1e293b', border: '1px solid #334155' }}
            />
          </ReactFlow>

          {/* 连接预览线 */}
          {connectingFrom && connectionPreview && (
            <ConnectionPreviewLine sourceId={connectingFrom} target={connectionPreview} />
          )}
        </div>

        {/* 右侧 Inspector */}
        {inspectorOpen && (
          <div style={{ width: 320, background: '#0f172a', borderLeft: '1px solid #334155', overflow: 'auto' }}>
            <Inspector onClose={() => setInspectorOpen(false)} />
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          node={contextMenu.node}
          x={contextMenu.x}
          y={contextMenu.y}
          api={canvasApi}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// 连接预览线
// ──────────────────────────────────────────────

const ConnectionPreviewLine: React.FC<{ sourceId: ULID; target: { x: number; y: number } }> = ({ sourceId, target }) => {
  const { nodes } = useMindMapStore()
  const rf = useReactFlow()
  const sourceNode = nodes.get(sourceId)
  if (!sourceNode) return null

  const sourcePos = rf.getInternalNode(sourceId)
  if (!sourcePos) return null

  const sx = sourcePos.internals.positionAbsolute.x + (sourceNode.size?.w || 240)
  const sy = sourcePos.internals.positionAbsolute.y + 50

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1000 }}>
      <path
        d={`M${sx},${sy} C${(sx + target.x) / 2},${sy} ${(sx + target.x) / 2},${target.y} ${target.x},${target.y}`}
        stroke="#3B82F6"
        strokeWidth={2}
        strokeDasharray="6,4"
        fill="none"
        style={{ filter: 'drop-shadow(0 0 4px #3B82F6)' }}
      />
      <circle cx={target.x} cy={target.y} r={5} fill="#3B82F6" />
    </svg>
  )
}

// ──────────────────────────────────────────────
// 侧边栏面板：Outline
// ──────────────────────────────────────────────

const OutlinePanel: React.FC<{ sessionId: string; onSelectNode: (id: string) => void }> = ({ onSelectNode }) => {
  const { getChildren, getRootNodes, selection, updateNode } = useMindMapStore()
  const rootNodes = getRootNodes()

  const renderTree = (node: MindMapNode, depth = 0): React.ReactNode => {
    const children = getChildren(node.id)
    const isSelected = selection.has(node.id)
    const hasChildren = children.length > 0

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginLeft: depth * 12,
            background: isSelected ? '#3B82F622' : 'transparent', borderRadius: 4, cursor: 'pointer',
            borderLeft: `3px solid ${isSelected ? '#3B82F6' : 'transparent'}`,
          }}
          onClick={() => onSelectNode(node.id)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); updateNode(node.id, { collapsed: !node.collapsed }) }}
              style={{ width: 16, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 10 }}
            >
              {node.collapsed ? '▶' : '▼'}
            </button>
          ) : <span style={{ width: 16 }} />}
          <span style={{ width: 10, height: 10, borderRadius: 2, background: node.color || NODE_KIND_COLORS[node.kind] }} />
          <span style={{ flex: 1, fontSize: 12, color: isSelected ? '#3B82F6' : '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {node.title}
          </span>
          <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>{node.kind}</span>
        </div>
        {!node.collapsed && children.map((c) => renderTree(c, depth + 1))}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>📋 Outline</h3>
      {rootNodes.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 24 }}>
          No nodes yet. Double-click canvas to create.
        </div>
      ) : (
        rootNodes.map((n) => renderTree(n))
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// 侧边栏面板：Search
// ──────────────────────────────────────────────

const SearchPanel: React.FC<{ sessionId: string; onResultSelect: (id: string) => void }> = ({ onResultSelect }) => {
  const { searchQuery, setSearchQuery, matchedNodeIds, nodes, highlightedNodeIds } = useMindMapStore()
  const [query, setQuery] = useState(searchQuery.text || '')

  useEffect(() => {
    const debounce = setTimeout(() => setSearchQuery({ ...searchQuery, text: query }), 150)
    return () => clearTimeout(debounce)
  }, [query, searchQuery, setSearchQuery])

  const results = Array.from(matchedNodeIds).map((id) => nodes.get(id)).filter(Boolean) as MindMapNode[]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>🔍 Search</h3>
      <input
        type="text"
        placeholder="Search nodes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          padding: '8px 12px', background: '#1e293b', border: '1px solid #334155',
          borderRadius: 6, color: '#e2e8f0', fontSize: 13, outline: 'none', width: '100%', marginBottom: 12,
        }}
      />
      <div style={{ flex: 1, overflow: 'auto' }}>
        {results.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 24 }}>
            {query ? 'No matches found' : 'Type to search...'}
          </div>
        ) : (
          results.map((node) => (
            <div
              key={node.id}
              onClick={() => onResultSelect(node.id)}
              style={{
                padding: '8px 12px', marginBottom: 4, background: highlightedNodeIds.has(node.id) ? '#3B82F622' : '#0f172a',
                border: `1px solid ${highlightedNodeIds.has(node.id) ? '#3B82F6' : '#334155'}`, borderRadius: 6, cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: node.color || NODE_KIND_COLORS[node.kind] }} />
                <span style={{ flex: 1, fontWeight: 500, color: '#e2e8f0', fontSize: 12 }}>{node.title}</span>
                <span style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase' }}>{node.kind}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// 侧边栏面板：History
// ──────────────────────────────────────────────

const HistoryPanel: React.FC<{ sessionId: string }> = () => {
  const { past, jumpToHistory, canUndo, canRedo, undo, redo } = useMindMapStore()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>🕐 History</h3>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button onClick={undo} disabled={!canUndo()} style={histBtn}>↶ Undo</button>
        <button onClick={redo} disabled={!canRedo()} style={histBtn}>↷ Redo</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #334155', borderRadius: 6 }}>
        {past.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 12 }}>No history yet</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {past.map((entry, index) => (
              <li
                key={entry.id}
                onClick={() => jumpToHistory(index)}
                style={{
                  padding: '8px 12px', borderBottom: '1px solid #1e293b', cursor: 'pointer',
                  background: index === past.length - 1 ? '#3B82F622' : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0' }}>{entry.description}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()} · {entry.mutations.length} changes
                  </div>
                </div>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>{past.length - index}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const histBtn: React.CSSProperties = {
  flex: 1, padding: '6px 8px', fontSize: 11, background: '#1e293b',
  border: '1px solid #334155', borderRadius: 4, color: '#e2e8f0', cursor: 'pointer',
}

// ──────────────────────────────────────────────
// 主导出组件
// ──────────────────────────────────────────────

export const MindMapCanvas: React.FC<MindMapCanvasProps> = (props) => (
  <ReactFlowProvider>
    <MindMapCanvasInner {...props} />
  </ReactFlowProvider>
)

// 兼容旧导出
export { MindMapNodeComponent, MindMapEdgeComponent }
export { OutlinePanel as MindMapOutline, SearchPanel as MindMapSearch }
