# @deepseek-ai/dsh-automation-router

Automation gate-router: polls a `PipelineGateAdapter`, diffs snapshots, persists per-item state in a durable JSON ledger, and wakes the source session of rejected items exactly once per state. Ships as a Cordis function plugin (`automation-router`) plus the pure engine pieces for direct reuse.

## Model

- `RouterEngine.tick()` - derives wake need declaratively from the current snapshot plus the ledger; diff events stay informational.
- `FileLedger` - schema-versioned JSON file with atomic tmp+rename writes; tracks identity/state plus wake bookkeeping (`notifiedState`, retry count).
- Wake transports: `LogWakeTransport` (dry run) and `InProcessWakeTransport` (same-context session followup). A failed delivery stays un-notified and retries next tick; an unresolvable target defers silently.
- `ReleaseControlGateAdapter` - finance release-control binding over an injected caller seam; extracts rejection reasons from the gate-results trail with feedback/flat fallbacks, and resolves a lane to a live registered session only.
- Data channels behind one caller seam: `mcp-tools` binds `ctx.tools.execute` per MCP namespace (resolved via strict `ctx.get`, failing loud when absent); `http-rest` speaks `GET {httpBaseUrl}/api/v3/pipeline/status` directly, so hosts without a tool service watch the same pipeline truthfully.

## Plugin config

`serverName` (MCP namespace), `ledgerPath` (required), `pollIntervalMs` (default 60s), `transport` (`log` default | `in-process` wake delivery), `channel` (`mcp-tools` default | `http-rest`), and for `http-rest`: `httpBaseUrl` (required) plus `httpTimeoutMs` (default 15s). REST listing answers carry status-grouped issue summaries, so rejection reasons arrive only through the MCP channel today.

## Known Limitations and Deferred Work

- Cross-process wake is not implemented: lanes hosted in other processes need a bridge at the universal-plugin layer or single-context hosting; `in-process` fails loud when the agents service is absent.
- The real-composition Loader test (test-only cordis.yml with a fixture MCP server) is pending; the plugin lifecycle test boots a real Context with a mock tools service.
- Ledger growth is unbounded for long-lived pipelines; retention lands with Phase B watchers.
