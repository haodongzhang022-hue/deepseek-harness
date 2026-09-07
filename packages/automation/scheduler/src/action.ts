/**
 * Action runners: what one scheduled fire actually does. Each runner
 * resolves to a compact machine-readable outcome string for the journal.
 * @module ui-automation-scheduler/action
 */

import { spawn } from 'node:child_process'

/** Outcome of one fire; the journal line carries it verbatim. */
export interface ActionResult {
  readonly ok: boolean
  /** Compact summary: exit code, HTTP status, or the failure message. */
  readonly detail: string
}

/** One configured action, executed on schedule. */
export interface ActionRunner {
  run(): Promise<ActionResult>
}

/** Spawns a child process; stdout/stderr are ignored, only the exit code matters. */
export class ExecRunner implements ActionRunner {
  constructor(private readonly options: {
    readonly command: string
    readonly args?: readonly string[]
    readonly cwd?: string
    readonly timeoutMs: number
  }) {}

  async run(): Promise<ActionResult> {
    return new Promise((resolve) => {
      const [file, ...rest] = splitCommand(this.options.command)
      const child = spawn(file, [...rest, ...this.options.args ?? []], {
        cwd: this.options.cwd === undefined || this.options.cwd === '' ? undefined : this.options.cwd,
        stdio: 'ignore',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
      child.on('error', error => resolve({ ok: false, detail: error.message }))
      child.on('exit', (code, signalName) => {
        if (signalName !== null) resolve({ ok: false, detail: 'killed by ' + signalName + ' after ' + this.options.timeoutMs + 'ms' })
        else if (code === 0) resolve({ ok: true, detail: 'exit 0' })
        else resolve({ ok: false, detail: 'exit ' + String(code) })
      })
    })
  }
}

/** POSTs/GETs a JSON endpoint; any 2xx counts as success. */
export class HttpRunner implements ActionRunner {
  constructor(private readonly options: {
    readonly url: string
    readonly method: string
    readonly body?: string
    readonly timeoutMs: number
  }) {}

  async run(): Promise<ActionResult> {
    try {
      const response = await fetch(this.options.url, {
        method: this.options.method,
        headers: { 'content-type': 'application/json' },
        body: this.options.method === 'GET' || this.options.body === undefined ? undefined : this.options.body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
      const snippet = (await response.text()).slice(0, 200)
      return response.ok
        ? { ok: true, detail: 'http ' + String(response.status) }
        : { ok: false, detail: 'http ' + String(response.status) + ': ' + snippet }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
}

/** Splits a command string on whitespace; args with spaces go in the args array instead. */
function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/)
}
