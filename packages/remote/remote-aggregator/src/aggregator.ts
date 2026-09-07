/**
 * Aggregator over multiple {@link SessionSource} instances. Presents a unified
 * session list, dispatches observe/send/subscribe to the owning source by id,
 * and routes each source's live events through the same interface.
 *
 * The aggregator is transport-agnostic: it only consumes the SessionSource
 * interface. Adding a source (a new opencode child, a remote dsh over
 * WebSocket, ...) never touches the business logic that calls it. This is the
 * cross-end decoupling seam: a phone-side client can drive the same aggregator
 * over a future WebSocket transport without changing a line here.
 *
 * @module @deepseek-ai/dsh-remote-aggregator/aggregator
 */

import type {
  SendResult, SessionEvent, SessionSnapshot, SessionSource, SessionSummary, Unsubscribe,
} from './types.ts'

/** Cross-source session locator: the owning source id plus the session id. */
export interface AggregatedSessionId {
  /** The owning source id. */
  readonly sourceId: string
  /** The session id within that source. */
  readonly sessionId: string
}

export class RemoteAggregator {
  private readonly sources = new Map<string, SessionSource>()

  /** Register a source. Idempotent if `source.id` is unique. */
  addSource(source: SessionSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`remote-aggregator: source already registered: ${source.id}`)
    }
    this.sources.set(source.id, source)
  }

  /** Remove a source and release its resources. */
  async removeSource(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId)
    if (source === undefined) return
    this.sources.delete(sourceId)
    await source.close()
  }

  /** List sessions across all sources, tagged with their owning source id. */
  async list(): Promise<readonly SessionSummary[]> {
    const results = await Promise.all(
      [...this.sources.values()].map(async (source) => {
        try { return await source.list() } catch { return [] as const }
      }),
    )
    return results.flat()
  }

  /** Read one session by (sourceId, sessionId). */
  async observe(sourceId: string, sessionId: string): Promise<SessionSnapshot> {
    return await this.source(sourceId).observe(sessionId)
  }

  /** Send a message to one session. */
  async send(sourceId: string, sessionId: string, message: string): Promise<SendResult> {
    return await this.source(sourceId).send(sessionId, message)
  }

  /** Subscribe to live events from one session. Returns an unsubscribe handle. */
  subscribe(sourceId: string, sessionId: string, handler: (event: SessionEvent) => void): Unsubscribe {
    return this.source(sourceId).subscribe(sessionId, handler)
  }

  /** Cancel the active turn on one session. */
  async cancel(sourceId: string, sessionId: string): Promise<void> {
    await this.source(sourceId).cancel(sessionId)
  }

  /** Shut down all sources. */
  async close(): Promise<void> {
    const sources = [...this.sources.values()]
    this.sources.clear()
    await Promise.allSettled(sources.map((source) => source.close()))
  }

  private source(sourceId: string): SessionSource {
    const source = this.sources.get(sourceId)
    if (source === undefined) throw new Error(`remote-aggregator: unknown source: ${sourceId}`)
    return source
  }
}
