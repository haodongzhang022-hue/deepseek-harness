"""Minimal-permission MCP JSON-RPC server for the release-control queue.

The server records and validates release metadata. It never starts processes,
executes tests, or changes source files.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ISSUE_RE = re.compile(r"^RC-\d{6}$")
TEST_PORTS = set(range(8009, 8017))
GATE_PORTS = {8008, 8027}
STATE_DIR = Path(os.environ.get("DSH_RELEASE_CONTROL_DIR", "data/release_control"))
STATE_FILE = STATE_DIR / "state.json"
TOOLS = {
    "submit_change": "Submit a complete RC issue declaration.",
    "claim_gate_item": "Claim one release-control gate item.",
    "record_gate_result": "Record externally-produced gate evidence.",
    "record_production_decision": "Record the explicit production decision.",
    "register_test_agent": "Register a test agent and its heartbeat.",
    "dispatch_task": "Dispatch a bounded task to a registered test agent.",
    "list_release_state": "List the release-control audit state.",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"issues": {}, "claims": {}, "results": [], "agents": {}, "tasks": [], "production": []}
    try:
        value = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(value, dict):
            return value
    except (OSError, json.JSONDecodeError):
        pass
    return {"issues": {}, "claims": {}, "results": [], "agents": {}, "tasks": [], "production": []}


def _save(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATE_FILE)


def _require(args: dict[str, Any], *names: str) -> None:
    missing = [name for name in names if not isinstance(args.get(name), str) or not args[name].strip()]
    if missing:
        raise ValueError("missing required fields: " + ", ".join(missing))


def _port(args: dict[str, Any]) -> int:
    value = args.get("port")
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("port must be an integer")
    if value not in TEST_PORTS | GATE_PORTS:
        raise ValueError("port must be one of 8008-8016 or 8027")
    return value


def _handle(name: str, args: dict[str, Any], state: dict[str, Any]) -> Any:
    if name == "submit_change":
        _require(args, "issue_id", "title", "change_location", "objective", "artifact_ref")
        if not ISSUE_RE.fullmatch(args["issue_id"]):
            raise ValueError("issue_id must match RC-######")
        if not isinstance(args.get("acceptance"), list) or not args["acceptance"]:
            raise ValueError("acceptance must be a non-empty list")
        issue = {**args, "submitted_at": _now(), "status": "submitted"}
        state["issues"][args["issue_id"]] = issue
        _save(state)
        return issue
    if name == "claim_gate_item":
        _require(args, "issue_id", "ai_id", "role")
        port = _port(args)
        if port not in GATE_PORTS:
            raise ValueError("only 8008 and 8027 are claimable gate ports")
        if args["issue_id"] not in state["issues"]:
            raise ValueError("issue_id has not been submitted")
        if port == 8027 and state["issues"][args["issue_id"]].get("status") != "ready-for-8027":
            raise ValueError("8027 claim requires a passing 8008 result")
        if port in (8008, 8027) and str(port) in state["claims"]:
            raise ValueError(f"port {port} already has a unique claim")
        claim = {"issue_id": args["issue_id"], "ai_id": args["ai_id"], "role": args["role"], "port": port, "claimed_at": _now()}
        state["claims"][str(port)] = claim
        _save(state)
        return claim
    if name == "record_gate_result":
        _require(args, "issue_id", "ai_id", "result")
        port = _port(args)
        if port not in GATE_PORTS:
            raise ValueError("gate result port must be 8008 or 8027")
        claim = state["claims"].get(str(port))
        if not claim or claim["issue_id"] != args["issue_id"] or claim["ai_id"] != args["ai_id"]:
            raise ValueError("result must be recorded by the current gate owner")
        if args["result"] not in {"pass", "fail", "blocked"}:
            raise ValueError("result must be pass, fail, or blocked")
        if not isinstance(args["evidence_ref"], list) or not args["evidence_ref"]:
            raise ValueError("evidence_ref must be a non-empty list")
        result = {**args, "port": port, "recorded_at": _now()}
        state["results"].append(result)
        if port == 8008 and args["result"] == "pass":
            state["issues"][args["issue_id"]]["status"] = "ready-for-8027"
        _save(state)
        return result
    if name == "record_production_decision":
        _require(args, "issue_id", "ai_id", "decision", "reason")
        if args["decision"] not in {"approve", "reject"}:
            raise ValueError("decision must be approve or reject")
        claim = state["claims"].get("8027")
        if not claim or claim["ai_id"] != args["ai_id"]:
            raise ValueError("only the 8027 owner may record the production decision")
        decision = {**args, "recorded_at": _now()}
        state["production"].append(decision)
        _save(state)
        return decision
    if name == "register_test_agent":
        _require(args, "ai_id", "session_id", "capability")
        port = _port(args)
        if port not in TEST_PORTS:
            raise ValueError("test agent port must be in test ports 8009-8016")
        agent = {**args, "port": port, "heartbeat_at": _now()}
        state["agents"][args["ai_id"]] = agent
        _save(state)
        return agent
    if name == "dispatch_task":
        _require(args, "task_id", "ai_id", "description")
        if args["ai_id"] not in state["agents"]:
            raise ValueError("ai_id is not registered")
        task = {**args, "dispatched_at": _now(), "status": "dispatched"}
        state["tasks"].append(task)
        _save(state)
        return task
    if name == "list_release_state":
        return state
    raise ValueError("unknown tool")


def _response(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    request_id = request.get("id")
    try:
        if method == "initialize":
            result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "release-control", "version": "1.0.0"}}
        elif method == "tools/list":
            result = {"tools": [{"name": name, "description": description, "inputSchema": {"type": "object", "additionalProperties": True}} for name, description in TOOLS.items()]}
        elif method == "tools/call":
            params = request.get("params") or {}
            result = {"content": [{"type": "text", "text": json.dumps(_handle(params.get("name", ""), params.get("arguments") or {}, _load()), ensure_ascii=False)}], "isError": False}
        elif method == "notifications/initialized":
            return None
        else:
            raise ValueError(f"unsupported method: {method}")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except (ValueError, TypeError, KeyError) as error:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": str(error)}}


def main() -> None:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            response = _response(request)
            if response is not None:
                print(json.dumps(response, ensure_ascii=False), flush=True)
        except json.JSONDecodeError as error:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(error)}}), flush=True)


if __name__ == "__main__":
    main()
