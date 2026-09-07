# DeepSeek Harness 插件索引

## 概述
本索引记录从DSH 1024Store API获取的DeepSeek Harness插件推荐信息。

## 数据来源
- **API端点**: `https://api.deepseek1024.com/v1/plugins/search`
- **页面**: https://www.bilibili.com/toy/dsh-1024store/index.html
- **最近更新**: 2026-08-19

## 插件统计
- **总插件数**: 4,500+
- **Memory类插件**: 263个
- **Tool类插件**: 1,780个
- **Workflow类插件**: 385个
- **Code类插件**: 626个
- **Dev类插件**: 1,004个
- **Chat类插件**: 315个

---

## 🔥 热门插件推荐 (按Stars排序)

### 📦 Memory类 (记忆存储)

#### 1. dsh-memory-plugin ⭐29,432
- **作者**: volcengine
- **描述**: 整合长期记忆、知识检索与技能，为智能体提供自演进的上下文数据库。
- **安装命令**:
  ```bash
  dsh plugin --profile web add github:volcengine/OpenViking#path:examples/dsh-memory-plugin
  ```
- **推荐理由**: 最受欢迎的记忆插件，功能全面

#### 2. coding-agents (Hindsight) ⭐20,207
- **作者**: vectorize-io
- **描述**: Hindsight 可学习的 Agent 记忆：自动召回与沉淀的长期项目记忆、知识页、深度反思与按仓库隔离的记忆库。
- **安装命令**:
  ```bash
  dsh plugin --profile web add github:vectorize-io/hindsight#path:hindsight-integrations/coding-agents
  ```
- **推荐理由**: 智能学习型记忆，支持项目级隔离

#### 3. dsh-memory-evolve ⭐179
- **作者**: csyangwen
- **描述**: 跨会话长期记忆 + 后台自我进化能力：五轨记忆、git分支感知、技能自我进化
- **安装命令**:
  ```bash
  dsh plugin --profile web add github:csyangwen/dsh-memory-evolve
  ```
- **推荐理由**: 自进化记忆系统，功能独特

---

### 🔧 Tool类 (工具插件)

#### 1. dsh-ssh ⭐4,596
- **描述**: 通过 DSH 网页界面实现远程 Shell 访问与命令执行，便于系统管理
- **安装命令**:
  ```bash
  dsh plugin --profile web add github:volcengine/OpenViking#path:examples/dsh-ssh
  ```
- **推荐理由**: 远程管理必备工具

#### 2. dsh-tool-describe-image ⭐4,596
- **描述**: 通过 DSH 界面提供图像描述工具，实现自动化视觉内容分析
- **推荐理由**: 多模态能力增强

---

### 🔄 Workflow类 (工作流)

#### 1. deepseek-harness ⭐14,235
- **描述**: 将架构、流程、时序、数据流等图表生成能力打包为技能，输出带动效的自包含 HTML
- **推荐理由**: 可视化工作流设计

#### 2. dsh-plugin ⭐5,556
- **描述**: 通过分阶段评估和预算控制，驱动智能体在多种运行环境中自我进化
- **推荐理由**: 智能体自我进化框架

---

### 💻 Code类 (代码相关)

#### 1. dsh-TUI ⭐1,980
- **描述**: Claude Code 风格全屏终端 UI：像素鲸鱼顶栏、实时工作状态行、思考流式展开
- **推荐理由**: 极简终端界面，提升开发体验

#### 2. dsh-agent-teams ⭐557
- **描述**: AgentTeams 多智能体团队协作
- **推荐理由**: 多代理协作方案

---

### 🛠️ Dev类 (开发工具)

#### 1. dsh-plugin-desktop ⭐13,696
- **描述**: 为 DeepSeek Harness 插件生态提供现代化桌面端解决方案
- **推荐理由**: 桌面端插件管理

#### 2. dsh-remote-web-ui ⭐4,596
- **描述**: 支持从移动设备远程访问 DSH 网页界面
- **推荐理由**: 移动端远程控制

#### 3. design-studio ⭐4,183
- **描述**: 在 AI 工作区中集成设计工作室，支持可编辑设计与协作流程
- **推荐理由**: 设计协作集成

---

### 💬 Chat类 (聊天增强)

#### 1. dsh-ads ⭐500
- **描述**: 2005 年中文站点风格的整活广告插件
- **推荐理由**: 趣味娱乐插件

#### 2. dsh-visualize ⭐178
- **描述**: 对话内生成式 UI：模型把交互式 HTML 卡片直接画进会话流
- **推荐理由**: 交互式可视化

---

## 🐝 蜂群协作 / 多Agent团队插件（重点推荐）

> 检索时间: 2026-08-19 | 关键词: agent-teams(6), multi-agent(49), swarm(10), crew(9), orchestrat(71), subagent(123)

### 🏆 第一梯队（成熟可用）

#### 1. NanmiCoder/dsh-agent-teams ⭐898 — 蜂群协作核心首选
- **描述**: AgentTeams 多智能体团队，DSH生态中星数最高的多Agent协作插件
- **安装**: `dsh plugin --profile web add @nanmicoder/dsh-agent-teams`

#### 2. omdsh-dev/dsh_workflow ⭐97 — 可治理的调度层
- **描述**: UltraCode 式多 Agent 调度：可生成、可保存、可治理、可观察、可恢复的 Workflow 层
- **安装**: `dsh plugin --profile web add github:icetomoyo/dsh_workflow`
- **亮点**: 与「自动分工→并行→恢复」需求最匹配

#### 3. whyihaveyou/plugin-team-board ⭐45 — 共享任务看板
- **描述**: 基于 Cordis 服务键的多 Agent 共享任务看板：创建、认领、流转与查询
- **安装**: `dsh plugin --profile web add @dsh-suite/plugin-team-board`
- **亮点**: 原生 Cordis 架构，与本 Harness 同源

### 👥 第二梯队（岗位角色制）

| 插件 | 星数 | 岗位协作特性 |
|------|------|-------------|
| ZSeven-W/dsh-crew | 104⭐ | 外部工具分发任务给 DSH 智能体 |
| limuyang2/agent-team | 19⭐ | 独立模型+技能+共享工作区的编排团队 |
| MichengAI/dsh-agency-agents | 17⭐ | 全行业智能体岗位库 |
| Karbo123/evoresearch-plugin | 13⭐ | 多Agent专家团队+自进化研究记忆 |
| stuarthu/dsh-crew | 3⭐ | 产品经理/工程师/评审员角色代理，文件共享协同 |
| ivanon/dsh-dev-crew | 0⭐ | 按职责分派给绑定不同模型的子代理 |

### ⚡ 第三梯队（动态扩缩容/批量并行）

| 插件 | 特性 |
|------|------|
| hongyue0721/dsh-kimicode-swarm | swarm_batch 批量并行子Agent + /swarm 命令 + 实时进度条 |
| r600a-code/dsh-swarm-router | 子代理矩阵蜂群，异构任务路由到最合适模型 |
| february2015/dsh-taskswarm | 并行执行、隔离、崩溃恢复 |
| Makoveli89/dsh-swarm | 大规模编码代理群，同步阶段+隔离工作树 |

### 🔗 @引用增强（跨Agent协作入口）
- **omdsh-dev/dsh-at-file** ⭐461: Codex 风格 `@file` 文件引用
- **Chael-Chael/dsh-reference-anything** ⭐8: 统一 @ 引用文件/会话/历史对话

---

## 🏗️ 与 E:\自动分工工作流（LangGraph 自研系统）的映射

原系统7节点流水线 → DSH 蜂群插件组合方案：

| 原节点 | DSH 对应实现 |
|--------|-------------|
| 1. 需求分析与任务分割(Agent) | 主Agent原生能力 + dsh-agent-teams 团队长 |
| 2. 任务分配(1-36个AI) | dsh_workflow 调度层 / dsh-kimicode-swarm 批量分发 |
| 3. 开发循环(looparray并行) | subagent 原生并行委托 + taskswarm 崩溃恢复 |
| 4. 静态分析 | 各子代理自带工具链 |
| 5. 项目整合 | plugin-team-board 看板汇聚结果 |
| 6. 审查修复循环(多角色) | stuarthu/dsh-crew 角色制（PM/工程师/评审） |
| 7. 项目总结(Agent) | 主Agent收尾生成文档 |

**结论**: 用户设想的「公司岗位制 + 动态加派Agent」架构 = dsh-agent-teams(组织) + dsh_workflow(调度) + team-board(看板) + 角色crew(岗位)，无需从零开发；LangGraph 流水线可作为 dsh_workflow 的自定义 Workflow 定义移植。

---

## 📋 安装指南

### 快速安装
```bash
# 安装热门记忆插件
dsh plugin --profile web add github:volcengine/OpenViking#path:examples/dsh-memory-plugin

# 安装SSH工具
dsh plugin --profile web add github:volcengine/OpenViking#path:examples/dsh-ssh

# 安装桌面管理
dsh plugin --profile web add github:dsh-plugin-desktop
```

### 手动安装
1. 访问插件 GitHub 仓库
2. 按照 README 说明安装
3. 在 DeepSeek Harness 中配置插件

---

## 🔍 搜索更多插件

使用 API 搜索特定类别：
```bash
# 搜索记忆类插件
curl 'https://api.deepseek1024.com/v1/plugins/search?q=memory&sortBy=stars'

# 搜索工具类插件
curl 'https://api.deepseek1024.com/v1/plugins/search?q=tool&sortBy=stars'

# 搜索工作流插件
curl 'https://api.deepseek1024.com/v1/plugins/search?q=workflow&sortBy=stars'
```

---

## 📊 每日检查记录

| 日期 | 状态 | 新增插件 | 备注 |
|------|------|----------|------|
| 2026-08-19 | ✅ 成功 | 4,500+ | API正常，数据完整 |

---

## 📝 更新日志

### 2026-08-19
- 初始化插件索引
- 收集热门插件数据
- 建立API监控机制
## 2026-08-19 10:01:35 检查结果
- 新增插件: 100 个
- **dsh-chat-import** (70⭐) - 把 Claude Code / Codex / ChatGPT / Cursor / Gemini / Reasonix / opencode 的聊天记录全保真导入为可续聊的 DSH 会话。
- **dsh-auto-mode** (103⭐) - 为DeepSeek Harness提供安全自动权限管理，在保持安全控制的同时允许自动化操作。
- **dsh-mneme** (27⭐) - 跨会话记忆：SQLite + 可人工编辑的 Markdown 镜像，后台自动巩固（去重/合并/冲突裁决），提供 6 个记忆工具。
- **dsh-deepseek-flow** (41⭐) - 可能在 DSH 中编排多步流程，但信息有限，谨慎归类为工作流。
- **dsh-vision-toolkit** (703⭐) - 让纯文本模型更好地做视觉任务：带意图的图片问答、长截图 OCR、UI 还原等。
- **DSH-better-sidebar** (2180⭐) - 侧边栏完整工作台：内置文件渲染编辑、终端、Git 与子代理，支持三方插件注册新 Tab。
- **video-studio** (4183⭐) - 在 AI 工作区中集成视频编辑工具，支持创建与修改视频内容。
- **dsh-ai-novel-writer** (391⭐) - 提供本地优先的 AI 小说创作工作台，包含大纲、章节和修订工具。
- **dsh-crew** (59⭐) - 从外部工具分发任务给 DSH 智能体，支持多模态视觉和图像生成。
- **dsh-im-gateway** (27⭐) - 通过聚合 IM 网关，将 DSH agent 接入微信、飞书等 20+ 聊天平台。
- **dsh-agent-teams** (557⭐) - AgentTeams 多智能体团队。
- **fixture-clash** (1056⭐) - 测试插件市场冲突场景的端到端测试夹具。
- **dsh-TUI** (1980⭐) - Claude Code 风格全屏终端 UI：像素鲸鱼顶栏、实时工作状态行、思考流式展开。
- **fixture-b** (1056⭐) - 端到端测试用的第二个示例插件条目，用于市场验证。
- **dsh-pocket** (165⭐) - 把 DeepSeek Harness 装进你的口袋：电脑上跑 dsh web，手机扫码即同步访问（局域网 + 公网，实时同屏）
- **engramory** (159⭐) - 为 AI 智能体定义可移植的记忆协议，作为常驻规则加载，包含管理纪律、参考规范和可选钩子。
- **design-studio** (4183⭐) - 在 AI 工作区中集成设计工作室，支持可编辑设计与协作流程。
- **dsh-commandcode-provider** (60⭐) - 将 Command Code 集成进 DSH 作为模型提供商，支持实时模型目录与推理强度。
- **mstar-harness** (49⭐) - 技能驱动的 harness/loop 工程化工作流插件。
- **dsh-codex-connect** (27⭐) - 通过 ChatGPT OAuth 将 OpenAI Codex 模型接入 DeepSeek Harness，并提供可选的搜索与图片工具。
- **mirage-dsh** (3513⭐) - 把文件系统与 bash provider 替换为 mirage 虚拟工作区：文件工具与 shell 命令运行在挂载资源上（RAM、S3、Redis、Slack、Gmail、Notion、Postgres），支持按挂载读/写/执行模式、按命令的沙箱路由（monty、pyodide、quickjs 进程内；docker、e2b、daytona 远程），并可在虚拟终端把已安装 CLI（git、gh、slack、linear、ntn、gws 或自注册）作为起始词使用。
- **fixture-a** (1056⭐) - 用于插件市场端到端测试的示例插件，模拟一个样本条目。
- **dsh-memory-evolve** (179⭐) - 为 DeepSeek Harness 带来「跨会话长期记忆 + 后台自我进化」能力的纯插件实现：五轨记忆 · git 分支感知 · 回合内自我审查 · 技能自我进化与技能管理器 · 四轨待办 · COI 调度 · 会话广播 · 会话搜索 · 提示词管理器 · 临时信息便签——零核心修改、零运行时依赖，随装随用、卸载即净。
- **dsh-codex** (34⭐) - 通过 OpenAI Codex 登录流程，在 DeepSeek Harness 中使用 ChatGPT 订阅。
- **dsh-qqbot** (62⭐) - 让 QQ Bot 接入 DeepSeek Harness（dsh）的官方插件
- **dsh** (12142⭐) - 为 AI 智能体提供本地优先、Markdown 原生的可移植记忆层，跨应用和工具持久化。
- **dsh-portable-tavern** (18⭐) - DeepSeek Harness 的「便携酒馆」插件：RPG 式 SillyTavern V2/V3 角色卡生成器 + 酒馆角色扮演聊天。支持世界书、角色卡 JSON/PNG 导入导出、面板主题与本地音乐。独立插件，仅依赖官方 @deepseek-ai SDK。
- **deepseek-harness** (173⭐) - 编排多阶段科学发现流水线，驱动自主研究流程。
- **dsh-plugin-desktop** (13696⭐) - 为 DeepSeek Harness 插件生态提供现代化桌面端解决方案，助力插件的开发与管理。
- **dsh-product-bridge** (487⭐) - 桥接桌面应用与其产品功能，实现不同包之间的特性集成与协同。
- **distill** (19⭐) - 自动对话蒸馏：后台 subagent 反省 + 技能 create/update。
- **dsh** (34⭐) - 将任意文本框变成双向大模型通道，读取输入并自动填充回答，无需聊天窗口。
- **dsh-tongflow** (859⭐) - TongFlow — multimodal workflow studio and engine (canvas + Python plugin engine) and dsh-tongflow, the DeepSeek Harness studio plugin
- **dsh-at-file** (387⭐) - Codex 风格的 `@file` 文件引用，输入框里直接搜索并引用工作区文件。
- **dsh_workflow** (81⭐) - 把 UltraCode 式多 Agent 调度带给 DSH：可生成、可保存、可治理、可观察、可恢复的 Workflow 层。
- **dsh-vision-router** (761⭐) - 为纯文本 Agent 提供视觉能力：内置免 Key 视觉链 + 像素级视觉工具（看图问答、定位、裁剪、像素对比、取色、OCR、矢量化、抠图、截图）；粘贴图片即可用。
- **dsh-visualize** (178⭐) - 对话内生成式 UI：模型把交互式 HTML 卡片直接画进会话流，带流式预览与沙箱渲染。
- **dsh-mnemon** (105⭐) - Mnemon 深度集成：本地三层记忆（Runtime Memory、可检索 Documents、受监督 Memory Spaces）。
- **mnemon** (482⭐) - 提供 LLM 监督的持久记忆，基于图召回和跨会话知识，以单一二进制支持多种智能体运行时。
- **ff-llm-wiki-plugin** (296⭐) - 集成语言模型驱动的 wiki 工具的示例插件。
- **dsh-automation** (57⭐) - 定时任务：让 Coding 任务按计划在全新 Agent Session 中运行，保留可审计历史。
- **dsh-code-review** (149⭐) - 分析代码差异并审查变更，提供改进建议。
- **aggregate-better-sidebar** (2180⭐) - 扩展 DSH 侧边栏，支持第三方页面，内置文件编辑、终端、Git 与子代理视图。
- **base** (319⭐) - 提供跨会话笔记存储与代理上下文记忆的基础包。
- **dsh-noema** (109⭐) - 提供持久可检查的长期记忆，配备召回工具和设置页面，方便管理代理记忆。
- **dsh-flowix-memory** (319⭐) - 为 AI 代理跨会话存储和检索笔记与长期记忆。
- **dsh-open-in-vscode** (50⭐) - 从 Web GUI 一键在 VS Code 中打开工作区目录。
- **dsh-tool-describe-image** (4596⭐) - 通过 DSH 界面提供图像描述工具，实现自动化视觉内容分析。
- **treg** (475⭐) - 充当智能体工具的 OpenRouter，通过统一 API 聚合和路由工具访问。
- **fixture-carrier** (1056⭐) - 模拟载体插件的测试夹具，用于验证市场交互流程。
- **MisakaNet** (405⭐) - 为零依赖、Git 支持的微型课程库，供 AI 智能体异步分享和搜索经过验证的调试经验。
- **deepseek-harness** (1077⭐) - 提供自托管的真人介入任务管理器，支持从移动端、网页或桌面实时控制智能体。
- **graph-memory** (548⭐) - 从对话中提取结构化三元组构建知识图谱，压缩上下文 75%，支持跨会话经验复用。
- **dsh-focus-chat** (21⭐) - 「聚焦会话」精简视图，只关注最终产出结果。
- **dsh-memento** (58⭐) - 有界、分层、带审批门、可审计的跨会话记忆：`ctx.memory` 服务 + 零依赖 SQLite 存储 + `memory` 工具与冻结快照注入；写入必过审批门，模型可见内容可自会话日志重建。
- **dsh-im** (53⭐) - 通过扫码或机器人凭据把IM机器人接入DeepSeek Harness（支持飞书、微信、钉钉、企业微信、QQ、Telegram、Discord和WhatsApp）。 Connect IM bots to DeepSeek Harness via QR code or credentials (8 channels).
- **headless** (319⭐) - 无界面的核心运行时包，提供代理与记忆的基础服务。
- **superdesign-skill** (432⭐) - 为编码智能体提供设计技能，将 AI 生成的界面转变为精致、可发布的前端设计。
- **dsh-plugin** (5556⭐) - 通过分阶段评估和预算控制，驱动智能体在多种运行环境中自我进化。
- **plugin-team-board** (42⭐) - 基于 Cordis 服务键的多 Agent 共享任务看板：创建、认领、流转与查询。
- **dsh** (3896⭐) - 为 Codex、Claude Code 等 AI 工具提供可选的动画宠物图库，增添趣味互动。
- **DSH-taskboard** (39⭐) - 任务看板插件，基于 SQLite，支持项目、代理认领/审核和原生网页界面。
- **dsh-memory-plugin** (29432⭐) - 整合长期记忆、知识检索与技能，为智能体提供自演进的上下文数据库。
- **deepseek-harness** (14235⭐) - 将架构、流程、时序、数据流等图表生成能力打包为技能，输出带动效的自包含 HTML 并支持清晰导出。
- **qq2006** (124⭐) - 为客户端界面应用QQ2006怀旧主题，唤起经典聊天风格。
- **argo** (100⭐) - 专为 agent 打造的搜索工具：多语言，覆盖中文/英文/学术/代码/购物/金融/新闻/百科。
- **coding-agents** (20207⭐) - Hindsight 可学习的 Agent 记忆：自动召回与沉淀的长期项目记忆、知识页、深度反思与按仓库隔离的记忆库。
- **dsh-k8e-sandbox-bundle** (474⭐) - 提供沙箱矩阵，用于编排多环境的自动化工作流。
- **dsh-profile-bundle** (487⭐) - 作为桌面应用评估框架的一部分，提供用于测试 DSH 配置档案的测试夹具。
- **base** (176⭐) - 桌面客户端基础包，提供笔记与代理上下文的持久化存储。
- **dsh-mneme** (27⭐) - 实现结构化记忆引擎，支持语义搜索、实体时间线和自动整合。
- **recruiting-copilot** (37⭐) - 给 HR / 猎头的 AI 招聘工作流：岗位标准梳理、Boss直聘 + 猎聘双通道寻源初筛、市场人才盘点、简历评估、约面试、候选人台账与日报。可装成 Claude Code 插件或 DeepSeek Harness (dsh) 插件——后者自带可直接上手操作的「招聘浏览器」面板；也能配合任意读 AGENTS.md 的 AI 编程助手使用。
- **dsh-lark-bot** (21⭐) - dsh-lark-bot：把 DeepSeek Harness (dsh) 桥接进飞书/Lark 的 bot：流式卡片、项目工作区、并行任务、多角色 Agent、跨会话通知、对话内模型/密钥管理与安全网守护（dsh 崩溃后飞书仍可自救）。A bridge bot connecting DeepSeek Harness (dsh) into Feishu/Lark: streaming cards, workspaces, parallel tasks, multi-role agents, cross-session notify, in-chat model/key management, and a safety-net guardian.
- **dsh-plugin-subscriptions** (121⭐) - 通过 OAuth 登录，将 ChatGPT、Claude 和 Grok 订阅用作 DeepSeek Harness 的模型提供商，无需 API 密钥。
- **base** (296⭐) - 桌面端基础包，提供笔记存储与代理上下文记忆功能。
- **dsh-reasoning-effort** (81⭐) - DSH适用的Codex风格的思考强度滑块，以及大肥鱼跑步滑块。Codex-style model and reasoning-effort slider for DeepSeek Harness
- **modsearch** (150⭐) - 纯文本 agent 的联网搜索桥：搜索网页与 X，返回结构化 JSON 证据（search/fetch/引用）。
- **dsh-browser** (300⭐) - Chrome 侧边栏扩展，让 DSH 直接操控你的浏览器，无需视觉能力。
- **dsh-plugin-browserskill** (1149⭐) - 通过 CLI 与扩展让智能体操控真实登录的浏览器，无干扰地自动化任务。
- **sandbase-harness** (621⭐) - 本地优先的 Agent 运行时，提供持久会话、沙箱后端、审计与回放，并通过 DSH bundle 暴露 MCP bridge。
- **sealos-skills** (70⭐) - Sealos技能包，支持用一条命令部署项目、配置数据库和对象存储，兼容多种AI命令行工具。
- **dsh-chat-timeline** (15⭐) - 添加右侧聊天导航栏，类似 DeepSeek 官方网页界面，方便浏览会话。
- **dsh-research-loop** (149⭐) - 通过迭代查询和分析结果，自动执行研究循环流程。
- **easyeda-agent** (234⭐) - 嘉立创EDA专业版(EasyEDA Pro)自动化：给 AI harness 装上画板的「手」—— 一套 typed 原理图/PCB 动作，CLI / Agent Skill / stdio MCP 三形态融合接入。承接嘉立创「不以卖板赚钱，以培养中国工程师为己任」 | EasyEDA Pro automation: the hands of your AI harness — typed schematic/PCB actions via CLI, Agent Skill and stdio MCP.
- **bridge-browser** (300⭐) - 通过 Chrome 侧边栏扩展使 harness 直接控制浏览器。
- **dsh-memory** (20⭐) - AGI 的长期记忆基础设施。让 AI Agent 拥有不可遗忘的自我。跨会话记忆 · 持续学习 · 可审计信任（智能论 v3.2）
- **anime-find** (146⭐) - DeepSeek Harness 搜番插件：对话内多源搜索番剧，卡片展示 Bangumi 评分与详情，支持复制磁力。
- **fixture-cross** (1056⭐) - 用于验证跨插件行为的端到端测试夹具。
- **dsh-agent-team-gui** (74⭐) - 支持持久多模型智能体团队，可复用团队、按智能体策略及协作对话。
- **dsh-ads** (500⭐) - 2005 年中文站点风格的整活广告插件：侧栏广告/信息流/角落弹窗 + 假关闭叉，素材全虚构。
- **dsh-market** (1056⭐) - 装在 DSH 里的插件市场：设置页内逛/搜全部社区插件，按分类筛选，确认后一键安装，已装插件一目了然。
- **dsh-codex-subscription** (14⭐) - 复用 Codex CLI 本地订阅，在 DeepSeek Harness 中使用 ChatGPT 模型，无需 API 密钥。
- **ppt-studio** (4183⭐) - 为 AI 工作区添加演示文稿制作功能，用户可设计与编辑幻灯片。
- **dsh-auto-review** (38⭐) - 只读审查子代理自动审核批准请求，返回结构化裁决。
- **dsh-remote-web-ui** (4596⭐) - 支持从移动设备远程访问 DSH 网页界面，随时随地控制与监控。
- **modlens** (3114⭐) - 为纯文本模型架起视觉桥梁：粘贴图片，输出结构化 JSON 证据（OCR、版面、语义）。
- **plugin** (89⭐) - 治理 AI agent 任务，通过编排对齐目标、规划并验证交付。
- **dsh-ssh** (4596⭐) - 通过 DSH 网页界面实现远程 Shell 访问与命令执行，便于系统管理。
- **humanizer-ru-dsh** (102⭐) - 清理俄语文本中的 AI 痕迹：识别聊天机器人复制粘贴的痕迹（ChatGPT、Gemini、Grok、Perplexity、DeepSeek），按需改写为自然文风；39 条正则标记与证据登记，离线纯文本 bundle。
- **ui-codepilot-theme** (176⭐) - 受 CodePilot 启发的 harness 客户端界面主题。

