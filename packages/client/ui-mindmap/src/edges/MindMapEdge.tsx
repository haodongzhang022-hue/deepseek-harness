/**
 * Mind-Map Edge Component - Type-aware edge renderer
 * @module @deepseek-ai/dsh-client-ui-mindmap/edges/MindMapEdge
 */

import React from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position } from '@xyflow/react'
import type { MindMapEdge as MindMapEdgeType, EdgeType } from '../contract/types.ts'
import { EDGE_TYPE_STYLES, EDGE_TYPE_LABELS } from '../contract/types.ts'

// ──────────────────────────────────────────────
// 边 Props (运行时由 React Flow 注入；data 从 Record 转回领域类型)
// ──────────────────────────────────────────────

export interface MindMapEdgeProps {
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  markerEnd?: string
  data: MindMapEdgeType
  selected?: boolean
}

// ──────────────────────────────────────────────
// 主边组件
// ──────────────────────────────────────────────

export const MindMapEdge: React.FC<MindMapEdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data: rawData,
  selected,
  markerEnd,
}) => {
  const data = rawData as MindMapEdgeType
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const style = data ? EDGE_TYPE_STYLES[data.type] : { color: '#64748B', width: 2 }
  const label = data?.label || (data ? EDGE_TYPE_LABELS[data.type] : '')

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        style={{
          stroke: selected ? '#fff' : style.color,
          strokeWidth: selected ? style.width + 1 : style.width,
          strokeDasharray: style.dash?.join(','),
          filter: selected ? `drop-shadow(0 0 4px ${style.color})` : 'none',
          transition: 'all 0.15s ease',
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: selected ? style.color : '#0f172a',
              color: selected ? '#fff' : '#94a3b8',
              border: `1px solid ${style.color}66`,
              fontWeight: 500,
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// ──────────────────────────────────────────────
// 边注册表
// ──────────────────────────────────────────────

export const EDGE_COMPONENTS: Partial<Record<EdgeType, React.FC<MindMapEdgeProps>>> = {
  // 所有边类型共用同一渲染器，通过 data.type 区分样式
  derives_from: MindMapEdge,
  blocks: MindMapEdge,
  duplicates: MindMapEdge,
  relates_to: MindMapEdge,
  fixes: MindMapEdge,
  tests: MindMapEdge,
  depends_on: MindMapEdge,
}

export function getEdgeComponent(type: EdgeType): React.FC<MindMapEdgeProps> {
  return EDGE_COMPONENTS[type] || MindMapEdge
}
