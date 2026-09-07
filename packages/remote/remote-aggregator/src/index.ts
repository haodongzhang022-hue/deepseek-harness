/**
 * Decoupled remote session aggregation. Drives external ACP agents (opencode,
 * etc.) through a unified {@link SessionSource} interface so a caller — the
 * harness Web, a phone-side PWA, a remote dashboard — can list, observe,
 * send, and subscribe across backends without per-backend branching.
 *
 * The package carries no dsh or Cordis dependency; it speaks ACP over stdio
 * (today) and is ready for a WebSocket transport (cross-end phase) without
 * interface changes.
 *
 * @module @deepseek-ai/dsh-remote-aggregator
 */

export type {
  SessionSource,
  SessionSummary,
  SessionSnapshot,
  SessionEvent,
  SessionEventType,
  SessionRole,
  SessionKind,
  SessionStatus,
  SendResult,
  Unsubscribe,
  SourceTransport,
  TransportKind,
} from './types.ts'

export { AcpClient, type AcpClientOptions } from './acp-client.ts'
export {
  AcpSource,
  type AcpSourceOptions,
  createOpencodeSource,
  type OpencodeSourceOptions,
  createDshSource,
  type DshSourceOptions,
} from './acp-source.ts'
export { RemoteAggregator, type AggregatedSessionId } from './aggregator.ts'
