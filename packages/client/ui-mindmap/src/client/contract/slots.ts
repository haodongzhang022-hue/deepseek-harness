/**
 * Mind-Map slot contract (entry shell). The archived design defined a full
 * canvas extension surface (node renderers, edge renderers, canvas API); none
 * of it is wired yet. This package currently contributes one mount: the
 * 'conversation.view' tab. The injected share is a discrete stage marker so the
 * placeholder can surface its backlog status without fabricating a canvas API.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view') into
// every program that sees this contract; ui-conversation owns the declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Registrant-private injected share (arrives via the register inject factory).
 */
export type MindMapInjected = {
  /** Backlog stage of the canvas implementation; 'entry-shell' today. */
  readonly stage: 'entry-shell'
}

/** Runtime share of the mount seat: the session-scope conversation view tab. */
export type MindMapRuntimeProps = PropsRuntime<'conversation.view'>

/** Full component props: session-scope runtime share, inject, and locale seat. */
export type MindMapComponentProps =
  MindMapRuntimeProps
  & MindMapInjected
  & PropsLocale<'mindmap'>