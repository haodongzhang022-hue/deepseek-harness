/**
 * Layout Engine Tests
 * @module @deepseek-ai/dsh-client-ui-mindmap/canvas/layout.test
 */

import { describe, it, expect } from 'vitest'
import { computeLayout } from './layout.ts'
import type { MindMapNode, MindMapEdge, ULID } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 测试工具
// ──────────────────────────────────────────────

const makeNode = (id: string, kind: MindMapNode['kind'] = 'issue'): MindMapNode => ({
  id: id as ULID,
  kind,
  title: `Node ${id}`,
  body: '',
  status: 'open',
  labels: [],
  toolCalls: [],
  approvals: [],
  files: [],
  snapshots: [],
  parentIds: [],
  childIds: [],
  edgeTypes: [],
  position: { x: 0, y: 0 },
  collapsed: false,
  pinned: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: { type: 'human', id: 'test' },
  version: 1,
})

const makeEdge = (source: string, target: string, type: MindMapEdge['type'] = 'derives_from'): MindMapEdge => ({
  id: `${source}-${target}` as ULID,
  sourceId: source as ULID,
  targetId: target as ULID,
  type,
  createdAt: Date.now(),
  createdBy: { type: 'human', id: 'test' },
})

// ──────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────

describe('Layout Engine', () => {
  it('should compute hierarchical layout', () => {
    const nodes = [makeNode('1'), makeNode('2'), makeNode('3')]
    const edges = [makeEdge('1', '2'), makeEdge('1', '3')]

    const result = computeLayout(nodes, edges, {
      algorithm: 'hierarchical', direction: 'TB', nodeSep: 200, rankSep: 150, animate: false, fitView: false, center: false,
    })

    expect(result.length).toBe(3)
    // 根节点在顶层 (y=0)
    const root = result.find(r => r.id === '1')!
    expect(root.position.y).toBe(0)
    // 子节点在下一层 (y=150)
    const child2 = result.find(r => r.id === '2')!
    expect(child2.position.y).toBe(150)
  })

  it('should compute grid layout', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => makeNode(String(i + 1)))
    const result = computeLayout(nodes, [], {
      algorithm: 'grid', nodeSep: 200, animate: false, fitView: false, center: false,
    })
    expect(result.length).toBe(9)
    // 3x3 网格 (居中: 行号 0..2 → y = -200/0/200)
    expect(result[0]!.position.x).toBe(-200) // col 0
    expect(result[1]!.position.x).toBe(0)    // col 1
    expect(result[2]!.position.x).toBe(200)  // col 2
    expect(result[3]!.position.y).toBe(0)    // row 1
    expect(result[6]!.position.y).toBe(200)  // row 2
  })

  it('should handle disconnected nodes in hierarchical layout', () => {
    const nodes = [makeNode('1'), makeNode('2'), makeNode('3')]
    const edges: MindMapEdge[] = [] // 无连接

    const result = computeLayout(nodes, edges, {
      algorithm: 'hierarchical', direction: 'TB', nodeSep: 200, rankSep: 150, animate: false, fitView: false, center: false,
    })

    // 所有节点应在第 0 层
    result.forEach(r => expect(r.position.y).toBe(0))
  })

  it('should compute radial layout around meta node', () => {
    const nodes = [makeNode('center', 'meta'), makeNode('a'), makeNode('b'), makeNode('c')]
    const edges = [makeEdge('center', 'a'), makeEdge('center', 'b'), makeEdge('center', 'c')]

    const result = computeLayout(nodes, edges, {
      algorithm: 'radial', nodeSep: 200, animate: false, fitView: false, center: false,
    })

    // 中心节点在原点
    const center = result.find(r => r.id === 'center')!
    expect(center.position.x).toBe(0)
    expect(center.position.y).toBe(0)

    // 子节点在半径 250 处
    const childA = result.find(r => r.id === 'a')!
    const dist = Math.sqrt(childA.position.x ** 2 + childA.position.y ** 2)
    expect(dist).toBeCloseTo(250, 0)
  })

  it('should produce stable layout (deterministic)', () => {
    const nodes = [makeNode('1'), makeNode('2')]
    const edges = [makeEdge('1', '2')]

    const result1 = computeLayout(nodes, edges, {
      algorithm: 'hierarchical', direction: 'TB', nodeSep: 200, rankSep: 150, animate: false, fitView: false, center: false,
    })
    const result2 = computeLayout(nodes, edges, {
      algorithm: 'hierarchical', direction: 'TB', nodeSep: 200, rankSep: 150, animate: false, fitView: false, center: false,
    })

    expect(result1[0]!.position).toEqual(result2[0]!.position)
    expect(result1[1]!.position).toEqual(result2[1]!.position)
  })

  it('should handle empty node list', () => {
    const result = computeLayout([], [], {
      algorithm: 'grid', animate: false, fitView: false, center: false,
    })
    expect(result.length).toBe(0)
  })
})