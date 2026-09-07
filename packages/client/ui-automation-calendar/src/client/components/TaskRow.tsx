/**
 * TaskRow - One calendar lane: label column plus the entry timeline.
 * @module ui-automation-calendar/client/components/TaskRow
 */

import { formatResourceValue } from '../engine/resource-aggregator.ts'
import type { CalendarRow } from '../contract/calendar-model.ts'
import type { TimeRange } from '../contract/time-granularity.ts'
import { TaskCell } from './TaskCell.tsx'
import type { Translate } from './translate.ts'
import css from './TaskRow.module.css'

interface TaskRowProps {
  row: CalendarRow
  timeRange: TimeRange
  depth?: number
  onTaskClick?: (taskId: string) => void
  onCycleGroupToggle?: (groupId: string) => void
  t: Translate
}

export function TaskRow({ row, timeRange, depth = 0, onTaskClick, onCycleGroupToggle, t }: TaskRowProps) {
  const span = Math.max(timeRange.end - timeRange.start, 1)

  return (
    <>
      <div className={css.row}>
        <div className={css.labelColumn} style={{ paddingLeft: `${depth * 16 + 8}px` }}>
          {row.type === 'cycle-group' && (
            <button
              className={css.expandButton}
              onClick={() => onCycleGroupToggle?.(row.id)}
              title={row.expanded ? '收起' : '展开'}
            >
              {row.expanded ? '▼' : '▶'}
            </button>
          )}
          <span className={css.icon}>{row.icon}</span>
          <span className={css.label} title={row.label}>{row.label}</span>
          <span className={css.meta}>
            {row.rowSummary.tokenUsage !== undefined && `${formatResourceValue(row.rowSummary.tokenUsage.total, 'token')} tok · `}
            {formatResourceValue(row.rowSummary.durationMs, 'duration')}
          </span>
        </div>
        <div className={css.lane}>
          {row.entries.map(entry => (
            <TaskCell
              key={entry.task.id}
              entry={entry}
              windowStart={timeRange.start}
              windowSpan={span}
              onClick={() => onTaskClick?.(entry.task.id)}
            />
          ))}
        </div>
      </div>
      {row.children?.map(child => (
        <TaskRow
          key={child.id}
          row={child}
          timeRange={timeRange}
          depth={depth + 1}
          {...(onTaskClick === undefined ? {} : { onTaskClick })}
          {...(onCycleGroupToggle === undefined ? {} : { onCycleGroupToggle })}
          t={t}
        />
      ))}
    </>
  )
}
