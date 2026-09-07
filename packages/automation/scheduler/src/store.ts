/**
 * TriggerStore: writable face over the signals/triggers/*.json registry.
 * The registry is git/manual managed; this store is the only code path that
 * may create, update, or delete a trigger file so management pages and the
 * pulse loop share one writer authority (each pulse re-reads the directory,
 * so CRUD here is live with no restart). Writes are validated and atomic.
 * @module ui-automation-scheduler/store
 */

import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Trigger, loadTriggers } from './triggers.ts'

const CHANNELS: ReadonlySet<string> = new Set(['minute', 'hour', 'day'])
const ACTION_KINDS: ReadonlySet<string> = new Set(['exec', 'http', 'dsh-prompt'])

/** A trigger as the store sees it: registry content plus a carried filename key. */
export interface StoredTrigger extends Trigger {
  readonly filename: string
}

/** Mutating a trigger this way writes a fresh file at dir/<id>.json. */
export interface TriggerPatch {
  readonly trigger_id: string
  readonly owner_session: string
  readonly enabled?: boolean
  readonly match: Trigger['match']
  readonly tzOffsetMin?: number
  readonly action: Trigger['action']
  readonly overlap?: Trigger['overlap']
  readonly dedup_key?: string
  readonly failure_policy?: Trigger['failure_policy']
}

/** Report one invalid field so the management page can correct it. */
export class TriggerValidationError extends Error {
  constructor(message: string) {
    super('trigger store: ' + message)
    this.name = 'TriggerValidationError'
  }
}

export class TriggerStore {
  constructor(private readonly dir: string) {}

  /** All triggers, sorted by trigger_id; malformed files fail loud. */
  list(): StoredTrigger[] {
    return loadTriggers(this.dir).map(t => ({ ...t, filename: this.filenameFor(t.trigger_id) }))
  }

  /** One trigger by id, or undefined when absent (or malformed). */
  get(id: string): StoredTrigger | undefined {
    return this.list().find(t => t.trigger_id === id)
  }

  /** Create a new trigger file. */
  create(patch: TriggerPatch): StoredTrigger {
    validate(patch)
    if (this.get(patch.trigger_id) !== undefined) {
      throw new TriggerValidationError(`trigger '${patch.trigger_id}' already exists`)
    }
    return this.writeFile(patch)
  }

  /** Replace the trigger file for id (creating it if absent — upsert). */
  update(id: string, patch: TriggerPatch): StoredTrigger {
    validate(patch)
    if (patch.trigger_id !== id && this.get(patch.trigger_id) !== undefined) {
      throw new TriggerValidationError(`trigger '${patch.trigger_id}' already exists`)
    }
    if (patch.trigger_id !== id && this.get(id) !== undefined) {
      // Renaming: remove the old filename so there is no stale duplicate.
      this.delete(id)
    }
    return this.writeFile(patch)
  }

  /** Delete the trigger file for id; missing id is a no-op. */
  delete(id: string): void {
    const path = join(this.dir, this.filenameFor(id))
    if (existsSync(path)) unlinkSync(path)
  }

  private writeFile(t: TriggerPatch): StoredTrigger {
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, this.filenameFor(t.trigger_id))
    const tmp = path + '.tmp'
    // Atomic on the same volume: write temp then rename over the target.
    const record: StoredTrigger = {
      trigger_id: t.trigger_id,
      owner_session: t.owner_session,
      match: t.match,
      action: t.action,
      filename: this.filenameFor(t.trigger_id),
      ...(t.enabled !== undefined ? { enabled: t.enabled } : {}),
      ...(t.tzOffsetMin !== undefined ? { tzOffsetMin: t.tzOffsetMin } : {}),
      ...(t.failure_policy !== undefined ? { failure_policy: t.failure_policy } : {}),
      ...(t.overlap !== undefined ? { overlap: t.overlap } : {}),
      ...(t.dedup_key !== undefined ? { dedup_key: t.dedup_key } : {}),
    }
    writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf8')
    renameSync(tmp, path)
    return record
  }

  private filenameFor(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]/g, '_') + '.json'
  }
}

/** Validate the fields the registry and bus rely on; throws TriggerValidationError. */
export function validate(patch: TriggerPatch): void {
  if (typeof patch.trigger_id !== 'string' || patch.trigger_id.trim() === '') {
    throw new TriggerValidationError('missing non-empty trigger_id')
  }
  if (typeof patch.owner_session !== 'string' || patch.owner_session.trim() === '') {
    throw new TriggerValidationError(`trigger '${patch.trigger_id}': missing owner_session`)
  }
  const match = patch.match
  if (match === undefined || typeof match !== 'object') {
    throw new TriggerValidationError(`trigger '${patch.trigger_id}': missing match`)
  }
  if (!CHANNELS.has(match.channel)) {
    throw new TriggerValidationError(`trigger '${patch.trigger_id}': invalid channel '${String(match.channel)}' (minute|hour|day)`)
  }
  if (match.atLocal !== undefined) {
    const { h, m } = match.atLocal
    if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) {
      throw new TriggerValidationError(`trigger '${patch.trigger_id}': atLocal must be h∈[0,23] m∈[0,59]`)
    }
  }
  for (const [field, value] of [['slot_m_mod', match.slot_m_mod], ['slot_h_mod', match.slot_h_mod]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0 || value > 23)) {
      throw new TriggerValidationError(`trigger '${patch.trigger_id}': ${field} must be a positive integer ≤23`)
    }
  }
  if (match.slot_weekday !== undefined && (!Number.isInteger(match.slot_weekday) || match.slot_weekday < 0 || match.slot_weekday > 6)) {
    throw new TriggerValidationError(`trigger '${patch.trigger_id}': slot_weekday must be an integer 0..6 (0=Sunday)`)
  }
  if (match.slot_dom !== undefined && (!Number.isInteger(match.slot_dom) || match.slot_dom < 1 || match.slot_dom > 31)) {
    throw new TriggerValidationError(`trigger '${patch.trigger_id}': slot_dom must be an integer 1..31`)
  }
  const action = patch.action
  if (action === undefined || typeof action !== 'object' || !ACTION_KINDS.has(action.kind)) {
    throw new TriggerValidationError(`trigger '${patch.trigger_id}': missing or unknown action.kind (exec|http|dsh-prompt)`)
  }
}
