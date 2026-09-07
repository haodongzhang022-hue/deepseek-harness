/**
 * Automation Calendar target builder: derives turn timings from the assembled
 * Conversation timeline so the calendar grid holds timing data independent of
 * the chat target. The old session snapshot exposed these timings directly;
 * the new architecture derives them here from Turn boundary events.
 * @module ui-automation-calendar/client/calendar-snapshot-builder
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationTimelineSnapshot, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One turn's start/end timing, the calendar model's core input. */
export interface CalendarTurnTiming {
  readonly startTime: number
  readonly endTime?: number
}

/** Independently assembled data consumed by the Calendar view. */
export interface CalendarSnapshot {
  readonly turnTimings: ReadonlyMap<number, CalendarTurnTiming>
}

/** Stable empty Turn map shared before a Session has assembled any turns. */
const EMPTY_TURN_TIMINGS: ReadonlyMap<number, CalendarTurnTiming> = new Map()

/** Stable empty Calendar target used until a Session has assembled turns. */
export const EMPTY_CALENDAR_SNAPSHOT: CalendarSnapshot = {
  turnTimings: EMPTY_TURN_TIMINGS,
}

function buildTimings(
  timeline: ConversationTimelineSnapshot,
): ReadonlyMap<number, CalendarTurnTiming> {
  const turnTimings = new Map<number, CalendarTurnTiming>()
  for (const turn of timeline.turns.values()) {
    if (turn.start === undefined) continue
    turnTimings.set(turn.turn, {
      startTime: turn.start.time,
      ...(turn.end === undefined ? {} : { endTime: turn.end.time }),
    })
  }
  return turnTimings
}

/**
 * Minimal incremental Calendar target. Nodes carry no Calendar-specific data;
 * the full snapshot is re-derived from the timeline on every publish because
 * Turn boundary events can land without a new Node.
 */
export class CalendarSnapshotBuilder
  implements ConversationViewBuilder<ConversationViewNode, CalendarSnapshot> {
  readonly empty = EMPTY_CALENDAR_SNAPSHOT
  private turnTimings: ReadonlyMap<number, CalendarTurnTiming> = EMPTY_TURN_TIMINGS

  replace(input: {
    readonly nodes: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): CalendarSnapshot {
    this.turnTimings = buildTimings(input.timeline)
    return this.snapshot()
  }

  apply(input: {
    readonly upserts: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): CalendarSnapshot {
    this.turnTimings = buildTimings(input.timeline)
    return this.snapshot()
  }

  private snapshot(): CalendarSnapshot {
    return { turnTimings: this.turnTimings }
  }
}

/** Calendar target factory registered into the Conversation view registry. */
export const calendarViewDefinition: ConversationViewDefinition<
  ConversationViewNode,
  CalendarSnapshot
> = {
  target: 'calendar',
  create: () => new CalendarSnapshotBuilder(),
}

/**
 * Register the incremental Calendar target builder.
 * @param ctx - owning UI Conversation context.
 */
export function registerCalendarConversationView(ctx: Context): void {
  ctx.uiConversation.views.register(calendarViewDefinition)
}