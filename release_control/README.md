# Release-control MCP server

The release-control MCP server records and validates the shared V3 release queue. It is a state and audit service, not a process controller.

## Responsibilities

- Records complete `RC-######` change declarations.
- Enforces exclusive 8008 and 8027 claims.
- Records externally produced gate evidence and explicit production decisions.
- Registers 8009–8016 test agents and dispatches bounded tasks.
- Persists audit state in `data/release_control/state.json`.

## Security boundary

The server never listens on V3 ports, starts or stops instances, executes shell commands or tests, modifies source files, or invokes 8028 publication.

## Usage

```sh
python -m release_control.mcp_server
```

The `release-control-mcp` console script is available when the package is installed. Configure the state directory with `DSH_RELEASE_CONTROL_DIR` when a different local queue location is required.

## Tools

| Tool | Purpose |
|---|---|
| `submit_change` | Submit a complete RC declaration. |
| `claim_gate_item` | Claim the 8008 or 8027 gate. |
| `record_gate_result` | Record externally generated evidence. |
| `record_production_decision` | Record an explicit approve or reject decision. |
| `register_test_agent` | Register a test agent on 8009–8016. |
| `dispatch_task` | Dispatch work to a registered test agent. |
| `list_release_state` | Read the current audit state. |
