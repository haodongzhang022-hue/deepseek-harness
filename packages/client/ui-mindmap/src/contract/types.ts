/**
 * Mind-Map Canvas Core Types
 * @module @deepseek-ai/dsh-client-ui-mindmap/contract/types
 */

import z from '@deepseek-ai/schemastery'

// ──────────────────────────────────────────────
// 基础标识与引用
// ──────────────────────────────────────────────

export type ULID = string & { readonly __brand: unique symbol }
export const ULID = z.string().pattern(/^[0-9A-HJKMNP-TV-Z]{26}$/)

export interface IdentityRef {
  type: 'human' | 'subagent' | 'skill' | 'system'
  id: string
  displayName?: string
  avatarUrl?: string
}

export interface AgentRef extends IdentityRef {
  type: 'subagent' | 'skill'
  sessionId?: string
  capabilities?: string[]
}

export interface FileRef {
  path: string
  action: 'create' | 'modify' | 'delete' | 'rename'
  language?: string
  linesAdded?: number
  linesRemoved?: number
}

export interface ToolCallRef {
  id: string
  toolName: string
  argsHash: string
  startedAt: number
  endedAt?: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  resultSummary?: string
  error?: string
}

export interface ApprovalRef {
  id: string
  type: 'tool' | 'permission' | 'plan' | 'custom'
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  requestedAt: number
  resolvedAt?: number
  resolver?: IdentityRef
  payload: unknown
}

export interface SnapshotRef {
  id: string
  label: string
  timestamp: number
  sessionId: string
  eventIndex: number
}

export interface GoalRef {
  id: string
  title: string
  status: 'active' | 'paused' | 'completed' | 'blocked'
  progress: number // 0-100
}

// ──────────────────────────────────────────────
// 节点种类与状态
// ──────────────────────────────────────────────

export type NodeKind =
  | 'issue'
  | 'pr'
  | 'decision'
  | 'research'
  | 'review'
  | 'test'
  | 'deploy'
  | 'incident'
  | 'meta'

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  issue: 'Issue',
  pr: 'Pull Request',
  decision: 'Decision',
  research: 'Research',
  review: 'Review',
  test: 'Test',
  deploy: 'Deploy',
  incident: 'Incident',
  meta: 'Meta',
}

export const NODE_KIND_COLORS: Record<NodeKind, string> = {
  issue: '#EF4444',      // red-500
  pr: '#3B82F6',         // blue-500
  decision: '#8B5CF6',   // violet-500
  research: '#06B6D4',   // cyan-500
  review: '#F59E0B',     // amber-500
  test: '#10B981',       // emerald-500
  deploy: '#6366F1',     // indigo-500
  incident: '#EC4899',   // pink-500
  meta: '#6B7280',       // gray-500
}

export const NODE_KIND_ICONS: Record<NodeKind, string> = {
  issue: 'git-issue',
  pr: 'git-pull-request',
  decision: 'book-open',
  research: 'search',
  review: 'eye',
  test: 'beaker',
  deploy: 'rocket',
  incident: 'alert-triangle',
  meta: 'target',
}

export type NodeStatus =
  | 'open'
  | 'in_progress'
  | 'review'
  | 'merged'
  | 'closed'
  | 'blocked'
  | 'cancelled'

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  review: 'In Review',
  merged: 'Merged',
  closed: 'Closed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
}

// ──────────────────────────────────────────────
// 边类型
// ──────────────────────────────────────────────

export type EdgeType =
  | 'derives_from'
  | 'blocks'
  | 'duplicates'
  | 'relates_to'
  | 'fixes'
  | 'tests'
  | 'depends_on'

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  derives_from: 'Derives From',
  blocks: 'Blocks',
  duplicates: 'Duplicates',
  relates_to: 'Relates To',
  fixes: 'Fixes',
  tests: 'Tests',
  depends_on: 'Depends On',
}

export const EDGE_TYPE_STYLES: Record<EdgeType, { color: string; dash?: number[]; width: number }> = {
  derives_from: { color: '#64748B', width: 2 },           // slate-500
  blocks: { color: '#EF4444', dash: [6, 4], width: 2 },   // red-500
  duplicates: { color: '#94A3B8', dash: [4, 4], width: 1 }, // slate-400
  relates_to: { color: '#64748B', dash: [2, 6], width: 1 }, // slate-500
  fixes: { color: '#10B981', width: 3 },                  // emerald-500
  tests: { color: '#06B6D4', width: 2 },                  // cyan-500
  depends_on: { color: '#F59E0B', width: 2 },             // amber-500
}

export const EDGE_TYPE_DIRECTIONAL: Record<EdgeType, boolean> = {
  derives_from: true,
  blocks: true,
  duplicates: false,
  relates_to: false,
  fixes: true,
  tests: true,
  depends_on: true,
}

// ──────────────────────────────────────────────
// 核心节点与边
// ──────────────────────────────────────────────

export interface MindMapNode {
  id: ULID
  kind: NodeKind
  title: string
  body: string
  status: NodeStatus
  assignee?: AgentRef
  labels: string[]

  // DSH 原生能力绑定
  sessionId?: string
  goalId?: string
  toolCalls: ToolCallRef[]
  approvals: ApprovalRef[]
  files: FileRef[]
  snapshots: SnapshotRef[]

  // 图拓扑
  parentIds: ULID[]
  childIds: ULID[]
  edgeTypes: EdgeType[]

  // 视觉/布局
  position: { x: number; y: number }
  size?: { w: number; h: number }
  color?: string
  collapsed?: boolean
  pinned?: boolean

  // 元数据
  createdAt: number
  updatedAt: number
  createdBy: IdentityRef
  version: number
}

export interface MindMapEdge {
  id: ULID
  sourceId: ULID
  targetId: ULID
  type: EdgeType
  label?: string
  createdAt: number
  createdBy: IdentityRef
}

// ──────────────────────────────────────────────
// 画布状态
// ──────────────────────────────────────────────

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

export interface CanvasState {
  nodes: Map<ULID, MindMapNode>
  edges: Map<ULID, MindMapEdge>
  viewport: Viewport
  selection: Set<ULID>
  hoverNode?: ULID
  hoverEdge?: ULID
  draggingNode?: ULID
  connectingFrom?: ULID
  connectionPreview?: { x: number; y: number }
}

// ──────────────────────────────────────────────
// 搜索与筛选
// ──────────────────────────────────────────────

export interface SearchQuery {
  text?: string
  kinds?: NodeKind[]
  statuses?: NodeStatus[]
  labels?: string[]
  assigneeIds?: string[]
  dateRange?: { from: number; to: number }
  hasSession?: boolean
  hasGoal?: boolean
}

export interface FilterState {
  query: SearchQuery
  matchedNodeIds: Set<ULID>
  highlightedNodeIds: Set<ULID>
}

// ──────────────────────────────────────────────
// 历史/时间旅行
// ──────────────────────────────────────────────

export interface HistoryEntry {
  id: ULID
  timestamp: number
  description: string
  mutations: Mutation[]
  viewport?: Viewport
  selection?: ULID[]
}

export type Mutation =
  | { op: 'upsert_node'; node: MindMapNode; previous?: MindMapNode }
  | { op: 'delete_node'; nodeId: ULID; previous: MindMapNode }
  | { op: 'upsert_edge'; edge: MindMapEdge; previous?: MindMapEdge }
  | { op: 'delete_edge'; edgeId: ULID; previous: MindMapEdge }
  | { op: 'batch'; mutations: Mutation[] }
  | { op: 'viewport'; viewport: Viewport }
  | { op: 'selection'; selection: ULID[] }

export interface TimeTravelState {
  past: HistoryEntry[]
  future: HistoryEntry[]
  maxHistory: number
}

// ──────────────────────────────────────────────
// 布局算法配置
// ──────────────────────────────────────────────

export type LayoutAlgorithm =
  | 'hierarchical'
  | 'force'
  | 'radial'
  | 'grid'
  | 'dagre'

export interface LayoutOptions {
  algorithm: LayoutAlgorithm
  direction?: 'TB' | 'LR' | 'RL' | 'BT'
  nodeSep?: number
  rankSep?: number
  edgeSep?: number
  animate?: boolean
  duration?: number
  fitView?: boolean
  center?: boolean
  // force-specific
  linkDistance?: number
  linkStrength?: number
  chargeStrength?: number
  collisionRadius?: number
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  algorithm: 'hierarchical',
  direction: 'TB',
  nodeSep: 80,
  rankSep: 120,
  edgeSep: 20,
  animate: true,
  duration: 300,
  fitView: true,
  center: true,
}

// ──────────────────────────────────────────────
// 事件定义 (用于 session-persistence 事件溯源)
// ──────────────────────────────────────────────

export type MindMapEventType =
  | 'mindmap/node_created'
  | 'mindmap/node_updated'
  | 'mindmap/node_deleted'
  | 'mindmap/edge_created'
  | 'mindmap/edge_updated'
  | 'mindmap/edge_deleted'
  | 'mindmap/batch'
  | 'mindmap/viewport_changed'
  | 'mindmap/selection_changed'
  | 'mindmap/layout_applied'
  | 'mindmap/imported'
  | 'mindmap/exported'

export interface MindMapEvent<T = unknown> {
  type: MindMapEventType
  payload: T
  sessionId: string
  timestamp: number
  actor: IdentityRef
}

// ──────────────────────────────────────────────
// Schemastery Schemas (用于运行时验证与序列化)
// 注：schemastery 与 zod 不同：z.const 表示常量、z.union 表示枚举、
// object 字段默认可选、pattern 用于字符串约束。
// ──────────────────────────────────────────────

const NODE_KINDS = ['issue', 'pr', 'decision', 'research', 'review', 'test', 'deploy', 'incident', 'meta'] as const
const NODE_STATUSES = ['open', 'in_progress', 'review', 'merged', 'closed', 'blocked', 'cancelled'] as const
const IDENTITY_TYPES = ['human', 'subagent', 'skill', 'system'] as const
const EDGE_TYPES = ['derives_from', 'blocks', 'duplicates', 'relates_to', 'fixes', 'tests', 'depends_on'] as const
const TOOL_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const
const APPROVAL_TYPES = ['tool', 'permission', 'plan', 'custom'] as const
const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const
const FILE_ACTIONS = ['create', 'modify', 'delete', 'rename'] as const

const enumOf = <const T extends readonly string[]>(values: T) => z.union(values) as z<T[number]>

const identityRef = z.object({
  type: enumOf(IDENTITY_TYPES),
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().pattern(/^https?:\/\//),
})

const toolCallRef = z.object({
  id: z.string(),
  toolName: z.string(),
  argsHash: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  status: enumOf(TOOL_STATUSES),
  resultSummary: z.string(),
  error: z.string(),
})

const approvalRef = z.object({
  id: z.string(),
  type: enumOf(APPROVAL_TYPES),
  status: enumOf(APPROVAL_STATUSES),
  requestedAt: z.number(),
  resolvedAt: z.number(),
  resolver: identityRef,
  payload: z.any(),
})

const fileRef = z.object({
  path: z.string(),
  action: enumOf(FILE_ACTIONS),
  language: z.string(),
  linesAdded: z.number(),
  linesRemoved: z.number(),
})

const snapshotRef = z.object({
  id: z.string(),
  label: z.string(),
  timestamp: z.number(),
  sessionId: z.string(),
  eventIndex: z.number(),
})

export const MindMapNodeSchema = z.object({
  id: ULID,
  kind: enumOf(NODE_KINDS),
  title: z.string().pattern(/^[\s\S]{1,200}$/),
  body: z.string().pattern(/^[\s\S]{0,50000}$/),
  status: enumOf(NODE_STATUSES),
  assignee: identityRef,
  labels: z.array(z.string()).default([]),
  sessionId: z.string(),
  goalId: z.string(),
  toolCalls: z.array(toolCallRef).default([]),
  approvals: z.array(approvalRef).default([]),
  files: z.array(fileRef).default([]),
  snapshots: z.array(snapshotRef).default([]),
  parentIds: z.array(ULID).default([]),
  childIds: z.array(ULID).default([]),
  edgeTypes: z.array(enumOf(EDGE_TYPES)).default([]),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ w: z.number(), h: z.number() }),
  color: z.string(),
  collapsed: z.boolean().default(false),
  pinned: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
  createdBy: identityRef,
  version: z.number().min(1),
})

export const MindMapEdgeSchema = z.object({
  id: ULID,
  sourceId: ULID,
  targetId: ULID,
  type: enumOf(EDGE_TYPES),
  label: z.string(),
  createdAt: z.number(),
  createdBy: identityRef,
})

/** 从 schema 提取输入/输出类型 (替代 zod 的 z.input/z.output) */
type InferInput<S> = S extends z<infer I, any> ? I : never
type InferOutput<S> = S extends z<any, infer O> ? O : never

export type MindMapNodeInput = InferInput<typeof MindMapNodeSchema>
export type MindMapEdgeInput = InferInput<typeof MindMapEdgeSchema>
export type MindMapNodeOutput = InferOutput<typeof MindMapNodeSchema>
export type MindMapEdgeOutput = InferOutput<typeof MindMapEdgeSchema>