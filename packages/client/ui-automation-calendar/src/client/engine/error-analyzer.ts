/**
 * Error analysis engine for detecting stuck tasks and error patterns.
 * @module ui-automation-calendar/engine/error-analyzer
 */

import type {
  AutomationTaskEntry,
  ErrorAnalysis,
  ErrorPatternDefinition,
  StuckTask,
  TaskError,
} from '../contract/calendar-model.ts'

/** Default stuck thresholds by task kind, in milliseconds. */
export const DEFAULT_STUCK_THRESHOLDS = {
  tool_call: 5 * 60_000,
  assistant_response: 10 * 60_000,
  default: 30 * 60_000,
} as const

/** Common error patterns with severity and remediation hints. */
export const ERROR_PATTERNS: ErrorPatternDefinition[] = [
  {
    id: 'rate-limit',
    pattern: /rate.?limit|429|too.?many.?requests/i,
    severity: 'warning',
    category: 'api',
    suggestion: 'API调用频率超限，建议增加请求间隔或启用重试退避',
    autoAction: 'increase-interval',
  },
  {
    id: 'token-limit',
    pattern: /token.?limit|context.?length|max.?tokens/i,
    severity: 'error',
    category: 'model',
    suggestion: 'Token超限，建议启用compaction或减少上下文',
    autoAction: 'enable-compaction',
  },
  {
    id: 'timeout',
    pattern: /timeout|ETIMEDOUT|deadline.?exceeded/i,
    severity: 'warning',
    category: 'network',
    suggestion: '请求超时，建议检查网络或增加超时时间',
    autoAction: 'increase-timeout',
  },
  {
    id: 'connection-refused',
    pattern: /ECONNREFUSED|ECONNRESET|connection.?refused/i,
    severity: 'critical',
    category: 'infra',
    suggestion: '连接被拒绝，建议检查服务状态',
    autoAction: 'alert-ops',
  },
  {
    id: 'oom',
    pattern: /out.?of.?memory|heap.?limit|OOM/i,
    severity: 'critical',
    category: 'resource',
    suggestion: '内存不足，建议增加内存限制或优化内存使用',
    autoAction: 'increase-memory',
  },
  {
    id: 'permission-denied',
    pattern: /permission.?denied|EACCES|unauthorized/i,
    severity: 'error',
    category: 'auth',
    suggestion: '权限不足，建议检查凭证配置',
    autoAction: 'refresh-credentials',
  },
]

/**
 * Detect stuck tasks.
 * @param tasks - candidate running tasks.
 * @param thresholds - per-kind budgets; `default` applies when no kind matches.
 * @param now - evaluation clock; injectable so replay and tests classify the
 *   same log identically instead of drifting with wall time.
 * @returns stuck tasks ranked longest-stuck first.
 */
export function detectStuckTasks(
  tasks: readonly AutomationTaskEntry[],
  thresholds: typeof DEFAULT_STUCK_THRESHOLDS = DEFAULT_STUCK_THRESHOLDS,
  now: number = Date.now(),
): StuckTask[] {
  const stuckTasks: StuckTask[] = []

  for (const task of tasks) {
    if (task.status !== 'running') continue

    const duration = now - task.startedAt
    const threshold = getThresholdForTask(task, thresholds)

    if (duration > threshold) {
      const severity = duration > threshold * 2 ? 'critical' : 'warning'
      const lastActivity = task.lastActivityAt ?? task.startedAt
      const stuckDuration = now - lastActivity

      stuckTasks.push({
        task,
        stuckDuration,
        threshold,
        severity,
        lastActivity,
        recommendation: getStuckRecommendation(stuckDuration),
      })
    }
  }

  return stuckTasks.sort((a, b) => b.stuckDuration - a.stuckDuration)
}

function getThresholdForTask(
  _task: AutomationTaskEntry,
  thresholds: typeof DEFAULT_STUCK_THRESHOLDS,
): number {
  // Task-kind routing lands when producers stamp their kind on entries.
  return thresholds.default
}

function getStuckRecommendation(stuckDuration: number): string {
  if (stuckDuration > 60 * 60_000) return '任务已卡住超过1小时，建议检查进程状态或考虑重启'
  if (stuckDuration > 30 * 60_000) return '任务已卡住超过30分钟，建议检查网络连接或服务状态'
  if (stuckDuration > 10 * 60_000) return '任务响应较慢，可能是正常处理中，建议继续观察'
  return '任务可能正在处理大量数据，建议继续观察'
}

/** Match an error against the known pattern table and rank the result. */
export function analyzeError(error: TaskError): ErrorAnalysis {
  const matchedPatterns = ERROR_PATTERNS.filter(p =>
    p.pattern.test(error.message) || p.pattern.test(error.code),
  )

  const rootCause = inferRootCause(matchedPatterns, error)
  return {
    error,
    patterns: matchedPatterns,
    severity: determineSeverity(matchedPatterns, error),
    ...(rootCause === undefined ? {} : { rootCause }),
    suggestions: [
      ...matchedPatterns.map(p => p.suggestion),
      ...(error.suggestion !== undefined ? [error.suggestion] : []),
    ],
    autoActions: matchedPatterns
      .map(p => p.autoAction)
      .filter((a): a is string => a !== undefined),
  }
}

function determineSeverity(
  patterns: readonly ErrorPatternDefinition[],
  error: TaskError,
): 'warning' | 'error' | 'critical' {
  if (error.severity !== undefined) return error.severity
  if (patterns.some(p => p.severity === 'critical')) return 'critical'
  if (patterns.some(p => p.severity === 'error')) return 'error'
  if (patterns.some(p => p.severity === 'warning')) return 'warning'
  return 'error'
}

function inferRootCause(
  patterns: readonly ErrorPatternDefinition[],
  error: TaskError,
): string | undefined {
  if (patterns.length > 0) return patterns[0]?.id
  if (error.code.length > 0) return `error:${error.code.toLowerCase()}`
  return undefined
}
