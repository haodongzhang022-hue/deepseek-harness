/**
 * Mind-Map Store Tests
 * @module @deepseek-ai/dsh-client-ui-mindmap/store/mindmap.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMindMapStore } from './mindmap.ts'
import type { MindMapNode, ULID } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 测试工具
// ──────────────────────────────────────────────

const resetStore = () => {
  useMindMapStore.getState().reset()
  useMindMapStore.getState().initialize('test-session')
}

const createTestNode = (overrides: Partial<MindMapNode> = {}): MindMapNode => ({
  id: `01ARZ3NDEKTSV4RRFFQ69G5FAV` as ULID,
  kind: 'issue',
  title: 'Test Issue',
  body: 'Test body',
  status: 'open',
  labels: [],
  toolCalls: [],
  approvals: [],
  files: [],
  snapshots: [],
  parentIds: [],
  childIds: [],
  edgeTypes: [],
  position: { x: 100, y: 100 },
  collapsed: false,
  pinned: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: { type: 'human', id: 'test-user' },
  version: 1,
  ...overrides,
})

// ──────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────

describe('MindMap Store', () => {
  beforeEach(() => {
    resetStore()
    vi.useFakeTimers()
  })

  // ──────────────────────────────────────────────
  // 节点 CRUD
  // ──────────────────────────────────────────────

  describe('Node CRUD', () => {
    it('should create a node', async () => {
      const nodeId = await useMindMapStore.getState().createNode({
        kind: 'issue',
        title: 'New Issue',
        position: { x: 100, y: 100 },
      })

      const node = useMindMapStore.getState().nodes.get(nodeId)
      expect(node).toBeDefined()
      expect(node?.title).toBe('New Issue')
      expect(node?.kind).toBe('issue')
      expect(node?.status).toBe('open')
    })

    it('should update a node', async () => {
      const nodeId = await useMindMapStore.getState().createNode({
        kind: 'issue',
        title: 'Original',
        position: { x: 0, y: 0 },
      })

      await useMindMapStore.getState().updateNode(nodeId, { title: 'Updated', status: 'in_progress' })

      const node = useMindMapStore.getState().nodes.get(nodeId)
      expect(node?.title).toBe('Updated')
      expect(node?.status).toBe('in_progress')
      expect(node?.version).toBe(2)
    })

    it('should delete a node', async () => {
      const nodeId = await useMindMapStore.getState().createNode({
        kind: 'issue',
        title: 'To Delete',
        position: { x: 0, y: 0 },
      })

      await useMindMapStore.getState().deleteNode(nodeId)

      expect(useMindMapStore.getState().nodes.has(nodeId)).toBe(false)
    })

    it('should duplicate a node', async () => {
      const nodeId = await useMindMapStore.getState().createNode({
        kind: 'pr',
        title: 'Original PR',
        position: { x: 100, y: 100 },
      })

      const newId = await useMindMapStore.getState().duplicateNode(nodeId)

      const duplicate = useMindMapStore.getState().nodes.get(newId as ULID)

      expect(duplicate).toBeDefined()
      expect(duplicate?.title).toBe('Original PR (copy)')
      expect(duplicate?.id).not.toBe(nodeId)
      expect(duplicate?.position.x).toBe(140)
      expect(duplicate?.position.y).toBe(140)
    })
  })

  // ──────────────────────────────────────────────
  // 边 CRUD
  // ──────────────────────────────────────────────

  describe('Edge CRUD', () => {
    it('should create an edge between two nodes', async () => {
      const sourceId = await useMindMapStore.getState().createNode({
        kind: 'issue',
        title: 'Parent',
        position: { x: 0, y: 0 },
      })

      const targetId = await useMindMapStore.getState().createNode({
        kind: 'pr',
        title: 'Child',
        position: { x: 300, y: 0 },
      })

      const edgeId = await useMindMapStore.getState().createEdge(sourceId, targetId, 'derives_from')

      const edge = useMindMapStore.getState().edges.get(edgeId as ULID)
      expect(edge).toBeDefined()
      expect(edge?.sourceId).toBe(sourceId)
      expect(edge?.targetId).toBe(targetId)
      expect(edge?.type).toBe('derives_from')

      // 检查节点拓扑更新
      const source = useMindMapStore.getState().nodes.get(sourceId)
      const target = useMindMapStore.getState().nodes.get(targetId)
      expect(source?.childIds).toContain(targetId)
      expect(target?.parentIds).toContain(sourceId)
    })

    it('should not create self-loop edge', async () => {
      const nodeId = await useMindMapStore.getState().createNode({
        kind: 'issue',
        title: 'Node',
        position: { x: 0, y: 0 },
      })

      const edgeId = await useMindMapStore.getState().createEdge(nodeId, nodeId, 'derives_from')
      expect(edgeId).toBe('')
    })

    it('should delete an edge and update topology', async () => {
      const sourceId = await useMindMapStore.getState().createNode({
        kind: 'issue',
        title: 'Parent',
        position: { x: 0, y: 0 },
      })

      const targetId = await useMindMapStore.getState().createNode({
        kind: 'pr',
        title: 'Child',
        position: { x: 300, y: 0 },
      })

      const edgeId = await useMindMapStore.getState().createEdge(sourceId, targetId, 'derives_from')
      await useMindMapStore.getState().deleteEdge(edgeId as ULID)

      expect(useMindMapStore.getState().edges.has(edgeId as ULID)).toBe(false)

      const source = useMindMapStore.getState().nodes.get(sourceId)
      const target = useMindMapStore.getState().nodes.get(targetId)
      expect(source?.childIds).not.toContain(targetId)
      expect(target?.parentIds).not.toContain(sourceId)
    })
  })

  // ──────────────────────────────────────────────
  // 选择与视口
  // ──────────────────────────────────────────────

  describe('Selection & Viewport', () => {
    it('should manage selection', async () => {
      const id1 = await useMindMapStore.getState().createNode({ kind: 'issue', title: '1', position: { x: 0, y: 0 } })
      const id2 = await useMindMapStore.getState().createNode({ kind: 'pr', title: '2', position: { x: 100, y: 0 } })

      useMindMapStore.getState().setSelection([id1, id2])
      expect(useMindMapStore.getState().selection.size).toBe(2)

      useMindMapStore.getState().setSelection([id1], false) // add
      expect(useMindMapStore.getState().selection.size).toBe(2)

      useMindMapStore.getState().setSelection([id1], true) // replace
      expect(useMindMapStore.getState().selection.size).toBe(1)
      expect(useMindMapStore.getState().selection.has(id1)).toBe(true)
    })

    it('should update viewport', () => {
      useMindMapStore.getState().setViewport({ x: 100, y: 200, zoom: 1.5 })
      const vp = useMindMapStore.getState().viewport
      expect(vp.x).toBe(100)
      expect(vp.y).toBe(200)
      expect(vp.zoom).toBe(1.5)
    })
  })

  // ──────────────────────────────────────────────
  // 搜索与筛选
  // ──────────────────────────────────────────────

  describe('Search & Filter', () => {
    beforeEach(async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Bug: Login fails', labels: ['bug', 'auth'], position: { x: 0, y: 0 } })
      await useMindMapStore.getState().createNode({ kind: 'pr', title: 'Fix login', labels: ['fix', 'auth'], position: { x: 300, y: 0 } })
      await useMindMapStore.getState().createNode({ kind: 'test', title: 'Login test', labels: ['test'], position: { x: 600, y: 0 } })
    })

    it('should filter by text', () => {
      useMindMapStore.getState().setSearchQuery({ text: 'login' })
      const matched = useMindMapStore.getState().matchedNodeIds
      expect(matched.size).toBe(3) // "Bug: Login fails", "Fix login", "Login test"
    })

    it('should filter by kind', () => {
      useMindMapStore.getState().setSearchQuery({ kinds: ['issue'] })
      const matched = useMindMapStore.getState().matchedNodeIds
      expect(matched.size).toBe(1)
    })

    it('should filter by labels', () => {
      useMindMapStore.getState().setSearchQuery({ labels: ['auth'] })
      const matched = useMindMapStore.getState().matchedNodeIds
      expect(matched.size).toBe(2)
    })

    it('should combine filters', () => {
      useMindMapStore.getState().setSearchQuery({ text: 'login', kinds: ['pr'] })
      const matched = useMindMapStore.getState().matchedNodeIds
      expect(matched.size).toBe(1) // only "Fix login" PR
    })

    it('should clear filter', () => {
      useMindMapStore.getState().setSearchQuery({ text: 'login' })
      useMindMapStore.getState().clearFilter()
      expect(useMindMapStore.getState().searchQuery).toEqual({})
      expect(useMindMapStore.getState().matchedNodeIds.size).toBe(0)
    })
  })

  // ──────────────────────────────────────────────
  // 历史/撤销重做
  // ──────────────────────────────────────────────

  describe('History / Undo-Redo', () => {
    it('should track history on node creation', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Test', position: { x: 0, y: 0 } })
      expect(useMindMapStore.getState().past.length).toBe(1)
      expect(useMindMapStore.getState().canUndo()).toBe(true)
    })

    it('should undo node creation', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Test', position: { x: 0, y: 0 } })
      expect(useMindMapStore.getState().nodes.size).toBe(1)

      await useMindMapStore.getState().undo()
      expect(useMindMapStore.getState().nodes.size).toBe(0)
      expect(useMindMapStore.getState().canRedo()).toBe(true)
    })

    it('should redo after undo', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Test', position: { x: 0, y: 0 } })
      await useMindMapStore.getState().undo()
      await useMindMapStore.getState().redo()

      expect(useMindMapStore.getState().nodes.size).toBe(1)
      expect(useMindMapStore.getState().canUndo()).toBe(true)
      expect(useMindMapStore.getState().canRedo()).toBe(false)
    })

    it('should clear redo stack on new action', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: '1', position: { x: 0, y: 0 } })
      await useMindMapStore.getState().undo()
      await useMindMapStore.getState().createNode({ kind: 'pr', title: '2', position: { x: 100, y: 0 } })

      expect(useMindMapStore.getState().canRedo()).toBe(false)
    })
  })

  // ──────────────────────────────────────────────
  // 批量操作
  // ──────────────────────────────────────────────

  describe('Batch Operations', () => {
    it('should execute multiple mutations atomically', async () => {
      const mutations = [
        { op: 'upsert_node' as const, node: createTestNode({ id: '1' as ULID, title: 'Batch 1', position: { x: 0, y: 0 } }) },
        { op: 'upsert_node' as const, node: createTestNode({ id: '2' as ULID, title: 'Batch 2', position: { x: 100, y: 0 } }) },
        { op: 'upsert_edge' as const, edge: { id: 'e1' as ULID, sourceId: '1' as ULID, targetId: '2' as ULID, type: 'derives_from' as const, createdAt: Date.now(), createdBy: { type: 'human' as const, id: 'test' } } },
      ]

      await useMindMapStore.getState().batch(mutations)

      expect(useMindMapStore.getState().nodes.size).toBe(2)
      expect(useMindMapStore.getState().edges.size).toBe(1)
      expect(useMindMapStore.getState().past.length).toBe(1) // single history entry
    })
  })

  // ──────────────────────────────────────────────
  // 计算属性
  // ──────────────────────────────────────────────

  describe('Computed Properties', () => {
    it('should get root nodes', async () => {
      const rootId = await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Root', position: { x: 0, y: 0 } })
      const childId = await useMindMapStore.getState().createNode({ kind: 'pr', title: 'Child', position: { x: 300, y: 0 } })
      await useMindMapStore.getState().createEdge(rootId, childId, 'derives_from')

      const roots = useMindMapStore.getState().getRootNodes()
      expect(roots.length).toBe(1)
      expect(roots[0]!.id).toBe(rootId)
    })

    it('should get leaf nodes', async () => {
      const rootId = await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Root', position: { x: 0, y: 0 } })
      const childId = await useMindMapStore.getState().createNode({ kind: 'pr', title: 'Child', position: { x: 300, y: 0 } })
      await useMindMapStore.getState().createEdge(rootId, childId, 'derives_from')

      const leaves = useMindMapStore.getState().getLeafNodes()
      expect(leaves.length).toBe(1)
      expect(leaves[0]!.id).toBe(childId)
    })

    it('should get nodes by kind', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Issue 1', position: { x: 0, y: 0 } })
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Issue 2', position: { x: 100, y: 0 } })
      await useMindMapStore.getState().createNode({ kind: 'pr', title: 'PR 1', position: { x: 200, y: 0 } })

      const issues = useMindMapStore.getState().getNodesByKind('issue')
      const prs = useMindMapStore.getState().getNodesByKind('pr')

      expect(issues.length).toBe(2)
      expect(prs.length).toBe(1)
    })
  })

  // ──────────────────────────────────────────────
  // 导入导出
  // ──────────────────────────────────────────────

  describe('Import/Export', () => {
    it('should export to JSON', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Test', position: { x: 0, y: 0 } })

      const blob = await useMindMapStore.getState().exportCanvas('json')
      const text = await blob.text()
      const data = JSON.parse(text)

      expect(data.nodes.length).toBe(1)
      expect(data.nodes[0].title).toBe('Test')
      expect(data.edges.length).toBe(0)
      expect(data.viewport).toBeDefined()
    })

    it('should export to Mermaid', async () => {
      await useMindMapStore.getState().createNode({ kind: 'issue', title: 'Test', position: { x: 0, y: 0 } })

      const blob = await useMindMapStore.getState().exportCanvas('mermaid')
      const text = await blob.text()

      expect(text).toContain('graph TD')
      expect(text).toContain('Test')
    })

    it('should import from JSON', async () => {
      const data = {
        nodes: [createTestNode({ id: 'imported' as ULID, title: 'Imported' })],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      await useMindMapStore.getState().importCanvas(blob, 'json')

      expect(useMindMapStore.getState().nodes.size).toBe(1)
      expect(useMindMapStore.getState().nodes.get('imported' as ULID)?.title).toBe('Imported')
    })
  })
})
