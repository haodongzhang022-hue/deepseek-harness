# 功能：流水线门禁 / 信号灯（GATE）

门禁把评审串成稳定闭环，是"稳定生效"的另一半：绿灯放行，红灯阻塞，合并前多一道 approved 校验。

## 当前版本 v0.2.0（最高权重，以下为唯一有效依据）

- **信号灯断言**：`gate` 先跑 `tests/` 下全部断言脚本（顺序按数字前缀），任一失败即红灯阻塞，
  不放行后续评审/合并。断言**不等于评审**，二者正交（[assertions.py](../review_guardrail/assertions.py)）。
- **严重度门禁判定**（[engine.py](../review_guardrail/engine.py) `classify_verdict`）：
  - `critical` 超过 `gate.max_critical` → `critical`
  - 否则 `warning` 超 `max_warning` 或 `info` 超 `max_info` → `needs_modification`
  - 否则 → `passed`
  - `verdict_gate: critical` 时，任何 critical 即打回。
- **合并前置**：`merge_requires: approved` —— 仅当 verdict=`passed`（≈ approved）才允许合并；
  `gate` 命令到 `allowed=true` 才放行。CI 示例见 [integration/github.review-guardrail.yml](../integration/github.review-guardrail.yml)。
- **真实评审状态门禁**（v0.2.0 新增）：`gate --pr <n>` 额外读 GitHub 真实 `reviewDecision`
  （[github.py](../review_guardrail/adapters/github.py)），非 `approved` 即红灯阻塞。对齐云端
  "mergeable 只代表能合并，不代表评审已通过"——自动合并前再验一道门。
- **退出码**：`gate` 打回返回 2，断言失败返回 3。
- **调用**：
  ```sh
  python -m review_guardrail asserts
  python -m review_guardrail gate --repo <repo> --base <b> --head <h>
  python -m review_guardrail gate --repo <repo> --pr 42            # 关联 GitHub 真实评审状态
  ```

## 版本迭代

### v0.2.1 · 2026-08-26
- CI 集成首个落地档：`.github/workflows/review-guardrail.yml` 把"信号灯断言 → 静态评审 → 合并门禁"串进 PR 流程，
  `gate` 为末步且返回非零即 CI 失败，配合分支保护拦截带病合并。
- 实测运行（本地 CI 同环境，见 [ci-run.sh](../ci-run.sh)）：7 条信号灯断言全 PASS，
  review verdict=passed，`GATE PASSED (merge allowed)`，退出码 0。
- `--out review.json` 落档 + artifact 上传，红灯时可下载评审证据定位。

### v0.2.0 · 2026-08-26
- `gate --pr <n>`：关联 GitHub 真实评审状态，非 approved 红灯阻塞（对齐云端合并门禁语义）。
- 新增 `merge` 子命令：approved 才 `gh pr merge`；`assign` 子命令：自动分配评审人。
- 固化断言：gh fail loud + 评审状态归一化（[07_github_fail_loud.py](../tests/07_github_fail_loud.py)）。

### v0.1.0 · 2026-08-26
- 上线信号灯断言运行器 + 严重度门禁 + 合并 approved 前置校验。
- 固化断言：门禁阈值不可被偷偷调松（[02_severity_gate.py](../tests/02_severity_gate.py)）。

> 说明：旧版本仅作历史留存，当前行为一律以"当前版本"为准。