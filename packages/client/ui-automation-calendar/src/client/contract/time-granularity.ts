/**
 * Time granularity types and configurations for the automation calendar.
 * @module ui-automation-calendar/contract/time-granularity
 */

/** Built-in granularity identifiers. */
export type BuiltinGranularityId =
  | 'sub-second'
  | 'second'
  | 'five-seconds'
  | 'fifteen-seconds'
  | 'half-minute'
  | 'minute'
  | 'five-minutes'
  | 'fifteen-minutes'
  | 'half-hour'
  | 'hour'
  | 'three-hours'
  | 'six-hours'
  | 'twelve-hours'
  | 'day'
  | 'week'
  | 'month'

/** Granularity identifier - builtin or custom. */
export type GranularityId = BuiltinGranularityId | (string & {})

/** Configuration for a time granularity level. */
export interface GranularityConfig {
  id: GranularityId
  name: string
  nameKey: string
  intervalMs: number
  color: string
  icon: string
  tickFormat: string
  collapseThresholdMs: number
}

/** Custom user-defined granularity. */
export interface CustomGranularity extends GranularityConfig {
  id: string
  builtin: false
  semantic?: {
    trigger: string
    cronExpression?: string
    eventPattern?: string
  }
}

/** Time slot in the calendar. */
export interface TimeSlot {
  start: number
  end: number
  granularity: GranularityId
}

/** Time range query. */
export interface TimeRange {
  start: number
  end: number
}

/** Time tick for axis rendering. */
export interface TimeTick {
  time: number
  label: string
  major: boolean
}

export const BUILTIN_GRANULARITIES: ReadonlyMap<BuiltinGranularityId, GranularityConfig> = new Map([
  ['sub-second', {
    id: 'sub-second',
    name: 'sub-second',
    nameKey: 'granularity.sub-second',
    intervalMs: 100,
    color: '#888888',
    icon: '⏱',
    tickFormat: 'SSS',
    collapseThresholdMs: 300,
  }],
  ['second', {
    id: 'second',
    name: 'second',
    nameKey: 'granularity.second',
    intervalMs: 1000,
    color: '#999999',
    icon: '⏱',
    tickFormat: 'ss',
    collapseThresholdMs: 3000,
  }],
  ['five-seconds', {
    id: 'five-seconds',
    name: 'five-seconds',
    nameKey: 'granularity.five-seconds',
    intervalMs: 5000,
    color: '#aaaaaa',
    icon: '⏱',
    tickFormat: 'ss',
    collapseThresholdMs: 15000,
  }],
  ['fifteen-seconds', {
    id: 'fifteen-seconds',
    name: 'fifteen-seconds',
    nameKey: 'granularity.fifteen-seconds',
    intervalMs: 15000,
    color: '#bbbbbb',
    icon: '⏱',
    tickFormat: 'ss',
    collapseThresholdMs: 45000,
  }],
  ['half-minute', {
    id: 'half-minute',
    name: 'half-minute',
    nameKey: 'granularity.half-minute',
    intervalMs: 30000,
    color: '#cccccc',
    icon: '⏱',
    tickFormat: 'ss',
    collapseThresholdMs: 90000,
  }],
  ['minute', {
    id: 'minute',
    name: 'minute',
    nameKey: 'granularity.minute',
    intervalMs: 60000,
    color: '#dddddd',
    icon: '⏱',
    tickFormat: 'mm',
    collapseThresholdMs: 180000,
  }],
  ['five-minutes', {
    id: 'five-minutes',
    name: 'five-minutes',
    nameKey: 'granularity.five-minutes',
    intervalMs: 300000,
    color: '#eeeeee',
    icon: '⏱',
    tickFormat: 'mm',
    collapseThresholdMs: 900000,
  }],
  ['fifteen-minutes', {
    id: 'fifteen-minutes',
    name: 'fifteen-minutes',
    nameKey: 'granularity.fifteen-minutes',
    intervalMs: 900000,
    color: '#ffffff',
    icon: '⏱',
    tickFormat: 'HH:mm',
    collapseThresholdMs: 2700000,
  }],
  ['half-hour', {
    id: 'half-hour',
    name: 'half-hour',
    nameKey: 'granularity.half-hour',
    intervalMs: 1800000,
    color: '#111111',
    icon: '⏱',
    tickFormat: 'HH:mm',
    collapseThresholdMs: 5400000,
  }],
  ['hour', {
    id: 'hour',
    name: 'hour',
    nameKey: 'granularity.hour',
    intervalMs: 3600000,
    color: '#122222',
    icon: '⏱',
    tickFormat: 'HH',
    collapseThresholdMs: 10800000,
  }],
  ['three-hours', {
    id: 'three-hours',
    name: 'three-hours',
    nameKey: 'granularity.three-hours',
    intervalMs: 10800000,
    color: '#133333',
    icon: '⏱',
    tickFormat: 'HH',
    collapseThresholdMs: 32400000,
  }],
  ['six-hours', {
    id: 'six-hours',
    name: 'six-hours',
    nameKey: 'granularity.six-hours',
    intervalMs: 21600000,
    color: '#144444',
    icon: '⏱',
    tickFormat: 'HH',
    collapseThresholdMs: 64800000,
  }],
  ['twelve-hours', {
    id: 'twelve-hours',
    name: 'twelve-hours',
    nameKey: 'granularity.twelve-hours',
    intervalMs: 43200000,
    color: '#155555',
    icon: '⏱',
    tickFormat: 'HH',
    collapseThresholdMs: 129600000,
  }],
  ['day', {
    id: 'day',
    name: 'day',
    nameKey: 'granularity.day',
    intervalMs: 86400000,
    color: '#166666',
    icon: '⏱',
    tickFormat: 'MM/dd',
    collapseThresholdMs: 259200000,
  }],
  ['week', {
    id: 'week',
    name: 'week',
    nameKey: 'granularity.week',
    intervalMs: 604800000,
    color: '#177777',
    icon: '⏱',
    tickFormat: 'MM/dd',
    collapseThresholdMs: 1814400000,
  }],
  ['month', {
    id: 'month',
    name: 'month',
    nameKey: 'granularity.month',
    intervalMs: 2592000000,
    color: '#188888',
    icon: '⏱',
    tickFormat: 'yyyy/MM',
    collapseThresholdMs: 7776000000,
  }],
])

/** Get granularity config by id. */
export function getGranularityConfig(id: GranularityId): GranularityConfig | undefined {
  return BUILTIN_GRANULARITIES.get(id as BuiltinGranularityId)
}

/** Get all builtin granularities as array, sorted by interval. */
export function getAllBuiltinGranularities(): GranularityConfig[] {
  return Array.from(BUILTIN_GRANULARITIES.values()).sort((a, b) => a.intervalMs - b.intervalMs)
}
