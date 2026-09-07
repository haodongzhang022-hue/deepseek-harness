"""经验库 CLI：add / search / promote / render。

用法(安装后)：
  experience-store --config experience.yml add --case <id> --title <t> \
      --problem <p> --solution <s> [--tags a,b,c] [--confidence 0.8] [--ts <ISO>]
  experience-store --config experience.yml search "<query>"
  experience-store --config experience.yml promote --case <id>
  experience-store --config experience.yml render
退出码: 0=成功, 1=错误。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from experience_store.engine import ExperienceStore, parse_policy

HERE = Path(__file__).resolve().parent
# 缺省配置文件：优先用包同级的 experience.yml 作为示例策略，也接受 --config 覆盖
DEFAULT_CONFIG = str(HERE.parent / "experience.yml")


def _load(cfg_path: str) -> ExperienceStore:
    return ExperienceStore(parse_policy(Path(cfg_path).read_text(encoding="utf-8")), cfg_path)


def cmd_add(args) -> int:
    store = _load(args.config)
    exp = store.add(args.case, args.title, args.problem, args.solution,
                    tags=args.tags.split(",") if args.tags else None,
                    confidence=args.confidence, created_ts=args.ts)
    print(f"added {exp.case_id} ts={exp.created_ts} confidence={exp.confidence:.2f}")
    return 0


def cmd_search(args) -> int:
    store = _load(args.config)
    for e in store.search(args.query, args.top_k):
        print(f"[{e.score:.3f}] {e.case_id} :: {e.title} (conf={e.confidence:.2f}, "
              f"uses={e.use_count}) ts={e.created_ts}")
    return 0


def cmd_promote(args) -> int:
    store = _load(args.config)
    store.promote(args.case)
    print(f"promoted {args.case}")
    return 0


def cmd_render(args) -> int:
    store = _load(args.config)
    print(f"mirror -> {store.render_mirror()}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="experience-store", description="经验蒸馏入库/检索/镜像")
    p.add_argument("--config", default=DEFAULT_CONFIG, help="experience.yml 路径")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="蒸馏一条经验入库")
    a.add_argument("--case", required=True, help="Case 唯一标识")
    a.add_argument("--title", required=True)
    a.add_argument("--problem", required=True)
    a.add_argument("--solution", required=True)
    a.add_argument("--tags", default="")
    a.add_argument("--confidence", type=float, default=None)
    a.add_argument("--ts", default=None, help="统一时间戳(ISO, 同一记录行与镜像一致)")
    a.set_defaults(func=cmd_add)

    s = sub.add_parser("search", help="按经验检索(置信度/新鲜度/复用加权)")
    s.add_argument("query")
    s.add_argument("--top-k", type=int, default=None)
    s.set_defaults(func=cmd_search)

    pr = sub.add_parser("promote", help="复用一次并累计频次/置信度")
    pr.add_argument("--case", required=True)
    pr.set_defaults(func=cmd_promote)

    r = sub.add_parser("render", help="重渲染镜像 Markdown")
    r.set_defaults(func=cmd_render)

    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        code = args.func(args)
    except Exception as error:  # noqa: BLE001 - 顶层 fail loud 到退出码 1
        print(f"error: {error}", file=sys.stderr)
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()
