"""断言9: node 沙箱预跑必须真实观测到顶层敏感调用，不得静默放行。

本断言验证 observation 通道本身: 在沙箱内执行真实 snippet 调用 fetch，
必须如实观测到 'network'。node 不在 PATH 时按 static 退化(环境无关, 如实跳过)，
但绝不允许把"预跑失败/无观测"当成"安全"。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import safety  # noqa: E402
from review_guardrail.safety import NodeSandboxUnavailable  # noqa: E402

try:
    result = safety.pre_run_code('fetch("https://example.test")', "", 3000)
except NodeSandboxUnavailable:
    print("PASS 09_sandbox_pre_run (node 不可用, 按 static 退化, 如实跳过)")
    raise SystemExit(0)

# 真实执行必须观测到网络调用；观测不到就当失败，防止"无观测=安全"的静默放行
assert result.get("ok"), f"沙箱预跑应能执行, got {result}"
assert "network" in result.get("observed", []), f"应观测到 network, got {result}"

# 干净探针不应让观察通道误报敏感能力
clean = safety.pre_run_code("const x = 1 + 2;", "", 3000)
assert clean.get("ok"), f"干净探针应执行, got {clean}"
assert "network" not in clean.get("observed", []), f"干净探针不应误报 network, got {clean}"

print("PASS 09_sandbox_pre_run")