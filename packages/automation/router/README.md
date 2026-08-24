# @deepseek-ai/dsh-automation-router

Automation gate-router: polls a `PipelineGateAdapter`, diffs snapshots, persists per-item state in a durable JSON ledger, and wakes the source session of rejected items exactly once per state. Ships as a Cordis function plugin (`automation-router`) plus the pure engine pieces for direct reuse.

## Model

- `RouterEngine.tick()` - derives wake need declaratively from the current snapshot plus the ledger; diff events stay informational.
- `FileLedger` - schema-versioned JSON file with atomic tmp+rename writes; tracks identity/state plus wake bookkeeping (`notifiedState`, retry count).
- Wake transports: `LogWakeTransport` (dry run) and `InProcessWakeTransport` (same-context session followup). A failed delivery stays un-notified and retries next tick; an unresolvable target defers silently.
- `ReleaseControlGateAdapter` - finance release-control binding over an injected caller seam (bound to `ctx.tools.execute` by the plugin); extracts rejection reasons from the gate-results trail with feedback/flat fallbacks, and resolves a lane to a live registered session only.

## Plugin config

`serverName` (MCP namespace), `ledgerPath` (required), `pollIntervalMs` (default 60s), `transport` (`log` default | `in-process`).

## Known Limitations and Deferred Work

- Cross-process wake is not implemented: lanes hosted in other processes need a bridge at the universal-plugin layer or single-context hosting; `in-process` fails loud when the agents service is absent.
- The real-composition Loader test (test-only cordis.yml with a fixture MCP server) is pending; the plugin lifecycle test boots a real Context with a mock tools service.
- Ledger growth is unbounded for long-lived pipelines; retention lands with Phase B watchers.
