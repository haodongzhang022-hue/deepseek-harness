# 功能：评审→修复闭环 + 轮次护栏（FIXLOOP）

对齐云端 `pull_request.changes_requested` 阶段的自动修复机制，并修复其"10 轮评审靠人记、
跨调用丢失"的 bug：本地用持久化状态记录轮次，杜绝无限循环。

## 当前版本 v0.1.0（最高权重，以下为唯一有效依据）

- **触发**：`loop` 子命令跑一次评审后：
  - `verdict=passed` → 无需修复，记录本轮后通过（退出码 0）。
  - 打回（`needs_modification` / `critical`）→ 进入修复闭环。
- **默认直接改**：评审打回的问题（尤其 bug）默认直接修复并重新提交，不反复询问"要不要改"。
- **轮次护栏**（[loop.py](../review_guardrail/loop.py)）：
  - `loop.max_rounds`（默认 10）为"评审→修复"最大轮数。
  - 每轮打回后 `begin_fix` 把轮次 +1；未达上限输出"修复指令"（[output.py](../review_guardrail/output.py)
    `render_fix_instructions`，含本轮/上限与逐条修改点）。
  - 已达上限仍打回 → 停止自动修复，输出 `loop.feedback_message` 反馈人类（调整需求 / 改框架 /
    收紧评审标准），不再盲修。
- **状态持久化（解决云端 bug）**：轮次与历史以 `LoopState` 落到
  `loop.state_dir/pr-<n>.json`（相对 guardrail.yml），每次调用读写同一文件。
  云端"轮次靠人记"在跨调用后会丢，本地则跨调用存活；状态文件损坏会 fail loud，绝不静默归零。
- **写回 PR**：`--post` 把修复指令 / 超限反馈发布为 GitHub PR 评论（对齐云端"在 PR 评论中输出"）。
- **调用**：
  ```sh
  python -m review_guardrail loop --pr 42 --repo <repo> --base <b> --head <h>
  python -m review_guardrail loop --pr 42 --route static --patch - --post   # 打回→发 PR 评论
  ```

## 版本迭代

### v0.1.0 · 2026-08-26
- 上线评审→修复闭环：默认直接改 + 最大轮次护栏 + 超限反馈人类。
- 轮次持久化到 `loop.state_dir`，跨调用存活，修复云端"10 轮靠人记丢失"的 bug。
- 固化断言：轮次不丢、达上限停修、损坏状态 fail loud（[06_loop_guardrail.py](../tests/06_loop_guardrail.py)）。

> 说明：旧版本仅作历史留存，当前行为一律以"当前版本"为准。
