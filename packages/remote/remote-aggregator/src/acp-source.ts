/**
 * Generic ACP-backed {@link SessionSource}. Drives one ACP child (opencode,
 * dsh `--profile acp`, any ACP agent) over stdio through {@link AcpClient}.
 * Per-backend variants are factory functions that pin `command`/`args`/`kind`
 * — the source logic is identical because the ACP protocol is identical.
 *
 * Sticking to one source class (not one-per-backend) follows the project rule:
 * same functional steps live in one file and branch on parameters, not on
 * parallel implementations. A future non-ACP backend implements
 * {@link SessionSource} directly.
 *
 * ACP limitation: the protocol exposes list/resume/new/prompt/cancel but no
 * "read history" RPC, so {@link observe} returns the session meta with an
 * empty event list — the live stream is the source of truth, delivered
 * through {@link subscribe}.
 *
 * @module @deepseek-ai/dsh-remote-aggregator/acp-source
 */

import { AcpClient, type AcpClientOptions } from './acp-client.ts'
import type {
  SendResult, SessionEvent, SessionKind, SessionSnapshot, SessionSource, SessionSummary, Unsubscribe,
} from './types.ts'

/** Options for a generic ACP source. */
export interface AcpSourceOptions {
  /** Source id; the aggregator uses this to prefix session ids. */
  readonly id: string
  /** Backend kind for presentation. */
  readonly kind: SessionKind
  /** Human label for diagnostics. */
  readonly label: string
  /** Executable to spawn (e.g. `opencode`, `pnpm`). */
  readonly command: string
  /** Args (e.g. `['acp']`, `['dsh','--profile','acp']`). */
  readonly args: readonly string[]
  /** Child cwd; doubles as the ACP session workspace. */
  readonly cwd: string
  /** Extra env (e.g. DEEPSEEK_API_KEY for dsh, provider keys for opencode). */
  readonly env?: Record<string, string>
  /** Permission policy (default `reject`). */
  readonly permission?: 'allow' | 'reject'
  /** Client name reported in ACP `initialize`. */
  readonly clientName?: string
  /** Called when the child process exits before close(). */
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

/** Windows-safe command overrides for known shims that ENOENT under spawn. */
const DEFAULT_COMMAND_WIN32: Partial<Record<string, string>> = {
  opencode: 'C:\\Users\\dongdong\\AppData\\Local\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe',
}

/** Resolve a command to a Windows-safe path when a known shim is present. */
function resolveCommand(command: string, env?: Record<string, string>): string {
  if (process.platform !== 'win32') return command
  if (env?.OPENCODE_BIN !== undefined) return env.OPENCODE_BIN
  return DEFAULT_COMMAND_WIN32[command] ?? command
}

export class AcpSource implements SessionSource {
  readonly id: string
  readonly kind: SessionKind
  readonly label: string
  private readonly client: AcpClient
  private readonly subscribers = new Map<string, Set<(event: SessionEvent) => void>>()
  private connected = false

  constructor(options: AcpSourceOptions) {
    this.id = options.id
    this.kind = options.kind
    this.label = options.label
    const clientOptions: AcpClientOptions = {
      command: resolveCommand(options.command, options.env),
      args: options.args,
      cwd: options.cwd,
      onUpdate: (sessionId, event) => this.dispatch(sessionId, event),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.permission !== undefined ? { permission: options.permission } : {}),
      ...(options.clientName !== undefined ? { clientName: options.clientName } : {}),
      ...(options.onExit !== undefined ? { onExit: options.onExit } : {}),
    }
    this.client = new AcpClient(clientOptions)
  }

  /** Spawn the child and complete the ACP handshake. Required before any source method. */
  async connect(): Promise<void> {
    if (this.connected) return
    await this.client.connect()
    this.connected = true
  }

  async list(): Promise<readonly SessionSummary[]> {
    await this.connect()
    const result = await this.client.listSessions()
    return result.sessions.map((entry) => this.toSummary(entry.sessionId, entry.cwd))
  }

  async observe(sessionId: string): Promise<SessionSnapshot> {
    await this.connect()
    // ACP exposes no read-history RPC; the live stream is the source of truth.
    return {
      sessionId,
      sourceId: this.id,
      meta: this.toSummary(sessionId, undefined),
      events: [],
    }
  }

  async send(sessionId: string, message: string): Promise<SendResult> {
    await this.connect()
    // ACP prompt is synchronous (resolves at turn end); incremental content
    // flows to subscribers via onUpdate during the prompt. Dispatch a terminal
    // status event on resolution so subscribers see turn boundaries.
    void this.client.prompt(sessionId, message).then(
      (response) => this.dispatch(sessionId, {
        type: 'status',
        content: response.stopReason,
        at: Date.now(),
      }),
      (error) => this.dispatch(sessionId, {
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      }),
    )
    return {}
  }

  subscribe(sessionId: string, handler: (event: SessionEvent) => void): Unsubscribe {
    let set = this.subscribers.get(sessionId)
    if (set === undefined) {
      set = new Set()
      this.subscribers.set(sessionId, set)
    }
    set.add(handler)
    return () => {
      const current = this.subscribers.get(sessionId)
      if (current === undefined) return
      current.delete(handler)
      if (current.size === 0) this.subscribers.delete(sessionId)
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.client.cancel(sessionId)
  }

  async close(): Promise<void> {
    this.subscribers.clear()
    await this.client.close()
    this.connected = false
  }

  /** Create a new ACP session in `cwd`; returns the assigned session id. */
  async createSession(cwd: string): Promise<string> {
    await this.connect()
    const result = await this.client.newSession(cwd)
    return result.sessionId
  }

  private dispatch(sessionId: string, event: SessionEvent): void {
    const set = this.subscribers.get(sessionId)
    if (set === undefined) return
    for (const handler of set) {
      try { handler(event) } catch { /* subscriber handler failure must not break dispatch */ }
    }
  }

  private toSummary(sessionId: string, cwd: string | undefined): SessionSummary {
    return {
      sessionId,
      sourceId: this.id,
      kind: this.kind,
      ...(cwd !== undefined ? { cwd } : {}),
    }
  }
}

/** Opencode source defaults: `opencode acp` over stdio. */
export interface OpencodeSourceOptions {
  readonly id: string
  readonly cwd: string
  readonly env?: Record<string, string>
  readonly command?: string
  readonly args?: readonly string[]
  readonly permission?: 'allow' | 'reject'
  readonly clientName?: string
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

/** Create an opencode ACP source. */
export function createOpencodeSource(options: OpencodeSourceOptions): AcpSource {
  return new AcpSource({
    id: options.id,
    kind: 'opencode',
    label: 'opencode (ACP stdio)',
    command: options.command ?? 'opencode',
    args: options.args ?? ['acp'],
    cwd: options.cwd,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.permission !== undefined ? { permission: options.permission } : {}),
    ...(options.clientName !== undefined ? { clientName: options.clientName } : {}),
    ...(options.onExit !== undefined ? { onExit: options.onExit } : {}),
  })
}

/** dsh source defaults: `pnpm dsh --profile acp` over stdio. */
export interface DshSourceOptions {
  readonly id: string
  /** Repo root or dsh-home cwd (where `pnpm dsh` resolves). */
  readonly cwd: string
  readonly env?: Record<string, string>
  /** Override the launch command (default `pnpm`). */
  readonly command?: string
  /** Override the launch args (default `['dsh','--profile','acp']`). */
  readonly args?: readonly string[]
  readonly permission?: 'allow' | 'reject'
  readonly clientName?: string
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

/** Create a dsh ACP source. Requires DEEPSEEK_API_KEY in env for the LLM route. */
export function createDshSource(options: DshSourceOptions): AcpSource {
  return new AcpSource({
    id: options.id,
    kind: 'dsh',
    label: 'dsh (ACP stdio)',
    command: options.command ?? 'pnpm',
    args: options.args ?? ['dsh', '--profile', 'acp'],
    cwd: options.cwd,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.permission !== undefined ? { permission: options.permission } : {}),
    ...(options.clientName !== undefined ? { clientName: options.clientName } : {}),
    ...(options.onExit !== undefined ? { onExit: options.onExit } : {}),
  })
}
