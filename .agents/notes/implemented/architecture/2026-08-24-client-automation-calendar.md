# Client automation-calendar conversation view

Date: 2026-08-24

## Context

The web GUI had no time-oriented view of what a session's automation actually did: turns were visible only as a linear transcript. Users managing periodic AI tasks need to see when work ran, at which granularity it repeats, and when something went sideways (stuck turns, failure bursts, duration outliers) without reading the log.

## Decision

Add `packages/client/ui-automation-calendar`, a pure-consumer conversation-view plugin:

- It registers one `conversation.view` list entry (`id: 'automation-calendar'`) via `ctx.slots.inject` and the `calendar` locale dictionary. No service, no store — viewing state (granularity, window, selection, expanded cycle groups) is component-local because no cross-entry or remount-surviving consumer exists.
- All data derives from the standard-kit snapshot slices (`turnTimings`/`running`/`lastAgentError`) through `useSession` selectors; the model experience is zero-token / zero-KV-cache by construction.
- Time granularity lives in one contract table (16 builtin levels); custom levels register on the engine singleton and persist in browser `localStorage` (`dsh.automation-calendar.custom-granularities`), not user settings.
- Cycle detection claims each task into at most one pattern (confidence-descending greedy claiming): a strict hourly series is an interval group and never also a daily-cron group.

## Rejected alternatives

- **A host-side resource collector now** (CPU/GPU/storage per task): the contracts reserve the fields, but no current producer exists; shipping a collector without evidence would fake precision. Deferred until a consumer justifies it — see the package README's Known Limitations.
- **Cross-session aggregation in v1**: requires a host-side rollup service over persisted sessions; out of scope for a view that must stay a pure projection of one loaded session.
- **Settings-plugin persistence for custom granularities**: heavier wiring for a single-browser preference; revisit if levels need to roam.

## Consequences

- The tab reads only today's `ConversationSnapshot`; richer per-task facts wait on a `SessionEventMap` extension, which would be required-on-read and therefore needs its own decision.
- Anomaly/stuck findings are informational banners; click-through to a task needs an owner-prop route added to the slot contract later.

## Verification

- `node node_modules\vitest\vitest.mjs run packages/client/ui-automation-calendar/tests` — 31 tests across engines (granularity/cycles/errors/anomalies) and the view-model hook.
- Registration surfaces checked present: root `tsconfig.client.json`, `packages/bundle/web-app/cordis.patch.yml`, `packages/bundle/web-app/package.json`.