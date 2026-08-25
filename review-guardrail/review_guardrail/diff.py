"""从 git 拉取真实 diff 并解析为“文件 → 新增行(新行号, 文本)”。

只评审真实变更（新增行），不采信任何模拟数据。支持两种来源：
  - 本地工作区/提交区间: resolve patches via `git diff`
  - 已有 patch 文本/文件: 直接解析 (CI 里常已持有 diff，避免额外 git 依赖)
"""
from __future__ import annotations

import re
import subprocess
from typing import Sequence

HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
ADDED_HEADER_RE = re.compile(r"^\+\+\+ b/(.+?)\s*$")


def parse_patch(text: str) -> dict[str, list[tuple[int, str]]]:
    """解析 unified diff，仅保留新增行，返回 { 文件名: [(新行号, 行文本), ...] }。

    - ``+++ b/<file>`` 确定当前文件；``@@ ... +c,d @@`` 确定新增起始行号 c；
    - ``+`` 开头且非 ``+++`` 视为新增行；上下文/删除行推进行号但不产出 finding。
    """
    files: dict[str, list[tuple[int, str]]] = {}
    cur: str | None = None
    new_line: int = 0
    consumed: int = 0  # 当前 hunk 已消耗的新侧行数（含上下文与新增）
    have_hunk = False
    for line in text.splitlines():
        if line.startswith("+++ "):
            match = ADDED_HEADER_RE.match(line)
            if match:
                cur = match.group(1)
                files.setdefault(cur, [])
                have_hunk = False
            continue
        if line.startswith("@@"):
            match = HUNK_RE.match(line)
            if not match or cur is None:
                continue
            new_line = int(match.group(1))
            consumed = 0
            have_hunk = True
            continue
        if cur is None or not have_hunk:
            continue
        if line.startswith("+") and not line.startswith("+++"):
            files[cur].append((new_line + consumed, line[1:]))
            consumed += 1
        elif line.startswith("\\"):  # "\ No newline at end of file"
            continue
        elif line.startswith("-"):
            continue
        else:  # 上下文" "或空行：推进新增侧行号
            consumed += 1
    return {k: v for k, v in files.items() if v}


def _run_git(repo: str, args: Sequence[str]) -> str:
    proc = subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失败: {proc.stderr.strip()}")
    return proc.stdout


def working_diff(repo: str) -> str:
    """工作区相对 HEAD 的未提交变更（只读，不改动 git 索引）。

    未跟踪的新文件不在 HEAD diff 里：本地评审这类变更请用 --base/--head 或 --patch，
    本模块保持只读，不显式 `git add -N` 以免副作用。
    """
    return _run_git(repo, ["diff", "--no-ext-diff", "-U3", "HEAD"])


def range_diff(repo: str, base: str, head: str) -> str:
    """base..head 的提交区间 diff。"""
    return _run_git(repo, ["diff", "--no-ext-diff", "-U3", base, head])