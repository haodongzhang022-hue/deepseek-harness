/**
 * Automation Calendar client entry - registers the locale dictionary and the
 * 'conversation.view' tab (the 日历页). Turn timing data comes from a
 * package-owned 'calendar' conversation target assembled from the session
 * timeline, exposed to the view as the standard `useCalendar` hook.
 * @module ui-automation-calendar/client/index
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation)
// must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Pulls the renderer Context merge (ctx.uiSession, ctx.uiConversation) and the
// slots Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Pulls the SessionStandardProps merge ('useSession') into the runtime props.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { calendarEn, calendarZh, CALENDAR_LOCALE_NS } from './locales.ts'
import {
  EMPTY_CALENDAR_SNAPSHOT, registerCalendarConversationView,
  type CalendarSnapshot,
} from './calendar-snapshot-builder.ts'
import { CalendarRoot } from './components/CalendarRoot.tsx'
import type { CalendarInjected } from './contract/slots.ts'

export const name = 'ui-automation-calendar'

/**
 * Slot dependencies: registry seats for composition, the locale service for
 * the seat binding, the sessions service the inject face navigates with, and
 * the conversation/UI-session registries that assemble and expose the calendar
 * target. Everything else arrives through standard-kit props shares.
 */
export const inject = ['slots', 'locale', 'sessions', 'uiSession', 'uiConversation'] as const

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(CALENDAR_LOCALE_NS, { zh: calendarZh, en: calendarEn }), 'ui-automation-calendar: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(CALENDAR_LOCALE_NS)

  const calendarSources = new WeakMap<SessionBinding, ObservableSnapshot<CalendarSnapshot>>()
  const calendarSource = (binding: SessionBinding): ObservableSnapshot<CalendarSnapshot> => {
    let source = calendarSources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('calendar')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_CALENDAR_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      calendarSources.set(binding, source)
    }
    return source
  }

  registerCalendarConversationView(ctx)
  ctx.uiSession.provide({
    hooks: ['calendar'],
    resolve: binding => ({ hooks: { calendar: calendarSource(binding) } }),
  })

  const injectCalendar = (): CalendarInjected => ({
    navigateToSession: (sessionId: string) => void ctx.sessions.open(sessionId as SessionId),
  })

  // Primary mount: the conversation view tab (会话轮次 — the session turn
  // calendar moved behind the automation console's 自动化日历 entry).
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'automation-calendar',
    order: 12,
    locale: CALENDAR_LOCALE_NS,
    label: () => t('view.calendar'),
    inject: injectCalendar,
  }, CalendarRoot))
}
