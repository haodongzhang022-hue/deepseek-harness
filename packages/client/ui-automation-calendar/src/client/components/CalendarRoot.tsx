/**
 * CalendarRoot - Main container for the automation calendar view.
 * @module ui-automation-calendar/client/components/CalendarRoot
 */

import { useState, useCallback } from 'react'
import type { CalendarComponentProps } from '../contract/slots.ts'
import type { GranularityId, TimeRange } from '../contract/time-granularity.ts'
import { useCalendarViewModel } from '../hooks/useCalendarViewModel.ts'
import { TimeAxis } from './TimeAxis.tsx'
import { TaskGrid } from './TaskGrid.tsx'
import { SummaryBar } from './SummaryBar.tsx'
import { GranularitySelector } from './GranularitySelector.tsx'
import { StuckIndicator } from './StuckIndicator.tsx'
import { TaskDetailsPanel } from './TaskDetailsPanel.tsx'
import { ResourcePanel } from './ResourcePanel.tsx'
import { TimeRangeSelector } from './TimeRangeSelector.tsx'
import { AnomalyAlert } from './AnomalyAlert.tsx'

import css from './CalendarRoot.module.css'

const DAY_MS = 24 * 60 * 60 * 1000

const DEFAULT_TIME_RANGE: TimeRange = {
  start: Date.now() - DAY_MS,
  end: Date.now(),
}

const DEFAULT_GRANULARITY: GranularityId = 'hour'

export function CalendarRoot({
  useSession,
  navigateToSession,
  t,
}: CalendarComponentProps) {
  const [granularity, setGranularity] = useState<GranularityId>(DEFAULT_GRANULARITY)
  const [timeRange, setTimeRange] = useState<TimeRange>(DEFAULT_TIME_RANGE)
  const [expandedCycleGroups, setExpandedCycleGroups] = useState<ReadonlySet<string>>(new Set())
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedResourceId, setSelectedResourceId] = useState('token')

  // Framework selector hooks over the conversation snapshot - each slice
  // re-renders only when its own value changes.
  const turnTimings = useSession(s => s.turnTimings)
  const running = useSession(s => s.running)
  const lastAgentError = useSession(s => s.lastAgentError)
  const snapshotSessionId = useSession(s => s.sessionId)

  const modelInput = turnTimings === undefined ? undefined : {
    turnTimings,
    running,
    lastAgentError,
    sessionId: String(snapshotSessionId),
  }

  const { viewModel, stuckTasks, anomalies } = useCalendarViewModel(
    modelInput,
    timeRange,
    granularity,
    expandedCycleGroups,
  )

  const handleCycleGroupToggle = useCallback((groupId: string) => {
    setExpandedCycleGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const handleRefresh = useCallback(() => {
    setTimeRange({ start: Date.now() - DAY_MS, end: Date.now() })
  }, [])

  const selectedTask = selectedTaskId === null
    ? undefined
    : viewModel.rows.flatMap(r => r.entries.map(e => e.task)).find(task => task.id === selectedTaskId)

  const allTasks = viewModel.rows.flatMap(r => r.entries.map(e => e.task))

  return (
    <div className={css.calendarRoot}>
      <div className={css.header}>
        <div className={css.title}>
          <span className={css.icon}>📅</span>
          <span>{t('view.calendar')}</span>
        </div>
        <div className={css.controls}>
          <TimeRangeSelector timeRange={timeRange} onChange={setTimeRange} />
          <GranularitySelector value={granularity} onChange={setGranularity} t={t} />
          <button className={css.refreshButton} onClick={handleRefresh}>🔄 {t('action.refresh')}</button>
        </div>
      </div>

      {stuckTasks.length > 0 && <StuckIndicator stuckTasks={stuckTasks} t={t} />}

      {anomalies.findings.length > 0 && <AnomalyAlert report={anomalies} />}

      <SummaryBar summary={viewModel.summary} t={t} />

      <TimeAxis ticks={viewModel.timeTicks} timeRange={timeRange} onTimeRangeChange={setTimeRange} />

      <div className={css.mainContent}>
        <div className={css.gridArea}>
          <TaskGrid
            rows={viewModel.rows}
            timeRange={timeRange}
            granularity={granularity}
            onTaskClick={setSelectedTaskId}
            onCycleGroupToggle={handleCycleGroupToggle}
            t={t}
          />
        </div>

        <div className={css.resourceArea}>
          <ResourcePanel
            tasks={allTasks}
            timeRange={timeRange}
            granularity={granularity}
            selectedResourceId={selectedResourceId}
            onResourceSelect={setSelectedResourceId}
          />
        </div>

        {selectedTask !== undefined && (
          <TaskDetailsPanel
            task={selectedTask}
            onClose={() => setSelectedTaskId(null)}
            onNavigate={navigateToSession}
          />
        )}
      </div>

      {viewModel.rows.length === 0 && (
        <div className={css.emptyState}>
          <div className={css.emptyIcon}>📭</div>
          <div className={css.emptyTitle}>{t('empty.title')}</div>
          <div className={css.emptyDescription}>{t('empty.description')}</div>
        </div>
      )}
    </div>
  )
}
