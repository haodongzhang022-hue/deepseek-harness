/**
 * Action runners: what one scheduled fire actually does. Each runner
 * resolves to a compact machine-readable outcome string for the journal.
 * @module ui-automation-scheduler/action
 */

import { spawn, type ChildProcess } from 'node:child_process'

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
      const parts = splitCommand(this.options.command)
      const file = parts[0]
      if (file === undefined) {
        resolve({ ok: false, detail: 'empty command' })
        return
      }
      const child: ChildProcess = spawn(file, [...parts.slice(1), ...this.options.args ?? []], {
        stdio: 'ignore',
        signal: AbortSignal.timeout(this.options.timeoutMs),
        ...(this.options.cwd === undefined || this.options.cwd === '' ? {} : { cwd: this.options.cwd }),
        // Headless daemon discipline: never allocate a visible console on Windows.
        windowsHide: true,
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
        ...(this.options.method === 'GET' || this.options.body === undefined ? {} : { body: this.options.body }),
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
