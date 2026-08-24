/**
 * Wake transports: how a router reaches the session that owns a rejected item.
 * @module ui-automation-router/wake-transport
 */

import type { GateItem } from '@deepseek-ai/dsh-automation-gate'

/** One delivered wake-up. Implementations must not throw for absent targets. */
export interface WakeTransport {
  readonly name: string
  deliver(sessionId: string, item: GateItem): Promise<void>
}

/** Chinese wake message naming the rejection so the same conversation resumes with context. */
export function buildWakeText(item: GateItem): string {
  let text = '【自动化路由】你提交的任务「' + item.title + '」（' + item.id + '）在整合门测试中被驳回。'
  if (item.detail !== undefined && item.detail.length > 0) {
    text += '\n驳回原因/证据：' + item.detail
  }
  text += '\n请在本会话继续迭代修复后重新提交。'
  return text
}

/** Logs instead of delivering — dry-run, tests, and pipelines without a live target host. */
export class LogWakeTransport implements WakeTransport {
  readonly name = 'log'

  async deliver(sessionId: string, item: GateItem): Promise<void> {
    const line = '[wake] -> ' + sessionId + ': ' + buildWakeText(item)
    console.log(line)
  }
}
