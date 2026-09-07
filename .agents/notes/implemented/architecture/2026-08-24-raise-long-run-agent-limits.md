# Raise long-run agent-loop defaults ~3-5x

Date: 2026-08-24

## Context

Long-running autonomous sessions (goal continuation, deep delegation trees, repetitive tool use under guards) hit the shipped defaults far too early: goal rounds capped at 256, delegation depth at 3, parallel tool calls at 10, and repeat-tool reminders firing at 3/5/8 consecutive calls. A multi-phase build dies mid-flight or nags itself into noise long before its budget is genuinely spent.

## Decision

Raise the four defaults together, sized so a full autonomous build fits inside one session:

| Knob | Old | New |
| --- | --- | --- |
| `defaultMaxGoalRounds` (goal) | 256 | 1024 |
| `maxDepth` (tool-subagent) | 3 | 12 |
| `DEFAULT_MAX_PARALLEL_TOOL_CALLS` (agent-loop) | 10 | 50 |
| `thresholds` (repeat-tool-reminder) | [3, 5, 8] | [15, 25, 40] |

All remain validated config fields; only the defaults moved. Tests and READMEs asserting the old numbers were updated in the same change; guard behavior specs now pin their thresholds explicitly (`{ thresholds: [3] }`) so chain-semantics coverage stays decoupled from the default's value.

## Rejected alternatives

- **Removing the caps entirely**: unbounded recursion and unbounded reminder silence are worse than generous caps; depth and rounds remain the last-resort circuit breakers.
- **Raising only goal rounds**: the binding constraint moves to whichever cap is hit first; raising them as a set keeps the ratios that make deep delegation usable.

## Consequences

- Deployments that relied on the tight defaults as implicit safety nets should set explicit values in cordis.yml; misconfiguration still fails loud at load.
- Reminder thresholds above typical loop length mean the guard now targets genuine loops, not legitimate repetition — but a truly runaway identical call burns more tokens before the first nag.

## Verification

- `node node_modules\vitest\vitest.mjs run packages/goal/goal/tests packages/guard/repeat-tool-reminder/tests packages/subagent/tool-subagent/tests packages/core/agent-loop/tests` — 462 tests green after the change.