"""gh 薄适配：PR 评论 / 真实评审状态 / 分配评审人 / 自动合并。

只做 gh CLI 的原生透传 + 结果解析，不自己发明协议；`gh` 缺失或命令失败一律
fail loud（RuntimeError），绝不静默当成“成功”。所有命令都在 repo 目录下执行，
用真实 GitHub 状态当唯一事实源，不伪造任何评审结论。
"""
from __future__ import annotations

import shutil
import subprocess

from ..engine import GithubConfig


def _gh(repo: str, *args: str) -> str:
    if not shutil.which("gh"):
        raise RuntimeError("缺少 gh CLI，无法执行 GitHub 操作（不静默跳过）")
    proc = subprocess.run(
        ["gh", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} 失败: {proc.stderr.strip()}")
    return proc.stdout


def comment(repo: str, pr: str, body: str) -> None:
    """在 PR 上写一条评审结论评论（对应云端 npc:go 输出到 PR 评论）。"""
    _gh(repo, "pr", "comment", pr, "--body", body)


def add_reviewer(repo: str, pr: str, reviewers: list[str]) -> None:
    """自动分配评审人（对应云端 git:reviewer add-reviewer）。空列表=不分配。"""
    if not reviewers:
        return
    _gh(repo, "pr", "add-reviewer", pr, "--request-reviewers", ",".join(reviewers))


def review_state(repo: str, pr: str) -> str:
    """读取 GitHub 真实评审状态: approved / changes_requested / none。

    以 gh pr view --json reviewDecision 为准；REVIEW_REQUIRED 归一为 none
    （尚无评审结论，未批准也不打回）。
    """
    out = _gh(repo, "pr", "view", pr, "--json", "reviewDecision", "--jq", ".reviewDecision")
    state = out.strip().lower()
    if state == "approved":
        return "approved"
    if state == "changes_requested":
        return "changes_requested"
    return "none"


def merge(repo: str, pr: str, cfg: GithubConfig) -> None:
    """自动合并（对应云端 git:auto-merge）。合并方式与删分支由 guardrail.yml 的 github 节控制。"""
    argv = ["pr", "merge", pr, "--squash"] if cfg.squash else ["pr", "merge", pr]
    if cfg.delete_branch:
        argv.append("--delete-branch")
    _gh(repo, *argv)
