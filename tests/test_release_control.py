from __future__ import annotations

import importlib


def server(tmp_path, monkeypatch):
    monkeypatch.setenv("DSH_RELEASE_CONTROL_DIR", str(tmp_path))
    module = importlib.import_module("release_control.mcp_server")
    module.STATE_DIR = tmp_path
    module.STATE_FILE = tmp_path / "state.json"
    return module


def submit(module):
    return module._handle("submit_change", {"issue_id": "RC-123456", "title": "test", "change_location": "src/x", "objective": "verify", "acceptance": ["passes"], "artifact_ref": "artifact://x"}, module._load())


def test_release_flow_and_gate_rules(tmp_path, monkeypatch):
    module = server(tmp_path, monkeypatch)
    submit(module)
    with __import__("pytest").raises(ValueError):
        module._handle("claim_gate_item", {"issue_id": "RC-123456", "ai_id": "dev", "role": "dev", "port": 8009}, module._load())
    module._handle("claim_gate_item", {"issue_id": "RC-123456", "ai_id": "gate8", "role": "owner", "port": 8008}, module._load())
    module._handle("record_gate_result", {"issue_id": "RC-123456", "ai_id": "gate8", "evidence_ref": ["artifact://tests"], "result": "pass", "port": 8008}, module._load())
    assert module._load()["issues"]["RC-123456"]["status"] == "ready-for-8027"


def test_invalid_input_is_error_response(tmp_path, monkeypatch):
    module = server(tmp_path, monkeypatch)
    response = module._response({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "submit_change", "arguments": {}}})
    assert response and response["error"]["code"] == -32602


def test_initialize_and_tools_list(tmp_path, monkeypatch):
    module = server(tmp_path, monkeypatch)
    init = module._response({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    listing = module._response({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert init["result"]["serverInfo"]["name"] == "release-control"
    assert {tool["name"] for tool in listing["result"]["tools"]} == module.TOOLS.keys()
