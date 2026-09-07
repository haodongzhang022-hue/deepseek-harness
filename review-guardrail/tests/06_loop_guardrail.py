"""断言6: 评审→修复闭环 + 轮次护栏（解决云端"10 轮靠人记丢失"的持久化方案）。"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import loop  # noqa: E402
from review_guardrail.engine import Config  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    cfg = Config.from_mapping({"loop": {"max_rounds": 2, "state_dir": "data/review_loop"}})
    config_path = str(Path(tmp) / "guardrail.yml")

    # 初始状态：PR 42，未开始
    state = loop.load_state(config_path, cfg, "42")
    assert state.pr == "42" and state.round == 0 and state.feedback is False

    # 第 1 轮打回 → 允许 fix，round+1
    assert loop.begin_fix(config_path, cfg, state) == "fix"
    assert state.round == 1
    loop.record_round(state, "needs_modification", {"critical": 1, "warning": 0, "info": 0})
    loop.save_state(config_path, cfg, state)

    # 重新加载（模拟下一次调用）→ 轮次不丢（云端"靠人记"正是丢在这里）
    state2 = loop.load_state(config_path, cfg, "42")
    assert state2.round == 1 and len(state2.history) == 1

    # 第 2 轮（达上限）打回 → feedback，停止盲修
    assert loop.begin_fix(config_path, cfg, state2) == "fix"
    assert state2.round == 2
    assert loop.begin_fix(config_path, cfg, state2) == "feedback"
    assert state2.feedback is True
    loop.save_state(config_path, cfg, state2)

    # 状态确实落盘，可被下个调用读到
    path = loop.state_path(config_path, cfg, "42")
    assert path.is_file(), "闭环状态未落盘"
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["round"] == 2 and saved["feedback"] is True

    # 损坏的状态文件必须 fail loud，不能静默归零掩盖轮次
    path.write_text("{not json", encoding="utf-8")
    try:
        loop.load_state(config_path, cfg, "42")
        raise AssertionError("损坏状态文件未报错，疑似静默归零")
    except RuntimeError:
        pass

print("PASS 06_loop_guardrail")
