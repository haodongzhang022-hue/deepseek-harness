"""review-guardrail MCP server（stdin/stdout JSON-RPC，与 release_control 同风格）。

Trae / 各 agent 把它当作“功能调用模块”：通过这个明文工具面调用同一套评审+门禁引擎，
任何调用方都共享唯一的核心与策略，从入口上杜绝“各处进度不一”。只读，不改动源码。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from . import assertions, diff, loop, output, review
from .engine import Config, Report, filter_added

PKG_ROOT = Path(__file__).resolve().parent.parent
TOOLS = {
    "guardrail_review": "对给定 diff 做一次行级自动评审，返回 findings 与 verdict",
    "guardrail_asserts": "运行信号灯断言脚本，返回每项通过/失败",
    "guardrail_gate": "流水线门禁：信号灯+评审，返回是否允许合并（blocked/allowed）",
    "guardrail_config": "返回校验后的声明化策略",
    "guardrail_comment": "评审并把结论渲染为 PR 评论正文（传 pr 则发布到 GitHub）",
    "guardrail_assign": "自动分配评审人（gh add-reviewer，用 github.reviewers 或缺省 reviewers）",
    "guardrail_merge": "自动合并门禁：真实评审状态 approved 才合并（gh）",
    "guardrail_loop": "评审→修复闭环：打回返回修复指令，达 max_rounds 轮停止并反馈人类",
}


def _config() -> Config:
    path = os.environ.get("GUARDRAIL_CONFIG") or str(PKG_ROOT / "guardrail.yml")
    return Config.load(path)


def _report(cfg: Config, args: dict) -> Report:
    repo = args.get("repo") or str(Path.cwd())
    route = args.get("route")
    if route:
        cfg.review.route = route
    patch = args.get("patch")
    if patch:
        added = diff.parse_patch(patch)
    elif args.get("base") and args.get("head"):
        added = diff.parse_patch(diff.range_diff(repo, args.get("base"), args.get("head")))
    else:
        added = diff.parse_patch(diff.working_diff(repo))
    from .engine import run_review

    filtered = filter_added(added, cfg)
    return run_review(cfg, filtered, lambda a, c: review.dispatch_review(a, c, repo))


def _handle(name: str, args: dict) -> dict:
    cfg = _config()
    config_path = _config_path()
    if name == "guardrail_config":
        return cfg.to_dict()
    if name == "guardrail_asserts":
        tests_dir = Path(config_path).parent / cfg.assertions.dir
        run = assertions.run_all(tests_dir, cfg)
        return {
            "enabled": cfg.assertions.enabled,
            "all_passed": run.all_passed(),
            "results": [{"name": r.name, "passed": r.passed} for r in run.results],
        }
    if name == "guardrail_review":
        report = _report(cfg, args)
        return json.loads(output.render_json(report))
    if name == "guardrail_gate":
        report = _report(cfg, args)
        blocked = report.verdict != "passed"
        result = {"allowed": not blocked, "verdict": report.verdict, "counts": report.counts()}
        if args.get("pr"):
            from .adapters import github

            state = github.review_state(args.get("repo") or str(Path.cwd()), str(args["pr"]))
            result["review_state"] = state
            result["allowed"] = result["allowed"] and state == "approved"
        return result
    if name == "guardrail_comment":
        report = _report(cfg, args)
        body = output.render_pr_comment(report, cfg.review.role)
        if args.get("pr"):
            from .adapters import github

            github.comment(args.get("repo") or str(Path.cwd()), str(args["pr"]), body)
        return {"verdict": report.verdict, "counts": report.counts(), "comment": body}
    if name == "guardrail_assign":
        from .adapters import github

        reviewers = list(args.get("reviewers") or cfg.github.reviewers)
        if not reviewers:
            return {"assigned": False, "reason": "github.reviewers 为空，未分配"}
        github.add_reviewer(args.get("repo") or str(Path.cwd()), str(args["pr"]), reviewers)
        return {"assigned": True, "reviewers": reviewers}
    if name == "guardrail_merge":
        from .adapters import github

        repo = args.get("repo") or str(Path.cwd())
        state = github.review_state(repo, str(args["pr"]))
        if state != "approved":
            return {"merged": False, "review_state": state, "blocked": "需要 approved"}
        github.merge(repo, str(args["pr"]), cfg.github)
        return {"merged": True, "review_state": state}
    if name == "guardrail_loop":
        repo = args.get("repo") or str(Path.cwd())
        state = loop.load_state(config_path, cfg, str(args["pr"]))
        report = _report(cfg, args)
        loop.record_round(state, report.verdict, report.counts())
        if report.verdict == "passed":
            loop.save_state(config_path, cfg, state)
            return {"verdict": "passed", "round": state.round, "max_rounds": cfg.loop.max_rounds}
        action = loop.begin_fix(config_path, cfg, state)
        loop.save_state(config_path, cfg, state)
        if action == "feedback":
            body = cfg.loop.feedback_message
            if args.get("post"):
                from .adapters import github

                github.comment(repo, str(args["pr"]), body)
            return {"verdict": report.verdict, "action": "feedback", "round": state.round,
                    "max_rounds": cfg.loop.max_rounds, "message": body}
        instructions = output.render_fix_instructions(report, state.round, cfg.loop.max_rounds)
        if args.get("post"):
            from .adapters import github

            github.comment(repo, str(args["pr"]), instructions)
        return {"verdict": report.verdict, "action": "fix", "round": state.round,
                "max_rounds": cfg.loop.max_rounds, "instructions": instructions}
    raise ValueError("unknown tool")


def _config_path() -> str:
    return os.environ.get("GUARDRAIL_CONFIG") or str(PKG_ROOT / "guardrail.yml")


def _response(request: dict) -> dict | None:
    method = request.get("method")
    rid = request.get("id")
    try:
        if method == "initialize":
            result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "review-guardrail", "version": "0.2.0"}}
        elif method == "tools/list":
            result = {"tools": [{"name": n, "description": d, "inputSchema": {"type": "object", "additionalProperties": True}} for n, d in TOOLS.items()]}
        elif method == "tools/call":
            params = request.get("params") or {}
            result = {"content": [{"type": "text", "text": json.dumps(_handle(params.get("name", ""), params.get("arguments") or {}), ensure_ascii=False)}], "isError": False}
        elif method == "notifications/initialized":
            return None
        else:
            raise ValueError(f"unsupported method: {method}")
        return {"jsonrpc": "2.0", "id": rid, "result": result}
    except (ValueError, TypeError, KeyError) as error:
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": str(error)}}


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