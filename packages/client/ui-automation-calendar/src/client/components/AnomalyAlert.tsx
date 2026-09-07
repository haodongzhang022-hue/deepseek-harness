/**
 * AnomalyAlert - Banner listing structured anomaly findings.
 * @module ui-automation-calendar/client/components/AnomalyAlert
 */

import type { AnomalyFinding, AnomalyReport } from '../engine/anomaly-detector.ts'
import { formatResourceValue } from '../engine/resource-aggregator.ts'
import css from './AnomalyAlert.module.css'

interface AnomalyAlertProps {
  report: AnomalyReport
}

/** One-line human summary per finding kind; Chinese product copy. */
function describe(finding: AnomalyFinding): string {
  switch (finding.kind) {
    case 'duration-outlier':
      return `执行时长异常：偏离中位数 ${finding.deviation.toFixed(1)}σ（本次 ${formatResourceValue(finding.durationMs, 'duration')}，通常 ${formatResourceValue(finding.medianDurationMs, 'duration')}）`
    case 'failure-burst':
      return `连续失败：${finding.failedCount}个任务在${formatResourceValue(finding.windowMs, 'duration')}内相继失败`
  }
}

const KIND_ICON: Record<AnomalyFinding['kind'], string> = {
  'duration-outlier': '⏱️',
  'failure-burst': '💥',
}

export function AnomalyAlert({ report }: AnomalyAlertProps) {
  return (
    <div className={css.alert} role="alert">
      <div className={css.header}>
        <span className={css.badge}>异常 {report.findings.length}</span>
        <span className={css.hint}>检测到偏离历史模式的行为</span>
      </div>
      <ul className={css.list}>
        {report.findings.map((finding, index) => (
          <li key={index} className={css.item}>
            <span className={css.icon}>{KIND_ICON[finding.kind]}</span>
            <span className={css.text}>{describe(finding)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
