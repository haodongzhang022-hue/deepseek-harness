/**
 * Mind-Map Canvas Store
 * Zustand + Immer for immutable updates with mutable syntax
 * @module @deepseek-ai/dsh-client-ui-mindmap/store/mindmap
 */

import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'

// Immer 需要 Map/Set 支持 (store 内部用 Map 存储节点/边)
enableMapSet()
import type {
  MindMapNode,
  MindMapEdge,
  Viewport,
  SearchQuery,
  Mutation,
  HistoryEntry,
  LayoutOptions,
  NodeKind,
  NodeStatus,
  EdgeType,
  ULID,
  IdentityRef,
  FileRef,
} from '../contract/types.ts'
import {
  DEFAULT_VIEWPORT,
  DEFAULT_LAYOUT_OPTIONS,
  NODE_KIND_COLORS,
  EDGE_TYPE_DIRECTIONAL,
} from '../contract/types.ts'
import { nanoid } from 'nanoid'

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

interface MindMapState {
  // 核心数据
  nodes: Map<ULID, MindMapNode>
  edges: Map<ULID, MindMapEdge>

  // 视口与选择
  viewport: Viewport
  selection: Set<ULID>
  hoverNode?: ULID
  hoverEdge?: ULID

  // 交互状态
  draggingNode?: ULID
  connectingFrom?: ULID
  connectionPreview?: { x: number; y: number }

  // 搜索/筛选
  searchQuery: SearchQuery
  matchedNodeIds: Set<ULID>
  highlightedNodeIds: Set<ULID>

  // 历史/撤销
  past: HistoryEntry[]
  future: HistoryEntry[]
  maxHistory: number

  // 会话绑定
  sessionId: string
  readOnly: boolean

  // 同步状态
  isSyncing: boolean
  lastSyncedAt: number
  pendingMutations: Mutation[]
}

/**
 * Mind-Map Store Actions —— 与 {@link MindMapState} 交叉组成完整 store 类型。
 * 签名与下方 create() initializer 中的实现一一对应。
 */
export interface MindMapActions {
  initialize: (sessionId: string, readOnly?: boolean, initialNodes?: MindMapNode[], initialEdges?: MindMapEdge[]) => void
  reset: () => void
  createNode: (input: Partial<MindMapNode> & { kind: NodeKind; position: { x: number; y: number } }) => Promise<ULID>
  updateNode: (nodeId: ULID, patch: Partial<MindMapNode>) => Promise<void>
  deleteNode: (nodeId: ULID) => Promise<void>
  duplicateNode: (nodeId: ULID, offset?: { x: number; y: number }) => Promise<string>
  createEdge: (sourceId: ULID, targetId: ULID, type: EdgeType, label?: string) => Promise<string>
  updateEdge: (edgeId: ULID, patch: Partial<MindMapEdge>) => Promise<void>
  deleteEdge: (edgeId: ULID) => Promise<void>
  batch: (mutations: Mutation[]) => Promise<void>
  setSelection: (nodeIds: ULID[], replace?: boolean) => void
  clearSelection: () => void
  setViewport: (viewport: Partial<Viewport>, animate?: boolean) => void
  fitView: (nodeIds?: ULID[], padding?: number) => void
  centerOn: (nodeId: ULID) => void
  setHoverNode: (nodeId?: ULID) => void
  setHoverEdge: (edgeId?: ULID) => void
  setDraggingNode: (nodeId?: ULID) => void
  setConnectingFrom: (nodeId?: ULID) => void
  setConnectionPreview: (pos?: { x: number; y: number }) => void
  setSearchQuery: (query: SearchQuery) => void
  clearFilter: () => void
  search: (query: SearchQuery) => Promise<string[]>
  applyLayout: (options?: Partial<LayoutOptions>) => Promise<void>
  autoArrange: (nodeIds?: ULID[]) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: () => boolean
  canRedo: () => boolean
  jumpToHistory: (index: number) => Promise<void>
  openNodeSession: (nodeId: ULID) => Promise<void>
  spawnSubagentForNode: (nodeId: ULID, config?: {
    prompt: string
    workingDirectory?: string
    allowedTools?: string[]
    maxTurns?: number
    onComplete?: (result: unknown) => void
  }) => Promise<string>
  linkNodeToGoal: (nodeId: ULID, goalId: string) => Promise<void>
  attachFilesToNode: (nodeId: ULID, files: string[]) => Promise<void>
  exportCanvas: (format: 'json' | 'mermaid' | 'plantuml' | 'graphml' | 'png' | 'svg') => Promise<Blob>
  importCanvas: (data: Blob | string, format: 'json' | 'mermaid' | 'graphml') => Promise<void>
  inviteCollaborator: (email: string, role: 'view' | 'edit' | 'admin') => Promise<void>
  shareLink: (permissions: 'view' | 'edit') => Promise<string>
  flushPendingMutations: () => void
  getSelectedNodes: () => MindMapNode[]
  getNode: (id: ULID) => MindMapNode | undefined
  getEdge: (id: ULID) => MindMapEdge | undefined
  getChildren: (nodeId: ULID) => MindMapNode[]
  getParents: (nodeId: ULID) => MindMapNode[]
  getConnectedEdges: (nodeId: ULID) => MindMapEdge[]
  getRootNodes: () => MindMapNode[]
  getLeafNodes: () => MindMapNode[]
  getNodesByKind: (kind: NodeKind) => MindMapNode[]
  getNodesByStatus: (status: NodeStatus) => MindMapNode[]
}

/** 完整 store 类型 = 数据 + 动作 */
export type MindMapStore = MindMapState & MindMapActions

// ──────────────────────────────────────────────
// 初始状态
// ──────────────────────────────────────────────

const createInitialState = (sessionId: string, readOnly = false): MindMapState => ({
  nodes: new Map(),
  edges: new Map(),
  viewport: DEFAULT_VIEWPORT,
  selection: new Set(),
  searchQuery: {},
  matchedNodeIds: new Set(),
  highlightedNodeIds: new Set(),
  past: [],
  future: [],
  maxHistory: 100,
  sessionId,
  readOnly,
  isSyncing: false,
  lastSyncedAt: 0,
  pendingMutations: [],
})

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

const generateULID = (): ULID => nanoid(26) as ULID

const now = () => Date.now()

function createNode(input: Partial<MindMapNode> & { kind: NodeKind; position: { x: number; y: number } }): MindMapNode {
  const identity: IdentityRef = { type: 'human', id: 'current-user' }
  return {
    id: generateULID(),
    kind: input.kind,
    title: input.title || 'New Node',
    body: input.body || '',
    status: input.status || 'open',
    ...(input.assignee ? { assignee: input.assignee } : {}),
    labels: input.labels || [],
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    toolCalls: input.toolCalls || [],
    approvals: input.approvals || [],
    files: input.files || [],
    snapshots: input.snapshots || [],
    parentIds: input.parentIds || [],
    childIds: input.childIds || [],
    edgeTypes: input.edgeTypes || [],
    position: input.position,
    ...(input.size ? { size: input.size } : {}),
    ...(input.color ? { color: input.color } : {}),
    collapsed: input.collapsed || false,
    pinned: input.pinned || false,
    createdAt: now(),
    updatedAt: now(),
    createdBy: input.createdBy || identity,
    version: 1,
  }
}

function createEdge(sourceId: ULID, targetId: ULID, type: EdgeType, label?: string): MindMapEdge {
  return {
    id: generateULID(),
    sourceId,
    targetId,
    type,
    ...(label !== undefined ? { label } : {}),
    createdAt: now(),
    createdBy: { type: 'human', id: 'current-user' },
  }
}

function pushHistory(state: MindMapState, description: string, mutations: Mutation[], viewport?: Viewport, selection?: ULID[]) {
  const entry: HistoryEntry = {
    id: generateULID(),
    timestamp: now(),
    description,
    mutations,
    viewport: viewport || state.viewport,
    selection: selection || Array.from(state.selection),
  }
  state.past.push(entry)
  if (state.past.length > state.maxHistory) {
    state.past.shift()
  }
  state.future = [] // 新操作清空 redo 栈
}

// ──────────────────────────────────────────────
// Store 创建
// ──────────────────────────────────────────────

export const useMindMapStore = create<MindMapStore>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        ...createInitialState('default'),

        // ──────────────────────────────────────────────
        // 初始化/重置
        // ──────────────────────────────────────────────

        initialize: (sessionId: string, readOnly = false, initialNodes?: MindMapNode[], initialEdges?: MindMapEdge[]) => {
          set((state) => {
            Object.assign(state, createInitialState(sessionId, readOnly))
            if (initialNodes) {
              initialNodes.forEach((n) => state.nodes.set(n.id, n))
            }
            if (initialEdges) {
              initialEdges.forEach((e) => state.edges.set(e.id, e))
            }
          })
        },

        reset: () => {
          const { sessionId, readOnly } = get()
          set(createInitialState(sessionId, readOnly))
        },

        // ──────────────────────────────────────────────
        // 节点 CRUD
        // ──────────────────────────────────────────────

        createNode: async (input) => {
          const node = createNode(input)

          set((state) => {
            state.nodes.set(node.id, node)
            pushHistory(state, `Create ${node.kind}: ${node.title}`, [
              { op: 'upsert_node', node },
            ])
          })

          // 触发持久化
          get().flushPendingMutations()
          return node.id
        },

        updateNode: async (nodeId: ULID, patch: Partial<MindMapNode>) => {
          set((state) => {
            const node = state.nodes.get(nodeId)
            if (!node) return

            const previous = { ...node }
            const updated = { ...node, ...patch, updatedAt: now(), version: node.version + 1 }
            state.nodes.set(nodeId, updated)

            pushHistory(state, `Update ${node.kind}: ${node.title}`, [
              { op: 'upsert_node', node: updated, previous },
            ])
          })

          get().flushPendingMutations()
        },

        deleteNode: async (nodeId: ULID) => {
          set((state) => {
            const node = state.nodes.get(nodeId)
            if (!node) return

            // 同时删除关联的边
            const edgesToDelete: ULID[] = []
            state.edges.forEach((edge, edgeId) => {
              if (edge.sourceId === nodeId || edge.targetId === nodeId) {
                edgesToDelete.push(edgeId)
              }
            })

            const mutations: Mutation[] = [{ op: 'delete_node', nodeId, previous: node }]
            edgesToDelete.forEach((edgeId) => {
              const edge = state.edges.get(edgeId)!
              mutations.push({ op: 'delete_edge', edgeId, previous: edge })
              state.edges.delete(edgeId)
            })

            // 从父/子节点中移除引用
            node.parentIds.forEach((pid) => {
              const parent = state.nodes.get(pid)
              if (parent) {
                parent.childIds = parent.childIds.filter((id) => id !== nodeId)
                parent.updatedAt = now()
                parent.version++
              }
            })
            node.childIds.forEach((cid) => {
              const child = state.nodes.get(cid)
              if (child) {
                child.parentIds = child.parentIds.filter((id) => id !== nodeId)
                child.updatedAt = now()
                child.version++
              }
            })

            state.nodes.delete(nodeId)
            state.selection.delete(nodeId)

            pushHistory(state, `Delete ${node.kind}: ${node.title}`, mutations)
          })

          get().flushPendingMutations()
        },

        duplicateNode: async (nodeId: ULID, offset = { x: 40, y: 40 }) => {
          const node = get().nodes.get(nodeId)
          if (!node) return ''

          const newNode = createNode({
            ...node,
            title: `${node.title} (copy)`,
            position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
            parentIds: [],
            childIds: [],
            edgeTypes: [],
            createdAt: now(),
            updatedAt: now(),
            version: 1,
          })

          set((state) => {
            state.nodes.set(newNode.id, newNode)
            pushHistory(state, `Duplicate ${node.kind}: ${node.title}`, [
              { op: 'upsert_node', node: newNode },
            ])
          })

          get().flushPendingMutations()
          return newNode.id
        },

        // ──────────────────────────────────────────────
        // 边 CRUD
        // ──────────────────────────────────────────────

        createEdge: async (sourceId: ULID, targetId: ULID, type: EdgeType, label?: string) => {
          if (sourceId === targetId) return ''

          const edge = createEdge(sourceId, targetId, type, label)

          set((state) => {
            state.edges.set(edge.id, edge)

            // 更新节点拓扑
            const source = state.nodes.get(sourceId)
            const target = state.nodes.get(targetId)
            if (source && !source.childIds.includes(targetId)) {
              source.childIds.push(targetId)
              source.edgeTypes.push(type)
              source.updatedAt = now()
              source.version++
            }
            if (target && !target.parentIds.includes(sourceId)) {
              target.parentIds.push(sourceId)
              target.updatedAt = now()
              target.version++
            }

            pushHistory(state, `Connect ${type}`, [
              { op: 'upsert_edge', edge },
            ])
          })

          get().flushPendingMutations()
          return edge.id
        },

        updateEdge: async (edgeId: ULID, patch: Partial<MindMapEdge>) => {
          set((state) => {
            const edge = state.edges.get(edgeId)
            if (!edge) return

            const previous = { ...edge }
            const updated = { ...edge, ...patch }
            state.edges.set(edgeId, updated)

            pushHistory(state, `Update edge`, [
              { op: 'upsert_edge', edge: updated, previous },
            ])
          })

          get().flushPendingMutations()
        },

        deleteEdge: async (edgeId: ULID) => {
          set((state) => {
            const edge = state.edges.get(edgeId)
            if (!edge) return

            // 更新节点拓扑
            const source = state.nodes.get(edge.sourceId)
            const target = state.nodes.get(edge.targetId)
            if (source) {
              source.childIds = source.childIds.filter((id) => id !== edge.targetId)
              source.edgeTypes = source.edgeTypes.filter((t) => t !== edge.type)
              source.updatedAt = now()
              source.version++
            }
            if (target) {
              target.parentIds = target.parentIds.filter((id) => id !== edge.sourceId)
              target.updatedAt = now()
              target.version++
            }

            state.edges.delete(edgeId)

            pushHistory(state, `Delete edge`, [
              { op: 'delete_edge', edgeId, previous: edge },
            ])
          })

          get().flushPendingMutations()
        },

        // ──────────────────────────────────────────────
        // 批量操作
        // ──────────────────────────────────────────────

        batch: async (mutations: Mutation[]) => {
          set((state) => {
            mutations.forEach((m) => {
              switch (m.op) {
                case 'upsert_node':
                  if (m.node) state.nodes.set(m.node.id, m.node)
                  break
                case 'delete_node':
                  state.nodes.delete(m.nodeId)
                  state.selection.delete(m.nodeId)
                  break
                case 'upsert_edge':
                  if (m.edge) state.edges.set(m.edge.id, m.edge)
                  break
                case 'delete_edge':
                  state.edges.delete(m.edgeId)
                  break
                case 'viewport':
                  state.viewport = m.viewport
                  break
                case 'selection':
                  state.selection = new Set(m.selection)
                  break
              }
            })
            pushHistory(state, 'Batch operation', mutations)
          })

          get().flushPendingMutations()
        },

        // ──────────────────────────────────────────────
        // 选择/视口
        // ──────────────────────────────────────────────

        setSelection: (nodeIds: ULID[], replace = true) => {
          set((state) => {
            if (replace) {
              state.selection = new Set(nodeIds)
            } else {
              nodeIds.forEach((id) => state.selection.add(id))
            }
          })
        },

        clearSelection: () => {
          set((state) => { state.selection.clear() })
        },

        setViewport: (viewport: Partial<Viewport>, animate = false) => {
          void animate
          set((state) => {
            state.viewport = { ...state.viewport, ...viewport }
          })
        },

        fitView: (nodeIds?: ULID[], padding = 100) => {
          const { nodes } = get()
          const targetNodes = nodeIds?.length
            ? nodeIds.map((id) => nodes.get(id)).filter(Boolean) as MindMapNode[]
            : Array.from(nodes.values())

          if (targetNodes.length === 0) return

          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          targetNodes.forEach((n) => {
            minX = Math.min(minX, n.position.x)
            minY = Math.min(minY, n.position.y)
            maxX = Math.max(maxX, n.position.x + (n.size?.w || 200))
            maxY = Math.max(maxY, n.position.y + (n.size?.h || 100))
          })

          const width = maxX - minX
          const height = maxY - minY
          const scaleX = (window.innerWidth - padding * 2) / width
          const scaleY = (window.innerHeight - padding * 2) / height
          const zoom = Math.min(scaleX, scaleY, 2)

          set((state) => {
            state.viewport = {
              x: -(minX + width / 2) * zoom + window.innerWidth / 2,
              y: -(minY + height / 2) * zoom + window.innerHeight / 2,
              zoom,
            }
          })
        },

        centerOn: (nodeId: ULID) => {
          const node = get().nodes.get(nodeId)
          if (!node) return

          set((state) => {
            state.viewport = {
              x: -node.position.x * state.viewport.zoom + window.innerWidth / 2,
              y: -node.position.y * state.viewport.zoom + window.innerHeight / 2,
              zoom: state.viewport.zoom,
            }
          })
        },

        // ──────────────────────────────────────────────
        // 交互状态
        // ──────────────────────────────────────────────

        setHoverNode: (nodeId?: ULID) => set((s) => {
          if (nodeId !== undefined) s.hoverNode = nodeId
          else delete s.hoverNode
        }),
        setHoverEdge: (edgeId?: ULID) => set((s) => {
          if (edgeId !== undefined) s.hoverEdge = edgeId
          else delete s.hoverEdge
        }),
        setDraggingNode: (nodeId?: ULID) => set((s) => {
          if (nodeId !== undefined) s.draggingNode = nodeId
          else delete s.draggingNode
        }),
        setConnectingFrom: (nodeId?: ULID) => set((s) => {
          if (nodeId !== undefined) s.connectingFrom = nodeId
          else delete s.connectingFrom
        }),
        setConnectionPreview: (pos?: { x: number; y: number }) => set((s) => {
          if (pos !== undefined) s.connectionPreview = pos
          else delete s.connectionPreview
        }),

        // ──────────────────────────────────────────────
        // 搜索/筛选
        // ──────────────────────────────────────────────

        setSearchQuery: (query: SearchQuery) => {
          set((state) => {
            state.searchQuery = query
            // 执行搜索
            const matched = new Set<ULID>()
            const highlighted = new Set<ULID>()

            state.nodes.forEach((node, id) => {
              let match = true

              if (query.text) {
                const text = query.text.toLowerCase()
                match = node.title.toLowerCase().includes(text) ||
                  node.body.toLowerCase().includes(text) ||
                  node.labels.some((l) => l.toLowerCase().includes(text))
              }
              if (match && query.kinds?.length) {
                match = query.kinds.includes(node.kind)
              }
              if (match && query.statuses?.length) {
                match = query.statuses.includes(node.status)
              }
              if (match && query.labels?.length) {
                match = query.labels.some((l) => node.labels.includes(l))
              }
              if (match && query.assigneeIds?.length) {
                match = node.assignee ? query.assigneeIds.includes(node.assignee.id) : false
              }
              if (match && query.hasSession) {
                match = !!node.sessionId
              }
              if (match && query.hasGoal) {
                match = !!node.goalId
              }

              if (match) {
                matched.add(id)
                if (query.text) highlighted.add(id)
              }
            })

            state.matchedNodeIds = matched
            state.highlightedNodeIds = highlighted
          })
        },

        clearFilter: () => {
          set((state) => {
            state.searchQuery = {}
            state.matchedNodeIds.clear()
            state.highlightedNodeIds.clear()
          })
        },

        /** 执行搜索并返回匹配节点 ID 列表 (供 Canvas API 使用) */
        search: async (query: SearchQuery): Promise<string[]> => {
          get().setSearchQuery(query)
          return Array.from(get().matchedNodeIds)
        },

        // ──────────────────────────────────────────────
        // 布局
        // ──────────────────────────────────────────────

        applyLayout: async (options?: Partial<LayoutOptions>) => {
          const { nodes, edges } = get()
          const nodeArray = Array.from(nodes.values())
          const edgeArray = Array.from(edges.values())

          // 这里集成实际的布局算法 (dagre, elkjs, graphology 等)
          // 暂时返回简单的网格布局作为演示
          const layout = computeLayout(nodeArray, edgeArray, { ...DEFAULT_LAYOUT_OPTIONS, ...options })

          set((state) => {
            layout.forEach(({ id, position }) => {
              const node = state.nodes.get(id)
              if (node) {
                node.position = position
                node.updatedAt = now()
                node.version++
              }
            })
            pushHistory(state, 'Apply layout', [
              { op: 'batch', mutations: layout.map((l) => ({
                op: 'upsert_node' as const,
                node: state.nodes.get(l.id)!,
              })) },
            ])
          })

          get().flushPendingMutations()
        },

        autoArrange: async (nodeIds?: ULID[]) => {
          void nodeIds
          await get().applyLayout({ algorithm: 'hierarchical', animate: true })
        },

        // ──────────────────────────────────────────────
        // 历史/撤销
        // ──────────────────────────────────────────────

        undo: async () => {
          const { past } = get()
          if (past.length === 0) return

          const entry = past[past.length - 1]!
          // 反向应用 mutations
          set((state) => {
            entry.mutations.reverse().forEach((m) => {
              switch (m.op) {
                case 'upsert_node':
                  if (m.previous) {
                    state.nodes.set(m.previous.id, m.previous)
                  } else if (m.node) {
                    state.nodes.delete(m.node.id)
                  }
                  break
                case 'delete_node':
                  if (m.previous) {
                    state.nodes.set(m.previous.id, m.previous)
                  }
                  break
                case 'upsert_edge':
                  if (m.previous) {
                    state.edges.set(m.previous.id, m.previous)
                  } else if (m.edge) {
                    state.edges.delete(m.edge.id)
                  }
                  break
                case 'delete_edge':
                  if (m.previous) {
                    state.edges.set(m.previous.id, m.previous)
                  }
                  break
                case 'viewport':
                  state.viewport = m.viewport
                  break
                case 'selection':
                  state.selection = new Set(m.selection)
                  break
              }
            })
            state.future.unshift(entry)
            state.past.pop()
          })

          get().flushPendingMutations()
        },

        redo: async () => {
          const { future } = get()
          if (future.length === 0) return

          const entry = future[0]!
          set((state) => {
            entry.mutations.forEach((m) => {
              switch (m.op) {
                case 'upsert_node':
                  if (m.node) state.nodes.set(m.node.id, m.node)
                  break
                case 'delete_node':
                  state.nodes.delete(m.nodeId)
                  state.selection.delete(m.nodeId)
                  break
                case 'upsert_edge':
                  if (m.edge) state.edges.set(m.edge.id, m.edge)
                  break
                case 'delete_edge':
                  state.edges.delete(m.edgeId)
                  break
                case 'viewport':
                  state.viewport = m.viewport
                  break
                case 'selection':
                  state.selection = new Set(m.selection)
                  break
              }
            })
            state.past.push(entry)
            state.future.shift()
          })

          get().flushPendingMutations()
        },

        canUndo: () => get().past.length > 0,
        canRedo: () => get().future.length > 0,

        jumpToHistory: async (index: number) => {
          const { past } = get()
          if (index < 0 || index >= past.length) return

          // 简化：时间旅行完整重建留待下一步实现；此处仅记录目标索引
          const targetEntry = past[index]!
          void targetEntry
        },

        // ──────────────────────────────────────────────
        // DSH 集成
        // ──────────────────────────────────────────────

        openNodeSession: async (nodeId: ULID) => {
          const node = get().nodes.get(nodeId)
          if (!node?.sessionId) {
            // 创建新的子会话
            // TODO: 调用 session bridge
            return
          }
          // TODO: 打开现有会话
        },

        spawnSubagentForNode: async (nodeId: ULID, config) => {
          void config
          const node = get().nodes.get(nodeId)
          if (!node) return ''

          // TODO: 通过 session bridge 创建 subagent
          const subagentId = `subagent-${generateULID()}`

          // 更新节点关联
          await get().updateNode(nodeId, {
            assignee: { type: 'subagent', id: subagentId, displayName: 'Subagent' },
            sessionId: subagentId,
          })

          return subagentId
        },

        linkNodeToGoal: async (nodeId: ULID, goalId: string) => {
          await get().updateNode(nodeId, { goalId })
        },

        attachFilesToNode: async (nodeId: ULID, files: string[]) => {
          const node = get().nodes.get(nodeId)
          if (!node) return

          const fileRefs: FileRef[] = files.map((path) => ({
            path,
            action: 'modify',
          }))

          await get().updateNode(nodeId, {
            files: [...node.files, ...fileRefs],
          })
        },

        // ──────────────────────────────────────────────
        // 导入导出
        // ──────────────────────────────────────────────

        exportCanvas: async (format: 'json' | 'mermaid' | 'plantuml' | 'graphml' | 'png' | 'svg') => {
          const { nodes, edges, viewport } = get()
          const data = {
            nodes: Array.from(nodes.values()),
            edges: Array.from(edges.values()),
            viewport,
            exportedAt: now(),
            version: '1.0',
          }

          switch (format) {
            case 'json':
              return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            case 'mermaid':
              return new Blob([toMermaid(data)], { type: 'text/plain' })
            case 'plantuml':
              return new Blob([toPlantUML(data)], { type: 'text/plain' })
            case 'graphml':
              return new Blob([toGraphML(data)], { type: 'application/xml' })
            case 'png':
            case 'svg':
              // 需要 canvas 渲染器支持
              return new Blob([''], { type: `image/${format}` })
          }
        },

        importCanvas: async (data: Blob | string, format: 'json' | 'mermaid' | 'graphml') => {
          let parsed: { nodes: MindMapNode[]; edges: MindMapEdge[]; viewport?: Viewport } | null = null

          if (typeof data === 'string' || data instanceof Blob) {
            const text = typeof data === 'string' ? data : await data.text()
            switch (format) {
              case 'json':
                parsed = JSON.parse(text)
                break
              case 'mermaid':
                parsed = fromMermaid(text)
                break
              case 'graphml':
                parsed = fromGraphML(text)
                break
            }
          }

          if (!parsed) return

          set((state) => {
            state.nodes.clear()
            state.edges.clear()
            parsed.nodes.forEach((n) => state.nodes.set(n.id, n))
            parsed.edges.forEach((e) => state.edges.set(e.id, e))
            if (parsed.viewport) state.viewport = parsed.viewport
            pushHistory(state, `Import from ${format}`, [
              { op: 'batch', mutations: [
                ...parsed.nodes.map((n) => ({ op: 'upsert_node' as const, node: n })),
                ...parsed.edges.map((e) => ({ op: 'upsert_edge' as const, edge: e })),
              ] },
            ])
          })

          get().flushPendingMutations()
        },

        // ──────────────────────────────────────────────
        // 协作
        // ──────────────────────────────────────────────

        inviteCollaborator: async (email: string, role: 'view' | 'edit' | 'admin') => {
          void email
          void role
          // TODO: 集成 Yjs / Automerge
        },

        shareLink: async (permissions: 'view' | 'edit') => {
          // TODO: 生成分享链接
          return `https://dsh.example.com/mindmap/${get().sessionId}?perm=${permissions}`
        },

        // ──────────────────────────────────────────────
        // 持久化同步
        // ──────────────────────────────────────────────

        flushPendingMutations: () => {
          const { pendingMutations, sessionId } = get()
          void sessionId
          if (pendingMutations.length === 0) return

          // TODO: 通过 session-persistence 发送 mindmap/mutation 事件
          set((state) => {
            state.pendingMutations = []
            state.lastSyncedAt = now()
          })
        },

        // ──────────────────────────────────────────────
        // 计算属性 (selectors)
        // ──────────────────────────────────────────────

        getSelectedNodes: () => {
          const { nodes, selection } = get()
          return Array.from(selection).map((id) => nodes.get(id)).filter(Boolean) as MindMapNode[]
        },

        getNode: (id: ULID) => get().nodes.get(id),

        getEdge: (id: ULID) => get().edges.get(id),

        getChildren: (nodeId: ULID) => {
          const node = get().nodes.get(nodeId)
          if (!node) return []
          return node.childIds.map((id) => get().nodes.get(id)).filter(Boolean) as MindMapNode[]
        },

        getParents: (nodeId: ULID) => {
          const node = get().nodes.get(nodeId)
          if (!node) return []
          return node.parentIds.map((id) => get().nodes.get(id)).filter(Boolean) as MindMapNode[]
        },

        getConnectedEdges: (nodeId: ULID) => {
          const { edges } = get()
          return Array.from(edges.values()).filter(
            (e) => e.sourceId === nodeId || e.targetId === nodeId
          )
        },

        getRootNodes: () => {
          const { nodes } = get()
          return Array.from(nodes.values()).filter((n) => n.parentIds.length === 0)
        },

        getLeafNodes: () => {
          const { nodes } = get()
          return Array.from(nodes.values()).filter((n) => n.childIds.length === 0)
        },

        getNodesByKind: (kind: NodeKind) => {
          const { nodes } = get()
          return Array.from(nodes.values()).filter((n) => n.kind === kind)
        },

        getNodesByStatus: (status: NodeStatus) => {
          const { nodes } = get()
          return Array.from(nodes.values()).filter((n) => n.status === status)
        },
      }))
    ),
    { name: 'mindmap-store' }
  )
)

// ──────────────────────────────────────────────
// 布局算法 (简化版，实际应用 dagre/elkjs)
// ──────────────────────────────────────────────

function computeLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  options: LayoutOptions
): Array<{ id: ULID; position: { x: number; y: number } }> {
  // 简易层次布局：按 derives_from 边构建树，BFS 布局
  const children = new Map<ULID, ULID[]>()
  const parents = new Map<ULID, ULID[]>()

  edges.forEach((e) => {
    if (e.type === 'derives_from') {
      if (!children.has(e.sourceId)) children.set(e.sourceId, [])
      children.get(e.sourceId)!.push(e.targetId)
      if (!parents.has(e.targetId)) parents.set(e.targetId, [])
      parents.get(e.targetId)!.push(e.sourceId)
    }
  })

  // 找根节点
  const roots = nodes.filter((n) => !parents.has(n.id) || parents.get(n.id)!.length === 0)

  const result: Array<{ id: ULID; position: { x: number; y: number } }> = []
  const visited = new Set<ULID>()

  function layoutNode(nodeId: ULID, x: number, y: number, depth: number) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    result.push({ id: nodeId, position: { x, y } })

    const kids = children.get(nodeId) || []
    const spacing = options.nodeSep || 200
    const startX = x - (kids.length - 1) * spacing / 2

    kids.forEach((kidId, i) => {
      layoutNode(kidId, startX + i * spacing, y + (options.rankSep || 150), depth + 1)
    })
  }

  roots.forEach((root, i) => {
    layoutNode(root.id, i * 800, 100, 0)
  })

  // 处理未连接的节点
  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      result.push({ id: n.id, position: n.position })
    }
  })

  return result
}

// ──────────────────────────────────────────────
// 导出格式转换
// ──────────────────────────────────────────────

function toMermaid(data: { nodes: MindMapNode[]; edges: MindMapEdge[] }): string {
  const lines = ['graph TD']
  data.nodes.forEach((n) => {
    const shape = n.kind === 'pr' ? '(()' : n.kind === 'decision' ? '{' : '[' 
    const endShape = n.kind === 'pr' ? ')' : n.kind === 'decision' ? '}' : ']'
    lines.push(`  ${n.id}${shape}${n.title}${endShape}`)
    lines.push(`  style ${n.id} fill:${n.color || NODE_KIND_COLORS[n.kind]},color:#fff`)
  })
  data.edges.forEach((e) => {
    const arrow = EDGE_TYPE_DIRECTIONAL[e.type] ? '-->' : '---'
    const label = e.label ? `|${e.label}|` : ''
    lines.push(`  ${e.sourceId} ${arrow}${label} ${e.targetId}`)
  })
  return lines.join('\n')
}

function toPlantUML(data: { nodes: MindMapNode[]; edges: MindMapEdge[] }): string {
  const lines = ['@startmindmap']
  data.nodes.forEach((n) => {
    lines.push(`* [#${n.color?.slice(1) || NODE_KIND_COLORS[n.kind].slice(1)}] ${n.title}`)
  })
  lines.push('@endmindmap')
  return lines.join('\n')
}

function toGraphML(data: { nodes: MindMapNode[]; edges: MindMapEdge[] }): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="label" attr.type="string"/>',
    '  <key id="kind" for="node" attr.name="kind" attr.type="string"/>',
    '  <key id="status" for="node" attr.name="status" attr.type="string"/>',
    '  <key id="color" for="node" attr.name="color" attr.type="string"/>',
    '  <key id="x" for="node" attr.name="x" attr.type="double"/>',
    '  <key id="y" for="node" attr.name="y" attr.type="double"/>',
    '  <graph id="G" edgedefault="directed">',
  ]
  data.nodes.forEach((n) => {
    lines.push(`    <node id="${n.id}">`)
    lines.push(`      <data key="label">${n.title}</data>`)
    lines.push(`      <data key="kind">${n.kind}</data>`)
    lines.push(`      <data key="status">${n.status}</data>`)
    lines.push(`      <data key="color">${n.color || NODE_KIND_COLORS[n.kind]}</data>`)
    lines.push(`      <data key="x">${n.position.x}</data>`)
    lines.push(`      <data key="y">${n.position.y}</data>`)
    lines.push('    </node>')
  })
  data.edges.forEach((e) => {
    lines.push(`    <edge source="${e.sourceId}" target="${e.targetId}">`)
    lines.push(`      <data key="type">${e.type}</data>`)
    if (e.label) lines.push(`      <data key="label">${e.label}</data>`)
    lines.push('    </edge>')
  })
  lines.push('  </graph>', '</graphml>')
  return lines.join('\n')
}

function fromMermaid(text: string): { nodes: MindMapNode[]; edges: MindMapEdge[] } | null {
  void text
  // 简化解析，实际需要完整的 Mermaid 解析器
  return null
}

function fromGraphML(text: string): { nodes: MindMapNode[]; edges: MindMapEdge[] } | null {
  void text
  // 简化解析
  return null
}

// ──────────────────────────────────────────────
// 选择器 Hooks
// ──────────────────────────────────────────────

export const useNodes = () => useMindMapStore((s) => Array.from(s.nodes.values()))
export const useEdges = () => useMindMapStore((s) => Array.from(s.edges.values()))
export const useViewport = () => useMindMapStore((s) => s.viewport)
export const useSelection = () => useMindMapStore((s) => Array.from(s.selection))
export const useSearchQuery = () => useMindMapStore((s) => s.searchQuery)
export const useMatchedNodes = () => useMindMapStore((s) => Array.from(s.matchedNodeIds).map((id) => s.nodes.get(id)).filter(Boolean))
export const useCanUndo = () => useMindMapStore((s) => s.past.length > 0)
export const useCanRedo = () => useMindMapStore((s) => s.future.length > 0)