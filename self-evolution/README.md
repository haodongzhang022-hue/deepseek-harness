# 功能：自我进化插件治理体系（SELF-EVOLUTION）

目标：让 deepseek-harness 在运行中**热加载新能力（含从开源补充）、联网检索、安全评审、经验入库并持续复用**，
达成"越用越会、越用越安全"的自主进化闭环。所有新增能力经**安全评审闸**后才会激活，杜绝病毒/恶意注入。

本文档按"分功能 + 版本迭代"维护：**新版本永远最高权重**，旧版本保留备查，但以最新版为唯一直接依据。

---

## 当前版本 v0.4.1（2026-08-26，最高权重，以下为唯一有效依据）

> v0.4.1 相对 v0.4.0：③⑥ 两环**复测通过**；⑥ 经验库**解耦独立包全链路验证达成**（外部安装/CLI/跨进程），可独立开源。

### 0. 真实验证结论（2026-08-26）

- **③ 安全评审闸（复测通过）**：`tests/08_safety_scan.py`（9 断言）与 `tests/09_sandbox_pre_run.py` 均 PASS——恶意能力必须阻塞、白名单放行、未知能力 warning、信任门无记录 blocked/verified OK/dirty 拒绝。
- **⑥ 经验库（复测通过）**：`tests/test_experience_store.py` PASS（低置信拒收、FTS5 中文子串、新版本最高权重、统一时间戳、复用晋升）。
- **解耦独立包（达成，v0.4.1）**：`tests/test_installed_pkg.py` PASS——构建 wheel + `pip install --target` 到独立临时目录（零依赖）、只从外部目录 import OK、CLI 全链路 add→search→render 真实命中、**跨进程持久化**（进程 A `add` → 进程 B `search` 命中 `['xp-A']`）。

### 1. 体系蓝图：自我进化闭环（6 段）

```
① 触发 → ② 联网获取 → ③ 安全评审闸 → ④ 落库·热挂载 → ⑤ 脉冲式上线 → ⑥ 复盘蒸馏经验
   ↑                                                        ↓（失败即回滚）
   └────────────── 经验复用（回灌 ① ，形成闭环）──────────────────┘
```

| 阶段 | 职责 | 现状 |
|---|---|---|
| ① 触发 | agent 判定当前任务需要新能力/缺工具 | 已有（agent-loop）；经验复用回灌入口已具备（experience search） |
| ② 联网获取 | `web_search` 检索 → 从开源插件注册表/仓库发现可补充组件 | 已有 `web/`，开源源见资源清单 |
| ③ 安全评审闸 | **关键**：静态扫描 + LLM 审计 + 沙箱预跑 + 信任签名/信任标记 + 能力白名单 | **已落地 v0.2.0，真实验证达成**：`review-guardrail` safety/trust + 护栏 08/09 |
| ④ 落库·热挂载 | 源码+元数据落 SQLite，校验通过才在沙箱内热挂载执行 | 已有 `extensions/`、`session-persistence-sqlite` |
| ⑤ 脉冲式上线 | 灰度放量、dirty-flag 标记改动、失败即 dispose/回滚 | 已有 extensions 失败 dispose；脉冲灰度待固化 |
| ⑥ 复盘蒸馏经验 | 执行轨迹(Case)→可复用经验(Skill)→写回 SQLite/Agent Notes | **已落地 v0.3.0，真实验证达成**：`self-evolution/experience`；**v0.4.0 解耦为独立开源包** `experience-store` |

### 2. 安全评审闸：三层防御（防病毒/恶意注入的核心）

输入温度假设：外部拉取的插件**视为完全不可信**。三层缺一不可：

1. **静态 + LLM 评审（提交前）**：`review-guardrail` 静态检测 secrets / 后门 / 混淆 / prompt 注入，可升 `llm`/`hybrid` 深审。**已实现**。
2. **沙箱隔离（运行时）**：新增能力扫描 + node `vm` 预跑观测。`block_on` 命中即 blocked；
   node 路线下用内置 `vm` + 不可变沙箱真实预跑一次，只观测顶层敏感调用、不做副作用。
   ⚠️ **禁用 `vm`/`vm2` 跑不可信代码作为运行载体**——本处仅用 `vm` 做*观测探针*预跑，不放行任何能力。**已实现**。
3. **信任签名 + 能力白名单（授权）**：插件必须带信任级/签名才可接触敏感 API；改动后降级为 dirty，需重新评审。
   信任级 `blocked < dirty < verified < trusted`，`required` 达最低级且非 dirty 才激活。**已实现**。

落地形态（v0.2.0）：`review-guardrail` 扩展了三段，与既有"单点核心 + 声明化策略 + 断言护栏"同一风格：
- `guardrail.yml` 新增 `safety`（扫描粒度/block/allow/executor）+ `trust`（信任级/dirty）声明化段；
- CLI 新增 `safety scan --dir <插件> [--route static|node] [--trust]` 与 `trust --level verified|trusted ...`；
- `tests/08_safety_scan.py`、`tests/09_sandbox_pre_run.py` 两条护栏：恶意能力必须阻塞、预跑必须真实观测。

### 3. 经验库：已解耦为独立开源包（v0.4.0）

**解耦完成**：`self-evolution/experience/` 现在是标准可安装 pip 包 `experience-store`，纯标准库、零第三方依赖、
不耦合 deepseek-harness / review-guardrail。可在任意 Python 项目安装/复用，也可独立开源发布 PyPI/私有源。

```
experience/
├── experience_store/        # 包：engine.py(核心) + cli.py(CLI) + __init__.py(公开 API)
│   └── __init__.py          #   导出 ExperienceStore / Experience / parse_policy / DEFAULT_POLICY
├── tests/test_experience_store.py   # 测试护栏（独立 tests 目录）
├── experience.yml           # 声明化策略（示例）
├── pyproject.toml           # 构建配置（console script: experience-store）
├── README.md                # 开源使用文档（含版本迭代）
├── LICENSE                  # MIT
└── .gitignore               # 忽略 data/(运行产物)、build 产物
```

- **安装**：`pip install -e .`（离线可装）或发布后 `pip install experience-store`。
- **CLI**：`experience-store add|search|promote|render`（安装后全局可用）。
- **公开 API**：`from experience_store import ExperienceStore; store.search("...")`。
- **验证**：`pip install --target <tmp>` 构建成功、外部目录 import OK、测试护栏通过。

经验库复用规则（不变）：新版本永远最高权重、统一时间戳、低置信 fail loud、禁模拟数据，详见包内 `README.md`。

### 4. 发布流水线（A沙盒迭代 → B沙盒验证 → 生产）

迭代与发布严格走三段，避免污染生产环境：

```
A 沙盒（研发）→ 双副本互相修改、快速迭代、跑真实接口测试
   ↓ 迭代收敛
B 沙盒（验证）→ 部署验证、回归、放量观察
   ↓ 通过
生产环境（外部）→ 脉冲式灰度上线，dirty-flag + 失败回滚兜底
```

> **A/B 沙盒载体（v0.2.0 确认）**：A 沙盒 = 本仓库 + `undo-snapshots`（快照回滚底座，双副本可互相修改）；
> B 沙盒 = `dsh-home` web profile。测试模型走已配置的 opencodego\* 密钥渠道内 `ox alpha free`（免费）调用，
> 由 harness 直接切换使用，无需额外配置；A 沙盒内迭代收敛后推到 B 沙盒部署验证回归，通过后再灰度到生产。

---

## 资源清单（开源方案到各层能力的映射）

> 原则：优先**复用已有能力**，缺什么才引入开源；引入前必经安全评审闸。

| 能力层 | 首选方案 | 类型/许可 | 说明 | 链接 |
|---|---|---|---|---|
| 经验/记忆自进化 | EverOS | 开源 / Apache-2.0 | Markdown+SQLite+LanceDB，执行轨迹蒸馏成 Skills，**已有 `feat(dsh)` 集成分支**，最对口 | github.com/EverMind-AI/EverOS |
| 学习闭环（自动建/改进技能） | Hermes Agent | 开源 / MIT | Closed Learning Loop，SQLite+FTS5 检索历史，Honcho 用户建模 | github.com/NousResearch/hermes-agent |
| 插件安全评审模型 | Hyperagent | 开源 | micro-VM 沙箱 + Rust 静态扫描 + LLM 深审 + trust/dirty flag + 反注入 | hyperlight-dev/hyperagent |
| 技能自动扫描/访问控制 | GoPlus AgentGuard | 开源 | 启动即扫新技能：secret/后门/混淆/prompt 注入；能力白名单 | github.com/GoPlusSecurity/agentguard |
| 运行时沙箱（不可信代码） | isolated-vm / isolated-function / secure-exec | 开源 | 进程级 V8 隔离；`vm2` 已弃用勿用 | laverdet/isolated-vm；Kikobeats/isolated-function；rivet-dev/secure-exec |
| 插件注册表（联网可发现源） | awesome-opencode 等 | 开源 / 社区榜单 | 作为"从开源补充能力"的检索起点 | github.com/anomaly/opencode |
| 已自建 | review-guardrail（静态评审+门禁+闭环） | 本仓库 | 复用为安全评审闸主体，扩展沙箱层 | deepseek-harness/review-guardrail |

**已有（不再造轮子）**：插件热挂载 `packages/extensions`（cordis_define / DynamicCordisRegistry）；
联网 `packages/web`；SQLite 持久化 `packages/session/session-persistence-sqlite`。

---

## 版本迭代

### v0.4.1 · 2026-08-26
- **复测确认**：③ 安全评审闸（08/09 护栏）与 ⑥ 经验库（test_experience_store）全部 PASS，功能真实达成。
- **解耦独立包验证达成**：新增 `experience/tests/test_installed_pkg.py` 作为**可复现 e2e 护栏**——
  构建 wheel → `pip install --target` 到独立临时目录（零第三方依赖）→ 仅从外部目录 import OK →
  CLI 全链路 add→search→render 真实命中 → 跨进程持久化（进程 A 写 / 进程 B 读命中）。
- 结论：`experience-store` 已彻底解除与 deepseek-harness / review-guardrail 的耦合，可作为独立插件/包开源发布。

### v0.4.0 · 2026-08-26
- **⑥ 经验库解耦为独立可安装、可开源 pip 包** `experience-store`（纯标准库零依赖，不耦合本仓库）。
- 结构：`experience_store/`（engine 核心 + cli + 公开 API）+ `pyproject.toml`（console script）+ `LICENSE`(MIT) + 包内 README（版本迭代）。
- 验证：`pip install --target` 真实构建成功、外部目录 import OK。

### v0.3.0 · 2026-08-26
- **⑥ 经验蒸馏入库落地**（`self-evolution/experience`，纯标准库 + SQLite FTS5 trigram）：
  - 声明化 `experience.yml`（store/distill/rank/mirror）；单点核心 `experience_engine.py` + CLI `experience_cli.py`。
  - `add` 蒸馏写入（低置信 fail loud）、`search` 加权检索（置信度+新鲜度+复用，回灌①）、`promote` 复用晋升、`render` 镜像。
  - 唯一事实库 + 镜像共用统一时间戳；测试护栏 `tests/test_experience_store.py` 通过。
  - CLI 端到端冒烟：`add case-demo → search 安全评审 → render` 均正常。

### v0.2.0 · 2026-08-26
- **③ 安全评审闸落地**（review-guardrail 扩展，与既有风格一致）：
  - `guardrail.yml` 新增 `safety` / `trust` 声明化段（block/allow/executor/信任级/dirty）。
  - CLI 新增 `safety scan --dir <插件> [--route static|node] [--trust]`、`trust --level ...`；`gate` 支持 `--plugin-dir`，恶意能力合并前阻塞。
  - `tests/08_safety_scan.py`（恶意能力/未知能力/信任门必须阻塞）、`tests/09_sandbox_pre_run.py`（node 预跑必须真实观测，不做副作用/不静默放行）——9/9 断言通过。
- 确认 A/B 沙盒载体与测试模型接入：A=仓库+undo-snapshots、B=dsh-home web profile、模型走 opencodego\* 内 `ox alpha free`。

### v0.1.0 · 2026-08-26
- 盘点仓库已有能力：热挂载（extensions）、联网（web）、SQLite、Agent Notes、review-guardrail。
- 形成 6 段闭环蓝图 + 三层安全防御（病毒注入防护的核心） + 三段式发布流水线。
- 记录开源资源清单到各能力层的映射（上表）。