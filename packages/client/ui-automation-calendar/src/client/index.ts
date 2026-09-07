/**
 * Automation Calendar client entry - registers the locale dictionary and the
 * 'conversation.view' list-slot entry that mounts the calendar component.
 * @module ui-automation-calendar/client/index
 */

import type { Context, Service } from '@deepseek-ai/cordis'
import { calendarEn, calendarZh, CALENDAR_LOCALE_NS } from './locales.ts'
import { CalendarRoot } from './components/CalendarRoot.tsx'

export const name = 'ui-automation-calendar'

/**
 * Slot dependencies: registry seats for composition, locale for the seat
 * binding below. Everything else arrives through standard-kit props shares.
 */
export const inject = ['slots', 'locale'] as const

export function apply(ctx: Context): void {
  ctx.locale.register(CALENDAR_LOCALE_NS, { zh: calendarZh, en: calendarEn })

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: CALENDAR_LOCALE_NS,
    id: 'automation-calendar',
    order: 11,
    locale: CALENDAR_LOCALE_NS,
    label: 'view.calendar',
    inject: () => ({
      navigateToSession: (sessionId: string) => void ctx.sessions.open(sessionId as never),
    }),
  }), CalendarRoot as unknown as Service)
}
