/**
 * TaskDetailsPanel - Side panel with the selected task's facts.
 * @module ui-automation-calendar/client/components/TaskDetailsPanel
 */

import type { AutomationTaskEntry } from '../contract/calendar-model.ts'
import { analyzeError } from '../engine/error-analyzer.ts'
import { formatResourceValue } from '../engine/resource-aggregator.ts'
import type { Translate } from './translate.ts'
import css from './TaskDetailsPanel.module.css'

interface TaskDetailsPanelProps {
  task: AutomationTaskEntry
  onClose: () => void
  onNavigate?: (sessionId: string) => void
  t?: Translate
}

const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  stuck: '卡住',
  cancelled: '已取消',
}

export function TaskDetailsPanel({ task, onClose, onNavigate }: TaskDetailsPanelProps) {
  const analysis = task.error !== undefined ? analyzeError(task.error) : undefined

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <span className={css.title}>{task.label ?? task.id}</span>
        <button className={css.closeButton} onClick={onClose}>✕</button>
      </div>

      <div className={css.section}>
        <div className={css.factRow}>
          <span className={css.factName}>状态</span>
          <span className={css.factValue}>{STATUS_LABELS[task.status] ?? task.status}</span>
        </div>
        <div className={css.factRow}>
          <span className={css.factName}>开始</span>
          <span className={css.factValue}>{new Date(task.startedAt).toLocaleString()}</span>
        </div>
        {task.endedAt !== undefined && (
          <div className={css.factRow}>
            <span className={css.factName}>结束</span>
            <span className={css.factValue}>{new Date(task.endedAt).toLocaleString()}</span>
          </div>
        )}
        <div className={css.factRow}>
          <span className={css.factName}>时长</span>
          <span className={css.factValue}>{formatResourceValue(task.resources.durationMs, 'duration')}</span>
        </div>
        {task.cycle !== undefined && (
          <div className={css.factRow}>
            <span className={css.factName}>周期</span>
            <span className={css.factValue}>{task.cycle.type}{task.cycle.intervalMs !== undefined ? ` · 每${formatResourceValue(task.cycle.intervalMs, 'duration')}` : ''}</span>
          </div>
        )}
      </div>

      {task.resources.tokenUsage !== undefined && (
        <div className={css.section}>
          <div className={css.sectionTitle}>Token消耗</div>
          <div className={css.factRow}>
            <span className={css.factName}>总量</span>
            <span className={css.factValue}>{formatResourceValue(task.resources.tokenUsage.total, 'token')}</span>
          </div>
          <div className={css.factRow}>
            <span className={css.factName}>输入 / 输出</span>
            <span className={css.factValue}>
              {formatResourceValue(task.resources.tokenUsage.input, 'token')} / {formatResourceValue(task.resources.tokenUsage.output, 'token')}
            </span>
          </div>
        </div>
      )}

      {analysis !== undefined && (
        <div className={css.section}>
          <div className={css.sectionTitle}>错误分析</div>
          <div className={css.errorMessage}>{analysis.error.message}</div>
          {analysis.rootCause !== undefined && (
            <div className={css.factRow}>
              <span className={css.factName}>根因模式</span>
              <span className={css.factValue}>{analysis.rootCause}</span>
            </div>
          )}
          {analysis.suggestions.map((suggestion, i) => (
            <div key={i} className={css.suggestion}>💡 {suggestion}</div>
          ))}
          {analysis.autoActions.length > 0 && (
            <div className={css.autoActions}>建议自动动作：{analysis.autoActions.join(', ')}</div>
          )}
        </div>
      )}

      {onNavigate !== undefined && (
        <button className={css.openButton} onClick={() => onNavigate(task.sessionId)}>
          打开会话 →
        </button>
      )}
    </div>
  )
}
