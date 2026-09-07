/**
 * ACP client over a child process's stdio. Wraps `@agentclientprotocol/sdk`'s
 * client app + `ndJsonStream` so callers drive a remote ACP agent (opencode,
 * another dsh, ...) through one typed surface. Mirrors the connection pattern
 * in `dsh-subagent-acp` but is dependency-free (no Cordis, no dsh packages),
 * so it stays usable outside any harness process — a phone-side or
 * dashboard-side client can link it directly.
 *
 * @module @deepseek-ai/dsh-remote-aggregator/acp-client
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ContentBlock as AcpContentBlock,
  type InitializeResponse,
  type ListSessionsResponse,
  type McpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import type { SessionEvent, SessionEventType } from './types.ts'

/** Spawn and transport options for one ACP child. */
export interface AcpClientOptions {
  /** Executable to spawn (e.g. `opencode`). */
  readonly command: string
  /** Arguments (e.g. `['acp']`). */
  readonly args: readonly string[]
  /** Child cwd; doubles as the ACP session workspace. */
  readonly cwd: string
  /** Extra env merged on top of `process.env`. */
  readonly env?: Record<string, string>
  /** Client name reported in `initialize`; defaults to `dsh-remote-aggregator`. */
  readonly clientName?: string
  /**
   * Permission policy for child permission requests. `reject` denies every
   * prompt (default — unattended source); `allow` picks the first
   * `allow_once`/`allow_always` option. No prompt is surfaced to a human.
   */
  readonly permission?: 'allow' | 'reject'
  /** Called for each `session/update` notification the child emits. */
  readonly onUpdate?: (sessionId: string, event: SessionEvent) => void
  /** Called when the child process exits before close(). */
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

/** A connected ACP client. Use {@link AcpClient.connect} to obtain one. */
export class AcpClient {
  private child: ChildProcess | undefined
  private connection: ReturnType<ReturnType<typeof createAcpClientApp>['connect']> | undefined
  private exited = false

  constructor(private readonly options: AcpClientOptions) {}

  /** Spawn the child, open the ACP connection, and complete the `initialize` handshake. */
  async connect(): Promise<InitializeResponse> {
    if (this.connection !== undefined) throw new Error('acp-client: already connected')
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    this.child = child
    child.once('exit', (code, signal) => {
      this.exited = true
      this.options.onExit?.(code, signal)
    })
    if (child.stdin === undefined || child.stdout === undefined) {
      throw new Error('acp-client: subprocess dropped a piped protocol stream')
    }
    const app = createAcpClientApp({ name: this.options.clientName ?? 'dsh-remote-aggregator' })
      .onNotification(methods.client.session.update, ({ params }) => {
        const sid = params.sessionId
        if (typeof sid !== 'string') return
        this.options.onUpdate?.(sid, acpUpdateToEvent(params))
      })
      .onRequest(methods.client.session.requestPermission, () => {
        // Unattended source: reject by default. The aggregator surface never
        // routes a permission prompt to a human here — a future interactive
        // transport can replace this handler.
        return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      })
    const connection = app.connect(ndJsonStream(
      NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ))
    this.connection = connection
    return await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    }) as InitializeResponse
  }

  /** Create a new ACP session in `cwd`. */
  async newSession(cwd: string, mcpServers: readonly McpServer[] = []): Promise<NewSessionResponse> {
    this.assertConnected()
    const params: NewSessionRequest = { cwd, mcpServers: [...mcpServers] }
    return await this.connection!.agent.request(methods.agent.session.new, params) as NewSessionResponse
  }

  /** List resumable sessions known to the child. */
  async listSessions(): Promise<ListSessionsResponse> {
    this.assertConnected()
    return await this.connection!.agent.request(methods.agent.session.list, {}) as ListSessionsResponse
  }

  /** Resume an existing session by id; `cwd` must match the session's workspace. */
  async resumeSession(sessionId: string, cwd: string): Promise<ResumeSessionResponse> {
    this.assertConnected()
    const params: ResumeSessionRequest = { sessionId, cwd, mcpServers: [] }
    return await this.connection!.agent.request(methods.agent.session.resume, params) as ResumeSessionResponse
  }

  /** Send one user prompt and await the turn's terminal response. */
  async prompt(sessionId: string, text: string): Promise<PromptResponse> {
    this.assertConnected()
    const params: PromptRequest = {
      sessionId,
      prompt: [{ type: 'text', text }],
    }
    return await this.connection!.agent.request(methods.agent.session.prompt, params) as PromptResponse
  }

  /** Best-effort cancel of the active turn on `sessionId`. Never throws. */
  cancel(sessionId: string): void {
    if (this.connection === undefined) return
    void this.connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => {
      // Child gone or no active session — cancel is best-effort.
    })
  }

  /** Tear down: close the ACP connection, EOF the child, escalate to SIGTERM if it lingers. */
  async close(): Promise<void> {
    this.connection?.close()
    this.connection = undefined
    const child = this.child
    this.child = undefined
    if (child === undefined || this.exited) return
    child.stdin?.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        resolve()
      }, 3_000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  private assertConnected(): void {
    if (this.connection === undefined) throw new Error('acp-client: not connected — call connect() first')
  }
}

/** Project an ACP `session/update` notification onto the source's {@link SessionEvent}. */
function acpUpdateToEvent(params: SessionNotification): SessionEvent {
  const update = params.update as { sessionUpdate: string; content?: AcpContentBlock; toolName?: string }
  const type = mapUpdateType(update.sessionUpdate)
  if (type === 'message' && update.content !== undefined) {
    return {
      type,
      role: 'assistant',
      content: update.content.type === 'text' ? update.content.text : '',
      at: Date.now(),
      raw: params,
    }
  }
  return {
    type,
    ...(update.toolName !== undefined ? { toolName: update.toolName } : {}),
    at: Date.now(),
    raw: params,
  }
}

function mapUpdateType(update: string): SessionEventType {
  switch (update) {
    case 'agent_message_chunk': return 'message'
    case 'tool_call': return 'tool_call'
    case 'tool_result': return 'tool_result'
    case 'status': return 'status'
    default: return 'status'
  }
}
