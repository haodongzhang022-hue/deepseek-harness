/**
 * StuckIndicator - Warning banner listing stuck running tasks.
 * @module ui-automation-calendar/client/components/StuckIndicator
 */

import type { StuckTask } from '../contract/calendar-model.ts'
import { formatResourceValue } from '../engine/resource-aggregator.ts'
import type { Translate } from './translate.ts'
import css from './StuckIndicator.module.css'

interface StuckIndicatorProps {
  stuckTasks: readonly StuckTask[]
  t: Translate
}

export function StuckIndicator({ stuckTasks, t }: StuckIndicatorProps) {
  const criticalCount = stuckTasks.filter(s => s.severity === 'critical').length

  return (
    <div className={css.banner} role="alert">
      <div className={css.header}>
        <span className={`${css.badge} ${criticalCount > 0 ? css.critical : ''}`}>
          {t('stuck.title')} {stuckTasks.length}
        </span>
        {criticalCount > 0 && (
          <span className={css.hint}>{criticalCount} 个已超过阈值两倍</span>
        )}
      </div>
      <ul className={css.list}>
        {stuckTasks.map(stuck => (
          <li key={stuck.task.id} className={css.item}>
            <span className={`${css.severityDot} ${stuck.severity === 'critical' ? css.dotCritical : ''}`} />
            <span className={css.label}>{stuck.task.label ?? stuck.task.id}</span>
            <span className={css.duration}>已运行 {formatResourceValue(stuck.stuckDuration, 'duration')}</span>
            <span className={css.recommendation}>{stuck.recommendation}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
