"""评审→修复闭环 + 轮次护栏（对齐云端 pull_request.changes_requested 阶段）。

解决云端"10 轮评审修复靠人记轮次、跨调用丢失"的 bug：轮次计数与历史持久化到
state_dir 下以 PR 命名的 JSON 文件，每次评审/修复读写同一文件，轮次不丢、杜绝无限循环。

护栏语义：
  1. 默认直接改：评审打回的问题（尤其 bug）默认直接修，不反复询问"要不要改"；
  2. 最大 max_rounds 轮：评审→修复来回超过上限即停止自动修复；
  3. 超限处置：停止盲修，把反馈文案写给人类（评论/文件），由人类改需求/框架/标准。

调用方（CLI/MCP）负责跑评审并拿到 verdict，本模块只裁决"能否修复 / 是否超限"，
状态以 LoopState 持久化，跨调用存活。
"""
from __future__ import annotations

import json
from pathlib import Path

from .engine import Config, LoopState


def _state_dir(config_path: str, cfg: Config) -> Path:
    base = Path(config_path).resolve().parent
    return base / cfg.loop.state_dir


def state_path(config_path: str, cfg: Config, pr: str) -> Path:
    """闭环状态文件：<state_dir>/<pr>.json（PR 号是唯一跨调用身份）。"""
    return _state_dir(config_path, cfg) / f"pr-{pr}.json"


def load_state(config_path: str, cfg: Config, pr: str) -> LoopState:
    path = state_path(config_path, cfg, pr)
    if path.is_file():
        try:
            return LoopState.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, TypeError, KeyError, ValueError):
            # 状态文件损坏 → fail loud，不让静默归零掩盖轮次
            raise RuntimeError(f"评审闭环状态文件损坏: {path}") from None
    return LoopState(pr=pr)


def save_state(config_path: str, cfg: Config, state: LoopState) -> None:
    path = state_path(config_path, cfg, state.pr)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def begin_fix(config_path: str, cfg: Config, state: LoopState) -> str:
    """评审打回后决定下一步：'fix'=允许自动修复（轮次+1） | 'feedback'=已达上限停止盲修。

    必须在写回 state 前调用；返回 'fix' 时已把 round 加 1，调用方负责 save_state。
    """
    if state.feedback:
        return "feedback"
    if state.round >= cfg.loop.max_rounds:
        state.feedback = True
        return "feedback"
    state.round += 1
    return "fix"


def record_round(state: LoopState, verdict: str, counts: dict) -> None:
    """记录本轮评审结论到历史，便于追溯与调试（{round, verdict, counts}）。"""
    state.history.append({"round": state.round, "verdict": verdict, "counts": dict(counts)})
