# Agent Note: Automation trigger monthly gate + calendar/frequency management surface

Status: implemented

English | [中文](2026-09-07-automation-trigger-slot-dom.zh.md)

## Problem

The automation bus (`packages/automation/scheduler`) could schedule once-a-minute, once-an-hour, and once-a-day work (and weekly via the existing `slot_weekday` gate), but had no monthly unit, so a "run on the 15th" automation was not expressible in the trigger registry. On the management side, the automation console (external `dsh-external/dsh-automation-console`) rendered one flat frequency-grouped list that favored the continuously running minute-level triggers; low-frequency automations (daily/wk/monthly) had no stable day-oriented presentation, and no view communicated the cycle unit with next-run time for every trigger.

## Decision

1. **The scheduler match language gains `slot_dom`.** `Trigger.match` accepts `slot_dom?: number` (1..31), a local-timezone day-of-month gate ANDed with `atLocal`, `slot_weekday`, `slot_m_mod`, `slot_h_mod`, exactly like the weekday gate. `matches()` computes the local day-of-month from the UTC slot plus the trigger offset; `TriggerStore.validate()` rejects non-integer or out-of-range values. Monthly ("每月第N日 @HH:MM" on the minute channel, or day-channel day-of-month) becomes expressible; matching stays a pure function of pulse content.
2. **The console presents two complementary views and a week/week/month editor.** The panel (client bundle, rebuilt via tsdown) now has four tabs. 「📅 日历」lays every 每天/每周/每月 automation onto a rolling day grid (current local week's Monday onward, 2/5/9-week window) so low-frequency automations stay continuously visible: planned occurrences are marked with their wall-clock stamp, the next run carries a highlighted frame, past days carry real receipt outcomes, and sub-day interval triggers aggregate into a per-day count chip. 「⏲ 频次」groups all triggers by cycle unit (每N分钟 / 每N小时 / 每天 / 每周 / 每月 / 已停用) with last-run status, next-run absolute time plus countdown, consecutive-failure badge, and an 8-event health dot strip. 「📡 运行」holds in-flight dispatches, the run journal, the pulse clock, and disabled triggers; 「🚦 门禁」keeps the gate board. The trigger editor gains 每N小时, 每周@星期几, and 每月@第N日 schedule kinds. All schedule math runs client-side as a mirror of the scheduler's pure match rules over the raw registry (`GET /api/triggers`), with receipt history from `GET /api/overview?level=1d&bins=N` — no host restart is required for the panel itself.
3. **The console host mirror stays decoupled but current.** The console host's local `matchesPulse`/`describeMatch`/`triggerLevel` faces gain the same `slot_dom` gate and weekly/monthly labels so the `automation_overview` tool text and post-restart snapshots describe monthly rules correctly.

## Consequences

- Monthly triggers only fire after the scheduler process restarts with the `slot_dom`-aware `triggers.ts`; until then the editor can create the rule but the running pulse loop ignores the new field.
- Weekly rules already worked in the running scheduler (the `slot_weekday` gate predates this change); the console now exposes them in the editor and views.
- Interval triggers (每N分钟/每N小时) do not get per-day cells; the calendar shows them as one aggregate "N 个周期" chip per day to keep the grid readable at large registry sizes.
- Past-day cells show actual receipt outcomes; scheduled future cells show planned stamps, so a missed run is visible as an empty scheduled slot.

## Verification

- `tests/triggers.spec.ts` (new, 7 cases): daily atLocal, every-N-minutes, weekly weekday gate, monthly day-of-month gate, day-channel monthly, disabled exclusion, channel equality. Full scheduler suite: 3 files, 22 tests pass.
- Console `tsc --noEmit` clean; `tsdown` bundle rebuilt; live GUI check: the ⚙️ 控制台 tab renders the four tabs, the calendar grid carries real per-day marks (e.g. daily-data-replenish @08:00, omni-ashare-quant-daily @05:35) plus the interval chip, and the frequency view lists compiled groups with next-run countdowns.

## Related

- [Automation calendar conversation view](../architecture/2026-08-24-client-automation-calendar.md) — the session-turn calendar this surface complements (automations instead of turns).