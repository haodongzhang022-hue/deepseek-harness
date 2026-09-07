/**
 * Mind-Map Layout Engine
 * Hierarchical (dagre), Force-directed (d3-force), Radial, Grid layouts
 * @module @deepseek-ai/dsh-client-ui-mindmap/canvas/layout
 */

import type { MindMapNode, MindMapEdge, LayoutOptions, LayoutAlgorithm, ULID } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 布局结果类型
// ──────────────────────────────────────────────

export interface LayoutResult {
  id: ULID
  position: { x: number; y: number }
}

// ──────────────────────────────────────────────
// 主布局函数 (分发到具体算法)
// ──────────────────────────────────────────────

export function computeLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  options: LayoutOptions
): LayoutResult[] {
  switch (options.algorithm) {
    case 'hierarchical':
    case 'dagre':
      return hierarchicalLayout(nodes, edges, options)
    case 'force':
      return forceLayout(nodes, edges, options)
    case 'radial':
      return radialLayout(nodes, edges, options)
    case 'grid':
      return gridLayout(nodes, options)
    default:
      return gridLayout(nodes, options)
  }
}

// ──────────────────────────────────────────────
// 层次布局 (Sugiyama-style BFS)
// ──────────────────────────────────────────────

function hierarchicalLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  options: LayoutOptions
): LayoutResult[] {
  const childrenMap = new Map<ULID, ULID[]>()
  const parentsMap = new Map<ULID, ULID[]>()

  // 构建邻接表 (仅 derives_from 边)
  edges.forEach((e) => {
    if (e.type === 'derives_from') {
      if (!childrenMap.has(e.sourceId)) childrenMap.set(e.sourceId, [])
      childrenMap.get(e.sourceId)!.push(e.targetId)
      if (!parentsMap.has(e.targetId)) parentsMap.set(e.targetId, [])
      parentsMap.get(e.targetId)!.push(e.sourceId)
    }
  })

  // 找根节点 (无父节点)
  const roots = nodes.filter((n) => !parentsMap.has(n.id) || parentsMap.get(n.id)!.length === 0)

  const result = new Map<ULID, { x: number; y: number }>()
  const visited = new Set<ULID>()
  const sep = options.nodeSep || 240
  const rankSep = options.rankSep || 160

  // BFS 分配层级
  const rank = new Map<ULID, number>()
  const queue: ULID[] = []

  roots.forEach((r) => {
    rank.set(r.id, 0)
    queue.push(r.id)
  })

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    const kids = childrenMap.get(current) || []
    kids.forEach((kid) => {
      const kidRank = (rank.get(current) || 0) + 1
      if (!rank.has(kid) || kidRank > (rank.get(kid) || 0)) {
        rank.set(kid, kidRank)
      }
      queue.push(kid)
    })
  }

  // 处理未连接节点
  nodes.forEach((n) => {
    if (!rank.has(n.id)) rank.set(n.id, 0)
  })

  // 按层级分组
  const byRank = new Map<number, ULID[]>()
  rank.forEach((r, id) => {
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r)!.push(id)
  })

  // 分配坐标
  const direction = options.direction || 'TB'
  byRank.forEach((ids, r) => {
    const count = ids.length
    ids.forEach((id, i) => {
      if (direction === 'TB' || direction === 'BT') {
        const x = (i - (count - 1) / 2) * sep
        const y = (direction === 'TB' ? r : -r) * rankSep
        result.set(id, { x, y })
      } else {
        const x = (direction === 'LR' ? r : -r) * rankSep
        const y = (i - (count - 1) / 2) * sep
        result.set(id, { x, y })
      }
    })
  })

  // 转换为结果数组
  return nodes.map((n) => ({
    id: n.id,
    position: result.get(n.id) || n.position,
  }))
}

// ──────────────────────────────────────────────
// 力导向布局 (简化版 Fruchterman-Reingold)
// ──────────────────────────────────────────────

function forceLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  options: LayoutOptions
): LayoutResult[] {
  const N = nodes.length
  if (N === 0) return []

  // 初始化随机位置
  const positions = new Map<ULID, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const angle = (i / N) * Math.PI * 2
    const radius = 300 + Math.random() * 200
    positions.set(n.id, {
      x: n.position.x + Math.cos(angle) * radius,
      y: n.position.y + Math.sin(angle) * radius,
    })
  })

  const k = options.linkDistance || 250 // 理想边长
  const iterations = 300
  const area = N * k * k
  const temperature = Math.sqrt(area) / 10
  const cooling = temperature / (iterations + 1)

  // 邻接表
  const adjacency = new Map<ULID, ULID[]>()
  edges.forEach((e) => {
    if (!adjacency.has(e.sourceId)) adjacency.set(e.sourceId, [])
    if (!adjacency.has(e.targetId)) adjacency.set(e.targetId, [])
    adjacency.get(e.sourceId)!.push(e.targetId)
    adjacency.get(e.targetId)!.push(e.sourceId)
  })

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<ULID, { x: number; y: number }>()
    nodes.forEach((n) => disp.set(n.id, { x: 0, y: 0 }))

    // 斥力 (所有节点对)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const ni = nodes[i]!
        const nj = nodes[j]!
        const pi = positions.get(ni.id)!
        const pj = positions.get(nj.id)!
        let dx = pi.x - pj.x
        let dy = pi.y - pj.y
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01
        const force = (k * k) / dist
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        const di = disp.get(ni.id)!
        const dj = disp.get(nj.id)!
        di.x += fx; di.y += fy
        dj.x -= fx; dj.y -= fy
      }
    }

    // 引力 (相邻节点)
    edges.forEach((e) => {
      const pi = positions.get(e.sourceId)
      const pj = positions.get(e.targetId)
      if (!pi || !pj) return
      let dx = pi.x - pj.x
      let dy = pi.y - pj.y
      let dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      const force = (dist * dist) / k
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      const di = disp.get(e.sourceId)!
      const dj = disp.get(e.targetId)!
      di.x -= fx; di.y -= fy
      dj.x += fx; dj.y += fy
    })

    // 应用位移 (受温度限制)
    nodes.forEach((n) => {
      const p = positions.get(n.id)!
      const d = disp.get(n.id)!
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01
      const lim = Math.min(dist, temperature)
      p.x += (d.x / dist) * lim
      p.y += (d.y / dist) * lim
    })

    // 降温
    const t = temperature - cooling * (iter + 1)
    if (t < 0) break
  }

  // 居中
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  positions.forEach((p) => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
  })
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  return nodes.map((n) => {
    const p = positions.get(n.id)!
    return { id: n.id, position: { x: p.x - cx, y: p.y - cy } }
  })
}

// ──────────────────────────────────────────────
// 径向布局 (以 meta 节点为中心)
// ──────────────────────────────────────────────

function radialLayout(
  nodes: MindMapNode[],
  edges: MindMapEdge[],
  options: LayoutOptions
): LayoutResult[] {
  const N = nodes.length
  if (N === 0) return []

  // 找中心节点 (第一个 meta 节点，否则第一个节点)
  const center = nodes.find((n) => n.kind === 'meta') || nodes[0]!
  const centerPos = { x: 0, y: 0 }

  const result = new Map<ULID, { x: number; y: number }>()
  result.set(center.id, centerPos)

  // BFS 分层
  const visited = new Set<ULID>([center.id])
  const queue: ULID[] = [center.id]
  const levelMap = new Map<ULID, number>([[center.id, 0]])

  while (queue.length > 0) {
    const current = queue.shift()!
    const level = levelMap.get(current) || 0
    const neighbors: ULID[] = []

    edges.forEach((e) => {
      if (e.sourceId === current && !visited.has(e.targetId)) neighbors.push(e.targetId)
      if (e.targetId === current && !visited.has(e.sourceId)) neighbors.push(e.sourceId)
    })

    const radius = (level + 1) * (options.linkDistance || 250)
    const angleStep = (Math.PI * 2) / Math.max(neighbors.length, 1)

    neighbors.forEach((nb, i) => {
      if (visited.has(nb)) return
      visited.add(nb)
      const angle = i * angleStep + level * 0.5
      result.set(nb, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      })
      levelMap.set(nb, level + 1)
      queue.push(nb)
    })
  }

  // 未访问节点随机放置
  nodes.forEach((n) => {
    if (!result.has(n.id)) {
      const angle = Math.random() * Math.PI * 2
      const r = 400 + Math.random() * 200
      result.set(n.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    }
  })

  return nodes.map((n) => ({ id: n.id, position: result.get(n.id) || n.position }))
}

// ──────────────────────────────────────────────
// 网格布局
// ──────────────────────────────────────────────

function gridLayout(
  nodes: MindMapNode[],
  options: LayoutOptions
): LayoutResult[] {
  const sep = options.nodeSep || 280
  const perRow = Math.ceil(Math.sqrt(nodes.length)) || 1
  const cols = perRow
  const rows = Math.ceil(nodes.length / perRow)

  return nodes.map((n, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      id: n.id,
      position: {
        x: (col - (cols - 1) / 2) * sep,
        y: (row - (rows - 1) / 2) * sep,
      },
    }
  })
}

// ──────────────────────────────────────────────
// 动画辅助 (在 React Flow 中应用布局)
// ──────────────────────────────────────────────

export function animateLayout(
  currentPositions: Map<ULID, { x: number; y: number }>,
  targetPositions: LayoutResult[],
  duration: number,
  onUpdate: (positions: Map<ULID, { x: number; y: number }>) => void,
  onComplete?: () => void
): () => void {
  const start = performance.now()
  const startPositions = new Map(currentPositions)
  let raf = 0

  const tick = (now: number) => {
    const t = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic

    const interpolated = new Map<ULID, { x: number; y: number }>()
    targetPositions.forEach((tp) => {
      const sp = startPositions.get(tp.id) || tp.position
      interpolated.set(tp.id, {
        x: sp.x + (tp.position.x - sp.x) * eased,
        y: sp.y + (tp.position.y - sp.y) * eased,
      })
    })

    onUpdate(interpolated)

    if (t < 1) {
      raf = requestAnimationFrame(tick)
    } else {
      onComplete?.()
    }
  }

  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

// ──────────────────────────────────────────────
// 布局算法信息
// ──────────────────────────────────────────────

export interface LayoutAlgorithmInfo {
  id: LayoutAlgorithm
  label: string
  description: string
  supportsDirection: boolean
}

export const LAYOUT_ALGORITHMS: LayoutAlgorithmInfo[] = [
  { id: 'hierarchical', label: 'Hierarchical', description: 'Tree layout by derives_from edges', supportsDirection: true },
  { id: 'force', label: 'Force-directed', description: 'Physics-based clustering', supportsDirection: false },
  { id: 'radial', label: 'Radial', description: 'Circular layout around center', supportsDirection: false },
  { id: 'grid', label: 'Grid', description: 'Simple grid arrangement', supportsDirection: false },
  { id: 'dagre', label: 'Dagre', description: 'Optimized hierarchical (lib)', supportsDirection: true },
]