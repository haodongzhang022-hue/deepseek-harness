# Automation gates panel: pipeline state in the web GUI

Status: PROPOSED — not implemented.

## Request

The user wants the gate-pipeline table visible inside the dsh web GUI, in the wide right-side area of the conversation view (the same region the automation-calendar occupies), with three filters: this conversation only, current project folder only, and everything.

## Data path decision

- Gate truth lives host-side: per-gate ledgers plus each watcher tick summary (`packages/automation/router`). The browser cannot read those files; a transport is required.
- Rejected first: session frames. Jobs reach the browser as `frame.jobs` folded into the `jobsBySession` mirror, but gate items are pipeline-global, not session-scoped; stuffing them into session frames misstates ownership and drags protocol changes through replay.
- Chosen direction: a dedicated global list mirror, the same shape as `jobsBySession` but keyed by nothing session-specific:
  1. Host: the router daemon keeps an authoritative snapshot per configured gate (items with id/lane/state/notifiedState/notifyCount/wakeTarget/updatedAt) and publishes on every tick that changes it (publish at commit point).
  2. Wire: one broadcast frame or SSE event carrying `{ gates: GateSnapshot[] }`; the connection layer treats it like job frames — replace-not-merge, initiator-owned ids stay host-minted.
  3. Runtime: `SessionManager` (or its sibling object-layer store) folds it into `gatesSnapshot`, exposed through the existing client services face.
  4. Client plugin `ui-automation-gates`: injects into `conversation.view` beside the calendar entry, renders the table from a `useGates()` framework hook bound to that mirror; zero RPC in the plugin, mirroring ui-jobs.

## Filters

- 全部: every gate row.
- 本对话: rows whose recorded wake target equals the open session id. Requires the ledger/engine to record the resolved wake target at delivery time (small engine change: pass the target into markNotified bookkeeping).
- 项目文件夹: rows whose source lane resolves under the workspace currently open (lane-to-workspace mapping arrives with Phase C intake; until then this filter groups by adapter/gate name, which for the finance pipeline equals the omni-meta project).

## Non-goals / deferrals

- No editing actions from the panel in v1 (read-only observation); resubmit stays in the owning conversation.
- No new session-log events: panel data is presentation-side computed state, not model-visible input.
