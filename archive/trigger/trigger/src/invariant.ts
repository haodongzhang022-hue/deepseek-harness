/**
 * Runtime invariants for the trigger package.
 * 
 * @module @deepseek-ai/dsh-trigger/invariant
 */

import type { TriggerRecord, TriggerId, TriggerState } from './types.ts'

/**
 * Assert that a trigger record is valid.
 */
export function assertValidTrigger(record: TriggerRecord): void {
  if (!record.id || typeof record.id !== 'string') {
    throw new Error('Invalid trigger: missing or invalid id')
  }
  if (!record.name || typeof record.name !== 'string') {
    throw new Error('Invalid trigger: missing or invalid name')
  }
  if (!record.condition || typeof record.condition !== 'object') {
    throw new Error('Invalid trigger: missing or invalid condition')
  }
  if (!record.action || typeof record.action !== 'object') {
    throw new Error('Invalid trigger: missing or invalid action')
  }
  if (!['idle', 'armed', 'triggered', 'disabled'].includes(record.state)) {
    throw new Error(`Invalid trigger: unknown state ${record.state}`)
  }
}

/**
 * Assert that a trigger is in the expected state.
 */
export function assertTriggerState(
  record: TriggerRecord,
  expected: TriggerState | TriggerState[]
): void {
  const states = Array.isArray(expected) ? expected : [expected]
  if (!states.includes(record.state)) {
    throw new Error(
      `Trigger ${record.id} is in state ${record.state}, expected ${states.join(' or ')}`
    )
  }
}

/**
 * Assert that a trigger ID is valid.
 */
export function assertValidTriggerId(id: unknown): asserts id is TriggerId {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Invalid trigger ID: must be a non-empty string')
  }
}
