/**
 * Temporary in-place runner for the automation daemons on the MAIN instance
 * host without restarting it. Same plugin code the profile will load on next
 * boot; data lands under data/automation-tmp to stay out of the正式 ledger's
 * way. Kill this process when the real mount takes over.
 * @module sandbox/automation/standalone-runner
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { apply } from './scheduler-plugin.ts'

const BASE = 'E:/1shuju/dsh-home/data/automation-tmp'
mkdirSync(BASE, { recursive: true })

const logger = {
  info: (...args: unknown[]) => { console.log('[info]', ...args) },
  warn: (...args: unknown[]) => { console.log('[warn]', ...args) },
  error: (...args: unknown[]) => { console.log('[error]', ...args) },
}

const ctx = {
  logger,
  /** Register immediately; the process lifetime owns disposal. */
  effect(setup: () => (() => void) | void): void { setup() },
  get(): undefined { return undefined },
} as never

const config = {
  jobs: [{
    name: 'rejection-dispatch',
    everyMs: 300000,
    jitterMs: 20000,
    timeoutMs: 60000,
    action: { kind: 'http', url: 'http://localhost:8008/api/v3/pipeline/rejections/dispatch_once', method: 'POST', body: '{}' },
  }],
  sweepIntervalMs: 30000,
  journalPath: BASE + '/scheduler-journal.ndjson',
  routerGates: [
    { name: 'itg-8008', serverName: 'releasecontrol', ledgerPath: BASE + '/router-8008.json', pollIntervalMs: 120000, gate: 'integration-8008', transport: 'http', httpBaseUrl: 'http://localhost:8008' },
    { name: 'stg-8027', serverName: 'releasecontrol', ledgerPath: BASE + '/router-8027.json', pollIntervalMs: 180000, gate: 'staging-8027', transport: 'http', httpBaseUrl: 'http://localhost:8008' },
  ],
}

await apply(ctx, config as never)
console.log('[runner] automation daemons live (tmp channel)')
