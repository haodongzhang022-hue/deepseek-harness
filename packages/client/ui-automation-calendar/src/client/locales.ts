/**
 * Locale dictionaries for the automation calendar.
 * @module ui-automation-calendar/client/locales
 */

/** Locale namespace owned by this package. */
export const CALENDAR_LOCALE_NS = 'calendar'

/** Every key the calendar reads through its locale seat. */
export type CalendarKey =
  | 'view.calendar'
  | 'action.refresh'
  | 'action.openSession'
  | 'granularity.label'
  | 'granularity.sub-second'
  | 'granularity.second'
  | 'granularity.five-seconds'
  | 'granularity.fifteen-seconds'
  | 'granularity.half-minute'
  | 'granularity.minute'
  | 'granularity.five-minutes'
  | 'granularity.fifteen-minutes'
  | 'granularity.half-hour'
  | 'granularity.hour'
  | 'granularity.three-hours'
  | 'granularity.six-hours'
  | 'granularity.twelve-hours'
  | 'granularity.day'
  | 'granularity.week'
  | 'granularity.month'
  | 'summary.total'
  | 'summary.active'
  | 'summary.completed'
  | 'summary.failed'
  | 'summary.tokens'
  | 'stuck.title'
  | 'empty.title'
  | 'empty.description'

export const calendarZh: Record<CalendarKey, string> = {
  'view.calendar': '自动化日历',
  'action.refresh': '刷新',
  'action.openSession': '打开会话',
  'granularity.label': '粒度',
  'granularity.sub-second': '亚秒',
  'granularity.second': '秒',
  'granularity.five-seconds': '5秒',
  'granularity.fifteen-seconds': '15秒',
  'granularity.half-minute': '30秒',
  'granularity.minute': '分钟',
  'granularity.five-minutes': '5分钟',
  'granularity.fifteen-minutes': '15分钟',
  'granularity.half-hour': '30分钟',
  'granularity.hour': '小时',
  'granularity.three-hours': '3小时',
  'granularity.six-hours': '6小时',
  'granularity.twelve-hours': '12小时',
  'granularity.day': '天',
  'granularity.week': '周',
  'granularity.month': '月',
  'summary.total': '总任务',
  'summary.active': '运行中',
  'summary.completed': '已完成',
  'summary.failed': '失败',
  'summary.tokens': 'Token消耗',
  'stuck.title': '卡住的任务',
  'empty.title': '暂无任务数据',
  'empty.description': '当前时间范围内没有可展示的自动化任务',
}

export const calendarEn: Record<CalendarKey, string> = {
  'view.calendar': 'Automation Calendar',
  'action.refresh': 'Refresh',
  'action.openSession': 'Open Session',
  'granularity.label': 'Granularity',
  'granularity.sub-second': 'Sub-second',
  'granularity.second': 'Second',
  'granularity.five-seconds': '5s',
  'granularity.fifteen-seconds': '15s',
  'granularity.half-minute': '30s',
  'granularity.minute': 'Minute',
  'granularity.five-minutes': '5m',
  'granularity.fifteen-minutes': '15m',
  'granularity.half-hour': '30m',
  'granularity.hour': 'Hour',
  'granularity.three-hours': '3h',
  'granularity.six-hours': '6h',
  'granularity.twelve-hours': '12h',
  'granularity.day': 'Day',
  'granularity.week': 'Week',
  'granularity.month': 'Month',
  'summary.total': 'Total',
  'summary.active': 'Running',
  'summary.completed': 'Completed',
  'summary.failed': 'Failed',
  'summary.tokens': 'Tokens',
  'stuck.title': 'Stuck Tasks',
  'empty.title': 'No task data',
  'empty.description': 'No automation tasks fall inside the selected time range',
}
