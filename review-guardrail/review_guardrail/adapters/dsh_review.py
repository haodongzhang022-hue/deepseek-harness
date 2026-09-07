"""llm 评审后端：用真实 dsh CLI + DEEPSEEK_API_KEY 跑行级评审。

流程：把过滤后的真实新增行整理成 payload → 用 guardrail.yml 声明化的 role/system_prompt/
user_prompt 组装 prompt → 调用 dsh 一次任务 → 解析返回的严格 JSON findings。
不生成任何模拟数据；无密钥/解析失败即 fail loud。prompt 全部声明化，改配置即可换角色。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any

from ..engine import Config, Finding, fill_template


def _build_payload(added_lines: dict[str, list[tuple[int, str]]]) -> str:
    blocks = []
    for path, lines in added_lines.items():
        body = "\n".join(f"{ln}: {text}" for ln, text in lines)
        blocks.append(f"[{path}]\n{body}")
    return "\n\n".join(blocks)


def _extract_json(stdout: str) -> list[dict[str, Any]]:
    start = stdout.find("[")
    end = stdout.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise RuntimeError("dsh 输出中未找到 JSON 数组")
    try:
        value = json.loads(stdout[start : end + 1])
    except json.JSONDecodeError as error:
        raise RuntimeError(f"dsh 输出不是合法 JSON: {error}") from error
    if not isinstance(value, list):
        raise RuntimeError("dsh 输出 JSON 不是数组")
    return value


def _dsh_command(repo: str, prompt: str) -> str:
    env = os.environ.copy()
    if not env.get("DEEPSEEK_API_KEY"):
        raise RuntimeError("缺少 DEEPSEEK_API_KEY，无法运行 llm 评审（不造数据）")
    cmd = os.environ.get("DSH_REVIEW_CMD")
    if not cmd:
        if shutil.which("dsh"):
            cmd = "dsh"
        else:
            cmd = "pnpm"
    argv = cmd.split() if cmd in ("pnpm",) else [cmd]
    if cmd == "pnpm":
        argv = ["pnpm", "dsh"]
    proc = subprocess.run(
        [*argv, "--profile", "headless", prompt],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"dsh 运行失败: {proc.stderr.strip()}")
    return proc.stdout


def run(added_lines: dict[str, list[tuple[int, str]]], repo: str, cfg: Config) -> list[Finding]:
    if not added_lines:
        return []
    payload = _build_payload(added_lines)
    priority = " -> ".join(cfg.review.priority)
    system = fill_template(cfg.review.system_prompt, role=cfg.review.role, priority=priority)
    user = fill_template(
        cfg.review.user_prompt, role=cfg.review.role, priority=priority, payload=payload
    )
    prompt = f"{system}\n\n{user}"
    stdout = _dsh_command(repo, prompt)
    findings: list[Finding] = []
    valid = 0
    for item in _extract_json(stdout):
        try:
            findings.append(
                Finding(
                    file=str(item["file"]),
                    line_start=int(item["line_start"]),
                    line_end=int(item["line_end"]),
                    severity=str(item["severity"]),
                    category=str(item["category"]),
                    message=str(item["message"]),
                    suggestion=str(item.get("suggestion", "")),
                )
            )
            valid += 1
        except (KeyError, TypeError, ValueError):
            continue
    if valid == 0 and stdout.strip():
        raise RuntimeError("dsh 评审结果中没有可用的 finding 记录，疑似输出格式异常，拒绝静默通过")
    return findings