"""断言4: diff 解析只取新增行、行号正确（回归护栏，防行级定位退化）。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail.diff import parse_patch  # noqa: E402

PATCH = """diff --git a/app.py b/app.py
index 111..222 100644
--- a/app.py
+++ b/app.py
@@ -1,4 +1,5 @@
 def main():
-    old = 1
+    added_a = 1
     keep = 2
+    added_b = 3
"""

parsed = parse_patch(PATCH)
assert "app.py" in parsed, "patch 未解析出文件名"
lines = parsed["app.py"]
got = [(ln, t) for ln, t in lines]
assert got == [(2, "    added_a = 1"), (4, "    added_b = 3")], f"新增行/行号错误: {got}"
assert [t for _ln, t in got] == ["    added_a = 1", "    added_b = 3"], "行文本应保留源码缩进"

# 空/无新增行的 patch → 空结果
assert parse_patch("") == {}
assert parse_patch("diff --git a/x b/x\n- removed\n") == {}

print("PASS 04_diff_parser")