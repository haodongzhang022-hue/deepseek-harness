/**
 * TimeRangeSelector - Preset windows plus step back/forward paging.
 * @module ui-automation-calendar/client/components/TimeRangeSelector
 */

import { useMemo } from 'react'
import type { TimeRange } from '../contract/time-granularity.ts'
import css from './TimeRangeSelector.module.css'

interface TimeRangeSelectorProps {
  timeRange: TimeRange
  onChange: (range: TimeRange) => void
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** Preset windows anchored to "now"; ids double as labels. */
const PRESETS: readonly { id: string; spanMs: number }[] = [
  { id: '1时', spanMs: HOUR_MS },
  { id: '24时', spanMs: DAY_MS },
  { id: '7天', spanMs: 7 * DAY_MS },
  { id: '30天', spanMs: 30 * DAY_MS },
]

export function TimeRangeSelector({ timeRange, onChange }: TimeRangeSelectorProps) {
  const activeSpan = timeRange.end - timeRange.start

  // A preset is active when the current window's span matches it exactly.
  const activeId = useMemo(
    () => PRESETS.find(p => p.spanMs === activeSpan)?.id ?? null,
    [activeSpan],
  )

  const applyPreset = (spanMs: number): void => {
    const now = Date.now()
    onChange({ start: now - spanMs, end: now })
  }

  // Page by exactly one whole window; forward never crosses "now".
  const page = (direction: 1 | -1): void => {
    const span = timeRange.end - timeRange.start
    const nextEnd = direction === 1 ? Math.min(timeRange.end + span, Date.now()) : timeRange.end + span
    onChange({ start: nextEnd - span, end: nextEnd })
  }

  const atPresent = timeRange.end >= Date.now() - 1000

  return (
    <div className={css.selector}>
      <button className={css.stepButton} onClick={() => page(-1)} title="上一段">‹</button>
      <div className={css.presets}>
        {PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`${css.preset} ${preset.id === activeId ? css.active : ''}`}
            onClick={() => applyPreset(preset.spanMs)}
          >
            {preset.id}
          </button>
        ))}
      </div>
      <button className={css.stepButton} onClick={() => page(1)} disabled={atPresent} title="下一段">›</button>
    </div>
  )
}
