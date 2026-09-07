/**
 * Durable per-item state ledger for the router engine.
 * @module ui-automation-router/ledger
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GateItem, GateItemState } from '@deepseek-ai/dsh-automation-gate'

/** On-disk schema version; bump only for structural format changes. */
export const LEDGER_SCHEMA_VERSION = 1

/** One item's tracked history as the engine consumes and persists it. */
export interface LedgerEntry {
  readonly id: string
  /** Identity fields replayed into snapshot diffs across restarts. */
  readonly sourceLane: string
  readonly title: string
  readonly lastState: GateItemState
  /** State whose rejection wake already went out; suppresses duplicates. */
  notifiedState?: GateItemState
  notifyCount: number
  updatedAt: number
}

interface LedgerFile {
  version: number
  /** Widened on read: corrupt files may hold null despite the write-side type. */
  items: Record<string, LedgerEntry> | null
}

/**
 * JSON-file ledger. Writes are atomic (tmp + rename); the file is created on
 * first write. A missing or corrupt file starts empty — the next tick reseeds
 * from the adapter snapshot, and at worst one wake re-delivers.
 */
export class FileLedger {
  private readonly items = new Map<string, LedgerEntry>()
  private loaded = false

  constructor(private readonly filePath: string) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch {
      // First run or deleted ledger: start empty.
      return
    }
    try {
      const parsed = JSON.parse(raw) as LedgerFile
      if (parsed.version !== LEDGER_SCHEMA_VERSION || parsed.items === null || typeof parsed.items !== 'object') {
        return
      }
      for (const entry of Object.values(parsed.items)) {
        this.items.set(entry.id, entry)
      }
    } catch {
      // Corrupt file: start empty rather than crash the loop.
    }
  }

  private persist(): void {
    const file: LedgerFile = { version: LEDGER_SCHEMA_VERSION, items: Object.fromEntries(this.items) }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.filePath)
  }

  get(id: string): LedgerEntry | undefined {
    this.load()
    return this.items.get(id)
  }

  all(): LedgerEntry[] {
    this.load()
    return [...this.items.values()]
  }

  /** Seed or refresh identity/state fields without touching wake bookkeeping. */
  track(item: GateItem): void {
    this.load()
    const existing = this.items.get(item.id)
    if (existing !== undefined
      && existing.lastState === item.state
      && existing.sourceLane === item.sourceLane
      && existing.title === item.title) {
      return
    }
    this.items.set(item.id, {
      id: item.id,
      sourceLane: item.sourceLane,
      title: item.title,
      lastState: item.state,
      ...(existing?.notifiedState === undefined ? {} : { notifiedState: existing.notifiedState }),
      notifyCount: existing?.notifyCount ?? 0,
      updatedAt: Date.now(),
    })
    this.persist()
  }

  markNotified(id: string, state: GateItemState): void {
    this.load()
    const entry = this.items.get(id)
    if (entry === undefined) return
    entry.notifiedState = state
    entry.notifyCount += 1
    entry.updatedAt = Date.now()
    this.persist()
  }
}
