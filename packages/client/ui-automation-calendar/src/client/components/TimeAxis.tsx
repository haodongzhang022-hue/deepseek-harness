/**
 * TimeAxis - Horizontal time ruler above the task grid.
 * @module ui-automation-calendar/client/components/TimeAxis
 */

import type { TimeRange, TimeTick } from '../contract/time-granularity.ts'
import css from './TimeAxis.module.css'

interface TimeAxisProps {
  ticks: readonly TimeTick[]
  timeRange: TimeRange
  /** Clicking empty axis space re-centers the window on that moment. */
  onTimeRangeChange?: (range: TimeRange) => void
}

export function TimeAxis({ ticks, timeRange, onTimeRangeChange }: TimeAxisProps) {
  const span = Math.max(timeRange.end - timeRange.start, 1)

  return (
    <div className={css.axis}>
      <div className={css.track}>
        {ticks.map(tick => (
          <button
            key={tick.time}
            className={`${css.tick} ${tick.major ? css.major : ''}`}
            style={{ left: `${((tick.time - timeRange.start) / span) * 100}%` }}
            onClick={() => {
              if (onTimeRangeChange === undefined) return
              // Re-center a same-span window on the clicked tick.
              const half = span / 2
              onTimeRangeChange({ start: tick.time - half, end: tick.time + half })
            }}
            title={tick.label}
          >
            <span className={css.line} />
            {tick.label.length > 0 && <span className={css.label}>{tick.label}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
