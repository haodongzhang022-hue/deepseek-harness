# 迭代台账与管道可见性（3080 开发 → 8088 生产）

> 生成：2026-09-03（监控哨兵/管道审计回）。权威数据源：8008 release_control queue.json（76 条目）、autopilot_state.json、双实例 cordis.patch.yml、promote-to-prod.ps1。

## 1. 环境拓扑（本机双实例 + 发布管道）

| 端口 | 角色 | 位置 | 状态 |
|---|---|---|---|
| 3080 | 开发/测试（默认开发目的地，新功能/插件迭代处） | dsh-home：E:/1shuju/dsh-home | 运行中（本会话宿主） |
| 8088 | 生产（稳定可用第一优先，迭代完成才动） | dsh-prod-home + dsh-prod-src：E:/1shuju/ | 运行中 |
| 8008 | 集成门（mimo-8008 自动评审） | omni-meta dashboard_8008 | 运行中 |
| 8027 | 预发布门（staging-autopilot 冒烟） | omni-meta dashboard_8008 | 运行中 |
| 8066 | 基线锚点 | — | 未建立（baseline_8066=null） |
| 8009–8016 | 测试 lane（提交方自测端口） | DSH 会话注册 | 8 个注册全部过期 live:false，需重新 heartbeat |

## 2. 发布管道状态机（release_control 权威规则）

`8009-8016 → queued_8008 → testing_8008 → queued_8027 → testing_8027 → awaiting_production_approval →（人工 record_production_decision）→ production_approved → closed`

- 门禁白名单：unit:release_control | unit:v3_meta | unit:v3_api | http:8008:/health
- 去重：提交时文件内容 hash（仅完全相同文件才拒）
- 模块注册：24 个模块，8008 批准自动 bump 版本

## 3. 队列健康审计（消息队列两级投递）

- 一级：wake.py —— 驳回经 3080 宿主 RPC `POST /api/session.prompt`(mode=queue) 唤醒源会话，**恰好一次/每次裁决**，重试 + needs_human 升级。
- 二级：channel_notify.py —— 唤醒失败时推 IM（飞书/钉钉/企微/TG），env: OMNI_SIGNAL_*。

**缺口（按优先级，均已在 autopilot_state.json 留证）：**

1. **[阻断] 唤醒 401**：RC-000074 唤醒重试 8 次全部 `http 401: Unauthorized`（3080 拒绝无/过期凭据的 session.prompt）。修复方向：wake.py 复用 v0.3.1 的 tokenFile 自动发现（读 dsh-home/web.log）。
2. **[高] 提交/注册 session_id 非法**：RC-000070 注册 id `session-c3af47763e10` 非完整 UUID；RC-000075 提交 session_id=`-` → is_plausible_session_id 直接拒收，唤醒不可能。修复方向：submit_change/register_test_agent 在 API 层校验并拒收。
3. **[中] IM 兜底未配置**：omni-meta .env 缺 OMNI_SIGNAL_* → 1 的失败无第二通道，needs_human 无人接管（RC-000070/074/075 已停滞）。
4. **[低] 生产 patch 与开发 patch 同文**：8088 也挂 automation-scheduler/router（配置指向 dsh-home 和 3080 API）与全部开发向插件。发布前应对生产 patch 做裁剪审计。
5. needs_human / awaiting_production_approval 无可见视图：dsh-release-board（开发中）应补齐这两个状态。

## 4. 队列在途项目（权威 queue.json）

| Issue | 状态 | 说明 |
|---|---|---|
| RC-000073 | awaiting_production_approval | event_dynamics 跨品种双模块+前端修复重提；8008+8027 双过。**等人工生产决策**（08-30 起） |
| RC-000074 | rejected_8008 + needs_human | 期货特征列 3→18；8009 唤醒 8 连败 401，驳回无人收到 |
| RC-000075 | rejected_8008 + needs_human | 0901 模式首版（session='-'）；重提 RC-000076 已双过 closed → 0901 模式已上线 |
| 其余 73 | closed/archived（61 closed = 已生产发布并验证） | — |

## 5. 开发侧迭代台账（3080）

### 已交付（测试通过，8088 待激活）
- **[v0.3.1] dsh-mindmap-conversation 双环境+持久化**：tokenFile 自动发现 / tree.ts 树持久化（快照 hydrate+防抖+原子替换+损坏容错，.smoke-persist 证据，冒烟 6/6）/ promote-to-prod.ps1 / 双实例跨代理配置。产物 09-03 12:11 已最新（src 12:10 < lib 12:11），3080 已重启生效，**8088 重启后自动激活**（lib 经 file:/// 绝对路径共享）。

### 开发中（未入库/未提交，322 文件 +30712 行）
- 新包（未跟踪）：packages/client/ui-mindmap、packages/client/ui-plugin-discovery、packages/host/plugin-aggregator、packages/remote、packages/automation/scheduler(service/store)、packages/experimental/dsh-scientific-skills
- dsh-external：dsh-automation-console（已双端挂载）、dsh-release-board（发布看板，未构建注入）
- 配置/能力：dsh-local-plugins/*、config/deepseek-harness/*、dsh-config/*、dsh-custom-enhancement-plugin
- 文档（已 staged）：docs/AI_RELEASE_COLLABORATION_RULES.md、docs/RELEASE_CONTROL_PIPELINE.md、docs/V3_COLLABORATION.md、.agents/skills/omni-meta-release-collaboration
- us-futures：美股期货数据模块（未跟踪，含数据）
- 存档迁移：archive/trigger/*、archive/ui-mindmap（旧版）
- **提交前需清理杂项**：.stryker-tmp/、_page.html、.tmp-dump.yml、_patch-start.ps1、_wsproxy.mjs、.tmp-dsh-rollback-gen.ps1、_cal_client.js、dsh-automation-tmp.log、.tmp-validate-pi-ai.*

### 待执行动作（按序）
1. 8088 激活 v0.3.1（promote-to-prod.ps1 -Restart，需人工批准窗口）
2. RC-000073 生产决策（人工 record_production_decision）
3. 队列缺口修复迭代：401 tokenFile 注入 wake.py → session_id API 校验 → OMNI_SIGNAL_* 兜底配置 → needs_human 视图（全部在 3080 开发、白名单自测、再进队列）
4. deepseek-harness 322 文件清理 + 按区块分批 commit（不得一把梭），随后纳入队列模块提交
5. 发布看板构建注入（管道可视化）

## 6. 会话注册表（0831 roster，本环境无 memory 工具，落盘登记）

- 管道审计/监控哨兵会话：session_ID 待人工补充（GUI URL 为准），用途=3080 开发环境管道体检
- lane 8011/8012/8009 等历史注册：全部过期，重新注册时**必须使用完整 session-UUID**
