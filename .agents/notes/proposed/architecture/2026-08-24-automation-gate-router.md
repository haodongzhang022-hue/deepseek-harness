# Automation gate-router: generic pipeline monitoring with pluggable adapters

Date: 2026-08-24
Status: proposed — Phase A implementation target

## Context

The omni-meta quantitative-finance project runs a working release pipeline: test agents on ports 8009-8016 iterate against the 8066 baseline, submit changes into the 8008 integration queue, an integrator tests and approves or rejects with evidence, passing items reach 8027 deployment verification and then 8028/8066 promotion. Today every step fires through manually invoked MCP tool calls; nothing watches the queue. Rejected work stalls because no mechanism routes the rejection back to the originating agent session.

This harness also ships a general-purpose automation-calendar view. The user's direction: build the monitoring/routing layer as GENERIC capability in this repo, borrowing the finance pipeline's shape but not coupling to it. A separate effort will extract the finance release-control service into a universal plugin; this router must adapt to BOTH without rework.

## Decision

Four layers, one seam:

1. **Gate contract (generic, lives here).** A narrow adapter interface over any gate pipeline:
   - `listItems(state?)` — snapshot of queue/testing/rejected/approved items
   - `itemIdentity(item)` → stable id + source port + target-session hint
   - `recordResult(...)`, `claim(...)` — command half, per adapter capability
   Adapter implementations: (a) finance release-control via its official stdio MCP server (`python -m release_control.mcp_server`) driven by this repo's mcp-client package — no REST reverse-engineering; (b) reserved slot for the future universal plugin.

2. **Router engine (generic).** Poll adapter on interval, diff snapshots into events (`submitted`/`rejected`/`approved`), keep one durable state row per item (`queued→testing→passed|rejected→notified→reiterating→resubmitted`), and dispatch actions. State machine table is data, not code paths, so new pipelines only add rows.

3. **Wake transport (dsh-native).** Rejection wake = SDK `prompt({ sessionId, contentBlocks })` — server resolves the retained agent and calls `followup(createUserMessage(...))`. The message carries rejection reason + evidence + original objective so the SAME conversation continues iterating with full context. Registry heartbeats (session_id + TTL) decide live-vs-restart before delivery.

4. **Watchers as consumers of the same engine** (Phase B): 8008/8027/8028 become config entries — claim when an item arrives and capacity is live, record result, idle-wait. Phase C intake maps a fresh requirement to a port/session via capability match.

## What we gave up

- **Reverse-engineering the finance REST API**: the MCP stdio surface is the service's official contract and already versioned; HTTP scraping would break silently on their upgrades.
- **Hardcoding port numbers in the engine**: ports are adapter configuration; the engine sees identities and capabilities only. This is what keeps the future universal plugin a drop-in.
- **New-session-on-reject**: waking must reuse the originating session — context continuity IS the point; a fresh session would re-read the world.

## Consequences

- The finance pipeline gains unattended iteration overnight; humans step in only where `record_production_decision` already demands it.
- When the universal plugin lands, onboarding a pipeline = one adapter file + state-table rows, zero engine changes.
- Misdelivery risk: if a session id dies between heartbeat and prompt, the router retries with backoff and marks `notify-failed` for human routing rather than dropping the item.

## Verification

- Phase A acceptance: seed one rejected item in 8008; router (running) delivers a followup to the registered source session within one poll interval; item state transitions recorded; duplicate delivery suppressed across restarts.
- Contract tests run against a fake adapter; finance adapter gets a thin smoke behind a feature flag.