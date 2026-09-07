/**
 * Automation Calendar slot contract: the registrant-side props composition for
 * the conversation view tab and the injected navigation face, plus the
 * `useCalendar` standard-hook name this session-scoped view consumes.
 */
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view') and
// the target assembly types into every program that sees this contract;
// ui-conversation owns the slot declaration, this package only contributes an
// entry and targets.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CalendarSnapshot } from '../calendar-snapshot-builder.ts'

/**
 * Registrant-private injected share (arrives via the register inject factory).
 */
export type CalendarInjected = {
  /** Open the session a task belongs to. */
  navigateToSession: (sessionId: string) => void
}

/** Selector hook over the current Conversation binding's Calendar target. */
export type UseCalendar = SnapshotSelectorHook<CalendarSnapshot>

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled timing data consumed by the Calendar view. */
    calendar: CalendarSnapshot
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's Calendar target. */
    useCalendar: UseCalendar
  }
}

/**
 * Runtime share of the mount seat: the conversation view tab
 * ('conversation.view'). It is a session-scope slot delivering the standard
 * kit; the view tab's extra owner props (the inspect handoff) are ignored by
 * this pure presenter.
 */
export type CalendarRuntimeProps =
  PropsRuntime<'conversation.view'>

/**
 * Full component props: the session-scope runtime share of the mount seat
 * plus this package's injected callbacks and the calendar locale seat.
 */
export type CalendarComponentProps =
  CalendarRuntimeProps
  & CalendarInjected
  & PropsLocale<'calendar'>