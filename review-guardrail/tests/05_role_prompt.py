"""断言5: 声明化评审角色 prompt 正确注入（role/priority/payload 占位，JSON 花括号不破坏）。"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import engine  # noqa: E402
from review_guardrail.adapters import dsh_review  # noqa: E402

# 1) 声明化配置能解析出新字段（role / system_prompt / user_prompt）
cfg = engine.Config.load(str(ROOT / "guardrail.yml"))
assert cfg.review.role == "代码审查员", "review.role 未解析"
assert "{role}" in cfg.review.system_prompt, "system_prompt 应有 {role} 注入点"
assert "{payload}" in cfg.review.user_prompt, "user_prompt 应有 {payload} 注入点"

# 2) fill_template 只替换已知 token，JSON 结构花括号原样保留
template = '{"file": str, "message": str} 按 {priority} 查，对象 {payload}，角色 {role}'
filled = engine.fill_template(
    template, role="代码审查员", priority="security -> bug", payload="[a.py]\n1: x"
)
assert '{"file": str, "message": str}' in filled, "JSON 结构花括号被误替换"
assert "security -> bug" in filled
assert "[a.py]\n1: x" in filled
assert "代码审查员" in filled
assert filled.count("{") == 1 and filled.count("}") == 1, "非 token 花括号应原样保留"

# 3) payload 组装：文件 → 行号 + 源码文本
added = {"a.py": [(3, "    x = 1"), (5, "    y = 2")]}
payload = dsh_review._build_payload(added)
assert "[a.py]" in payload and "3:     x = 1" in payload and "5:     y = 2" in payload

# 4) run() 用声明化 prompt 组装后仍遵守"缺密钥 fail loud"（不得用默认模板伪造通过）
os.environ.pop("DEEPSEEK_API_KEY", None)
try:
    dsh_review.run({"a.py": [(1, "y = z")]}, str(ROOT), cfg)
    raise AssertionError("缺 DEEPSEEK_API_KEY 未失败，疑似伪造评审")
except RuntimeError:
    pass

print("PASS 05_role_prompt")
