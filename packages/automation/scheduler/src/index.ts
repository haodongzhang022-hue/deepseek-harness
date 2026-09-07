/**
 * Calendar-style automation scheduler: interval schedules firing exec/HTTP
 * actions with jitter, failure backoff, and an append-only audit journal.
 * @module @deepseek-ai/dsh-automation-scheduler
 */

export { SchedulerEngine } from './engine.ts'
export type { JournalEntry, ScheduledJob, SchedulerEngineOptions, SweepSummary } from './engine.ts'
export { ExecRunner, HttpRunner } from './action.ts'
export type { ActionResult, ActionRunner } from './action.ts'

export const name = 'automation-scheduler'
