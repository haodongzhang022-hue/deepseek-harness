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

## 7. 对齐校验机制 v1（2026-09-08 上线）

> 目标：校验"开发→提PR→门禁→生产"链条的缺漏（防止提 PR 没提好/漏提/漏收口），
> 权威数据源 = omni-meta queue.json + autopilot_state.json + 追踪器 router-*.json + 双实例目录。

**引擎**：`scripts/alignment_check.py`（本仓，stdlib 无依赖，只读审计；`--fix-ledger` 带备份回写追踪器终态）
**报告**：`data/release_control/ALIGNMENT_REPORT.md`（人类可读）+ `ALIGNMENT_STATE.json`（机器可读，含缺口清单）
**调度**：`E:/1shuju/dsh-home/data/automation/signals/triggers/alignment-check.json`，每 30 分钟 `--report-only` 跑一次落盘
**手动**：`python scripts/alignment_check.py`；清陈账：`python scripts/alignment_check.py --fix-ledger`

**校验面**：A 队列 vs 追踪器对账｜B 在途/needs_human 遗留｜C 开发未提交（本仓+omni-meta）｜D 生产源/preset 漂移｜E 服务存活。

### 首轮结论（2026-09-08 00:49，66 项缺口；修复陈账前 98 项）

| 类 | 结论 |
|---|---|
| A 追踪器 | 32 行全部陈账回写（6 项 testing/queued 实际早已 closed 并推送 8028；26 项 rejected 实际 archived）。`--fix-ledger` 已修 + 备份 `router-*.bak-align-20260908-004921` |
| B 在途 | 队列 0 在途；9 项 needs_human 全部被 closed 替代项覆盖，无遗留；**但唤醒兜底未配置**（OMNI_SIGNAL_* 缺失，9 项驳回从未送达源会话）→ 待办 3 |
| C 开发未提交 | omni-meta **17 个源文件**未提交（含 release_control/queue.py、scripts/sync_agent_preset.py、dashboard_8008/{api/xlink.py,core/orders.py,frontend/index.html}、trading/stages.py、xlink/factor_features.py 等）+ 91 未跟踪源 + 68 产物；分支领先 main 380 提交；本仓未跟踪 dsh-secretary、dsh-git-auto-update、alignment 引擎 |
| D 生产未同步 | dsh-prod-src 机制目录落后 1.5–9.3 天（release_control/review-guardrail/self-evolution/config/dsh-config 均 08-28）；**4 个 preset 仅开发侧**（architect-bridge-0906 / architect-cloudlocal-0906 / architect-local-0906 / secretary-mode）；git-auto-update 仅生产侧（豁免） |
| E 服务 | 8008/8027/8028 OK（v3.19.1 三端对齐）；**8066 基线锚点 DOWN**（RC-000084/087 关闭理由含"8066 锚定"，需核对其是否仅发布期拉起）；8088 存活（401 鉴权态） |

### 由对账发现的缺口处理记录（2026-09-08 02:10 完成首轮处置）

| 项 | 处置 | 结果 |
|---|---|---|
| 追踪器 32 行陈账 | `--fix-ledger` 回写终态 + 备份 | 追踪板 0 分叉（已持续核对） |
| omni-meta 未提交源 | 两个提交：`7c94870` fix(queue.py 租约回收 v3，14 测绿) + `adc8bc6` chore(deploy-state 版本化 26 文件，3218+/726-，已在 8008/8027/8028 运行) | 未提交源 17→2（残留=`sync_agent_preset.py`+测试：PTC 引导门禁对 creator-0907 红灯，**留给 owner 补引导段后自提**） |
| 4 个 preset 缺失生产 | promote `architect-bridge-0906`/`architect-cloudlocal-0906`/`architect-local-0906`/`secretary-mode`（备份 `.agent-presets.bak-align-20260908-015936`） | 0 缺失；**8088 重启后生效**（待人工窗口） |
| 8066 基线 | 核实：非 HTTP 服务，是 `.v3_baseline.json` 基准文件（v3_servers.py anchor/sync 管理） | 基准健康（01:36 锚定 ba01635480b3041d）；防空跑探针，检查已改为文件判据 |
| OMNI_SIGNAL 兜底 | 核实：.env 无 OMNI_SIGNAL_*；主唤醒已修（RC-000077 cookie），中继打回卡通道在役 | 降到 low：可选配置第三通道，非阻塞 |
| 生产源落后 9.3 天 | 9 目录备份 + `/E /XO` 增量同步（备份 `dsh-prod-src-backup-alignment-20260908-020326`） | 源漂移 8→0 |
| 新发现（非本次处置） | 00:49 后 `packages/core/tools/src` 32 个文件被并发会话构建改写（mtime 02:03），及本仓 +1 提交（a1583b63 automation） | 归属其他会话，不代提交；下次对账若仍驻留再处理 |

**新增已知豁免**：`git-auto-update` preset 仅生产侧（生产私有，豁免）；`experiments/` 在 omni-meta 被 gitignore（仓库策略）。

**再次对账残余（02:03 快照，68 项）**：B-wake-channel low ×1；C-dev-untracked 3（含 alignment 引擎本身，待按区块提交）；C-dev-modified 32（并发构建，外部归属）；C-omni 未提交 2（PTC 门禁 owner 项）+ 未跟踪 93 源 68 产物（治理批次）；D preset 仅生产 1（豁免）；E 三端 v3.19.1 对齐 + 8088 鉴权存活。

### 处置后剩余行动
1. **[待窗口] 8088 重启**激活 4 个新 preset 与生产源同步（人工批准窗口）
2. **[owner] PTC 引导门禁**：creator-0907 补 run_code 引导段后由 sync_agent_preset 提交方自提
3. **[可选] IM 第三通道**：OMNI_SIGNAL_CHANNEL/OMNI_SIGNAL_WEBHOOK_URL（低）
4. **[治理] omni-meta 未跟踪 93 源 + 68 产物**按区块入库/归档
5. **[监控] packages/core/tools 并发改写**：下次对账观察，若驻留则归因到具体会话

### v2 双侧部署 + 全流程追踪（2026-09-08 03:30 上线）

**设计结论**：机制**双侧都部署**——同一引擎 `--role dev|prod` 角色对偶运行，
权威源共享（omni-meta 队列/autopilot/omni git/端口 health），视角互换（self=各自仓库+home，
peer=对侧），报告互比产生"对比"。理由：
1. prod 侧自动化基础设施与 dev 完全一致（时钟+triggers 目录），双侧部署成本≈0；
2. 角色对偶能发现单边看不到的缺漏（实证：prod 侧首跑即发现 8088 自身追踪器 23 行陈账，
   dev 侧视角完全不可见）；
3. 容错：dev 会话/进程不可用时 8088 仍独立出具审计；
4. 生产侧定时走 `--report-only` 只读；`--fix-ledger` 需显式加参（仅写本侧 router JSON+备份）。

**新增校验面**：
- **F1 在途轨迹**：非终态 RC 的阶段事件时间线 + 停驻小时数
- **F2 部署关联**：closed RC 的 artifact commit 是否在当前代码树（git 祖先判断，可解析才判）
- **F3 驳回→重提闭环链**：显式引用双向查找（归档理由/标题/他项引用）+ 同名 closed 豁免 + demo 豁免
- **F4 审核时间线**：8008/8027 通过率、提交→关闭天数最长 Top
- **G 对侧对比**：读对侧 ALIGNMENT_STATE.json 输出缺口面差集；角色固有面（C-dev-*）预排除防互报

**部署物**：
- 引擎：`scripts/alignment_check.py`（本仓 + 已同步 `dsh-prod-src/scripts/`）
- 触发器模板：`data/release_control/triggers/alignment-check.{dev,prod}.json`
- 已部署：dev `dsh-home/data/automation/signals/triggers/alignment-check.json`（30min，role dev）
  + prod `dsh-prod-home/data/automation/signals/triggers/alignment-check.json`（30min，role prod）
- 双侧报告：dev `data/release_control/ALIGNMENT_REPORT.md` / prod `dsh-prod-src/data/release_control/ALIGNMENT_REPORT.md`

**首轮双侧结果（03:27-03:30，两端各 2 轮收敛）**：
| 面 | dev 视角 | prod 视角 |
|---|---|---|
| A 追踪器 | 0 陈账（此前已修） | **23 行陈账→已修**（备份 `router-*.bak-align-20260908-032429`，dev 看不见的缺口被 prod 抓住） |
| F2 部署关联 | closed 70：在树 49 / 不在树 0 / 无法核验 21 | 同 |
| F3 驳回重提 | 驳回 22 → 10 闭环链（028→073/068→072/070→071/074→078/080-083→084/085-086→087），孤驳 1（RC-000012） | 同 |
| F4 审核 | 8008 74/93 通过，8027 70/73 通过；最长 submit→close 11.6d（RC-000001） | 同 |
| G 对比 | only_self=C-dev-*（角色固有） | only_peer=C-dev-*（对侧固有）｜无分歧 gap |

**从 F 面派生的长期动作**：
1. 21 个 closed RC 无 commit 可核验（artifact_ref 写分支名/@latest）→ 建议提交规范要求 artifact_ref 带 commit
2. RC-000012 孤驳 → 补归档备注或确认已被后续 API 工作覆盖
3. 提交→关闭最长 11.6 天 → 结合 F1 停驻监控持续观察卡点

### 9/5 git 事故存档 + H 面上线 + 8088 交接（2026-09-08 04:00）

**事故**：`5120dd87c7`（09-05 14:22，"chore: WIP checkpoint before upstream dsh-0.1.3-alpha.1 merge"）
一次提交 **30,674 文件 / 4,255,267 行**；该批正当修改约 59 文件（对照 `a584925285` 13 + `41301d0567` 8
等后续修正提交），其余为工作树快照杂物。后果：dev-repo 对象库膨胀（size-pack ≈ **188.89 MiB**，
`git count-objects -vH` 实测），PR 评审噪声大、diff 不可读。**工作树现已正常**（后续提交已修正），
事故残留仅存在于 git 历史。

**处置**：
1. **H 面（git 卫生）上线**：引擎双仓扫描近 500 提交，>1000 文件的提交触发 high 告警 + 对象库体积报告。
   实测持续命中：dev-repo `5120dd87c7`（30674）+ omni-meta `f5f7a06`（2867）/`4bfc876`（1243）即两仓现存大提交，
   每 30 分钟监测，同类事故提交不再可能无声进入历史。
2. **交接手册**：`data/release_control/HANDOVER_8088.md`（已同步 `dsh-prod-src/data/release_control/`），
   含机制全貌/运行方式/双端边界/事故存档与 git 卫生纪律（提交前 `git diff --stat`；禁 WIP 一把梭；
   artifact_ref 必须带 commit）/故障排查表。
3. **历史清理建议**：filter-repo 瘦身列为独立专项（需全协作会话 force-push 配合 + 先备份仓库），
   不阻断日常运行；H 面持续监测兜底。

**双侧终态（04:00 快照）**：dev 51 缺口 / prod 41 缺口，G 对侧对比双侧无分歧 gap
（仅角色固有面：dev 独有 C-dev-* 与本仓 H 大提交监测；prod 独有 dev 侧报告内容滞后一环的对照说明）。
双侧 30min 触发器在役：dev `dsh-home/.../triggers/alignment-check.json` +
prod `dsh-prod-home/.../triggers/alignment-check.json`（均 `--role` 显式 + `--report-only` 只读）。

### 瘦身专项交接 + 机制交付入库（2026-09-08 04:30）

**专项会话已建**：`session-4033bd53-6bc4-4c54-9440-9789fa67526f`（git 历史瘦身，任务书+接力卡号已注入，GUI 可见）
**交接卡**：`RL-000022`（open → 新会话接手 → done；契约=方案/备份/force-push 协调/59 正当修改保留验证/H 面复核）
**归口原则入手册**：8088 发现开发链路问题 → 只报告回投接力卡，生产环境不执行历史重写/force-push；
手册已同步 `dsh-prod-src/data/release_control/HANDOVER_8088.md`。
**机制交付已正式提交**：dev-repo `dce9aa9ddb`（引擎 v2 + 触发器模板×2 + 交接手册 + spawn 脚本 + 台账 + .gitignore），
对齐校验/交接物不再游离于版本控制；40 分钟后 8088 侧 H 面将随新引擎继续监测瘦身效果（对象库体积回落可自动验证）。

---
*上一版第 1-6 节为 0903 首审结论；第 7 节起为 0908 对齐机制运行后的持续对账记录。*
