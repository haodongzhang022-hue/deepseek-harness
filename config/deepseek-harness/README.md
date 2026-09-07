# Release-control MCP overlay

This directory contains a user-owned template for connecting the release-control audit server to DeepSeek Harness through [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md).

## Install in a user preset

Copy `release-control.cordis.patch.yml` into the user-owned preset or profile patch location and merge its row with existing patches. Do not edit the deployment's shipped presets. The server is started with `python -m release_control.mcp_server`; it records and validates release metadata but does not listen on V3 ports, run commands or tests, edit source, or publish 8028.

Use `agentPresets.standingKeyFor(...)` to mount-validate the authored preset. Start a new session after validation and confirm that the tools appear with names such as `mcp__releasecontrol__submit_change`. Discovery is asynchronous; wait for the tools before using them.

The queue is shared across sessions, so this row belongs in the host-connected preset composition rather than an agent-owned `isolate` realm. Runtime audit files are written below `data/release_control/`, which is ignored by Git.

Read [`docs/AI_RELEASE_COLLABORATION_RULES.md`](../../docs/AI_RELEASE_COLLABORATION_RULES.md) and [`docs/RELEASE_CONTROL_PIPELINE.md`](../../docs/RELEASE_CONTROL_PIPELINE.md) before using the queue.
