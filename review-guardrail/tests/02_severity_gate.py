"""断言2: 严重度门禁判定正确（回归护栏，防止门禁被偷偷调松）。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import engine  # noqa: E402

gate = engine.GateConfig(max_critical=0, max_warning=3, max_info=10,
                          verdict_gate="needs_modification", merge_requires="approved")


def finding(sev: str) -> engine.Finding:
    return engine.Finding(file="a.py", line_start=1, line_end=1, severity=sev, category="quality", message="x")


# 无 finding → passed（可合并，等价 approved）
assert engine.classify_verdict([], gate) == "passed"
# 1 个 critical 就打回 critical
assert engine.classify_verdict([finding("critical")], gate) == "critical"
# warning 超上限 → needs_modification
assert engine.classify_verdict([finding("warning")] * 4, gate) == "needs_modification"
# info 超过上限(>10) → needs_modification
assert engine.classify_verdict([finding("info")] * 11, gate) == "needs_modification"
# warning/info 在阈值内 → 仍 passed
assert engine.classify_verdict([finding("warning")] * 3 + [finding("info")] * 10, gate) == "passed"

print("PASS 02_severity_gate")