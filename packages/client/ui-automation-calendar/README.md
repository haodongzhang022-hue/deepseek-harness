# @deepseek-ai/dsh-client-ui-automation-calendar

Automation task calendar: a conversation-view tab that lays the current session's agent turns on a selectable time granularity (16 builtin levels from sub-second to month, plus user-defined levels), folds periodic series into expandable cycle-group rows, and surfaces stuck-task warnings, structured anomalies, and resource-density context.

## Model Experience

- **Token cost: zero.** The calendar is a pure projection over the already-delivered conversation snapshot (`turnTimings`, `running`, `lastAgentError`). It issues no model requests, injects no context, and adds nothing to any prompt.
- **KV-cache effect: none.** No plugin-owned context enters the request path; switching to or interacting with the tab never invalidates cached turns.
- **Latency: view-local.** All aggregation (bucketing, cycle detection, stuck classification, anomaly scoring) runs in `useMemo` over selector slices, so only the tab's own render reacts to its inputs.

## Composition

Pure-consumer plugin — no service. Registers one `conversation.view` entry (`id: 'automation-calendar'`, order 11) through `ctx.slots.inject` plus the `calendar` locale dictionary. The view reads the session-scope standard kit (`useSession`/`sessionId`) and derives everything else; navigation back into a task's session rides the injected `navigateToSession` callback.

### Time granularity

`contract/time-granularity.ts` is the single home of the level table: each level carries interval, tick format, and a collapse threshold. `TimeGranularityEngine.addPersistentCustomGranularity()` registers a level in memory and in `localStorage` (key `dsh.automation-calendar.custom-granularities`) so it survives reloads; the inline form in the granularity dropdown creates them. `mapIntervalToGranularity()` projects a detected cycle period onto the smallest level at or above it — an hourly loop lands on the hour row, a daily one on the day row.

### Cycle detection

`engine/cycle-detector.ts` groups tasks per agent, then matches fixed-interval and cron-shaped (daily/weekly) patterns. One task belongs to at most one pattern: candidates compete by confidence (strongest first), and a candidate dissolves when exclusivity leaves it below the minimum group size — a strict hourly series is one interval group, never also a daily one.

### Stuck classification

`engine/error-analyzer.ts` flags running turns whose silence exceeds their threshold (default 30 minutes, warning at 1×, critical at 2×) with a human recommendation. `detectStuckTasks` takes an injectable clock so replayed logs classify identically regardless of wall time.

### Anomaly detection

`engine/anomaly-detector.ts` emits typed findings over the window: duration outliers via median/MAD robust z-score (>2), and failure bursts (3+ consecutive failed tasks). The banner renders each finding with a plain-language description.

## Known Limitations and Deferred Work

- **Single-session scope.** The view aggregates only the conversation snapshot of the session it renders in; cross-session automation inventory needs a host-side rollup that does not exist yet.
- **Resource metrics are token/duration-only today.** CPU/GPU/storage/network fields exist in the contracts and aggregators but no collector feeds them; the density heatmap therefore normalizes on tokens and duration alone.
- **Cycle detection thresholds are fixed constants** (20% interval deviation, 0.5 confidence floor, 60%/50% hour/day dominance). They will mis-split mixed workloads until a consumer justifies a config knob.
- **Custom-granularity persistence is browser-local.** Levels live in this browser's `localStorage`, not in user settings; they do not roam across machines and are invisible to the settings plugin.
- **Anomaly findings are informational.** The banner has no click-through to the offending task yet; wiring findings to `onTaskClick` needs an owner-prop route.
