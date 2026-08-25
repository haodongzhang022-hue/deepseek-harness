#!/usr/bin/env bash
# 复刻 .github/workflows/review-guardrail.yml 的 job：在容器 /workspace 里按 CI 相同环境跑三件套。
set -e
export PYTHONPATH=/workspace/review-guardrail
export GUARDRAIL_CONFIG=/workspace/review-guardrail/guardrail.yml
BASE="$1"; HEAD="$2"
[ -n "$BASE" ] || BASE=origin/master
[ -n "$HEAD" ] || HEAD=HEAD

echo "=== [1/3] 信号灯断言 ==="
python -m review_guardrail asserts

echo
echo "=== [2/3] 静态行级评审 (base=$BASE head=$HEAD) ==="
python -m review_guardrail review --route static --repo /workspace --base "$BASE" --head "$HEAD" --format json --out review.json

echo
echo "=== [3/3] 合并门禁 ==="
python -m review_guardrail gate --route static --repo /workspace --base "$BASE" --head "$HEAD"
echo
echo "GATE_RUN_DONE"