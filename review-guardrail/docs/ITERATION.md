# 功能：稳定生效与升级迭代（ITERATION）

机制要"稳定生效并迭代"，不是靠人记，而是结构上强制：单点核心 + 声明化策略 + 断言护栏 + 版本化文档。

## 当前版本 v0.2.0（最高权重，以下为唯一有效依据）

### 为什么不会"各处进度不一样"
核心进程只在本模块一份（CLI 与 MCP 指向同一 `engine` 与同一份 `guardrail.yml`）。
Trae、deepseek-harness、各 agent 都是薄接入，不复制实现——升级只改这一处，所有调用方同时生效，
避免二次改造造成的混乱。

### 稳定生效的四根支柱
1. **护栏进 CI，而非靠人记**：`on.pull_request` 触发信号灯，任何提交都跑（见 [github.review-guardrail.yml](../integration/github.review-guardrail.yml)）。
2. **修复点固化成断言**：每修一个 bug，往 [tests/](../tests/) 加一条 `NN_*.py`（或 `.sh`）。谁再改回 bug，CI 立刻红灯。
3. **职责单一 + 文档对齐**：策略只经由 `guardrail.yml`，路由/阈值/开关/角色 prompt 都声明化，调参不碰代码。
4. **单点门禁 + 闭环护栏**：`gate` 把 信号灯 + 评审 + 真实评审状态（`--pr`）串成合并闭环；
   打回走 `loop` 修复闭环，轮次持久化，杜绝无限循环（云端"10 轮靠人记丢失"的 bug 由此修掉）。

### 恢复（出问题先止损）
- 看 CI 红灯定位是哪条断言失败 / 哪个严重度超限。
- **回滚策略**：`git revert guardrail.yml` 即可，调参调崩不碰代码与测试。
- **回滚代码**：`git checkout <上一提交> -- <文件>` 后重跑 `asserts` 确认转绿。

### 升级（持续增强机制）
- 每修一个 bug → 加一条断言。
- 提升评审深度：`review.route` 升到 `hybrid`/`llm`；收紧 `gate.max_*` 阈值。
- 换评审角色/重点：改 `guardrail.yml -> review.role / system_prompt / user_prompt`，无需改代码。
- 接入更强后端：`review.adapter` 预留 `pr-agent`（成熟开源评审框架），在 [dsh_review.py](../review_guardrail/adapters/dsh_review.py) 同位补充即可。
- 将新角色/新模块纳入评审对象：登记后其 diff 自动进入评审视野。

### 版本记录约定
- 文档**分功能**（REVIEW / GATE / FIXLOOP / ITERATION），不拆分过多。
- 功能内写"版本迭代"：每次改动在此追加一条，**新版本永远最高权重**，旧版本保留但不作为当前直接参考，一律以最新版为准。

## 版本迭代

### v0.2.1 · 2026-08-26
- 首个 CI 落地档落地：`.github/workflows/review-guardrail.yml` 把信号灯、静态评审、合并门禁接进当前仓库 PR 流程，
  不再"靠人记"，任何提交自动跑（对应四根支柱第 1 条）。
- 评审证据落档为 workflow artifact；升级 llm/hybrid 只改 `--route` + 配密钥，核心仍在本模块一份。
- 实测：断言 01-07 全 PASS，评审+门禁全绿（详见 [REVIEW.md](REVIEW.md) / [GATE.md](GATE.md) v0.2.1）。

### v0.2.0 · 2026-08-26
- 评审角色/prompt 声明化（`role / system_prompt / user_prompt`），改配置即换角色。
- GitHub 联动：`comment` / `assign` / `merge` 子命令 + `gate --pr` 关联真实评审状态；gh 缺失 fail loud。
- 修复闭环 `loop`：打回默认直接修，轮次持久化到 `loop.state_dir`，达上限停止并反馈人类。
- 固化断言：角色注入（05）、闭环轮次护栏（06）、gh fail loud（07）。

### v0.1.0 · 2026-08-26
- 建立单点核心模块（CLI + MCP）、声明化策略、断言护栏、分功能版本化文档四件套。
- 建立"恢复/升级"两条操作路径，作为后续迭代的运行手册。