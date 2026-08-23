/**
 * ResourcePanel - Density heatmap, token trend, and per-window statistics.
 * @module ui-automation-calendar/client/components/ResourcePanel
 */

import { useMemo } from 'react'
import type { AutomationTaskEntry } from '../contract/calendar-model.ts'
import type { GranularityId, TimeRange } from '../contract/time-granularity.ts'
import { computeDensityBuckets, aggregateTokenUsage, formatResourceValue } from '../engine/resource-aggregator.ts'
import css from './ResourcePanel.module.css'

interface ResourcePanelProps {
  tasks: readonly AutomationTaskEntry[]
  timeRange: TimeRange
  granularity: GranularityId
  selectedResourceId: string
  onResourceSelect?: (id: string) => void
}

/** Heatmap fill interpolates low→high intensity over the token scale. */
function heatColor(intensity: number): string {
  // Two-stop blend between the theme's bg-active and text-primary tokens.
  const alpha = Math.min(Math.max(intensity, 0), 1)
  return `color-mix(in srgb, var(--dsw-text-primary) ${Math.round(alpha * 85)}%, transparent)`
}

export function ResourcePanel({ tasks, timeRange, granularity }: ResourcePanelProps) {
  const density = useMemo(
    () => computeDensityBuckets(tasks, timeRange, granularity),
    [tasks, timeRange.start, timeRange.end, granularity],
  )

  const trend = useMemo(
    () => aggregateTokenUsage(tasks, timeRange, granularity),
    [tasks, timeRange.start, timeRange.end, granularity],
  )

  const maxTrend = Math.max(...trend.map(p => p.usage.total), 1)
  const totalTokens = tasks.reduce((sum, t) => sum + (t.resources.tokenUsage?.total ?? 0), 0)
  const totalDuration = tasks.reduce((sum, t) => sum + t.resources.durationMs, 0)

  return (
    <div className={css.panel}>
      <div className={css.title}>📊 资源密度</div>

      <div className={css.heatmap}>
        {density.map(bucket => (
          <div
            key={bucket.slot.start}
            className={css.heatCell}
            style={{ background: heatColor(bucket.resourceIntensity) }}
            title={[
              new Date(bucket.slot.start).toLocaleString(),
              `任务数: ${bucket.totalTasks}`,
              bucket.tokenUsage !== undefined ? `Tokens: ${formatResourceValue(bucket.tokenUsage, 'token')}` : null,
            ].filter(Boolean).join('\n')}
          />
        ))}
      </div>

      <div className={css.chart}>
        {trend.map(point => (
          <div
            key={point.timestamp}
            className={css.bar}
            style={{ height: `${(point.usage.total / maxTrend) * 100}%` }}
            title={`${new Date(point.timestamp).toLocaleTimeString()} · ${formatResourceValue(point.usage.total, 'token')} tok`}
          />
        ))}
      </div>

      <div className={css.stats}>
        <div className={css.statRow}>
          <span className={css.statName}>Token总量</span>
          <span className={css.statValue}>{formatResourceValue(totalTokens, 'token')}</span>
        </div>
        <div className={css.statRow}>
          <span className={css.statName}>总时长</span>
          <span className={css.statValue}>{formatResourceValue(totalDuration, 'duration')}</span>
        </div>
      </div>
    </div>
  )
}
