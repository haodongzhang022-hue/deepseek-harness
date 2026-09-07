/**
 * Shared translator type for calendar components.
 * @module ui-automation-calendar/client/components/translate
 */

import type { CalendarKey } from '../locales.ts'

/** The locale seat's translate function as components consume it. */
export type Translate = (key: CalendarKey) => string
