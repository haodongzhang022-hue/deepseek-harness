# Agent Note: tool-name validation at registration

Status: implemented

English | [中文](2026-09-08-tool-name-validation-at-registration.zh.md)

## Problem

The `mindmap-conversation` external plugin registered five tools with dotted
names (`mindmap.expand`, `mindmap.history`, `mindmap.request`,
`mindmap.search`, `mindmap.threads`). A Console Go–style OpenAI-compatible
upstream enforces the function-name pattern `^[a-zA-Z0-9_-]+$`, rejected
`tools[40]` (`mindmap.expand`) with an opaque `400 invalid_request_error`, and
the whole model turn died. DSH previously never validated tool names at
registration, so the misconfiguration surfaced only as an upstream error the
loop cannot attribute.

## Decision

`ToolRuntime.register()` in `@deepseek-ai/dsh-tools` now rejects any tool name
that does not match `^[a-zA-Z0-9_-]+$` (the common character set of
request-facing function-name APIs: OpenAI-compatible schemas, Anthropic tool
names, Gemini function declarations). The failure is a `TypeError` raised at
registration with the offending name and the allowed pattern, so an invalid
registration fails loud at plugin load time instead of on the first model
request. Scoped registrations share the same entry point and therefore the
same check.

## Alternatives

**Sanitize or rename at the provider boundary.** Rejected: renaming at the
request edge needs a bidirectional name mapping and would hide the plugin bug
behind silently renamed tools; the durable registry key must stay the wire
name.

**Keep failing at the upstream.**
Rejected: that is the original bug class — an unattributable 400 that stops
every request including the tool.

## Consequences

An invalid tool name now fails the plugin's registration with an actionable
message at load time. A repository scan of all 147 registered tool-name
literals (plus MCP bridge names, which use the `mcp__server__tool` underscore
convention) found no other violations, and the `mindmap-conversation` plugin
was renamed to `mindmap_*` in its own repository, so the change breaks no
existing registration. `tools.spec.ts` covers rejection of dotted, colon,
space, CJK, and empty names and acceptance of letters, digits, underscore, and
dash; the package README pair documents the naming rule.