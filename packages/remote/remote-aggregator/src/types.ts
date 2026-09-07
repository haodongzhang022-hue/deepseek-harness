/**
 * Decoupled session-source contract for cross-device control. A SessionSource
 * abstracts one controllable agent backend (a local dsh runtime, a remote
 * opencode ACP child, a remote opencode HTTP server, ...). Aggregators and
 * transports consume this interface; they never reach for concrete backends.
 *
 * The interface carries no dsh or Cordis dependency, so an out-of-process
 * client (a phone, a remote dashboard) can implement it against any reachable
 * backend without pulling the harness runtime.
 *
 * @module @deepseek-ai/dsh-remote-aggregator/types
 */

/** Backend family, surfaced for presentation grouping only. */
export type SessionKind = 'dsh' | 'opencode' | 'unknown'

/** A live session's run state, when the backend reports one. */
export type SessionStatus = 'idle' | 'busy' | 'waiting' | 'error'

/** A live session's high-level summary, surfaced by {@link SessionSource.list}. */
export interface SessionSummary {
  /** Stable id within this source's namespace. */
  readonly sessionId: string
  /** Owning source id; the aggregator prefixes this to disambiguate cross-source. */
  readonly sourceId: string
  /** Backend kind, for presentation grouping. */
  readonly kind: SessionKind
  /** Absolute workspace path, when the backend reports one. */
  readonly cwd?: string
  /** Creation time epoch ms, when known. */
  readonly createdAt?: number
  /** Human-readable title, when the backend surfaces one. */
  readonly title?: string
  /** Selected capability/agent/preset — the per-session "能力" of this session. */
  readonly preset?: string
  /** Current run state. */
  readonly status?: SessionStatus
}

/** One item in a session's message stream. */
export interface SessionEvent {
  readonly type: SessionEventType
  readonly role?: SessionRole
  /** Plain-text content for message/text events; omitted for tool/status-only events. */
  readonly content?: string
  /** Tool name, when this event is a tool boundary. */
  readonly toolName?: string
  /** Epoch ms, when the backend reports one. */
  readonly at?: number
  /** Raw backend-native payload, for callers that need fields beyond this projection. */
  readonly raw?: unknown
}

export type SessionEventType = 'message' | 'tool_call' | 'tool_result' | 'status' | 'error'
export type SessionRole = 'user' | 'assistant' | 'tool' | 'system'

/** A point-in-time read of one session's current message stream. */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly sourceId: string
  readonly meta: SessionSummary
  /** Ordered events; an empty list is a fresh session. */
  readonly events: readonly SessionEvent[]
}

/** A handle returned by {@link SessionSource.subscribe}; call it to stop delivery. */
export type Unsubscribe = () => void

/** Result of {@link SessionSource.send}: the backend accepted the message. */
export interface SendResult {
  /** Backend-assigned message id, when available. */
  readonly messageId?: string
}

/**
 * One controllable agent backend. Implementations live behind this interface;
 * the aggregator and transports never reach past it.
 *
 * Implementations own their transport: an in-process source calls the runtime
 * directly; an out-of-process source spawns a child or opens a socket. The
 * interface is identical either way.
 */
export interface SessionSource {
  /** Stable id; the aggregator uses this to prefix session ids. */
  readonly id: string
  /** Backend kind for presentation. */
  readonly kind: SessionKind
  /** Human label for diagnostics. */
  readonly label: string

  /** List resumable/known sessions on this source. */
  list(): Promise<readonly SessionSummary[]>
  /** Read the current message stream of one session. */
  observe(sessionId: string): Promise<SessionSnapshot>
  /** Send one user message; resolves when the backend accepted it. */
  send(sessionId: string, message: string): Promise<SendResult>
  /** Subscribe to live events from one session. Returns an unsubscribe handle. */
  subscribe(sessionId: string, handler: (event: SessionEvent) => void): Unsubscribe
  /** Request cancellation of the active turn on a session. */
  cancel(sessionId: string): Promise<void>
  /** Release this source's resources (subprocess, socket, ...). */
  close(): Promise<void>
}

/**
 * Transport seam for cross-device sources. A local source uses in-process
 * calls; a remote source uses WebSocket/HTTP. The seam is reserved for the
 * cross-end phase: the initial ACP source implements {@link SessionSource}
 * directly over stdio, and a future WebSocketTransport swaps in for the
 * phone/tablet client without touching the aggregator or business logic.
 */
export interface SourceTransport {
  readonly kind: TransportKind
  close(): Promise<void>
}

export type TransportKind = 'in-process' | 'stdio' | 'http' | 'websocket'
