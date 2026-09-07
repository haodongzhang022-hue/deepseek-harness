/**
 * Mind-Map Canvas Slot Contracts
 * @module @deepseek-ai/dsh-client-ui-mindmap/contract/slots
 */

import type {
  MindMapNode,
  MindMapEdge,
  NodeKind,
  NodeStatus,
  EdgeType,
  Viewport,
  SearchQuery,
  LayoutOptions,
  Mutation,
  HistoryEntry,
} from './types.ts'

// ──────────────────────────────────────────────
// 基础 Slot 形态 (本包扩展点基类型)
// 注：DSH slot 系统通过 SlotMap 声明合并注册；
// 本包接入时需在 @deepseek-ai/dsh-client-ui-slots 里 declare module 合并。
// ──────────────────────────────────────────────

export interface SlotLike {
  id: string
  label?: string
  order?: number
  icon?: string
  group?: 'left' | 'center' | 'right'
  [key: string]: unknown
}

// ──────────────────────────────────────────────
// 主视图注册
// ──────────────────────────────────────────────

/**
 * 注册为 conversation.view 的一个标签页
 * 与 chat、trajectory 并列
 */
export interface MindMapViewSlot extends SlotLike {
  id: 'mindmap'
  component: React.ComponentType<MindMapViewProps>
  order: 10
  label: 'Mind-Map'
  icon: 'git-branch'
  // 仅在有会话时显示
  when: 'has-session'
}

export interface MindMapViewProps {
  sessionId: string
  // 初始视口/选中可由 URL 或父组件控制
  initialViewport?: Viewport
  initialSelection?: string[]
  // 是否只读模式 (用于预览/分享)
  readOnly?: boolean
}

// ──────────────────────────────────────────────
// 侧边栏面板
// ──────────────────────────────────────────────

/**
 * 大纲面板 - 树形结构视图
 */
export interface MindMapOutlineSlot extends SlotLike {
  id: 'mindmap-outline'
  component: React.ComponentType<MindMapOutlineProps>
  order: 20
  label: 'Outline'
  icon: 'list-tree'
}

export interface MindMapOutlineProps {
  sessionId: string
  // 受控模式：外部传入 nodes/edges，否则自动订阅 projection
  nodes?: Map<string, MindMapNode>
  edges?: Map<string, MindMapEdge>
  onSelectNode: (nodeId: string) => void
  onCreateChild: (parentId: string, kind: NodeKind) => void
}

/**
 * 搜索面板
 */
export interface MindMapSearchSlot extends SlotLike {
  id: 'mindmap-search'
  component: React.ComponentType<MindMapSearchProps>
  order: 30
  label: 'Search'
  icon: 'search'
}

export interface MindMapSearchProps {
  sessionId: string
  onResultSelect: (nodeId: string) => void
  onFilterChange: (query: SearchQuery) => void
}

/**
 * 历史/时间旅行面板
 */
export interface MindMapHistorySlot extends SlotLike {
  id: 'mindmap-history'
  component: React.ComponentType<MindMapHistoryProps>
  order: 40
  label: 'History'
  icon: 'clock'
}

export interface MindMapHistoryProps {
  sessionId: string
  entries: HistoryEntry[]
  currentIndex: number
  onJumpTo: (index: number) => void
  onBranchFrom: (index: number) => void
}

// ──────────────────────────────────────────────
// 节点扩展点
// ──────────────────────────────────────────────

/**
 * 节点渲染器注册 - 按 kind 分发
 * 类似 conversation.chat.node
 */
export interface MindMapNodeRendererSlot extends SlotLike {
  id: `mindmap.node.${NodeKind}`
  kind: NodeKind
  component: React.ComponentType<MindMapNodeRendererProps>
  // 优先级：数字越大越优先
  priority?: number
}

export interface MindMapNodeRendererProps {
  node: MindMapNode
  // 视觉状态
  selected: boolean
  hovered: boolean
  // 交互回调
  onSelect: (nodeId: string, multi?: boolean) => void
  onDoubleClick: (nodeId: string) => void
  onDragStart: (nodeId: string, event: React.MouseEvent) => void
  onDragEnd: (nodeId: string, position: { x: number; y: number }) => void
  onConnectStart: (nodeId: string, handleId: string) => void
  onContextMenu: (nodeId: string, event: React.MouseEvent) => void
  // 尺寸约束
  minWidth?: number
  maxWidth?: number
}

/**
 * 节点右键菜单扩展
 */
export interface MindMapNodeContextMenuSlot extends SlotLike {
  id: string
  label: string
  icon?: string
  // 可选：仅对特定 kind 生效
  kinds?: NodeKind[]
  // 可选：仅对特定 status 生效
  statuses?: NodeStatus[]
  // 是否危险操作 (显示确认)
  dangerous?: boolean
  action: (node: MindMapNode, canvasApi: MindMapCanvasApi) => Promise<void> | void
}

/**
 * 节点悬浮详情扩展 (hover card)
 */
export interface MindMapNodeHoverSlot extends SlotLike {
  id: string
  kinds?: NodeKind[]
  component: React.ComponentType<MindMapNodeHoverProps>
}

export interface MindMapNodeHoverProps {
  node: MindMapNode
  // 快捷操作
  onOpenSession: () => void
  onOpenInEditor: (filePath: string) => void
  onCopyNode: () => void
  onSpawnSubagent: () => void
}

/**
 * 边渲染器扩展
 */
export interface MindMapEdgeRendererSlot extends SlotLike {
  id: `mindmap.edge.${EdgeType}`
  type: EdgeType
  component: React.ComponentType<MindMapEdgeRendererProps>
}

export interface MindMapEdgeRendererProps {
  edge: MindMapEdge
  sourceNode: MindMapNode
  targetNode: MindMapNode
  selected: boolean
  animated?: boolean
  onSelect: (edgeId: string) => void
}

// ──────────────────────────────────────────────
// 画布工具栏扩展
// ──────────────────────────────────────────────

/**
 * 顶部工具栏动作
 */
export interface MindMapToolbarActionSlot extends SlotLike {
  id: string
  label: string
  icon: string
  tooltip?: string
  // 组别：左/中/右
  group: 'left' | 'center' | 'right'
  order?: number
  // 禁用条件
  disabledWhen?: (canvasApi: MindMapCanvasApi) => boolean
  // 点击处理
  onClick: (canvasApi: MindMapCanvasApi) => Promise<void> | void
  // 可选：下拉菜单
  dropdown?: MindMapToolbarDropdownItem[]
}

export interface MindMapToolbarDropdownItem {
  label: string
  icon?: string
  shortcut?: string
  action: (canvasApi: MindMapCanvasApi) => Promise<void> | void
  dividerAfter?: boolean
}

/**
 * 画布 API - 传递给所有扩展的控制器
 */
export interface MindMapCanvasApi {
  // 核心状态访问
  readonly sessionId: string
  readonly nodes: Map<string, MindMapNode>
  readonly edges: Map<string, MindMapEdge>
  readonly viewport: Viewport
  readonly selection: Set<string>

  // 节点操作
  createNode: (input: Partial<MindMapNode> & { kind: NodeKind; position: { x: number; y: number } }) => Promise<string>
  updateNode: (nodeId: string, patch: Partial<MindMapNode>) => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>
  duplicateNode: (nodeId: string, offset?: { x: number; y: number }) => Promise<string>

  // 边操作
  createEdge: (sourceId: string, targetId: string, type: EdgeType) => Promise<string>
  updateEdge: (edgeId: string, patch: Partial<MindMapEdge>) => Promise<void>
  deleteEdge: (edgeId: string) => Promise<void>

  // 批量操作
  batch: (mutations: Mutation[]) => Promise<void>

  // 选择/视口
  setSelection: (nodeIds: string[], replace?: boolean) => void
  setViewport: (viewport: Partial<Viewport>, animate?: boolean) => void
  fitView: (nodeIds?: string[], padding?: number) => void
  centerOn: (nodeId: string) => void

  // 布局
  applyLayout: (options?: Partial<LayoutOptions>) => Promise<void>
  autoArrange: (nodeIds?: string[]) => Promise<void>

  // 搜索/筛选
  search: (query: SearchQuery) => Promise<string[]>
  setFilter: (query: SearchQuery) => void
  clearFilter: () => void

  // 历史/撤销
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: () => boolean
  canRedo: () => boolean
  jumpToHistory: (index: number) => Promise<void>

  // DSH 集成
  openNodeSession: (nodeId: string) => Promise<void>
  spawnSubagentForNode: (nodeId: string, config?: SubagentSpawnConfig) => Promise<string>
  linkNodeToGoal: (nodeId: string, goalId: string) => Promise<void>
  attachFilesToNode: (nodeId: string, files: string[]) => Promise<void>

  // 导入导出
  exportCanvas: (format: 'json' | 'mermaid' | 'plantuml' | 'graphml' | 'png' | 'svg') => Promise<Blob>
  importCanvas: (data: Blob | string, format: 'json' | 'mermaid' | 'graphml') => Promise<void>

  // 协作
  inviteCollaborator: (email: string, role: 'view' | 'edit' | 'admin') => Promise<void>
  shareLink: (permissions: 'view' | 'edit') => Promise<string>
}

export interface SubagentSpawnConfig {
  prompt: string
  workingDirectory?: string
  allowedTools?: string[]
  maxTurns?: number
  onComplete?: (result: unknown) => void
}

// ──────────────────────────────────────────────
// 会话桥接 (双向同步)
// ──────────────────────────────────────────────

/**
 * Session → MindMap 同步事件
 * 由 session-bridge 发射，mindmap store 订阅
 */
export interface SessionToMindMapEvent {
  type:
    | 'turn_completed'
    | 'tool_call_started'
    | 'tool_call_completed'
    | 'approval_requested'
    | 'approval_resolved'
    | 'goal_created'
    | 'goal_updated'
    | 'goal_completed'
    | 'file_changed'
    | 'subagent_spawned'
    | 'subagent_completed'
  payload: unknown
  turnId: string
  timestamp: number
}

/**
 * MindMap → Session 指令
 * 由 mindmap 发射，session-bridge 执行
 */
export interface MindMapToSessionCommand {
  type:
    | 'prompt'
    | 'steer'
    | 'approve'
    | 'reject'
    | 'spawn_subagent'
    | 'create_goal'
    | 'update_goal'
    | 'compact'
    | 'fork_session'
  payload: unknown
  targetNodeId?: string
  targetSessionId?: string
}

// ──────────────────────────────────────────────
// 导出所有 Slot 类型
// ──────────────────────────────────────────────

export type MindMapSlot =
  | MindMapViewSlot
  | MindMapOutlineSlot
  | MindMapSearchSlot
  | MindMapHistorySlot
  | MindMapNodeRendererSlot
  | MindMapNodeContextMenuSlot
  | MindMapNodeHoverSlot
  | MindMapEdgeRendererSlot
  | MindMapToolbarActionSlot

// 类型守卫
export function isMindMapViewSlot(slot: SlotLike): slot is MindMapViewSlot {
  return slot.id === 'mindmap'
}

export function isMindMapNodeRendererSlot(slot: SlotLike): slot is MindMapNodeRendererSlot {
  return slot.id.startsWith('mindmap.node.')
}

export function isMindMapEdgeRendererSlot(slot: SlotLike): slot is MindMapEdgeRendererSlot {
  return slot.id.startsWith('mindmap.edge.')
}