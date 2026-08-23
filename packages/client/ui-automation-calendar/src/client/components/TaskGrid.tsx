/**
 * TaskGrid - The scrollable lane list under the time axis.
 * @module ui-automation-calendar/client/components/TaskGrid
 */

import type { CalendarRow } from '../contract/calendar-model.ts'
import type { GranularityId, TimeRange } from '../contract/time-granularity.ts'
import { TaskRow } from './TaskRow.tsx'
import type { Translate } from './translate.ts'
import css from './TaskGrid.module.css'

interface TaskGridProps {
  rows: readonly CalendarRow[]
  timeRange: TimeRange
  granularity: GranularityId
  onTaskClick?: (taskId: string) => void
  onCycleGroupToggle?: (groupId: string) => void
  t: Translate
}

export function TaskGrid({ rows, timeRange, granularity, onTaskClick, onCycleGroupToggle, t }: TaskGridProps) {
  return (
    <div className={css.grid} data-granularity={granularity}>
      {rows.map(row => (
        <TaskRow
          key={row.id}
          row={row}
          timeRange={timeRange}
          onTaskClick={onTaskClick}
          onCycleGroupToggle={onCycleGroupToggle}
          t={t}
        />
      ))}
    </div>
  )
}
