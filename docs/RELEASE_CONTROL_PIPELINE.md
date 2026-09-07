# Release control pipeline

The release-control pipeline separates development, validation, and production publication for the V3 service. The shared audit queue is exposed through the release-control MCP server and does not control processes or ports.

## Responsibilities

AI sessions working on ports 8009–8016 register their session, capability, assigned port, and heartbeat before testing. Development changes are isolated modules with TDD coverage and retained evidence. The 8008 and 8027 responsibilities remain exclusive to their existing owners; ordinary development sessions cannot claim or bind those ports.

## Change and validation flow

1. Submit a complete `RC-######` declaration containing change location, objective, acceptance criteria, and artifact reference. Bug declarations also include old-version behavior and the repair plan.
2. Complete tests on an 8009–8016 test port and preserve the evidence artifact.
3. The 8008 owner claims the change and records a pass or failure with the evidence reference.
4. A passing 8008 result makes the issue eligible for the 8027 owner; it does not publish production.
5. The 8027 owner records the gate result. The release owner separately records the explicit 8028 production decision.
6. After production publication, anchor the next development baseline at 8066.

## MCP boundary

The server provides `submit_change`, `claim_gate_item`, `record_gate_result`, `record_production_decision`, `register_test_agent`, `dispatch_task`, and `list_release_state` through the `releasecontrol` MCP namespace. It validates and audits JSON state in `data/release_control/`. It never listens on V3 ports, starts or stops instances, executes shell or tests, modifies source, or invokes 8028 publication.

## Testing and packaging

Run the focused unit tests with `python -m pytest release_control/tests -q`. The standalone package uses Hatchling and exposes the `release-control-mcp` console script; install it locally with `python -m pip install -e release_control`. The tests cover protocol responses, validation failures, persistence, and the complete submit-to-decision flow.

For Harness setup, use [`config/deepseek-harness/README.md`](../config/deepseek-harness/README.md). Read [`AI_RELEASE_COLLABORATION_RULES.md`](AI_RELEASE_COLLABORATION_RULES.md) for the session-facing rules.
