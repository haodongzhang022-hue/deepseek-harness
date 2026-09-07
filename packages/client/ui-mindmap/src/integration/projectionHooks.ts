/**
 * Projection Hooks - React hooks for subscribing to MindMap state via DSH projections
 * @module @deepseek-ai/dsh-client-ui-mindmap/integration/projectionHooks
 */

import React from 'react'
import { useSyncExternalStore } from 'react'
import { useMindMapStore } from '../store/mindmap.ts'
import type { MindMapNode, MindMapEdge, ULID, NodeKind, NodeStatus } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 核心订阅 Hook
// ──────────────────────────────────────────────

export function useMindMapSelector<T>(selector: (state: ReturnType<typeof useMindMapStore.getState>) => T): T {
  return useSyncExternalStore(
    useMindMapStore.subscribe,
    () => selector(useMindMapStore.getState()),
    () => selector(useMindMapStore.getState())
  )
}

// ──────────────────────────────────────────────
// 常用 Selector Hooks
// ──────────────────────────────────────────────

export const useAllNodes = () => useMindMapSelector((s) => Array.from(s.nodes.values()))
export const useAllEdges = () => useMindMapSelector((s) => Array.from(s.edges.values()))
export const useViewport = () => useMindMapSelector((s) => s.viewport)
export const useSelection = () => useMindMapSelector((s) => Array.from(s.selection))
export const useSearchQuery = () => useMindMapSelector((s) => s.searchQuery)
export const useMatchedNodeIds = () => useMindMapSelector((s) => s.matchedNodeIds)
export const useHighlightedNodeIds = () => useMindMapSelector((s) => s.highlightedNodeIds)
export const useHoverNode = () => useMindMapSelector((s) => s.hoverNode)
export const useHoverEdge = () => useMindMapSelector((s) => s.hoverEdge)
export const useDraggingNode = () => useMindMapSelector((s) => s.draggingNode)
export const useConnectingFrom = () => useMindMapSelector((s) => s.connectingFrom)
export const useConnectionPreview = () => useMindMapSelector((s) => s.connectionPreview)
export const useReadOnly = () => useMindMapSelector((s) => s.readOnly)
export const useSessionId = () => useMindMapSelector((s) => s.sessionId)
export const useHistory = () => useMindMapSelector((s) => ({ past: s.past, future: s.future }))
export const useCanUndo = () => useMindMapSelector((s) => s.past.length > 0)
export const useCanRedo = () => useMindMapSelector((s) => s.future.length > 0)
export const useIsSyncing = () => useMindMapSelector((s) => s.isSyncing)

// ──────────────────────────────────────────────
// 计算属性 Hooks
// ──────────────────────────────────────────────

export function useNode(nodeId: ULID | undefined): MindMapNode | undefined {
  return useMindMapSelector((s) => nodeId ? s.nodes.get(nodeId) : undefined)
}

export function useEdge(edgeId: ULID | undefined): MindMapEdge | undefined {
  return useMindMapSelector((s) => edgeId ? s.edges.get(edgeId) : undefined)
}

export function useSelectedNodes(): MindMapNode[] {
  return useMindMapSelector((s) => Array.from(s.selection).map((id) => s.nodes.get(id)).filter(Boolean) as MindMapNode[])
}

export function useNodesByKind(kind: NodeKind): MindMapNode[] {
  return useMindMapSelector((s) => Array.from(s.nodes.values()).filter((n) => n.kind === kind))
}

export function useNodesByStatus(status: NodeStatus): MindMapNode[] {
  return useMindMapSelector((s) => Array.from(s.nodes.values()).filter((n) => n.status === status))
}

export function useRootNodes(): MindMapNode[] {
  return useMindMapSelector((s) => Array.from(s.nodes.values()).filter((n) => n.parentIds.length === 0))
}

export function useLeafNodes(): MindMapNode[] {
  return useMindMapSelector((s) => Array.from(s.nodes.values()).filter((n) => n.childIds.length === 0))
}

export function useChildren(parentId: ULID | undefined): MindMapNode[] {
  return useMindMapSelector((s) => {
    if (!parentId) return []
    const parent = s.nodes.get(parentId)
    if (!parent) return []
    return parent.childIds.map((id) => s.nodes.get(id)).filter(Boolean) as MindMapNode[]
  })
}

export function useParents(childId: ULID | undefined): MindMapNode[] {
  return useMindMapSelector((s) => {
    if (!childId) return []
    const child = s.nodes.get(childId)
    if (!child) return []
    return child.parentIds.map((id) => s.nodes.get(id)).filter(Boolean) as MindMapNode[]
  })
}

export function useConnectedEdges(nodeId: ULID | undefined): MindMapEdge[] {
  return useMindMapSelector((s) => {
    if (!nodeId) return []
    return Array.from(s.edges.values()).filter((e) => e.sourceId === nodeId || e.targetId === nodeId)
  })
}

export function useOutgoingEdges(nodeId: ULID | undefined): MindMapEdge[] {
  return useMindMapSelector((s) => {
    if (!nodeId) return []
    return Array.from(s.edges.values()).filter((e) => e.sourceId === nodeId)
  })
}

export function useIncomingEdges(nodeId: ULID | undefined): MindMapEdge[] {
  return useMindMapSelector((s) => {
    if (!nodeId) return []
    return Array.from(s.edges.values()).filter((e) => e.targetId === nodeId)
  })
}

// ──────────────────────────────────────────────
// 统计 Hooks
// ──────────────────────────────────────────────

export function useNodeCount(): number {
  return useMindMapSelector((s) => s.nodes.size)
}

export function useEdgeCount(): number {
  return useMindMapSelector((s) => s.edges.size)
}

export function useCountsByKind(): Record<NodeKind, number> {
  return useMindMapSelector((s) => {
    const counts: Record<NodeKind, number> = {
      issue: 0, pr: 0, decision: 0, research: 0,
      review: 0, test: 0, deploy: 0, incident: 0, meta: 0,
    }
    s.nodes.forEach((n) => { counts[n.kind]++ })
    return counts
  })
}

export function useCountsByStatus(): Record<NodeStatus, number> {
  return useMindMapSelector((s) => {
    const counts: Record<NodeStatus, number> = {
      open: 0, in_progress: 0, review: 0, merged: 0,
      closed: 0, blocked: 0, cancelled: 0,
    }
    s.nodes.forEach((n) => { counts[n.status]++ })
    return counts
  })
}

// ──────────────────────────────────────────────
// 操作 Hooks
// ──────────────────────────────────────────────

export function useMindMapActions() {
  const store = useMindMapStore()
  return {
    // 节点操作
    createNode: store.createNode,
    updateNode: store.updateNode,
    deleteNode: store.deleteNode,
    duplicateNode: store.duplicateNode,

    // 边操作
    createEdge: store.createEdge,
    updateEdge: store.updateEdge,
    deleteEdge: store.deleteEdge,

    // 批量
    batch: store.batch,

    // 选择/视口
    setSelection: store.setSelection,
    clearSelection: store.clearSelection,
    setViewport: store.setViewport,
    fitView: store.fitView,
    centerOn: store.centerOn,

    // 交互状态
    setHoverNode: store.setHoverNode,
    setHoverEdge: store.setHoverEdge,
    setDraggingNode: store.setDraggingNode,
    setConnectingFrom: store.setConnectingFrom,
    setConnectionPreview: store.setConnectionPreview,

    // 搜索/筛选
    search: store.search,
    setSearchQuery: store.setSearchQuery,
    clearFilter: store.clearFilter,

    // 布局
    applyLayout: store.applyLayout,
    autoArrange: store.autoArrange,

    // 历史
    undo: store.undo,
    redo: store.redo,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    jumpToHistory: store.jumpToHistory,

    // DSH 集成
    openNodeSession: store.openNodeSession,
    spawnSubagentForNode: store.spawnSubagentForNode,
    linkNodeToGoal: store.linkNodeToGoal,
    attachFilesToNode: store.attachFilesToNode,

    // 导入导出
    exportCanvas: store.exportCanvas,
    importCanvas: store.importCanvas,

    // 协作
    inviteCollaborator: store.inviteCollaborator,
    shareLink: store.shareLink,

    // 初始化
    initialize: store.initialize,
    reset: store.reset,
  }
}

// ──────────────────────────────────────────────
// 专用 Hooks
// ──────────────────────────────────────────────

/** 获取节点的完整子树 (递归) */
export function useSubtree(rootId: ULID | undefined): MindMapNode[] {
  return useMindMapSelector((s) => {
    if (!rootId) return []
    const result: MindMapNode[] = []
    const visited = new Set<ULID>()

    function collect(nodeId: ULID) {
      if (visited.has(nodeId)) return
      visited.add(nodeId)
      const node = s.nodes.get(nodeId)
      if (node) {
        result.push(node)
        node.childIds.forEach(collect)
      }
    }

    collect(rootId)
    return result
  })
}

/** 获取节点的祖先链 */
export function useAncestors(nodeId: ULID | undefined): MindMapNode[] {
  return useMindMapSelector((s) => {
    if (!nodeId) return []
    const result: MindMapNode[] = []
    const visited = new Set<ULID>()
    let current = s.nodes.get(nodeId)

    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      const parentId = current.parentIds[0] // 取第一个父节点
      if (!parentId) break
      current = s.nodes.get(parentId)
      if (current) result.unshift(current)
    }

    return result
  })
}

/** 获取两个节点间的路径 */
export function usePathBetween(fromId: ULID | undefined, toId: ULID | undefined): { nodes: MindMapNode[]; edges: MindMapEdge[] } {
  return useMindMapSelector((s) => {
    if (!fromId || !toId) return { nodes: [], edges: [] }

    // BFS 寻找最短路径
    const queue: ULID[] = [fromId]
    const visited = new Set<ULID>([fromId])
    const parent = new Map<ULID, ULID>()
    const parentEdge = new Map<ULID, ULID>()

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === toId) break

      const outgoing = Array.from(s.edges.values()).filter((e) => e.sourceId === current)
      for (const edge of outgoing) {
        if (!visited.has(edge.targetId)) {
          visited.add(edge.targetId)
          parent.set(edge.targetId, current)
          parentEdge.set(edge.targetId, edge.id)
          queue.push(edge.targetId)
        }
      }
    }

    // 重建路径
    const pathNodes: MindMapNode[] = []
    const pathEdges: MindMapEdge[] = []
    let current = toId

    while (current !== fromId && parent.has(current)) {
      const node = s.nodes.get(current)
      if (node) pathNodes.unshift(node)
      const edgeId = parentEdge.get(current)
      if (edgeId) {
        const edge = s.edges.get(edgeId)
        if (edge) pathEdges.unshift(edge)
      }
      current = parent.get(current)!
    }

    const fromNode = s.nodes.get(fromId)
    if (fromNode) pathNodes.unshift(fromNode)

    return { nodes: pathNodes, edges: pathEdges }
  })
}

/** 视口变换工具 */
export function useViewportTransform() {
  const viewport = useViewport()
  const setViewport = useMindMapStore((s) => s.setViewport)

  return {
    viewport,
    zoomIn: () => setViewport({ zoom: Math.min(viewport.zoom * 1.2, 2) }),
    zoomOut: () => setViewport({ zoom: Math.max(viewport.zoom / 1.2, 0.1) }),
    resetZoom: () => setViewport({ zoom: 1 }),
    pan: (dx: number, dy: number) => setViewport({ x: viewport.x + dx, y: viewport.y + dy }),
    setZoom: (zoom: number) => setViewport({ zoom: Math.max(0.1, Math.min(2, zoom)) }),
    setCenter: (x: number, y: number) => setViewport({ x: -x + window.innerWidth / 2, y: -y + window.innerHeight / 2 }),
  }
}

/** 键盘快捷键 Hook */
export function useMindMapShortcuts() {
  const { canUndo, canRedo, undo, redo, fitView, applyLayout, setSearchQuery, clearFilter } = useMindMapActions()

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) { if (canRedo()) redo() } else { if (canUndo()) undo() }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault()
        if (canRedo()) redo()
      }

      // 视图控制
      if (e.key === ' ' || e.key === '0') { e.preventDefault(); fitView() }
      if (e.key === 'l') { applyLayout() }
      if (e.key === '1') { setSearchQuery({}); clearFilter() }

      // 导航
      if (e.key === 'ArrowUp') { /* TODO: navigate up */ }
      if (e.key === 'ArrowDown') { /* TODO: navigate down */ }
      if (e.key === 'ArrowLeft') { /* TODO: navigate left */ }
      if (e.key === 'ArrowRight') { /* TODO: navigate right */ }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo, canRedo, undo, redo, fitView, applyLayout, setSearchQuery, clearFilter])
}