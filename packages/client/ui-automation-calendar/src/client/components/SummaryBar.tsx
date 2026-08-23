/**
 * SummaryBar - Aggregate statistics strip above the grid.
 * @module ui-automation-calendar/client/components/SummaryBar
 */

import type { CalendarSummary } from '../contract/calendar-model.ts'
import { formatResourceValue } from '../engine/resource-aggregator.ts'
import type { Translate } from './translate.ts'
import css from './SummaryBar.module.css'

interface SummaryBarProps {
  summary: CalendarSummary
  t: Translate
}

export function SummaryBar({ summary, t }: SummaryBarProps) {
  return (
    <div className={css.bar}>
      <div className={css.stat}>
        <span className={css.value}>{summary.totalTasks}</span>
        <span className={css.name}>{t('summary.total')}</span>
      </div>
      <div className={css.stat}>
        <span className={`${css.value} ${css.running}`}>{summary.activeTasks}</span>
        <span className={css.name}>{t('summary.active')}</span>
      </div>
      <div className={css.stat}>
        <span className={`${css.value} ${css.completed}`}>{summary.completedTasks}</span>
        <span className={css.name}>{t('summary.completed')}</span>
      </div>
      <div className={css.stat}>
        <span className={`${css.value} ${css.failed}`}>{summary.failedTasks}</span>
        <span className={css.name}>{t('summary.failed')}</span>
      </div>
      <div className={css.stat}>
        <span className={css.value}>{formatResourceValue(summary.totalTokens, 'token')}</span>
        <span className={css.name}>{t('summary.tokens')}</span>
      </div>
      <div className={css.stat}>
        <span className={css.value}>{formatResourceValue(summary.totalDurationMs, 'duration')}</span>
        <span className={css.name}>总时长</span>
      </div>
    </div>
  )
}
