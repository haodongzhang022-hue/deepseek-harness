/**
 * Automation Calendar slot contract: the registrant-side props composition for
 * the conversation-view calendar slot and its child holes.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view') into
// every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The automation calendar view - task timeline with resource monitoring,
     * rendered as one entry of the 'conversation.view' list slot.
     */
    'calendar.view': {
      kind: 'single'
      scope: 'session'
      owner: CalendarOwnerProps
    }

    /**
     * Task details body - the selected task's facts panel inside the calendar.
     */
    'calendar.task.details': {
      kind: 'single'
      scope: 'session'
      owner: TaskDetailsOwnerProps
    }
  }
}

/**
 * Owner share of the calendar view hole. sessionId/useSession ride the
 * session-scope standard kit (PropsRuntime), never the owner share.
 */
export interface CalendarOwnerProps {}

/** Owner share of the task details hole. */
export interface TaskDetailsOwnerProps {
  /** The selected task id, null when the panel is closed. */
  taskId: string | null
  /** Close the details panel. */
  onClose: () => void
}

/**
 * Registrant-private injected share (arrives via the register inject factory).
 */
export type CalendarInjected = {
  /** Open the session a task belongs to. */
  navigateToSession: (sessionId: string) => void
}

/**
 * Full component props: runtime share (standard kit + owner) plus the declared
 * holes' render shares, this package's injected callbacks, and the locale seat.
 */
export type CalendarComponentProps =
  PropsRuntime<'calendar.view'>
  & PropsRenderSlots<'calendar.task.details'>
  & CalendarInjected
  & PropsLocale<'calendar'>
