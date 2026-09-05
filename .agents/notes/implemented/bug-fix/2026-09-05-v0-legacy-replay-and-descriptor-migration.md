# Agent Note: v0 migration normalizes legacy pi-ai replay envelopes and subagent descriptors

Status: implemented

English | [中文](2026-09-05-v0-legacy-replay-and-descriptor-migration.zh.md)

## Problem

0.1.3-alpha.1 split adapter replay metadata into the `{ response, blocks }` envelope and raised subagent descriptors to version 3, but the released v0→v1 migration validated historical payloads against the new shapes only. In the production home, 133 of 254 stored sessions refused migration with `chunk replayState has unexpected member "kind"` or `subagent/descriptor uses unsupported descriptor version 2`, so every such conversation became unreadable in the web GUI after the upgrade.

## Decision

`dsh-session-format-v0-to-v1` now normalizes the two released legacy shapes instead of refusing them: a terminal `finish` chunk or model message source whose `replayState` is a flat envelope (top-level `kind`, no `response`) is split into `{ response: { …except blocks, version: 2 }, blocks }`, and subagent descriptors recorded at version 2 are promoted to version 3 with every other payload fact untouched. The chunk and message-source halves are converted with the same function, so the v1→v2 embedded-stream consistency check still passes. Unsupported versions and genuinely malformed shapes keep the existing migration refusal.

## Alternatives considered

**Refuse the legacy shapes (status quo).** Rejected because it blocks every pre-split conversation after an upgrade; migration exists to convert committed generations, not to discard them.

**Repair the stored artifacts on disk.** Rejected because it rewrites committed generations and would race the live instance that owns the same files.

## Consequences

Pre-split sessions load, migrate to v2, and render their history; normalized replay metadata passes the current pi-ai reader's `response.version === 2` contract. The package README documents both normalizers, and `migration.spec.ts` covers each conversion with the exact legacy payload shapes.