# AI release collaboration rules

This reference defines the shared release-control queue for AI sessions working on the V3 service.

## Before work

Before testing ports 8009–8016, submitting an 8008 update, or operating the 8008/8027 checks, read [`RELEASE_CONTROL_PIPELINE.md`](RELEASE_CONTROL_PIPELINE.md) and the repository instructions. Register the AI id, Harness session id, assigned port, capabilities, and heartbeat through the release-control MCP tools. Test work must remain a decoupled module and must include TDD coverage plus retained test evidence.

## Change declarations

Every change entering 8008 requires a complete `RC-######` declaration. It identifies the change location, objective, acceptance criteria, and artifact reference. A bug declaration also records the old-version behavior and the repair plan. Submit the declaration before requesting a gate claim.

## Exclusive responsibilities

8008 and 8027 each have one existing responsible AI. Ordinary development AI sessions must not claim, restart, bind, or otherwise take over ports 8008, 8027, or 8028. An 8008 pass authorizes progression to 8027; it does not authorize publication on 8028. The release owner must explicitly approve or reject production publication.

After production publication, 8066 is re-anchored as the baseline for the next development round.

## Evidence and audit

Run tests with normal Harness tools before recording a gate result. Include durable artifact references and the exact result in `record_gate_result`; the MCP server records state and rejects incomplete or unauthorized submissions. It cannot execute tests, run shell commands, alter code, control ports, or invoke 8028 publication.
