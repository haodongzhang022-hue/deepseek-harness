"""断言7: gh 薄适配 fail loud + 真实评审状态归一化（不伪造、不静默跳过）。"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail.adapters import github  # noqa: E402

# 1) 缺 gh CLI → fail loud（不静默当成功）
orig_which = shutil.which
try:
    shutil.which = lambda name: None
    try:
        github._gh("/tmp", "pr", "view", "1")
        raise AssertionError("缺 gh 未失败，疑似静默跳过")
    except RuntimeError:
        pass
finally:
    shutil.which = orig_which

# 2) 真实评审状态归一化：REVIEW_REQUIRED→none，APPROVED→approved，CHANGES_REQUESTED→changes_requested
calls = {"out": "REVIEW_REQUIRED\n"}

def fake_gh(repo, *args):
    return calls["out"]

orig_gh = github._gh
github._gh = fake_gh
try:
    assert github.review_state("/tmp", "1") == "none"
    calls["out"] = "APPROVED\n"
    assert github.review_state("/tmp", "1") == "approved"
    calls["out"] = "CHANGES_REQUESTED\n"
    assert github.review_state("/tmp", "1") == "changes_requested"
    # 空评审人不调用 gh（直接返回）
    github.add_reviewer("/tmp", "1", [])
finally:
    github._gh = orig_gh

print("PASS 07_github_fail_loud")
