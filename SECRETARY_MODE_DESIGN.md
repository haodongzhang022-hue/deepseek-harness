# DeepSeek Harness 秘书模式（Secretary Mode）设计方案

> 版本：v1.2（2026-09，总师架构评审 + preset 划分决策 ADP-R1）｜状态：**架构冻结，移交开发**（接力卡：见 §11）
> 目标载体：<dshHome>/.agent-presets/secretary-mode/ + dsh-external/dsh-secretary/
> 一句话：**每个对话配一名专属秘书，秘书只以「折叠信息层」（小目标 + 进度 + 阻塞 + 下一步）对外说话；秘书长汇总全部折叠层，常规事秘书自决自推，重要事汇总成「人类决策收件箱」一次拍板，再翻译分发回各对话继续推。人类从管 10 个对话升级到管 50–100 个，且不破坏现有缓存命中机制。**
> v1.1 变更摘要：总师评审结论「设计整体成立，升级 16 项（P0×6 / P1×6 / P2×4）」；关键修订 = 秘书会话「状态驱动」定位与上下文预算协议（§1.5）、执行授权门禁在工具层强制（§3.1）、身份校验降级为凭证+审计（§1.3）、工作区互斥锁（§5.4）、规则层预筛（§4.3）、自愈与晨报（§4.7-4.8）、与 0903 关系界定（§2.1）、实现验证点（§7.4）。评审明细见 §10。
> v1.2 变更摘要：preset 划分架构决策 ADP-R1（§2.1 重写 + §10.6 新增）——**秘书独立成 preset（形态隔离），平台/协作/数据三层统一**；经理按此分工。

---

## 0. 现状盘点（本方案直接落地在哪些现有机制上）

已确认可复用、可挂载的现有资产（2026-09 实测于本机部署）：

| 资产 | 位置 | 作用 |
|---|---|---|
| 接力卡 relay-cards | dsh-external/dsh-relay-cards（已挂 profiles/web/cordis.patch.yml） | relay_write/read/list/update；单文件 JSON 原子写 + 损坏自愈；open→in_progress→done 状态机。**「上报/分发」通道蓝本** |
| 自动化调度器 scheduler | packages/automation/scheduler（已挂，bus + signals/triggers） | 分钟级 pulse 总线；triggers/ 目录 JSON recipe（match 脉冲槽位 → http POST / exec；dedup_key 去重；failure_policy 通知 owner 会话）。**「巡检/唤醒」发动机** |
| 会话投递通道 | ACP agent/session/prompt（scheduler notify_transport dsh-session.prompt 已实现 v1） | 一个会话一次一条提示词、Agent 空闲才交付。**「叫醒秘书会话」的投递口** |
| automation-console | dsh-external/dsh-automation-console（已挂，含 client 面板） | 只读聚合 + automation_overview 工具 + web 面板样板（HTTP routes 先例）。**「汇总/面板」样板** |
| preset 体系 | E:/1shuju/dsh-home/.agent-presets/<id>/（preset.yml + agent.cordis.yml + registry/ + docs/） | 0903 preset 即当前模式载体；新 preset 完全同构，服务行放 isolate group |
| 插件挂载 | profiles/web/cordis.patch.yml insert（file:// 路径，src 直挂） | 新插件照 relay-cards 同款方式挂载 |
| memory / mindmap-conversation / release-control(8008) | 根目录 dsh-plugin-memory-config.yaml；0828siweijiaqiang 目录 mindmap；release_control MCP | 可选集成，非本方案依赖 |

**明确不在本方案范围内的东西**：不修改 agent-loop、不加新会话事件类型（折叠层写盘即审计，工具调用本身已落日志）、不动 LLM provider 层。全部是「新增 preset + 新增外部插件 + 新增 trigger recipe」。
---

## 1. 核心抽象：折叠信息层（Folded State）

### 1.1 为什么「只看折叠层」

人类现在管 10 个对话就累的原因：判断一个对话「要不要管、管什么」必须打开对话看原文，10 个对话 × 长上下文 = 认知带宽爆炸。
本方案第一个不变量：**秘书长和人类的一切判断，输入只有折叠信息层；对话原文永远不进入汇总/决策上下文。**

折叠层 = 每个对话一份、由该对话的专属秘书维护的浓缩状态。它回答判断所需的全部问题：
- 人类目标是什么？（goal）
- 现在完成到哪？（goal_progress + todos）
- 卡在哪？（blockers）
- 秘书建议下一步干什么？（next_action）
- 有没有需要人类拍板的事？（pending_decision）

这就是「只看 todolist 和汇报的进度」——折叠层就是「todolist + 汇报」本身。

### 1.2 折叠层 Schema（v1）

~~~json
{
  "schema_version": 1,                        // 版本演进：迁移函数在 store 层（照 session 格式版本做法）
  "conv_id": "conv-42",
  "enroll_token": "tok-xxxx",                 // 登记凭证：fold_write 身份校验用（见 1.3）
  "secretary_session_id": "session-xxxx",     // 专属秘书会话 id（注册表反向可查）
  "human_session_id": "session-yyyy",         // 人类原对话会话 id
  "workspace": "E:/xxx",                      // 共享工作区（秘书实际干活的地方）
  "own_preset": "architect-common-team-0903", // 该对话自身 preset（编排层不替代其专业执行）
  "industry": "software",                     // 可选：对接 0903 路由层的行业标记
  "goal": "一句话人类目标（不可篡改，变更=进 inbox 确认）",
  "goal_ctx": "结构化背景（登记时人类写的任务背景/约束，≤300 字，非原文）",
  "goal_progress": 0.3,                       // 0.0–1.0，按 todos 加权（done/total），防拍脑袋
  "todos": [                                  // 「小目标层」，判断的主要依据
    { "id": "t1", "text": "完成数据清洗脚本", "status": "done" },
    { "id": "t2", "text": "跑通回测流水线", "status": "active" },
    { "id": "t3", "text": "输出周报", "status": "todo" }
  ],
  "last_report": "清洗完成回测卡住",            // ≤100 字一句话汇报（唯一叙述字段）
  "blockers": [
    { "id": "b1", "level": "important", "text": "API 密钥过期，重试 3 次失败", "since": "2026-09-05T10:00:00Z", "state": "open" }
  ],
  "pending_decision": null,                   // 或 { id, question, options[], context_ref, raised_at }
  "pending_instructions": [],                 // 指令卡队列：{ id, priority: P0-P3, text, from, at }，sweep 合并投递
  "next_action": "换新密钥后重试回测",
  "heartbeat": { "updated_at": "2026-09-05T10:05:00Z", "status": "active|stalled|needs_human|done" },
  "autonomy_tier": "auto|assisted",           // 该对话允许秘书自主的等级（人类可逐对话设置）
  "history": [ { "at": "...", "actor": "secretary-42|chief|human", "action": "t2 done; blocker b1 raised" } ]
}
~~~

约束（插件强制校验）：
- goal 由人类在登记时给定，**秘书无权改动**；要改 → pending_decision 走人类确认。
- todos 是唯一事实源；last_report 是唯一的自然语言（≤ 100 字），防止秘书把原文/长叙述又写回来。
- goal_ctx 是秘书干活的背景依据（状态驱动输入），登记时由人类填写或由对话侧插件从人类首条消息提炼后请人类确认。
- 折叠层 ≤ 1KB（预算内），超限拒绝写入并提示压缩；schema_version 不兼容变更走迁移函数。

### 1.3 存储、更新协议与身份校验

- 存储：<DSH_HOME>/data/secretary/folded/<conv_id>.json（每对话一个文件），注册表 registry.json（conv_id → secretary_session_id + workspace 锁），收件箱 inbox/inbox.json（含 TTL），审计 journal/secretary-journal.ndjson。
- 写盘模式照抄 relay-cards 已验证的「tmp + rename 原子写 + 损坏隔离自愈」，插件 apply 内异常只记日志绝不抛出（不崩 web 主体）。
- 谁写：名义上「只有该对话的专属秘书会话写自己的折叠层」。**身份校验实现策略（v1.1 修订）**：工具回调能否拿到调用者 session 身份属实现验证点（§7.4 V1）；拿不到则降级为 **enroll_token 凭证校验 + 全量审计日志**——fold_write 必须带 conv_id + enroll_token，错误凭证拒绝，任何写入落 journal 备查。异常写入（频繁校验失败）计入面板告警。
- 折叠层是秘书会话的**唯一恢复源**：秘书会话被踢掉/重建后，凭 conv_id 重新加载折叠层即可无缝继续——这是「对话只完成了十分之一但停了」的续推基础。

### 1.4 与缓存命中机制的关系（三个不变量）

1. **判定上下文 = 固定模板 + 折叠 JSON（≤1KB）+ 挂起指令卡（≤0.5KB）**。秘书/秘书长每次请求的 prompt 前缀几乎不变（模板完全相同、折叠层大多数字段稳定），DeepSeek 前缀缓存持续命中；每次心跳的实际新 token ≈ 变化的小字段。
2. **原文字面永不进入汇总/决策上下文**。原文暴露只有一条受控路径：secretary_quote（按 context_ref/blocker id 取指定片段，限长度、一次性、仅人类在面板上主动展开时用），用完即弃，不进任何长期上下文。
3. **会话间上下文永不拼接**。100 个对话 = 100 个独立的小请求，绝不把 100 份历史拼进一个请求（那既毁前缀缓存又爆 token）；汇总以「每对话一行 ≤100 token」的表格形态出现。
4. **汇总前缀稳定（v1.1 补充）**：汇总请求 = 固定元数据前缀（模板 + 统计头）+ 按 conv_id 稳定排序的表体；表体只增删行、不改前缀，保证前缀缓存对「模板+统计头」持续命中。

度量（Phase 4 验收用）：每请求输入 token 中「与前一次同会话请求相同前缀」的占比 ≥ 95%，且全量汇总请求输入 ≤ 15K token。

### 1.5 秘书会话：状态驱动 Agent + 上下文预算协议（v1.1 新增，P0-1）

**定位修订**：秘书不是「对话驱动」的 agent（不继承聊天历史），而是「**状态驱动**」的 agent——它的一切输入来自折叠层、指令卡与工作区现状，一切输出写回折叠层与工作区。这同时解决「秘书上下文从哪来」与「缓存前缀稳定」两个问题。

秘书会话每次请求的上下文预算协议（≤ 5K token，硬约束）：

| 段 | 内容 | 预算 |
|---|---|---|
| S 系统模板 | 秘书角色规范 + 折叠协议 + 分级规则（固定不变） | 2–3K |
| F 折叠层 | 当前折叠层 JSON（含挂起指令队列） | ≤1K |
| I 本轮指令 | 续推卡/人类指令/秘书长回程指令（已合并） | ≤0.5K |
| W 本轮工作摘要 | 秘书上一轮自产的工作产物摘要（≤200 字，非原文） | ≤0.5K |

**历史不累积**：秘书会话的旧轮次不滚入新请求（会话内部对旧轮次压缩/prune，或由 sweep 以「新建迭代会话 + 折叠层恢复」实现轮次切换）。每轮请求前缀几乎相同 → 前缀缓存命中最大化。这是「不破坏缓存命中」在秘书侧的执行细则。

干活的背景从哪来（按需，不进长期上下文）：goal_ctx（结构化）优先；不足时 secretary_quote 按 ref 取片段；工作区文件/git 现状随时可查。禁止秘书凭猜测编造背景。
---

## 2. 角色与会话拓扑

~~~
                     ┌──────────────────────────────────────┐
                     │              人类（决策层）            │
                     │  决策收件箱面板（web） ← 一眼看完所有   │
                     │  秘书长聊天（可选：直接说话/批量拍板）   │
                     │  晨报推送（自动摘要，见 4.8）          │
                     └───────────────┬──────────────────────┘
                                     │ ① 只在折叠层上判断：总览表 + inbox
                                     ▼
                     ┌──────────────────────────────────────┐
                     │          秘书长会话（1 个）            │
                     │ 汇总折叠层 → 分类：自动类直接回指令；    │
                     │ 重要类进 inbox；人类决策 → 翻译分发      │
                     └───────────────┬──────────────────────┘
          指令卡/接力卡(down)▲    上报折叠层(up) │  折叠层只读(旁路)
        ┌───────────────────┴──────┬───────────┴───────┐
        ▼                          ▼                    ▼
  ┌─────────────┐           ┌─────────────┐      ┌─────────────┐
  │ 秘书会话 A   │           │ 秘书会话 B   │ ...  │ 秘书会话 N   │
  │ 对话1 专属   │           │ 对话2 专属   │      │ 对话N 专属   │
  │ 读折叠层→干→写 │           │ 同上         │      │ 同上         │
  └──────┬──────┘           └──────┬──────┘      └──────┬──────┘
         │  共享工作区（同一 workspace，实际执行任务）      │
         ▼                          ▼                    ▼
   ┌────────────────────────────────────────────────────────┐
   │  人类原对话会话（保留原样，秘书不并入、不读取其长历史）    │
   │  该对话自己的 preset 继续负责专业执行（如 0903 团队）    │
   └────────────────────────────────────────────────────────┘
~~~

- **专属秘书会话**：每对话 1 个独立 session（preset = secretary-mode）。状态驱动（§1.5），在该对话的共享工作区里真实干活（写代码/跑命令/检索）；复杂子任务可选转交「开发小组」（接力卡/subagent，§10 P2-16）。干完一轮，把变化写回折叠层。它绝不把原文搬进报告。
- **秘书长会话**：1 个（preset = secretary-mode，角色=秘书长）。定时轮询全部折叠层（或由 trigger 投递提醒），产出：**总览表**（每对话一行）+ **inbox**（L2/L3 决策项）+ **回程指令**（对 stalled / L0L1 处理过的对话直接下发继续指令）。秘书长自身状态（校准统计、最近汇总快照）落盘 chief-state.json。
- **人类**：只面对三个面——① 决策收件箱（web 批量勾选/回复）；② 目标登记与总览（面板或秘书长聊天）；③ 晨报（自动推送）。不打开任何对话原文。

### 2.1 体系划分架构决策 ADP-R1：形态分 preset，平台统一（v1.2）

**决策：秘书模式独立成 preset（secretary-mode），不与 0903 合并；统一靠「平台层 + 协作层 + 数据层」实现，不靠「同一个 preset」。**

判断依据（秘书 vs 架构师 = 两种 Agent 形态，操作差异在骨子里）：
- **形态差异**：0903 架构师 = 对话驱动 + 团队协作编排（行业路由/接力卡/坐标系/12 角色）；秘书 = 状态驱动 + 折叠层读写 + 窄工具面推进（§1.5）。合并进一个 preset 会 persona 串味、系统提示臃肿、权限白名单无法按形态收紧（§3.1 硬门禁失效）。preset 是「身份/行为模板」，按**形态**划分，不按业务领域划分——这正是用户观察「秘书的操作明显和其他 Agent 不同」的架构化表达。
- **统一靠三层（0903/量化/秘书等所有 preset 共享同一份，不复制）**：
  1. 平台层（全局插件与数据）：relay-cards、dsh-secretary（折叠层/inbox/锁/面板）、scheduler triggers、policy.json、审计日志——全部挂 profiles/web/cordis.patch.yml，跨 preset 单份生效。
  2. 协作层（跨 preset 寻址）：接力卡 assignee_role 继续对齐 0903 角色目录（「架构·经理」「架构·开发」…）；秘书/秘书长与任何 preset 会话经接力卡 + inbox 双向流转；折叠层 own_preset 字段记录对话自身 preset，转接不迷路。
  3. 数据层（同源事实）：折叠层/注册表/inbox/锁是全平台通用存储；0903 侧如需引用秘书状态直接读折叠层（工具全局可用），不复制不双写。
- **边界纪律**：architect-common-team-0903 原样不动（新增代替修改）；secretary-mode 只新增；两方接触面 = 接力卡 + 折叠层 + inbox 三个接口，无其他耦合。

---

## 3. 决策分级体系（L0–L3）

「常规的秘书直接做，重要的给人类」不能靠嘴，靠一张可配置的分级表：

~~~jsonc
// policy.json（preset registry 默认 + <DSH_HOME>/data/secretary/policy.json 可覆盖）
{
  "score_by_action": {
    "run_code/read/write 常规文件": 1, "git_commit": 2, "web_fetch": 1, "web_search": 1,
    "http_post_external": 3, "git_push": 4, "delete_file": 5, "schema_migration": 6,
    "deploy": 8, "资金操作/下单": 9, "对外发布/发消息": 7
  },
  "flags": { "irreversible": 3, "affects_other_conv": 4, "exceeds_budget": 2, "goal_ambiguous": 5 },
  "tiers": { "L1_auto_max": 3, "L2_chief_max": 7 }
}
~~~

| 级别 | 判定 | 谁执行 | 依据 |
|---|---|---|---|
| L0 自动执行 | 无决策、动作明确（接着干） | 秘书直接做 | todo 状态机推进 |
| L1 常规自决 | 动作风险分 ≤ 3 且目标清晰 | 秘书自决并留痕（history 记 action+理由） | policy 表 |
| L2 上报秘书长 | 风险 4–7、跨对话影响、或连续 2 轮无进展 | 秘书长汇总裁定；秘书长受同一 policy 约束，越限转 L3 | policy 表 + 停滞检测 |
| L3 人类决策 | 风险 > 7、不可逆、跨对话资源冲突、目标不明/要改 goal | 进 inbox，人类批量拍板 | inbox 面板 |

- **停滞检测**：heartbeat.updated_at 超过阈值（默认 15 分钟，可配）且 status≠done → 标记 stalled，由巡检 trigger 唤醒秘书会话并投递「续推卡」；连续唤醒 2 次仍无进展 → 自动升为 L2 上报（防止秘书空转烧 token）。
- **校准回路**：人类在 inbox 里给每条决策打 accepted / overruled（+理由）。秘书长周期统计误报率（overruled 占比）与漏报率（人类主动点名但未上报的对话），调 policy 阈值。
- **autonomy_tier=assisted 的对话**：L1 也进 inbox（人类想多管些的对话，逐对话设置）。

### 3.1 授权门禁在工具/preset 层强制（v1.1 新增，P0-2）

分级表只是「判断规则」，**强制执行必须在工具可用性层**：
- secretary-mode preset 的 agent.cordis.yml 配置权限白名单/黑名单：policy 高分动作对应的工具（delete/deploy/资金/对外发布/git_push 等）在秘书会话**直接不可用/需审批**（用 DSH 现有 permission/交互机制——本机 approval 关闭时表现为「不可用」而非「硬来」）。
- 秘书遇到不可用工具 → 自动升级 L2/L3（不用等 policy 打分，「工具不可用」本身就是硬门禁）。policy 表负责「提前识别」，preset 权限负责「兜底拦截」，双层闭环。
- 该机制与 DSH 现有审批体系关系：不绕过、不新增审批弹窗，只做「秘书会话范围内按风险收窄工具面」。

---

## 4. 核心流程（时序）

### 4.1 登记（onboarding）
1. 人类在任意对话里说「交给秘书」或面板新建 → secretary_enroll { conv_id, goal, goal_ctx, workspace, own_preset, autonomy_tier }。
2. 插件建折叠层（schema_version=1，生成 enroll_token，goal 原样写入）+ 注册表登记 + 创建/绑定秘书会话（沿用 preset 模板，共享工作区）。
3. 秘书首轮：把 goal 拆成小目标 todos（MECE + 可验证 + 每项 ≤ 半天体量）→ 写折叠层 → 进入常规循环。
4. goal 含糊（插件启发式：含「大概/尽量/你看着办」或超长）→ 直接进 inbox 要人类一句话确认目标。

### 4.2 常规推进（L0/L1，秘书自治）
- 秘书会话每轮：按 §1.5 组装上下文 → 判断 L0/L1 → 干活 → secretary_fold_write（todos 变更 + progress + report + next_action + 心跳）。
- 人类在原对话里说话时，由对话侧插件（dsh-secretary 的会话事件订阅）把人类「最新指示」提炼为 ≤200 字指令卡写入 pending_instructions（不复制原文），sweep 时投递。

### 4.3 巡检与续推（自动，规则层先筛，无 LLM 不唤醒）
- trigger recipe（见 §5）：secretary-sweep 每分钟执行 **规则层预筛**（纯代码，零 LLM）：
  1. 心跳超龄 & status≠done → stalled 候选；
  2. pending_instructions 非空 → 有待投递；
  3. 工作区产物时间戳与 progress 明显不符 → 上报漂移候选。
- 只有命中者才被唤醒并投递**续推卡**（模型调用只发生在真正需要判断/执行时；常规对话巡检不消耗 LLM token）：

~~~
[续推卡 conv-42] 任务: <goal> | 进度: 30%（<last_report>）
小目标: t1 done / t2 active / t3 todo
阻塞: b1 API密钥过期(important)
下一步建议: 换新密钥后重试回测
挂起指令: <pending_instructions 已合并>
请继续推进；按 §1.5 上下文预算工作，只更新折叠层，不要汇报原文。
~~~

### 4.4 上报与汇总（L2/L3）
- 秘书遇到 L2/L3 → 折叠层 blockers.important + pending_decision（插件同时落 inbox；必要时等价接力卡 relay 一条，assignee_role=秘书长，保持 0903 主干兼容）。
- 秘书长轮（trigger 提醒或自轮询）：secretary_report 读全部折叠层 → 分类：
  - **可直接裁决的 L2**（policy 内）→ 生成回程指令；
  - **L3 或跨对话冲突** → inbox 条目（question/options/context_ref/涉及对话）。
- **总览表**（人类面板的核心视图，全部来自折叠层，一行一个对话）：

~~~
#12 目标: 量化回测流水线 | 进度 30% | 阻塞: 密钥过期(重要) | 建议: 换key重试 | 报告: 清洗完成,回测卡住
#13 目标: 游戏角色动画系统 | 进度 70% | 无阻塞 | 建议: 继续做待机动画 | 报告: 走路动画已合入
#14 目标: 视频脚本x3 | 进度 10% | 阻塞: 缺参考素材(常规,秘书已自行处理) | 建议: 继续
~~~

### 4.5 人类决策与回程分发
1. 人类在 inbox 面板一次勾选/回复 N 条（或秘书长聊天里直接说「13、14 继续，12 先换 key」）。
2. secretary_inbox_decide 落库决策（含 accepted/overruled 标记，进校准回路）。
3. 秘书长分发轮把每条决策翻译成指令卡（带优先级）→ 写入对应对话 pending_instructions → 投递到秘书会话 → 秘书继续推（§4.3 相同通道）。
4. **指令合并**：同一会话多条挂起指令在投递前按 P0>P1>P2>P3 合并为一条（防堆积、防打断）。

### 4.6 完成与归档
- goal_progress=1 且 todos 全 done → 秘书写终局报告（折叠层保留）→ 状态 done → 从总览表消失，归档到 data/secretary/archive/。人类后续可一键复查归档（仍是折叠层，不拉原文）。

### 4.7 自愈（v1.1 新增，P1-9）
- sweep 发现 secretary_session_id 对应会话不存在/无法投递 → 自动重建秘书会话并重新绑定（幂等：按 conv_id 加载折叠层恢复，无重复状态）。
- 折叠层损坏 → 隔离留档重建（复用 relay store 已验证模式）；inbox/registry 同理。
- trigger 重复触发 → dedup_key 按 pulse_id（已验证机制），不产生重复执行。

### 4.8 人类晨报与 inbox 超时管理（v1.1 新增，P1-10/11）
- **晨报**：每日固定时间自动生成（纯折叠层聚合，非原文）：昨日进展（done TODO 数/对话数）、stalled 清单、inbox 待决清单（按风险排序）、各对话 next_action 一行。投递到人类主会话/面板通知。
- **inbox TTL**：条目默认 24h；超时未决 → 标记 WAITING_HUMAN 并置顶晨报（连续 2 次未决自动折叠为一条），避免任务无限搁置；人类一次拍板后可批量清场。
---

## 5. 调度与并发（50–100 对话的容量核算）

### 5.1 巡检/汇总 trigger（复用现有 scheduler bus）

~~~jsonc
// <DSH_HOME>/data/automation/signals/triggers/secretary-sweep.json
{
  "trigger_id": "secretary-sweep",
  "owner_session": "secretary-chief",              // 失败通知目标
  "match": { "channel": "minute", "slot_m_mod": 3 },
  "action": { "kind": "http", "url": "http://127.0.0.1:3080/api/v1/secretary/sweep", "method": "POST",
              "body": "{}", "timeout_s": 60 },     // 端点由 dsh-secretary 插件提供（automation-console HTTP routes 先例；token 自发现照 mindmap）
  "overlap": "skip", "dedup_key": "secretary-sweep:{pulse_id}",
  "failure_policy": { "consecutive_fail_notify": 3, "notify_transport": "dsh-session.prompt", "notify_target": "secretary-chief" }
}
~~~

~~~jsonc
// secretary-summary.json：slot_m_mod=15 → 通知秘书长会话「汇总一轮」；inbox 变化时插件实时推送
// secretary-digest.json：每日 08:00 → 生成晨报投递人类主会话
~~~

sweep 端点内部：规则层预筛（§4.3，零 LLM）→ 命中者查注册表 → 获取工作区锁（§5.4）→ 逐个（或分批 ≤ 4 并发）经 ACP session/prompt 投递续推卡；dedup 防止同一对话被重复唤醒。

### 5.2 容量核算（目标：1 人负载 50–100 对话）

| 项 | 每对话每轮 | 100 对话/小时量级 |
|---|---|---|
| 规则层预筛（sweep） | 纯代码，零 LLM | 每分钟 1 次全量扫描，CPU 可忽略 |
| 秘书心跳（L0/L1） | 输入 ≈ 模板(2–3K,前缀缓存命中) + 折叠层(≤1K) + 指令(≤0.5K) + 本轮摘要(≤0.5K) | 仅 stalled/有指令的对话被唤醒；前缀命中后实际新 token 很小 |
| 秘书长汇总 | ≤100 token/行 × 100 行 + 固定模板 | 1 次/15 分钟 ≈ 10–15K token/轮 |
| 人类决策 | 只有 L2/L3 进来（预期 <20% 对话轮次）；一次拍板 5–20 条 | 人类每天 ≤ 3–5 次批量查看 + 1 次晨报 |

关键点：**人类的工作量不随对话数线性增长**——增长的是秘书/秘书长（LLM 自动化）部分；人类只处理 inbox（被分级表挡到很小）与总览抽查。50–100 的可达性取决于 L1/L2 判定准确率（校准回路持续优化）而非机器算力。

### 5.3 限流与防抖
- sweep 批内并发 ≤ 4、每对话唤醒间隔 ≥ 心跳阈值（默认 15 分钟，防秘书空转）；
- 同一对话 dedup_key 按 pulse_id；秘书长汇总间隔 ≥ 5 分钟；
- 全局每日预算（cost_cap）超限 → 自动把余下对话降为「仅汇总不推进」，通知人类。

### 5.4 工作区互斥锁（v1.1 新增，P0-4）
- registry.json 维护 per-workspace 锁：{ workspace, holder_conv, locked_at, expiry }。
- 秘书在 L0/L1 执行前先 secretary_lock（非阻塞申请，15 分钟自动过期）；跨会话动作（git commit/push、大文件写）必须持锁；锁被占 → 动作升级 L2 或排队。
- 同一对话内天然串行（session/prompt 单会话串行交付），锁主要防「两个秘书在不同对话共用同一 workspace（同仓库不同任务）」的互踩。
- sweep 投递续推卡前先确认锁可用，避免唤醒即撞锁空转。

---

## 6. 插件与工具 API 草案（dsh-external/dsh-secretary）

function 插件（name/inject/Config/apply，无 default export；inject: [tools]），挂 cordis.patch.yml insert。工具清单：

| 工具 | 使用方 | 说明 |
|---|---|---|
| secretary_enroll | 人类/面板 | { conv_id, goal, goal_ctx, workspace, own_preset, autonomy_tier? } → 建折叠层+注册 |
| secretary_fold_write | 秘书 | 全量替换折叠层（心跳收尾；校验 enroll_token） |
| secretary_fold_patch | 秘书/秘书长 | 部分更新（todos/blockers/progress…） |
| secretary_fold_read | 秘书/秘书长 | 读单对话折叠层（纯 JSON，无原文） |
| secretary_fold_list | 秘书长/人类 | 汇总表（filter: active/stalled/needs_human/done/all） |
| secretary_instruction | 秘书长/对话侧 | 写 pending_instructions（带优先级，可合并） |
| secretary_lock / secretary_unlock | 秘书 | 工作区互斥锁（§5.4） |
| secretary_inbox_list | 秘书长/人类 | 决策收件箱（含 TTL/WAITING_HUMAN 状态） |
| secretary_inbox_decide | 人类 | { item_id, decision, note?, verdict: accepted|overruled } 落库并触发分发 |
| secretary_dispatch | 秘书长 | { conv_id, instruction, priority } → pending_instructions + 投递 |
| secretary_quote | 人类（面板展开时） | 取指定原文片段，限长、一次性、仅人类主动展开 |
| secretary_report | 秘书长 | fold_list + 自动聚合分类（纯函数，可单测） |
| secretary_digest | 秘书长/trigger | 生成晨报/周报（纯折叠层聚合） |
| secretary_status | 人类/面板 | 总量/各状态计数/心跳年龄/inbox 数/今日预算/锁占用/校准统计 |

面板（dsh-client-ui-slots，照 automation-console client 模式）：总览表 + 决策收件箱 + 校准回路视图 + 状态卡片，路由 /secretary。所有写操作走同一工具接口（模型可见、工具调用落日志，符合 Model-visible ⟺ logged）。
---

## 7. 实现规划与文件布局

### 7.1 组件清单

~~~
dsh-external/dsh-secretary/            # 新外部插件（本工作区，与 dsh-relay-cards 同级）
  src/index.ts       # function 插件：工具注册 + sweep/digest HTTP 端点 + 会话事件订阅（人类指示提炼）
  src/store.ts       # FoldedStore / InboxStore / RegistryStore（含锁；原子写+自愈，仿 relay store）
  src/aggregate.ts   # 汇总/分类/停滞判定/晨报生成（纯函数，单测覆盖）
  src/policy.ts      # 分级表加载与打分
  src/client/        # web 面板（总览表 + 收件箱 + 校准回路 + 状态卡）
  tests/*.test.mjs   # 单测 + load-smoke（照 relay-cards）
  ACCEPTANCE.md / README.md
.agent-presets/secretary-mode/         # 安装到 DSH_HOME（preset.yml + agent.cordis.yml + registry/policy.json + docs/）
  agent.cordis.yml   # 秘书/秘书长两套 agent 模板（isolate group）+ 权限白名单（§3.1 硬门禁）
  registry/policy.json
  docs/SECRETARY_RULES.md
profiles/web/cordis.patch.yml          # insert dsh-secretary + 三条 trigger recipe（sweep/summary/digest）
<DSH_HOME>/data/secretary/             # folded/ registry.json(含锁) inbox.json journal/ chief-state.json archive/
~~~

### 7.2 Phase 计划（每阶段有验收，不破坏现有机制）

- **Phase 0 设计冻结** ✓（本文档 v1.1 由总师评审升级后冻结）。
- **Phase 1 折叠层与工具**：dsh-secretary 插件（store+folded-*/inbox 基础+登记+锁）。验收：单测全绿 + load 冒烟；在本会话内用工具建一个真实折叠层走通写读；**验证点 V1-V4 全部落结论**（§7.4）。
- **Phase 2 秘书 preset + 单对话试点**：secretary-mode preset（含权限白名单）；把本仓库一个真实任务对话 enroll，秘书会话推进 3 轮以上，折叠层逐轮更新、能跨会话恢复（杀秘书会话重建后凭折叠层续推）、权限硬门禁生效。
- **Phase 3 秘书长 + inbox + 面板**：secretary_report 汇总、inbox 决策回路（含 TTL/校准标记）、web 面板、晨报。验收：2 个对话模拟 L3 上报 → 人类一次拍板 → 两条指令自动分发回对应秘书，全程不看原文；inbox 超时置顶生效。
- **Phase 4 调度自动化 + 批量 + 缓存验证**：sweep/summary/digest trigger 上线；10 对话压测 → 50 → 100；**缓存命中验证**（同会话请求前缀重复率 ≥95%，汇总请求 ≤15K token）；校准 policy（记录 accepted/overruled，调整阈值）。验收：1 人仅处理 inbox，总览表可 1 分钟内扫完 100 行。

### 7.3 明确不做的（防范围蔓延）
- 不改 agent-loop / 会话事件词汇（无需新事件类型；折叠层写盘即审计）。
- 不改任何现有 preset 文件（新增代替修改；0831/0901/0903 保持原样）。
- 秘书自动执行仍受 DSH 现有权限/审批体系约束（§3.1 机制，非绕过）；本机 approval 关闭时，高分工具不可用即自动升级。

### 7.4 实现前置验证点（Phase 1 必须先落结论，v1.1 新增）

| 编号 | 验证内容 | 不通过时的替代方案 |
|---|---|---|
| V1 | defineTool 回调能否拿到调用者 session 身份 | 降级为 enroll_token 凭证 + 审计（§1.3） |
| V2 | 同实例 HTTP 路由挂载（照 automation-console 先例）能否自定义 /api/v1/secretary/* | 改 exec 型 trigger 直接驱动本地 runner 脚本 |
| V3 | scheduler notify_transport dsh-session.prompt 对任意 session_id 投递是否可用（含不存在会话的行为） | sweep 端用 DSH host API 投递（mindmap token 自发现模式） |
| V4 | preset agent.cordis.yml 权限白名单能否按工具粒度禁用（§3.1 硬门禁的可行性） | 插件层做执行前门禁钩子（受 DSH 审批体系约束） |

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 秘书空转烧 token | 心跳阈值 + 连续无进展升级 L2 + 每日 cost_cap 硬顶 + 规则层预筛（零 LLM 巡检） |
| L1 自决闯祸（不可逆操作） | policy 表把不可逆动作抬到 L2/L3；§3.1 权限白名单硬门禁；autonomy_tier=assisted 兜底；全部动作留痕 history |
| 折叠层与真实状态漂移（秘书谎报/漏报） | 秘书长抽查（随机采样比对工作区产物时间戳与 progress）；history 审计链；sweep 规则层漂移检测；人类可一键 quote 溯源 |
| 多秘书并发踩同一工作区 | §5.4 工作区锁（per-workspace + 过期）；跨会话冲突动作 = L3 |
| 缓存命中被破坏（有人把原文塞回上下文） | prompt 硬约束 + 工具端校验（last_report 限长；quote 一次性限长）+ §1.5 上下文预算协议 + Phase 4 前缀重复率指标回归 |
| 人类又被淹没（inbox 爆炸） | 分级表校准回路；inbox 按风险排序 + TTL 置顶 + 重复项折叠；晨报聚合 |
| 秘书会话失效/文件损坏 | §4.7 自愈（自动重建恢复；隔离留档）+ 幂等设计 |
| 工具身份无法获取导致越权写 | §1.3 凭证+审计降级方案；异常写入告警进面板 |

---

## 9. 验收标准（可量化）

1. 1 人管理 50 个对话时，每日 inbox 决策 ≤ 30 条、单次批量决策 ≤ 15 分钟；总览表扫读 ≤ 2 分钟。
2. 对话因「目标只完成 1/10 停止」而长期滞留的比例，从当前状况下降到 ≤ 5%（stall → 24h 内自动续推或明示 needs_human）。
3. 缓存命中不下降：同会话请求前缀重复率 ≥ 95%；任一汇总请求输入 ≤ 15K token；无任何请求包含 ≥2 个对话的折叠层拼接原文。
4. 机制自愈：折叠层文件损坏可隔离重建；秘书会话重建后可仅凭折叠层恢复推进；trigger 重复触发不产生重复执行（dedup 验证）。
5. 人类决策效率：单次批量决策平均覆盖 ≥ 5 个对话；inbox 平均滞留 < 24h；校准回路可用（accepted/overruled 统计可见）。

---

## 10. 架构评审与升级清单（v1.1，总师评审结论）

### 10.1 评审结论

**设计总体成立（合理度 8.5/10）：分层清晰（编排层/执行层/决策层）、复用到位（relay/scheduler/ACP/preset 全部为已验证机制）、缓存意识正确（三不变量方向对）。可进入开发。** 但原始 v1.0 存在 6 个 P0 级缺口，不升级会直接影响「50–100 对话」目标与「不破坏缓存」承诺，故本版完成升级。

### 10.2 P0（必须，已入正文）

| # | 缺口（v1.0） | 升级落点（v1.1） |
|---|---|---|
| P0-1 | 秘书「干活上下文从哪来」未定义；秘书会话历史累积会破坏前缀缓存 | §1.5 状态驱动定位 + 上下文预算协议（S+F+I+W ≤5K，历史不累积）+ goal_ctx 字段 |
| P0-2 | 分级表是「劝告」，无强制；approval 关闭时会话可越权执行高分动作 | §3.1 权限白名单硬门禁（工具不可用即升级），preset 层落实 |
| P0-3 | 「只有专属秘书能写」无实现路径（工具回调未必有 session 身份） | §1.3 凭证（enroll_token）+ 审计降级方案 + V1 验证点 |
| P0-4 | 多对话共享 workspace 互踩无防护（git/大文件写） | §5.4 工作区互斥锁 + secretary_lock/unlock |
| P0-5 | 汇总请求前缀随行增删漂移，缓存收益打折 | §1.4 第 4 条：固定元数据前缀 + conv_id 稳定排序 |
| P0-6 | 折叠层 schema 演进无版本管理 | §1.2 schema_version + store 迁移函数 |

### 10.3 P1（重要，已入正文）

| # | 缺口 | 升级落点 |
|---|---|---|
| P1-7 | 指令投递无序、多条堆积会打断秘书 | §4.5 指令队列 pending_instructions + 优先级 + 合并投递 |
| P1-8 | 全对话每分钟扫→全都唤醒 LLM，成本失控 | §4.3 规则层预筛（零 LLM 巡检，命中才唤醒） |
| P1-9 | 秘书会话失效无人接管 | §4.7 自愈重建（幂等，凭折叠层恢复） |
| P1-10 | 人类不常驻时无信息推送，决策全靠主动去看 | §4.8 晨报 digest（纯折叠层聚合 + inbox 置顶） |
| P1-11 | inbox 无限滞留，任务无限搁置 | §4.8 inbox TTL + WAITING_HUMAN + 重复项折叠 |
| P1-12 | 与 0903/行业 preset 关系未界定，可能重复造执行层 | §2.1 编排层 vs 领域执行层；own_preset 字段；转交接力卡 |

### 10.4 P2（可选，迭代期）

| # | 升级点 | 说明 |
|---|---|---|
| P2-13 | 多人类多秘书长（owner 字段分池） | 团队场景再启用 |
| P2-14 | 校准回路视图（误报/漏报趋势、token/缓存消耗面板） | 面板增强 |
| P2-15 | 决策效率绩效指标（每次决策覆盖对话数、inbox 滞留时长） | 面板增强 |
| P2-16 | 秘书-开发小组协作：复杂子任务经接力卡/subagent 转交开发小组，成果包写回折叠层 | 对应用户「经理分工→开发小组开发」的执行层扩展示例 |

### 10.5 实现验证点（Phase 1 必须落结论）

见 §7.4 V1–V4：工具身份、同实例 HTTP 路由、session/prompt 投递、preset 权限白名单——四项均已有替代方案，风险可控。

### 10.6 preset 划分决策 ADP-R1（v1.2 新增）

- 决策：**秘书独立成 preset（secretary-mode），平台层统一**（§2.1 全文）。
- 理由：preset 按 Agent 形态划分（状态驱动推进器 vs 团队协作架构师）；统一由平台层（共享插件/数据）+ 协作层（接力卡寻址对齐 0903 角色目录）+ 数据层（折叠层同源）实现，不与 0903 合并。
- 影响：§7.1 组件清单不变（dsh-external/dsh-secretary 为全局插件）；secretary-mode 与 0903 preset 平行共存、互不改动。
- 经理分工注意：Phase 2 的 preset 开发与 0903 preset 完全解耦；接力卡 assignee_role 沿用 0903 角色目录命名（「架构·经理」「架构·开发」）。

---

## 11. 交接记录

| 项 | 内容 |
|---|---|
| 交接人 | 架构·总师（本会话） |
| 交付物 | 本文档 v1.2（架构冻结，含 ADP-R1 preset 划分决策） |
| 接手角色 | 架构·经理（分工）→ 开发小组（实现） |
| 接力卡 | 见 relay 队列（assignee_role=架构·经理，industry=software） |
| 开发入口 | Phase 1 先行：dsh-external/dsh-secretary（store + 工具 + V1–V4 验证 + 单测 + 挂载），照 dsh-relay-cards 蓝本 |
