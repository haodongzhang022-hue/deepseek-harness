/**
 * TaskCell - One task entry rendered inside its lane slot.
 * @module ui-automation-calendar/client/components/TaskCell
 */

import type { CalendarEntry } from '../contract/calendar-model.ts'
import { formatResourceValue } from '../engine/resource-aggregator.ts'
import css from './TaskCell.module.css'

interface TaskCellProps {
  entry: CalendarEntry
  /** Window bounds for positioning; span for percentage math. */
  windowStart: number
  windowSpan: number
  onClick?: () => void
}

function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function TaskCell({ entry, windowStart, windowSpan, onClick }: TaskCellProps) {
  const { task, slot, visual } = entry
  const left = ((slot.start - windowStart) / windowSpan) * 100
  const width = Math.max(((slot.end - slot.start) / windowSpan) * 100, 0.6)

  return (
    <button
      className={css.cell}
      style={{
        left: `${Math.max(left, 0)}%`,
        width: `${width}%`,
        background: visual.color,
        opacity: visual.opacity,
        borderWidth: visual.borderWidth,
        borderColor: visual.borderColor,
      }}
      onClick={onClick}
      title={[
        task.label ?? task.id,
        `${formatClock(slot.start)} → ${slot.end !== undefined ? formatClock(slot.end) : '…'}`,
        formatResourceValue(task.resources.durationMs, 'duration'),
        task.resources.tokenUsage !== undefined
          ? `Tokens: ${formatResourceValue(task.resources.tokenUsage.total, 'token')}`
          : null,
        task.error?.message,
      ].filter(Boolean).join('\n')}
    >
      {task.status === 'running' && <span className={css.pulse} />}
      {task.error !== undefined && <span className={css.errorDot}>!</span>}
    </button>
  )
}
