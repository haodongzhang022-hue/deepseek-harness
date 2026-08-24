# @deepseek-ai/dsh-automation-scheduler

Calendar-style automation trigger: fires configured exec/HTTP actions on interval schedules with per-fire timeouts, multiplicative failure backoff, fleet de-synchronization jitter, and an append-only NDJSON audit journal. This is the piece external pipelines hang idempotent once-endpoints onto (frequency, staggering, and retry policy live here; the endpoint guarantees its own safety).

## Model

- `SchedulerEngine.sweep()` - fires every due job; the plugin sweeps on a fixed cadence so schedule granularity equals `sweepIntervalMs`.
- Actions: `exec` (child process, exit code is the verdict) or `http` (JSON request, 2xx is the verdict).
- Backoff: consecutive failures double the next interval up to eight base intervals; any success resets.
- Journal: one `{at, job, ok, detail, durationMs}` line per fire - the audit trail for idempotent external endpoints.

## Known Limitations and Deferred Work

- Interval schedules only (`everyMs` + optional `jitterMs`); cron expressions land with the calendar UI integration.
- No persistence of backoff/due state across restarts: a restart may re-fire immediately, which is safe only against idempotent endpoints (the contract this package documents).
