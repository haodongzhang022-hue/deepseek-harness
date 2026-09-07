/**
 * '@' agent-directory source: registers the architect-team directory as a
 * second '@' trigger source that renders ABOVE the built-in reference source
 * (files/sessions). The unified trigger menu then shows clear categories —
 * 智能体 first, then 文件与文件夹 / 对话 — so role/agent candidates are never
 * buried under session memory.
 *
 * The empty query shows the whole directory (the point of '@' discovery); a
 * query narrows by substring match. Picks insert the plain '@架构·X' text —
 * no structured reference, no codec — which the prompt pipeline ships as-is.
 *
 * The source shape follows the input-trigger provider contract by duck type
 * (same pattern as the conversation InputHub's service face): the runtime
 * value is passed to the pipeline's registerSource, which casts it to its own
 * InputTriggerSource; the local fields must stay structurally compatible.
 */
import { directoryResolver } from './at-mention-directory.ts'

/** Section title key in the conversation dictionary. */
export type AtMentionSectionKey = 'mention.section.agents'
export const AT_MENTION_SECTION_KEY: AtMentionSectionKey = 'mention.section.agents'

/** Structural subset of InputTriggerCandidate the source emits. */
export interface AgentDirectoryCandidate {
  readonly name: string
  readonly description?: string
  readonly section: string
  readonly value: string
}

/** Structural subset of InputTriggerSource the pipeline consumes. */
export interface AgentDirectorySource {
  readonly trigger: '@'
  readonly name: string
  readonly order?: number
  readonly showGroupTitle?: boolean
  candidates(
    session: { readonly sessionId: string },
    req: { readonly query: string; readonly signal: AbortSignal },
  ): Promise<readonly AgentDirectoryCandidate[]>
  onPick(pick: {
    readonly candidate: AgentDirectoryCandidate
    readonly action: 'pick' | 'drill'
  }): { readonly text: string } | undefined
}

/**
 * Build the '@' agent-directory source.
 * @param t - bound conversation dictionary (section title only).
 * @returns the trigger source for the pipeline's registerSource.
 */
export function createAgentDirectorySource(t: (key: AtMentionSectionKey) => string): AgentDirectorySource {
  const section = t(AT_MENTION_SECTION_KEY)
  return {
    trigger: '@',
    name: 'agent-directory',
    // Above the built-in reference source (default order 0): roles first.
    order: -1,
    // Section titles within the group replace the source-title row.
    showGroupTitle: false,
    async candidates(_session, { query, signal }) {
      if (signal.aborted) return []
      const resolved = await directoryResolver(query)
      return resolved.map(candidate => ({
        name: candidate.insert,
        ...(candidate.detail === undefined ? {} : { description: candidate.detail }),
        section,
        value: JSON.stringify({ insert: candidate.insert }),
      }))
    },
    onPick({ candidate }) {
      try {
        const parsed = JSON.parse(candidate.value ?? '{}') as { insert?: string }
        if (parsed.insert !== undefined && parsed.insert !== '') {
          return { text: parsed.insert + ' ' }
        }
      } catch {
        // Unparseable value falls through to the name-derived fallback.
      }
      return { text: `${candidate.name} ` }
    },
  }
}