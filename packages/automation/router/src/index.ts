/**
 * Automation gate-router: generic pipeline monitoring with rejection wake-ups.
 * @module @deepseek-ai/dsh-automation-router
 */

export { RouterEngine } from './engine.ts'
export type { RouterEngineOptions, TickSummary } from './engine.ts'
export { FileLedger, LEDGER_SCHEMA_VERSION } from './ledger.ts'
export type { LedgerEntry } from './ledger.ts'
export { LogWakeTransport, buildWakeText } from './wake-transport.ts'
export type { WakeTransport } from './wake-transport.ts'

export const name = 'automation-router'
export const inject: string[] = []
export function apply(): void {
  // Node-side composition root lands with the MCP adapter wiring (Phase A step 2).
}
