/**
 * Mind-Map Canvas Plugin Entry Point
 * Registers all slots and integrates with DSH Client
 * @module @deepseek-ai/dsh-client-ui-mindmap/apply
 */

import { Context } from '@deepseek-ai/cordis'
import { MindMapBridge } from './integration/sessionBridge.ts'
import { MindMapCanvas, MindMapOutline, MindMapSearch, MindMapNodeComponent, MindMapEdgeComponent } from './canvas/MindMapCanvas.tsx'
// Type-only Context merges: pulls ctx.slots / ctx.locale / session runtime into the Context type.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  MindMapNodeRendererSlot,
  MindMapNodeContextMenuSlot,
  MindMapEdgeRendererSlot,
  MindMapToolbarActionSlot,
  MindMapCanvasApi,
} from './contract/slots.ts'
import type { NodeKind, EdgeType, ULID, HistoryEntry } from './contract/types.ts'
import { useMindMapStore } from './store/mindmap.ts'

// ──────────────────────────────────────────────
// 辅助：注册 slot (SlotMap 类型声明合并由接入方完成)
// ──────────────────────────────────────────────

type SlotOptions = {
  name?: string
  id: string
  label?: string
  order?: number
  icon?: string
  [key: string]: unknown
}

/** 以 (name, options, component) 形态注册 slot，兼容 SlotMap 声明合并前的类型边界。 */
function registerSlot(
  ctx: Context,
  name: string,
  options: SlotOptions,
  component: unknown,
): void {
  const { name: _ignored, ...rest } = options
  void _ignored
  const slots = ctx.slots as unknown as {
    register(opts: Record<string, unknown>, comp: unknown): () => void
  }
  slots.register({ name, ...rest }, component)
}

// ──────────────────────────────────────────────
// 插件主入口
// ──────────────────────────────────────────────

export default function apply(ctx: Context) {
  // 注册 MindMapBridge 服务
  ctx.plugin(MindMapBridge, { sessionId: '' })

  // ──────────────────────────────────────────────
  // 对话视图标签页
  // ──────────────────────────────────────────────

  registerSlot(ctx, 'conversation.view', {
    id: 'mindmap',
    order: 10,
    label: 'Mind-Map',
    icon: 'git-branch',
    when: 'has-session',
  }, ({ sessionId }: { sessionId: string }) => (
    <MindMapCanvas
      sessionId={sessionId}
      readOnly={false}
      onNodeClick={(node) => console.log('Node clicked:', node)}
      onNodeDoubleClick={(node) => console.log('Node double-clicked:', node)}
      onSelectionChange={(ids) => console.log('Selection changed:', ids)}
    />
  ) as unknown as React.ComponentType)

  // ──────────────────────────────────────────────
  // 侧边栏面板
  // ──────────────────────────────────────────────

  registerSlot(ctx, 'sidebar.section', {
    id: 'mindmap-outline',
    order: 20,
    label: 'Outline',
    icon: 'list-tree',
  }, ({ sessionId }: { sessionId: string }) => (
    <MindMapOutline
        sessionId={sessionId}
        onSelectNode={(id) => {
          useMindMapStore.getState().centerOn(id as ULID)
          useMindMapStore.getState().setSelection([id as ULID])
        }}
      />
    ) as unknown as React.ComponentType)

  registerSlot(ctx, 'sidebar.section', {
    id: 'mindmap-search',
    order: 30,
    label: 'Search',
    icon: 'search',
  }, ({ sessionId }: { sessionId: string }) => (
    <MindMapSearch
        sessionId={sessionId}
        onResultSelect={(id) => {
          useMindMapStore.getState().centerOn(id as ULID)
          useMindMapStore.getState().setSelection([id as ULID])
        }}
      />
    ) as unknown as React.ComponentType)

  registerSlot(ctx, 'sidebar.section', {
    id: 'mindmap-history',
    order: 40,
    label: 'History',
    icon: 'clock',
  }, ({ sessionId }: { sessionId: string }) => (
    <MindMapHistoryPanel sessionId={sessionId} />
    ) as unknown as React.ComponentType)

  // ──────────────────────────────────────────────
  // 节点渲染器 (按 kind 分发)
  // ──────────────────────────────────────────────

  const nodeKinds: NodeKind[] = ['issue', 'pr', 'decision', 'research', 'review', 'test', 'deploy', 'incident', 'meta']

  nodeKinds.forEach((kind) => {
    registerSlot(ctx, 'mindmap.node.renderer', {
      id: `mindmap.node.${kind}` as MindMapNodeRendererSlot['id'],
      kind,
      priority: 10,
    }, MindMapNodeComponent as unknown as React.ComponentType)
  })

  // ──────────────────────────────────────────────
  // 节点右键菜单扩展
  // ──────────────────────────────────────────────

  const contextMenuActions: MindMapNodeContextMenuSlot[] = [
    {
      id: 'spawn-subagent',
      label: 'Spawn Subagent Here',
      icon: 'bot',
      kinds: ['issue', 'pr', 'research'],
      action: async (node, api) => {
        await api.spawnSubagentForNode(node.id)
      },
    },
    {
      id: 'create-child-issue',
      label: 'Create Child Issue',
      icon: 'git-issue',
      kinds: ['issue', 'meta'],
      action: async (node, api) => {
        const childId = await api.createNode({
          kind: 'issue',
          title: `Sub-issue: ${node.title}`,
          position: { x: node.position.x + 300, y: node.position.y + 100 },
          parentIds: [node.id],
          edgeTypes: ['derives_from'],
        })
        await api.createEdge(node.id, childId, 'derives_from')
      },
    },
    {
      id: 'create-pr',
      label: 'Create PR from Issue',
      icon: 'git-pull-request',
      kinds: ['issue'],
      action: async (node, api) => {
        const prId = await api.createNode({
          kind: 'pr',
          title: `PR: ${node.title}`,
          position: { x: node.position.x + 300, y: node.position.y },
          parentIds: [node.id],
          edgeTypes: ['derives_from'],
        })
        await api.createEdge(node.id, prId, 'derives_from')
      },
    },
    {
      id: 'create-decision',
      label: 'Record Decision',
      icon: 'book-open',
      action: async (node, api) => {
        const decisionId = await api.createNode({
          kind: 'decision',
          title: `Decision: ${node.title}`,
          position: { x: node.position.x + 200, y: node.position.y + 200 },
          parentIds: [node.id],
          edgeTypes: ['relates_to'],
        })
        await api.createEdge(node.id, decisionId, 'relates_to')
      },
    },
    {
      id: 'create-test',
      label: 'Add Test',
      icon: 'beaker',
      kinds: ['pr'],
      action: async (node, api) => {
        const testId = await api.createNode({
          kind: 'test',
          title: `Test: ${node.title}`,
          position: { x: node.position.x + 200, y: node.position.y + 200 },
          parentIds: [node.id],
          edgeTypes: ['tests'],
        })
        await api.createEdge(testId, node.id, 'tests')
      },
    },
    {
      id: 'link-to-goal',
      label: 'Link to Goal',
      icon: 'target',
      action: async (node, api) => {
        // TODO: 显示 Goal 选择器
        const goalId = prompt('Enter Goal ID:')
        if (goalId) await api.linkNodeToGoal(node.id, goalId)
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      action: async (node, api) => {
        await api.duplicateNode(node.id)
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      dangerous: true,
      action: async (node, api) => {
        if (confirm(`Delete "${node.title}" and all connected edges?`)) {
          await api.deleteNode(node.id)
        }
      },
    },
  ]

  contextMenuActions.forEach((action) => {
    registerSlot(ctx, 'mindmap.node.contextmenu', action as unknown as SlotOptions, null as unknown as React.ComponentType)
  })

  // ──────────────────────────────────────────────
  // 节点悬浮详情
  // ──────────────────────────────────────────────

  registerSlot(ctx, 'mindmap.node.hover', {
    id: 'default-hover',
  }, MindMapNodeHoverCard as unknown as React.ComponentType)

  // ──────────────────────────────────────────────
  // 边渲染器
  // ──────────────────────────────────────────────

  const edgeTypes: EdgeType[] = ['derives_from', 'blocks', 'duplicates', 'relates_to', 'fixes', 'tests', 'depends_on']

  edgeTypes.forEach((type) => {
    registerSlot(ctx, 'mindmap.edge.renderer', {
      id: `mindmap.edge.${type}` as MindMapEdgeRendererSlot['id'],
      type,
    }, MindMapEdgeComponent as unknown as React.ComponentType)
  })

  // ──────────────────────────────────────────────
  // 工具栏动作
  // ──────────────────────────────────────────────

  const toolbarActions: MindMapToolbarActionSlot[] = [
    {
      id: 'fit-view',
      label: 'Fit View',
      icon: 'zoom-in',
      group: 'left',
      order: 10,
      onClick: (api) => api.fitView(),
    },
    {
      id: 'auto-layout',
      label: 'Auto Layout',
      icon: 'layout',
      group: 'left',
      order: 20,
      onClick: (api) => api.applyLayout({ algorithm: 'hierarchical' }),
    },
    {
      id: 'undo',
      label: 'Undo',
      icon: 'undo',
      group: 'left',
      order: 30,
      disabledWhen: (api) => !api.canUndo(),
      onClick: (api) => api.undo(),
    },
    {
      id: 'redo',
      label: 'Redo',
      icon: 'redo',
      group: 'left',
      order: 40,
      disabledWhen: (api) => !api.canRedo(),
      onClick: (api) => api.redo(),
    },
    {
      id: 'new-issue',
      label: 'New Issue',
      icon: 'plus',
      group: 'center',
      order: 10,
      onClick: (api) => {
        const viewport = api.viewport
        const center = { x: -viewport.x / viewport.zoom + window.innerWidth / 2 / viewport.zoom, y: -viewport.y / viewport.zoom + window.innerHeight / 2 / viewport.zoom }
        api.createNode({ kind: 'issue', title: 'New Issue', position: center })
      },
    },
    {
      id: 'new-pr',
      label: 'New PR',
      icon: 'git-pull-request',
      group: 'center',
      order: 20,
      onClick: (api) => {
        const viewport = api.viewport
        const center = { x: -viewport.x / viewport.zoom + window.innerWidth / 2 / viewport.zoom, y: -viewport.y / viewport.zoom + window.innerHeight / 2 / viewport.zoom }
        api.createNode({ kind: 'pr', title: 'New PR', position: center })
      },
    },
    {
      id: 'export-json',
      label: 'Export JSON',
      icon: 'download',
      group: 'right',
      order: 10,
      onClick: async (api) => {
        const blob = await api.exportCanvas('json')
        downloadBlob(blob, 'mindmap.json')
      },
    },
    {
      id: 'export-mermaid',
      label: 'Export Mermaid',
      icon: 'code',
      group: 'right',
      order: 20,
      onClick: async (api) => {
        const blob = await api.exportCanvas('mermaid')
        downloadBlob(blob, 'mindmap.mmd')
      },
    },
    {
      id: 'export-plantuml',
      label: 'Export PlantUML',
      icon: 'code',
      group: 'right',
      order: 30,
      onClick: async (api) => {
        const blob = await api.exportCanvas('plantuml')
        downloadBlob(blob, 'mindmap.puml')
      },
    },
    {
      id: 'import',
      label: 'Import',
      icon: 'upload',
      group: 'right',
      order: 40,
      onClick: (api) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,.mmd,.graphml'
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) {
            const format = file.name.endsWith('.json') ? 'json' :
              file.name.endsWith('.mmd') ? 'mermaid' : 'graphml'
            if (format === 'json' || format === 'mermaid' || format === 'graphml') {
              await api.importCanvas(file, format)
            }
          }
        }
        input.click()
      },
    },
  ]

  toolbarActions.forEach((action) => {
    registerSlot(ctx, 'mindmap.toolbar.action', action as unknown as SlotOptions, null as unknown as React.ComponentType)
  })

  // ──────────────────────────────────────────────
  // 命令面板扩展
  // ──────────────────────────────────────────────

  registerSlot(ctx, 'command', {
    id: 'mindmap:new-issue',
    title: 'Mind-Map: Create New Issue',
    icon: 'git-issue',
    action: () => {
      const api = getCanvasApi()
      const viewport = api.viewport
      const center = { x: -viewport.x / viewport.zoom + window.innerWidth / 2 / viewport.zoom, y: -viewport.y / viewport.zoom + window.innerHeight / 2 / viewport.zoom }
      api.createNode({ kind: 'issue', title: 'New Issue', position: center })
    },
  }, null as unknown as React.ComponentType)

  registerSlot(ctx, 'command', {
    id: 'mindmap:new-pr',
    title: 'Mind-Map: Create New PR',
    icon: 'git-pull-request',
    action: () => {
      const api = getCanvasApi()
      const viewport = api.viewport
      const center = { x: -viewport.x / viewport.zoom + window.innerWidth / 2 / viewport.zoom, y: -viewport.y / viewport.zoom + window.innerHeight / 2 / viewport.zoom }
      api.createNode({ kind: 'pr', title: 'New PR', position: center })
    },
  }, null as unknown as React.ComponentType)

  registerSlot(ctx, 'command', {
    id: 'mindmap:auto-layout',
    title: 'Mind-Map: Apply Auto Layout',
    icon: 'layout',
    action: () => getCanvasApi().applyLayout(),
  }, null as unknown as React.ComponentType)

  registerSlot(ctx, 'command', {
    id: 'mindmap:fit-view',
    title: 'Mind-Map: Fit View',
    icon: 'zoom-in',
    action: () => getCanvasApi().fitView(),
  }, null as unknown as React.ComponentType)

  registerSlot(ctx, 'command', {
    id: 'mindmap:export',
    title: 'Mind-Map: Export Canvas',
    icon: 'download',
    action: async () => {
      const api = getCanvasApi()
      const format = await selectExportFormat()
      if (format) {
        const blob = await api.exportCanvas(format)
        downloadBlob(blob, `mindmap.${format === 'json' ? 'json' : format}`)
      }
    },
  }, null as unknown as React.ComponentType)

  // ──────────────────────────────────────────────
  // 会话生命周期集成
  // ──────────────────────────────────────────────

  const on = ctx.on as unknown as (event: string, handler: (payload: unknown) => void) => void
  on('session/created', async (payload) => {
    // 新会话创建时初始化 MindMap
    const sessionId = (payload as { sessionId?: string } | undefined)?.sessionId ?? ''
    const bridge = ctx.mindmapBridge
    if (bridge) {
      // 可选：从模板创建初始节点
      void sessionId
    }
  })

  on('session/closed', (payload) => {
    // 会话关闭时清理
    void payload
  })

  // ──────────────────────────────────────────────
  // 辅助函数
  // ──────────────────────────────────────────────

  function getCanvasApi(): MindMapCanvasApi {
    // 在实际使用中，这应该从 React context 获取
    // 这里返回 store 的方法作为简化版 (对外参数为 string，内部为 ULID)
    const s = useMindMapStore.getState()
    return {
      sessionId: s.sessionId,
      nodes: s.nodes,
      edges: s.edges,
      viewport: s.viewport,
      selection: s.selection,
      createNode: s.createNode,
      updateNode: (nodeId: string, patch) => s.updateNode(nodeId as ULID, patch),
      deleteNode: (nodeId: string) => s.deleteNode(nodeId as ULID),
      duplicateNode: (nodeId: string, offset) => s.duplicateNode(nodeId as ULID, offset),
      createEdge: (sourceId: string, targetId: string, type) => s.createEdge(sourceId as ULID, targetId as ULID, type),
      updateEdge: (edgeId: string, patch) => s.updateEdge(edgeId as ULID, patch),
      deleteEdge: (edgeId: string) => s.deleteEdge(edgeId as ULID),
      batch: s.batch,
      setSelection: (nodeIds: string[], replace) => s.setSelection(nodeIds.map((id) => id as ULID), replace),
      setViewport: s.setViewport,
      fitView: (nodeIds?: string[], padding?: number) => s.fitView(nodeIds?.map((id) => id as ULID), padding),
      centerOn: (nodeId: string) => s.centerOn(nodeId as ULID),
      applyLayout: s.applyLayout,
      autoArrange: (nodeIds?: string[]) => s.autoArrange(nodeIds?.map((id) => id as ULID)),
      search: s.search,
      setFilter: s.setSearchQuery,
      clearFilter: s.clearFilter,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      jumpToHistory: s.jumpToHistory,
      openNodeSession: (nodeId: string) => s.openNodeSession(nodeId as ULID),
      spawnSubagentForNode: (nodeId: string, config) => s.spawnSubagentForNode(nodeId as ULID, config),
      linkNodeToGoal: (nodeId: string, goalId) => s.linkNodeToGoal(nodeId as ULID, goalId),
      attachFilesToNode: (nodeId: string, files) => s.attachFilesToNode(nodeId as ULID, files),
      exportCanvas: s.exportCanvas,
      importCanvas: s.importCanvas,
      inviteCollaborator: s.inviteCollaborator,
      shareLink: s.shareLink,
    }
  }

  async function selectExportFormat(): Promise<'json' | 'mermaid' | 'plantuml' | 'graphml' | 'png' | 'svg' | null> {
    // 简化版，实际应该用 Modal
    const format = prompt('Export format (json/mermaid/plantuml/graphml/png/svg):')
    if (format && ['json', 'mermaid', 'plantuml', 'graphml', 'png', 'svg'].includes(format)) {
      return format as any
    }
    return null
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}

// ──────────────────────────────────────────────
// 历史面板组件
// ──────────────────────────────────────────────

function MindMapHistoryPanel(_: { sessionId: string }) {
  const { past, jumpToHistory, canUndo, canRedo, undo, redo } = useMindMapStore()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={undo} disabled={!canUndo()} style={btnStyle}>↶ Undo</button>
        <button onClick={redo} disabled={!canRedo()} style={btnStyle}>↷ Redo</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid #334155', borderRadius: 6 }}>
        {past.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No history yet</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {past.map((entry: HistoryEntry, index: number) => (
              <li
                key={entry.id}
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #1e293b',
                  cursor: 'pointer',
                  background: index === past.length - 1 ? '#3B82F622' : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
                onClick={() => jumpToHistory(index)}
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

const btnStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, background: '#1e293b', border: '1px solid #334155',
  borderRadius: 4, color: '#e2e8f0', cursor: 'pointer', opacity: 1,
}

// ──────────────────────────────────────────────
// 节点悬浮卡片
// ──────────────────────────────────────────────

function MindMapNodeHoverCard({ node, onOpenSession, onCopyNode, onSpawnSubagent }: any) {
  return (
    <div style={{
      position: 'fixed', zIndex: 1000, pointerEvents: 'none',
      background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
      padding: 12, minWidth: 280, maxWidth: 400, boxShadow: '0 8px 24px #0008'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: 4, background: node.color }} />
        <strong style={{ color: '#e2e8f0' }}>{node.title}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>{node.kind}</span>
      </div>
      {node.body && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5 }}>{node.body}</div>
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {node.labels.map((l: string) => (
          <span key={l} style={{ fontSize: 10, background: '#1e293b', padding: '1px 6px', borderRadius: 9999 }}>{l}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, fontSize: 11, color: '#64748b' }}>
        {node.toolCalls.length > 0 && <span>⚙️ {node.toolCalls.length} tools</span>}
        {node.approvals.length > 0 && <span>✅ {node.approvals.length} approvals</span>}
        {node.files.length > 0 && <span>📁 {node.files.length} files</span>}
        {node.sessionId && <span>💬 Session</span>}
        {node.goalId && <span>🎯 Goal</span>}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e293b' }}>
        <button onClick={onOpenSession} style={hoverBtn}>Open Session</button>
        <button onClick={onSpawnSubagent} style={hoverBtn}>Spawn Agent</button>
        <button onClick={onCopyNode} style={hoverBtn}>Copy</button>
      </div>
    </div>
  )
}

const hoverBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, background: '#1e293b', border: '1px solid #334155',
  borderRadius: 4, color: '#e2e8f0', cursor: 'pointer',
}

// ──────────────────────────────────────────────
// 导出
// ──────────────────────────────────────────────

export { MindMapCanvas, MindMapOutline, MindMapSearch } from './canvas/MindMapCanvas.tsx'
export { useMindMapStore } from './store/mindmap.ts'
export { MindMapBridge } from './integration/sessionBridge.ts'
export * from './contract/types.ts'
export * from './contract/slots.ts'