# 功能：行级自动评审（REVIEW）

评审是"先于合并的质量屏障"：只读 diff 的新增行，不看未改动老代码，逐条给出行级结论并落严重度。

## 当前版本 v0.2.0（最高权重，以下为唯一有效依据）

- **范围**：只评审真实 diff 的新增行（`+` 行），见 [diff.py](../review_guardrail/diff.py)；被 `exclude_files` 命中的锁文件/文档/产物跳过。
- **优先级**：`guardrail.yml -> review.priority`，默认 安全 → 缺陷 → 质量 → 性能。
- **声明化评审角色**（v0.2.0 新增）：`review.role` / `review.system_prompt` / `review.user_prompt`
  在 `guardrail.yml` 里声明，对齐云端 `npc:go` 的 role。改配置即换角色，无需改代码；
  `{role}`/`{priority}`/`{payload}` 为注入点（[dsh_review.py](../review_guardrail/adapters/dsh_review.py) 用
  `fill_template` 安全替换，JSON 结构花括号不被误解析）。
- **路线**（`review.route`）：
  - `llm`：调真实 dsh + `DEEPSEEK_API_KEY`，结构化 JSON findings（[dsh_review.py](../review_guardrail/adapters/dsh_review.py)）。
  - `static`：内置保守规则（硬编码密钥、mock/占位、静默异常、TODO、调试 print），零外部依赖（[static.py](../review_guardrail/adapters/static.py)）。
  - `hybrid`：llm + static 合并，按 文件+行号 去重，二者互证。
- **输出**：`text`（行级评论块）或 `json`；`--out` 可写文件，便于 CI 落档；`comment` 子命令渲染成
  PR 评论 Markdown（见下）。
- **禁止模拟数据**：diff 取真实 git；llm 无密钥即 fail loud，绝不伪造"评审通过"（由 [03_no_mock_data.py](../tests/03_no_mock_data.py) 固化）。
- **调用**：
  ```sh
  python -m review_guardrail review --route llm --repo <repo> --base <b> --head <h> --format json
  python -m review_guardrail review --route static --patch -   # stdin diff
  python -m review_guardrail comment --route static --patch -  # 渲染 PR 评论（--pr <n> 发布到 GitHub）
  ```

## 版本迭代

### v0.2.1 · 2026-08-26
- CI 集成首个落地档：`.github/workflows/review-guardrail.yml` 走 `--route static`（零密钥、零外部依赖），
  复刻"信号灯 → 静态行级评审 → 合并门禁"三件套；本地复刻脚本 [ci-run.sh](../ci-run.sh) 在容器 `reviews/` 同环境验证。
- 实测：`HEAD~1..HEAD` 真实 diff，verdict=passed，0 critical / 0 warning / 0 info，门禁放行（见 [GATE.md](GATE.md) v0.2.1）。
- 评审证据 `review.json` 经 `actions/upload-artifact` 落档为 workflow artifact，红灯/绿灯皆可下载排查。
- 升级到 llm/hybrid：改工作流 `--route` 并在仓库配 `DEEPSEEK_API_KEY` 即可，核心只在本模块一份。

### v0.2.0 · 2026-08-26
- 评审角色声明化：`role` / `system_prompt` / `user_prompt` 进 `guardrail.yml`，改配置即换角色（对齐云端 npc:go）。
- prompt 组装改用 `fill_template` 安全替换占位符，JSON 结构花括号原样保留。
- 新增 `comment` 子命令与 `render_pr_comment`：评审结论渲染为 PR 评论 Markdown，`--pr` 发布到 GitHub。
- 固化断言：角色注入与 JSON 花括号保护（[05_role_prompt.py](../tests/05_role_prompt.py)）。

### v0.1.0 · 2026-08-26
- 上线行级评审核心：真实 diff 提取、优先级检查、severity 分级、text/json 输出。
- 三条路线（llm / static / hybrid）同源，用配置参数切换，供折中参考。
- 固化断言：解析正确性（01）、diff 只取新增行（04）、禁模拟数据（03）。

> 说明：旧版本仅作历史留存，当前行为一律以"当前版本"为准。