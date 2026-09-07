/**
 * Session Bridge - Bidirectional sync between DSH Session and Mind-Map Canvas
 * @module @deepseek-ai/dsh-client-ui-mindmap/integration/sessionBridge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import React from 'react'
import { useMindMapStore } from '../store/mindmap.ts'
import type {
  MindMapNode,
  NodeKind,
  EdgeType,
  ToolCallRef,
  FileRef,
  ULID,
} from '../contract/types.ts'
import { nanoid } from 'nanoid'

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

interface SessionEvent {
  type: string
  turnId: string
  timestamp: number
  payload: unknown
}

interface TurnData {
  id: string
  userMessage?: string
  assistantMessage?: string
  toolCalls: ToolCallData[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: number
  endedAt?: number
}

interface ToolCallData {
  id: string
  toolName: string
  args: unknown
  result?: unknown
  error?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: number
  endedAt?: number
}

interface ApprovalData {
  id: string
  type: 'tool' | 'permission' | 'plan' | 'custom'
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  payload: unknown
  requestedAt: number
  resolvedAt?: number
}

interface GoalData {
  id: string
  title: string
  status: 'active' | 'paused' | 'completed' | 'blocked'
  progress: number
}

interface SubagentData {
  id: string
  prompt: string
  status: 'spawning' | 'running' | 'completed' | 'failed'
  parentTurnId: string
  result?: unknown
}

// ──────────────────────────────────────────────
// Session Bridge Service
// ──────────────────────────────────────────────

declare module '@deepseek-ai/cordis' {
  interface Context {
    mindmapBridge: MindMapBridge
  }
}

export class MindMapBridge extends Service {
  static Config = z.object({
    sessionId: z.string(),
    autoSync: z.boolean().default(true),
    heuristicMapping: z.boolean().default(true),
  })

  private sessionId: string
  private autoSync: boolean
  private heuristicMapping: boolean
  private turnNodeMap = new Map<string, ULID>() // turnId -> nodeId
  private toolCallNodeMap = new Map<string, ULID>() // toolCallId -> nodeId
  private goalNodeMap = new Map<string, ULID>() // goalId -> nodeId
  private subagentNodeMap = new Map<string, ULID>() // subagentId -> nodeId

  constructor(ctx: Context, config: { sessionId: string; autoSync?: boolean; heuristicMapping?: boolean } = { sessionId: '' }) {
    super(ctx, 'mindmapBridge')
    this.sessionId = config.sessionId
    this.autoSync = config.autoSync ?? true
    this.heuristicMapping = config.heuristicMapping ?? true

    if (this.autoSync) {
      this.setupEventListeners()
    }
  }

  private setupEventListeners() {
    // 监听 session 事件 (事件名与载荷由宿主会话系统声明，此处按字符串注册)
    const on = this.ctx.on as unknown as (event: string, handler: (payload: any) => unknown) => void
    on('session/event', this.handleSessionEvent.bind(this))
    on('turn/start', this.handleTurnStart.bind(this))
    on('turn/end', this.handleTurnEnd.bind(this))
    on('tool/call', this.handleToolCall.bind(this))
    on('tool/result', this.handleToolResult.bind(this))
    on('approval/requested', this.handleApprovalRequested.bind(this))
    on('approval/resolved', this.handleApprovalResolved.bind(this))
    on('goal/created', this.handleGoalCreated.bind(this))
    on('goal/updated', this.handleGoalUpdated.bind(this))
    on('subagent/spawned', this.handleSubagentSpawned.bind(this))
    on('subagent/completed', this.handleSubagentCompleted.bind(this))
    on('file/changed', this.handleFileChanged.bind(this))
  }

  // ──────────────────────────────────────────────
  // 事件处理器
  // ──────────────────────────────────────────────

  private async handleSessionEvent(event: SessionEvent) {
    if (!this.heuristicMapping) return

    switch (event.type) {
      case 'user/message':
        await this.createOrUpdateIssueNode(event)
        break
      case 'assistant/message':
        await this.updateIssueNodeWithResponse(event)
        break
      case 'turn/start':
        await this.handleTurnStart(event.payload as TurnData)
        break
      case 'turn/end':
        await this.handleTurnEnd(event.payload as TurnData)
        break
    }
  }

  /** 用户消息 → 创建/复用 Issue 节点 (启发式映射) */
  private async createOrUpdateIssueNode(event: SessionEvent): Promise<void> {
    const text = typeof event.payload === 'string'
      ? event.payload
      : (event.payload as { content?: string } | undefined)?.content ?? ''
    if (!text) return

    // 若该 turn 已有节点则复用，否则新建
    const existingId = this.turnNodeMap.get(event.turnId)
    if (existingId) {
      await this.updateNode(existingId, {
        body: `${(await this.getNode(existingId))?.body ?? ''}\n\n${text}`.trim(),
      })
      return
    }
    const nodeId = await this.createNode({
      kind: 'issue',
      title: this.extractTitle(text),
      body: text,
      status: 'in_progress',
      position: this.getNextPosition('issue'),
      sessionId: this.sessionId,
      createdBy: { type: 'human', id: 'user' },
    })
    this.turnNodeMap.set(event.turnId, nodeId)
  }

  /** 助手消息 → 更新对应 Issue 节点正文与状态 */
  private async updateIssueNodeWithResponse(event: SessionEvent): Promise<void> {
    const nodeId = this.turnNodeMap.get(event.turnId)
    if (!nodeId) return
    const text = typeof event.payload === 'string'
      ? event.payload
      : (event.payload as { content?: string } | undefined)?.content ?? ''
    const node = await this.getNode(nodeId)
    if (!node) return
    await this.updateNode(nodeId, {
      body: `${node.body}\n\n---\n\n${text}`.trim(),
      status: 'review',
    })
  }

  /** 完成的工具调用 → 创建 PR 节点 (启发式映射) */
  private async createPRNodeFromToolCall(issueNodeId: ULID, toolCall: ToolCallData): Promise<void> {
    const nodeId = await this.createNode({
      kind: 'pr',
      title: `${toolCall.toolName}: ${this.summarizeArgs(toolCall.args)}`,
      body: `Tool: ${toolCall.toolName}\nArgs: ${JSON.stringify(toolCall.args, null, 2)}`,
      status: 'review',
      position: this.getNextPosition('pr', issueNodeId),
      parentIds: [issueNodeId],
      edgeTypes: ['derives_from'],
      sessionId: this.sessionId,
      toolCalls: [{
        id: toolCall.id,
        toolName: toolCall.toolName,
        argsHash: this.hashArgs(toolCall.args),
        startedAt: toolCall.startedAt,
        ...(toolCall.endedAt !== undefined ? { endedAt: toolCall.endedAt } : {}),
        status: 'completed',
        ...(toolCall.result ? { resultSummary: this.summarizeResult(toolCall.result) } : {}),
        ...(toolCall.error !== undefined ? { error: toolCall.error } : {}),
      }],
      createdBy: { type: 'subagent', id: 'assistant' },
    })
    this.toolCallNodeMap.set(toolCall.id, nodeId)

    // 关联 Issue 边
    const issueNode = await this.getNode(issueNodeId)
    if (issueNode && !issueNode.edgeTypes.includes('derives_from')) {
      await this.updateNode(issueNodeId, {
        edgeTypes: [...issueNode.edgeTypes, 'derives_from'],
      })
    }
  }

  private async handleTurnStart(turn: TurnData) {
    // 创建 Issue 节点代表用户需求
    if (turn.userMessage) {
      const nodeId = await this.createNode({
        kind: 'issue',
        title: this.extractTitle(turn.userMessage),
        body: turn.userMessage,
        status: 'in_progress',
        position: this.getNextPosition('issue'),
        sessionId: this.sessionId,
        createdBy: { type: 'human', id: 'user' },
      })
      this.turnNodeMap.set(turn.id, nodeId)
    }
  }

  private async handleTurnEnd(turn: TurnData) {
    const issueNodeId = this.turnNodeMap.get(turn.id)
    if (!issueNodeId) return

    // 更新 Issue 状态
    const hasErrors = turn.toolCalls.some((tc) => tc.status === 'failed')
    await this.updateNode(issueNodeId, {
      status: hasErrors ? 'blocked' : 'review',
      body: turn.assistantMessage
        ? `${turn.userMessage ?? ''}\n\n---\n\n${turn.assistantMessage}`
        : (turn.userMessage ?? ''),
    })

    // 为每个工具调用创建 PR 节点
    for (const tc of turn.toolCalls) {
      if (tc.status === 'completed' && tc.result) {
        await this.createPRNodeFromToolCall(issueNodeId, tc)
      }
    }
  }

  private async handleToolCall(toolCall: ToolCallData) {
    // 工具调用开始时创建 PR 节点 (pending 状态)
    const parentIssueId = this.findParentIssueForToolCall()
    if (parentIssueId) {
      const nodeId = await this.createNode({
        kind: 'pr',
        title: `${toolCall.toolName}: ${this.summarizeArgs(toolCall.args)}`,
        body: `Tool: ${toolCall.toolName}\nArgs: ${JSON.stringify(toolCall.args, null, 2)}`,
        status: 'in_progress',
        position: this.getNextPosition('pr', parentIssueId),
        parentIds: [parentIssueId],
        edgeTypes: ['derives_from'],
        sessionId: this.sessionId,
        toolCalls: [{
          id: toolCall.id,
          toolName: toolCall.toolName,
          argsHash: this.hashArgs(toolCall.args),
          startedAt: toolCall.startedAt,
          status: 'running',
        }],
        createdBy: { type: 'subagent', id: 'assistant' },
      })
      this.toolCallNodeMap.set(toolCall.id, nodeId)

      // 更新父 Issue 的边类型
      const parentNode = await this.getNode(parentIssueId)
      const parentEdgeTypes = (parentNode?.edgeTypes ?? []) as EdgeType[]
      await this.updateNode(parentIssueId, {
        edgeTypes: [...new Set([...parentEdgeTypes, 'derives_from' as EdgeType])],
      })
    }
  }

  private async handleToolResult(toolCall: ToolCallData) {
    const nodeId = this.toolCallNodeMap.get(toolCall.id)
    if (!nodeId) return

    const toolCallRef: ToolCallRef = {
      id: toolCall.id,
      toolName: toolCall.toolName,
      argsHash: this.hashArgs(toolCall.args),
      startedAt: toolCall.startedAt,
      ...(toolCall.endedAt !== undefined ? { endedAt: toolCall.endedAt } : {}),
      status: toolCall.status,
      ...(toolCall.result ? { resultSummary: this.summarizeResult(toolCall.result) } : {}),
      ...(toolCall.error !== undefined ? { error: toolCall.error } : {}),
    }

    const updates: Partial<MindMapNode> = {
      status: toolCall.status === 'completed' ? 'review' : 'blocked',
      toolCalls: [toolCallRef],
    }

    if (toolCall.result) {
      // 提取文件变更
      const files = this.extractFilesFromResult(toolCall.result)
      if (files.length > 0) {
        updates.files = files
      }
    }

    await this.updateNode(nodeId, updates)
  }

  private async handleApprovalRequested(approval: ApprovalData) {
    // 创建 Review 节点
    const nodeId = await this.createNode({
      kind: 'review',
      title: `Review: ${approval.type}`,
      body: `Approval requested for ${approval.type}\n\nPayload: ${JSON.stringify(approval.payload, null, 2)}`,
      status: 'open',
      position: this.getNextPosition('review'),
      approvals: [{
        id: approval.id,
        type: approval.type,
        status: 'pending',
        requestedAt: approval.requestedAt,
        payload: approval.payload,
      }],
      sessionId: this.sessionId,
      createdBy: { type: 'system', id: 'approval-system' },
    })
    return nodeId
  }

  private async handleApprovalResolved(approval: ApprovalData) {
    // 查找并更新 Review 节点
    const nodes = useMindMapStore.getState().nodes
    for (const [, node] of nodes) {
      if (node.kind === 'review' && node.approvals.some((a) => a.id === approval.id)) {
        const nextStatus = approval.status === 'approved' ? 'merged' : 'closed'
        await this.updateNode(node.id, {
          status: nextStatus,
          approvals: node.approvals.map((a) =>
            a.id === approval.id
              ? {
                  ...a,
                  status: approval.status,
                  ...(approval.resolvedAt !== undefined ? { resolvedAt: approval.resolvedAt } : {}),
                }
              : a
          ),
        })
        break
      }
    }
  }

  private async handleGoalCreated(goal: GoalData) {
    const nodeId = await this.createNode({
      kind: 'meta',
      title: `Goal: ${goal.title}`,
      body: `Goal created: ${goal.title}`,
      status: 'in_progress',
      position: this.getNextPosition('meta'),
      goalId: goal.id,
      sessionId: this.sessionId,
      createdBy: { type: 'system', id: 'goal-system' },
    })
    this.goalNodeMap.set(goal.id, nodeId)
  }

  private async handleGoalUpdated(goal: GoalData) {
    const nodeId = this.goalNodeMap.get(goal.id)
    if (!nodeId) return

    await this.updateNode(nodeId, {
      title: `Goal: ${goal.title}`,
      status: goal.status === 'completed' ? 'merged' : goal.status === 'blocked' ? 'blocked' : 'in_progress',
      body: `Progress: ${goal.progress}%\n\nStatus: ${goal.status}`,
    })
  }

  private async handleSubagentSpawned(subagent: SubagentData) {
    const parentNodeId = this.turnNodeMap.get(subagent.parentTurnId)
    const nodeId = await this.createNode({
      kind: 'research',
      title: `Subagent: ${this.extractTitle(subagent.prompt)}`,
      body: `Subagent spawned\n\nPrompt: ${subagent.prompt}`,
      status: 'in_progress',
      position: this.getNextPosition('research', parentNodeId),
      parentIds: parentNodeId ? [parentNodeId] : [],
      edgeTypes: parentNodeId ? ['derives_from'] : [],
      sessionId: subagent.id,
      assignee: { type: 'subagent', id: subagent.id, displayName: 'Subagent' },
      createdBy: { type: 'subagent', id: subagent.id },
    })
    this.subagentNodeMap.set(subagent.id, nodeId)
  }

  private async handleSubagentCompleted(subagent: SubagentData) {
    const nodeId = this.subagentNodeMap.get(subagent.id)
    if (!nodeId) return

    await this.updateNode(nodeId, {
      status: subagent.status === 'completed' ? 'merged' : 'blocked',
      body: `Subagent completed\n\nPrompt: ${subagent.prompt}\n\nResult: ${subagent.result ? JSON.stringify(subagent.result, null, 2) : 'No result'}`,
    })
  }

  private async handleFileChanged(data: { path: string; action: 'create' | 'modify' | 'delete' }) {
    // 关联到最近的 PR 节点
    const recentPRNodes = Array.from(useMindMapStore.getState().nodes.values())
      .filter((n) => n.kind === 'pr' && n.status !== 'merged')
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (recentPRNodes.length > 0) {
      const node = recentPRNodes[0]!
      await this.updateNode(node.id, {
        files: [...node.files, { path: data.path, action: data.action }],
      })
    }
  }

  // ──────────────────────────────────────────────
  // 节点创建辅助
  // ──────────────────────────────────────────────

  private async createNode(input: Partial<MindMapNode> & { kind: NodeKind; position: { x: number; y: number } }): Promise<ULID> {
    return useMindMapStore.getState().createNode(input)
  }

  private async updateNode(nodeId: ULID, patch: Partial<MindMapNode>): Promise<void> {
    return useMindMapStore.getState().updateNode(nodeId, patch)
  }

  private async getNode(nodeId: ULID): Promise<MindMapNode | undefined> {
    return useMindMapStore.getState().nodes.get(nodeId)
  }

  private findParentIssueForToolCall(): ULID | null {
    // 找到最近的进行中的 issue 节点
    const nodes = useMindMapStore.getState().nodes
    for (const [, node] of nodes) {
      if (node.kind === 'issue' && node.status === 'in_progress') {
        return node.id
      }
    }
    return null
  }

  private getNextPosition(kind: NodeKind, parentId?: ULID): { x: number; y: number } {
    const nodes = useMindMapStore.getState().nodes
    const baseOffset = { x: 300, y: 200 }

    if (parentId) {
      const parent = nodes.get(parentId)
      if (parent) {
        const children = Array.from(nodes.values()).filter((n) => n.parentIds.includes(parentId))
        const index = children.length
        return {
          x: parent.position.x + baseOffset.x,
          y: parent.position.y + baseOffset.y + index * 150,
        }
      }
    }

    // 全局偏移
    const count = Array.from(nodes.values()).filter((n) => n.kind === kind).length
    return {
      x: 100 + (count % 5) * 350,
      y: 100 + Math.floor(count / 5) * 250,
    }
  }

  // ──────────────────────────────────────────────
  // 启发式映射工具
  // ──────────────────────────────────────────────

  private extractTitle(text: string): string {
    const lines = text.trim().split('\n')
    const firstLine = (lines[0] ?? '').trim()
    return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine
  }

  private summarizeArgs(args: unknown): string {
    if (typeof args === 'string') return args.slice(0, 50)
    if (args && typeof args === 'object') {
      const keys = Object.keys(args as object)
      return keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '')
    }
    return String(args).slice(0, 50)
  }

  private hashArgs(args: unknown): string {
    return btoa(JSON.stringify(args)).slice(0, 16)
  }

  private summarizeResult(result: unknown): string {
    if (!result) return 'No result'
    const str = JSON.stringify(result)
    return str.length > 100 ? str.slice(0, 97) + '...' : str
  }

  private extractFilesFromResult(result: unknown): FileRef[] {
    const files: FileRef[] = []
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>
      if (obj.path && typeof obj.path === 'string') {
        files.push({
          path: obj.path,
          action: obj.action as FileRef['action'] || 'modify',
          language: obj.language as string,
          linesAdded: obj.linesAdded as number,
          linesRemoved: obj.linesRemoved as number,
        })
      }
      // 递归查找
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') {
          files.push(...this.extractFilesFromResult(v))
        }
      }
    }
    return files
  }

  // ──────────────────────────────────────────────
  // 公共 API (供 MindMap Canvas 调用)
  // ──────────────────────────────────────────────

  /** 事件发射 (事件名由宿主声明，此处按字符串发射) */
  private emit(event: string, payload: unknown): void {
    const emit = this.ctx.emit as unknown as (name: string, value: unknown) => void
    emit(event, payload)
  }

  /** 从节点打开/创建关联会话 */
  async openNodeSession(nodeId: ULID): Promise<string | null> {
    const node = useMindMapStore.getState().nodes.get(nodeId)
    if (!node) return null

    if (node.sessionId) {
      // 打开现有会话
      this.emit('mindmap/open-session', { sessionId: node.sessionId, nodeId })
      return node.sessionId
    } else {
      // 创建新的子会话
      const newSessionId = `mindmap-${nodeId}-${Date.now()}`
      this.emit('mindmap/create-session', {
        sessionId: newSessionId,
        parentSessionId: this.sessionId,
        initialPrompt: node.body || node.title,
        nodeId,
      })
      await this.updateNode(nodeId, { sessionId: newSessionId })
      return newSessionId
    }
  }

  /** 为节点生成子代理 */
  async spawnSubagentForNode(nodeId: ULID, config?: { prompt?: string; allowedTools?: string[] }): Promise<string> {
    const node = useMindMapStore.getState().nodes.get(nodeId)
    if (!node) throw new Error('Node not found')

    const subagentId = `subagent-${nanoid(12)}`
    this.emit('subagent/spawn', {
      id: subagentId,
      prompt: config?.prompt || `Continue working on: ${node.title}\n\nContext: ${node.body}`,
      ...(node.files[0]?.path ? { workingDirectory: node.files[0].path.split('/').slice(0, -1).join('/') } : {}),
      ...(config?.allowedTools ? { allowedTools: config.allowedTools } : {}),
      parentNodeId: nodeId,
      parentSessionId: this.sessionId,
    })

    await this.updateNode(nodeId, {
      assignee: { type: 'subagent', id: subagentId, displayName: 'Subagent' },
      sessionId: subagentId,
      status: 'in_progress',
    })

    return subagentId
  }

  /** 关联节点到 Goal */
  async linkNodeToGoal(nodeId: ULID, goalId: string): Promise<void> {
    await this.updateNode(nodeId, { goalId })
    this.goalNodeMap.set(goalId, nodeId)
  }

  /** 同步会话历史到 MindMap (初始化/重建) */
  async syncFromSession(events: SessionEvent[]): Promise<void> {
    for (const event of events) {
      await this.handleSessionEvent(event)
    }
    // 应用布局
    useMindMapStore.getState().applyLayout({ algorithm: 'hierarchical', animate: false })
  }

  /** 导出 MindMap 状态用于持久化 */
  exportState() {
    const { nodes, edges, viewport, selection } = useMindMapStore.getState()
    return {
      sessionId: this.sessionId,
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      viewport,
      selection: Array.from(selection),
      exportedAt: Date.now(),
    }
  }

  /** 从持久化状态恢复 */
  importState(state: ReturnType<typeof this.exportState>): void {
    useMindMapStore.getState().initialize(this.sessionId, false, state.nodes, state.edges)
    useMindMapStore.getState().setViewport(state.viewport)
    useMindMapStore.getState().setSelection(state.selection)
  }
}

// ──────────────────────────────────────────────
// 获取 Bridge 函数
// ──────────────────────────────────────────────

/**
 * 从 Cordis Context 获取 MindMapBridge 实例
 * 在非 React 上下文中使用 (如命令处理器、事件监听器)
 */
export function getMindMapBridge(ctx: Context): MindMapBridge {
  return ctx.mindmapBridge
}

/**
 * React Hook: 从 Cordis React Context 获取 MindMapBridge
 * 注意：实际使用时需要通过 React 的 Context.Provider 注入 cordis ctx
 */
export function useSessionBridge(cordisContext: React.Context<Context>): MindMapBridge {
  const ctx = React.useContext(cordisContext)
  return ctx.mindmapBridge
}

// ──────────────────────────────────────────────
// 导出
// ──────────────────────────────────────────────

export { MindMapBridge as default }