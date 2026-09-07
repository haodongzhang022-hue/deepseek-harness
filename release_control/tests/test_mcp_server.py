from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def server(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DSH_RELEASE_CONTROL_DIR", str(tmp_path))
    module = importlib.import_module("release_control.mcp_server")
    module.STATE_DIR = tmp_path
    module.STATE_FILE = tmp_path / "state.json"
    return module


def issue() -> dict[str, object]:
    return {
        "issue_id": "RC-123456",
        "title": "Release-control test",
        "change_location": "release_control/mcp_server.py",
        "objective": "validate queue",
        "acceptance": ["focused tests pass"],
        "artifact_ref": "artifact://tests",
    }


def submit(module) -> None:
    module._handle("submit_change", issue(), module._load())


def claim(module, port: int, ai_id: str) -> None:
    module._handle("claim_gate_item", {"issue_id": "RC-123456", "ai_id": ai_id, "role": "owner", "port": port}, module._load())


def test_initialize_and_tools_list(server) -> None:
    initialized = server._response({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    listing = server._response({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert initialized["result"]["serverInfo"]["name"] == "release-control"
    assert {tool["name"] for tool in listing["result"]["tools"]} == set(server.TOOLS)


def test_notifications_and_unknown_method(server) -> None:
    assert server._response({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    response = server._response({"jsonrpc": "2.0", "id": 1, "method": "unknown"})
    assert response["error"]["code"] == -32602


def test_submit_validates_issue_and_required_fields(server) -> None:
    with pytest.raises(ValueError, match="RC-######"):
        server._handle("submit_change", {**issue(), "issue_id": "RC-1"}, server._load())
    with pytest.raises(ValueError, match="acceptance"):
        server._handle("submit_change", {key: value for key, value in issue().items() if key != "acceptance"}, server._load())


def test_claim_requires_gate_port_and_is_unique(server) -> None:
    submit(server)
    with pytest.raises(ValueError, match="claimable"):
        claim(server, 8009, "test-agent")
    claim(server, 8008, "gate-8")
    with pytest.raises(ValueError, match="unique claim"):
        claim(server, 8008, "other-gate-8")


def test_gate_result_requires_owner_and_evidence(server) -> None:
    submit(server)
    claim(server, 8008, "gate-8")
    args = {"issue_id": "RC-123456", "ai_id": "other", "port": 8008, "result": "pass", "evidence_ref": ["artifact://x"]}
    with pytest.raises(ValueError, match="current gate owner"):
        server._handle("record_gate_result", args, server._load())
    args["ai_id"] = "gate-8"
    args["evidence_ref"] = []
    with pytest.raises(ValueError, match="evidence_ref"):
        server._handle("record_gate_result", args, server._load())


def test_agent_registration_and_dispatch(server) -> None:
    with pytest.raises(ValueError, match="test ports"):
        server._handle("register_test_agent", {"ai_id": "agent", "session_id": "s", "capability": "tests", "port": 8008}, server._load())
    server._handle("register_test_agent", {"ai_id": "agent", "session_id": "s", "capability": "tests", "port": 8009}, server._load())
    task = server._handle("dispatch_task", {"task_id": "t1", "ai_id": "agent", "description": "run focused tests"}, server._load())
    assert task["status"] == "dispatched"
    with pytest.raises(ValueError, match="not registered"):
        server._handle("dispatch_task", {"task_id": "t2", "ai_id": "unknown", "description": "run"}, server._load())


def test_state_persists_and_corruption_resets(server) -> None:
    submit(server)
    assert server.STATE_FILE.exists()
    assert server._load()["issues"]["RC-123456"]["status"] == "submitted"
    server.STATE_FILE.write_text("not json", encoding="utf-8")
    assert server._load()["issues"] == {}


def test_full_workflow_and_mcp_error_result(server) -> None:
    submit(server)
    claim(server, 8008, "gate-8")
    server._handle("record_gate_result", {"issue_id": "RC-123456", "ai_id": "gate-8", "port": 8008, "result": "pass", "evidence_ref": ["artifact://x"]}, server._load())
    claim(server, 8027, "gate-27")
    server._handle("record_gate_result", {"issue_id": "RC-123456", "ai_id": "gate-27", "port": 8027, "result": "pass", "evidence_ref": ["artifact://y"]}, server._load())
    decision = server._handle("record_production_decision", {"issue_id": "RC-123456", "ai_id": "gate-27", "decision": "approve", "reason": "release owner approved"}, server._load())
    assert decision["decision"] == "approve"
    response = server._response({"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {"name": "submit_change", "arguments": {}}})
    assert response["error"]["code"] == -32602
    assert json.loads(json.dumps(server._load()))["production"]
