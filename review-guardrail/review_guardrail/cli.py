"""review-guardrail CLI 入口。

子命令：
  review   跑一次行级自动评审，输出 text/json，写行级评论文件
  asserts  跑信号灯断言（仅护栏，正交于评审）
  gate     流水线门禁：信号灯 + 评审 + 合并前 approved 校验 + 插件安全扫描，红灯阻塞
  config   打印校验后的声明化策略
  comment  评审并把结论渲染/发布为 PR 评论（--pr 发布到 GitHub，缺省只打印）
  assign   自动分配评审人（gh add-reviewer）
  merge    自动合并门禁：真实评审状态 approved 才合并
  loop     评审→修复闭环：打回则输出修复指令，达 max_rounds 轮停止并反馈人类
  safety   插件安全评审闸：静态能力扫描 + 沙箱预跑 + 信任门禁
  trust    写入信任标记（激活前置条件；改动后降级 dirty 需重评）

退出码：0=通过，1=配置/运行错误，2=评审或门禁打回，3=断言失败
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import assertions, diff, loop, output, review, safety
from .engine import Config, Report, filter_added

PKG_ROOT = Path(__file__).resolve().parent.parent


def _default_config() -> str:
    env = os.environ.get("GUARDRAIL_CONFIG")
    if env:
        return env
    cwd = Path.cwd() / "guardrail.yml"
    if cwd.is_file():
        return str(cwd)
    bundled = PKG_ROOT / "guardrail.yml"
    return str(bundled)


def _load_config(path: str) -> Config:
    return Config.load(path)


def _resolve_tests_dir(cfg: Config, config_path: str) -> Path:
    base = Path(config_path).resolve().parent
    return base / cfg.assertions.dir


def _build_report(cfg: Config, repo: str, base: str, head: str, patch: str | None) -> Report:
    if patch is not None:
        added = diff.parse_patch(patch)
    elif base and head:
        added = diff.parse_patch(diff.range_diff(repo, base, head))
    else:
        added = diff.parse_patch(diff.working_diff(repo))
    filtered = filter_added(added, cfg)
    return _review_dispatch(cfg, filtered, repo)


def _review_dispatch(cfg: Config, filtered: dict, repo: str) -> Report:
    from .engine import run_review

    def _fn(added, cfg):
        return review.dispatch_review(added, cfg, repo)

    return run_review(cfg, filtered, _fn)


def cmd_config(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    print(json.dumps(cfg.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_review(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    if getattr(args, "route", None):
        cfg.review.route = args.route
    repo = args.repo or str(Path.cwd())
    patch = None
    if args.patch:
        if args.patch == "-":
            patch = sys.stdin.read()
        else:
            patch = Path(args.patch).read_text(encoding="utf-8")
    report = _build_report(cfg, repo, args.base, args.head, patch)
    text = output.render_json(report) if args.format == "json" else output.render_text(report)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    return 0 if report.verdict == "passed" else 2


def cmd_asserts(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    run = assertions.run_all(_resolve_tests_dir(cfg, args.config), cfg)
    for res in run.results:
        mark = "PASS" if res.passed else "FAIL"
        print(f"[{mark}] {res.name}")
        if not res.passed and res.output:
            print(res.output)
    if not cfg.assertions.enabled:
        print("assertions 未启用")
        return 0
    return 0 if run.all_passed() else 3


def cmd_gate(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    if getattr(args, "route", None):
        cfg.review.route = args.route
    fail_csv = []
    # 插件安全评审闸：外部拉取的插件目录在合并前必须过安全扫描(可关闭)
    if cfg.safety.enabled:
        plugin_dir = getattr(args, "plugin_dir", None) or ""
        if plugin_dir:
            scan = safety.scan_dir(Path(plugin_dir), cfg)
            print(f"[safety] scan {plugin_dir}: verdict={scan.verdict} "
                  f"capabilities={','.join(scan.capabilities) or 'none'}")
            if not scan.clean_enough():
                fail_csv.append(f"safety:{scan.verdict}")
    if cfg.assertions.enabled:
        run = assertions.run_all(_resolve_tests_dir(cfg, args.config), cfg)
        for res in run.results:
            mark = "PASS" if res.passed else "FAIL"
            print(f"[signal] [{mark}] {res.name}")
        if not run.all_passed():
            fail_csv.append("asserts")
    repo = args.repo or str(Path.cwd())
    patch = Path(args.patch).read_text(encoding="utf-8") if args.patch and args.patch != "-" else None
    if args.patch == "-":
        patch = sys.stdin.read()
    report = _build_report(cfg, repo, args.base, args.head, patch)
    print(output.render_text(report))
    if report.verdict != "passed":
        fail_csv.append(f"review:{report.verdict}")
    if getattr(args, "pr", None):
        state = _review_state(repo, args.pr)
        if state != "approved":
            fail_csv.append(f"review_state:{state}")
        else:
            print(f"gh review state: approved")
    if fail_csv:
        print(f"GATE BLOCKED: {', '.join(fail_csv)}")
        return 2
    print("GATE PASSED (merge allowed)")
    return 0


def cmd_safety(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    if getattr(args, "route", None):
        cfg.safety.executor = args.route
    scan = safety.scan_dir(Path(args.dir), cfg)
    print(f"safety scan: {args.dir}")
    print(f"verdict: {scan.verdict}")
    if scan.capabilities:
        print(f"capabilities: {', '.join(scan.capabilities)}")
    for f in scan.findings:
        print(f"  [{f.severity}] {f.file}:{f.line_start} {f.rule_id} {f.message}")
    if scan.pre_run:
        print(f"pre_run: {scan.pre_run}")
    if getattr(args, "trust", False):
        ok, reason = safety.evaluate_plugin_trust(cfg, args.config)
        print(f"trust gate: {'OK' if ok else 'BLOCKED'} ({reason})")
    return 0 if scan.clean_enough() else 2


def cmd_trust(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    record = safety.TrustRecord(level=args.level, updated_at=_now_iso(), dirty=args.dirty,
                                signature="")
    record.signature = safety.signature_of(record)
    path = safety.save_trust(record, cfg, args.config)
    print(f"trust saved -> {path}: level={record.level} updated_at={record.updated_at} "
          f"signature={record.signature} dirty={record.dirty}")
    return 0


def _now_iso() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _review_state(repo: str, pr: str) -> str:
    from .adapters import github

    return github.review_state(repo, pr)


def _read_patch(args: argparse.Namespace) -> str | None:
    if not args.patch:
        return None
    if args.patch == "-":
        return sys.stdin.read()
    return Path(args.patch).read_text(encoding="utf-8")


def cmd_comment(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    if getattr(args, "route", None):
        cfg.review.route = args.route
    repo = args.repo or str(Path.cwd())
    report = _build_report(cfg, repo, args.base, args.head, _read_patch(args))
    body = output.render_pr_comment(report, cfg.review.role)
    if not args.pr:
        print(body)
        return 0 if report.verdict == "passed" else 2
    from .adapters import github

    github.comment(repo, args.pr, body)
    print(f"commented on PR {args.pr} (verdict={report.verdict})")
    return 0 if report.verdict == "passed" else 2


def cmd_assign(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    reviewers = list(args.reviewers or cfg.github.reviewers)
    if not reviewers:
        print("未配置评审人（github.reviewers 为空），跳过分配")
        return 0
    from .adapters import github

    github.add_reviewer(args.repo or str(Path.cwd()), args.pr, reviewers)
    print(f"assigned reviewers: {', '.join(reviewers)} -> PR {args.pr}")
    return 0


def cmd_merge(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    repo = args.repo or str(Path.cwd())
    state = _review_state(repo, args.pr)
    if state != "approved":
        print(f"MERGE BLOCKED: 评审状态为 {state}，门禁要求 approved")
        return 2
    from .adapters import github

    github.merge(repo, args.pr, cfg.github)
    print(f"MERGED PR {args.pr} (squash={cfg.github.squash}, delete_branch={cfg.github.delete_branch})")
    return 0


def cmd_loop(args: argparse.Namespace) -> int:
    """评审→修复闭环。打回→输出修复指令（默认直接改）；达上限→停止并反馈人类。

    轮次以 LoopState 持久化在 loop.state_dir，跨调用存活，杜绝云端"轮次靠人记"丢失。
    """
    cfg = _load_config(args.config)
    if getattr(args, "route", None):
        cfg.review.route = args.route
    repo = args.repo or str(Path.cwd())
    state = loop.load_state(args.config, cfg, args.pr)
    report = _build_report(cfg, repo, args.base, args.head, _read_patch(args))
    loop.record_round(state, report.verdict, report.counts())
    if report.verdict == "passed":
        loop.save_state(args.config, cfg, state)
        print(f"LOOP PASSED: PR {args.pr} 评审通过，无需修复（当前第 {state.round}/{cfg.loop.max_rounds} 轮）")
        return 0
    action = loop.begin_fix(args.config, cfg, state)
    loop.save_state(args.config, cfg, state)
    if action == "feedback":
        print(f"LOOP STOPPED: PR {args.pr} 已达 {cfg.loop.max_rounds} 轮上限，停止自动修复，需人工介入")
        print(cfg.loop.feedback_message)
        if args.post:
            from .adapters import github

            github.comment(repo, args.pr, cfg.loop.feedback_message)
        return 2
    instructions = output.render_fix_instructions(report, state.round, cfg.loop.max_rounds)
    print(instructions)
    if args.post:
        from .adapters import github

        github.comment(repo, args.pr, instructions)
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="review-guardrail", description="自动评审 + 质量护栏")
    parser.add_argument("--config", default=_default_config(), help="guardrail.yml 路径")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_config = sub.add_parser("config", help="打印校验后的策略")
    p_config.set_defaults(func=cmd_config)

    p_review = sub.add_parser("review", help="行级自动评审")
    _add_common(p_review)
    p_review.add_argument("--format", choices=["text", "json"], default="text")
    p_review.add_argument("--out", help="把渲染结果写到此文件")
    p_review.set_defaults(func=cmd_review)

    p_asserts = sub.add_parser("asserts", help="跑信号灯断言")
    p_asserts.set_defaults(func=cmd_asserts)

    p_gate = sub.add_parser("gate", help="流水线门禁（信号灯+评审+合并批准）")
    _add_common(p_gate)
    p_gate.add_argument("--pr", help="PR 号：关联 GitHub 真实评审状态（approved 才放行）")
    p_gate.add_argument("--plugin-dir", help="外部插件目录：合并前过安全扫描闸")
    p_gate.set_defaults(func=cmd_gate)

    p_safety = sub.add_parser("safety", help="插件安全评审闸：扫描+沙箱预跑+信任门")
    p_safety.add_argument("--dir", required=True, help="待评插件源码目录")
    p_safety.add_argument("--route", choices=["static", "node"], default="static", help="预跑路线")
    p_safety.add_argument("--trust", action="store_true", help="同时评估信任门禁")
    p_safety.set_defaults(func=cmd_safety)

    p_trust = sub.add_parser("trust", help="写入信任标记（激活前置条件）")
    p_trust.add_argument("--level", choices=["blocked", "dirty", "verified", "trusted"],
                         default="verified", help="信任级")
    p_trust.add_argument("--dirty", action="store_true", help="标记为 dirty（改动后需重评）")
    p_trust.set_defaults(func=cmd_trust)

    p_comment = sub.add_parser("comment", help="评审并渲染/发布 PR 评论")
    _add_common(p_comment)
    p_comment.add_argument("--pr", help="PR 号：发布到 GitHub；缺省只打印评论正文")
    p_comment.set_defaults(func=cmd_comment)

    p_assign = sub.add_parser("assign", help="自动分配评审人（gh add-reviewer）")
    p_assign.add_argument("--pr", required=True, help="PR 号")
    p_assign.add_argument("--repo", help="git 仓库路径（缺省用 cwd）")
    p_assign.add_argument("--reviewers", nargs="*", default=[], help="评审人，缺省用 github.reviewers")
    p_assign.set_defaults(func=cmd_assign)

    p_merge = sub.add_parser("merge", help="自动合并门禁（真实评审状态 approved 才合并）")
    p_merge.add_argument("--pr", required=True, help="PR 号")
    p_merge.add_argument("--repo", help="git 仓库路径（缺省用 cwd）")
    p_merge.set_defaults(func=cmd_merge)

    p_loop = sub.add_parser("loop", help="评审→修复闭环 + 轮次护栏")
    _add_common(p_loop)
    p_loop.add_argument("--pr", required=True, help="PR 号（闭环状态按 PR 持久化）")
    p_loop.add_argument("--post", action="store_true", help="把修复指令/超限反馈发布为 PR 评论")
    p_loop.set_defaults(func=cmd_loop)
    return parser


def _add_common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--repo", help="git 仓库路径（缺省用 cwd）")
    p.add_argument("--base", default="", help="评审起点 ref")
    p.add_argument("--head", default="", help="评审终点 ref（与 --base 同时给为区间 diff）")
    p.add_argument("--patch", help="直接给 diff 路径，'-' 表示 stdin（CI 常见）")
    p.add_argument("--route", choices=["llm", "static", "hybrid"], help="覆盖 review.route")


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        code = args.func(args)
    except Exception as error:  # noqa: BLE001 - CLI 顶层把错误 fail loud 到退出码 1
        print(f"error: {error}", file=sys.stderr)
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()