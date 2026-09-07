"""评审后端分派：按 cfg.review.route 选择路线，同功能在单一分派点汇聚。"""
from __future__ import annotations

from .engine import Config, Finding
from . import adapters


def dispatch_review(added_lines: dict[str, list[tuple[int, str]]], cfg: Config, repo: str) -> list[Finding]:
    """route 用配置参数控制，支持在 llm / static / hybrid 间折中切换，不重复实现逻辑。"""
    route = cfg.review.route
    static = adapters.static.run(added_lines, cfg)
    if route == "static":
        return static
    llm = adapters.dsh_review.run(added_lines, repo, cfg)
    if route == "llm":
        return llm
    if route == "hybrid":
        return llm + _dedupe(static, llm)
    raise ValueError(f"未知 route: {route}")


def _dedupe(static: list[Finding], llm: list[Finding]) -> list[Finding]:
    """hybrid 下并入未出现在 llm 结果里的静态命中（按 文件+行号 判重）。"""
    seen = {(f.file, f.line_start) for f in llm}
    return [f for f in static if (f.file, f.line_start) not in seen]