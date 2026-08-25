"""断言1: 声明化策略可解析且字段合法（配置是唯一事实源）。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import engine  # noqa: E402

# 策略文件能被加载且顶层 schema 合法
cfg = engine.Config.load(str(ROOT / "guardrail.yml"))
assert cfg.version
assert cfg.review.route in ("llm", "static", "hybrid")
assert cfg.review.priority[:2] == ["security", "bug"], "检查优先级: 安全→缺陷 打头"
assert cfg.gate.max_critical == 0
assert cfg.gate.merge_requires == "approved"
assert cfg.assertions.enabled is True

# 未知字段必须 fail loud，不能静默跳过
try:
    engine.Config.from_mapping({"review": {"bogus": 1}})
    raise AssertionError("未知字段未报错")
except ValueError:
    pass

print("PASS 01_config_parse")