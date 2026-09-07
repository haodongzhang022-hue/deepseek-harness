"""断言3: 禁止模拟数据（关键护栏）。

  1) 静态检测器对干净新增行不产生任何 finding（不会凭空捏造）。
  2) llm(dsh) 后端在缺少 DEEPSEEK_API_KEY 时必须 fail loud（RuntimeError），
     绝不悄悄返回空/伪造结果充当“评审通过”。
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import engine  # noqa: E402
from review_guardrail.adapters import dsh_review, static  # noqa: E402

cfg = engine.Config.load(str(ROOT / "guardrail.yml"))

# 1) 干净新增行 → 静态检测无 finding
clean = {"clean.py": [(1, "def add(a, b):"), (2, "    return a + b")]}
assert static.run(clean, cfg) == [], "静态检测器对干净代码凭空产生 finding，疑似造假"

# 2) llm 后端无密钥必须报错，不得伪造结果
os.environ.pop("DEEPSEEK_API_KEY", None)
try:
    dsh_review.run({"x.py": [(1, "y = z")]}, str(ROOT), cfg)
    raise AssertionError("缺 DEEPSEEK_API_KEY 未失败，可能伪造了评审结果")
except RuntimeError:
    pass

print("PASS 03_no_mock_data")