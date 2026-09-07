# 对齐校验机制 · 8088 交接手册（v2，2026-09-08）

> 目的：发现并持续监测「3080 开发 → 提PR/RC → 8008/8027 门禁 → 8028 生产」链条的缺漏，
> 防止漏提、提错、漏收口，以及 2026-09-05 一次性 3 万文件 git 事故的重演。
> 本手册随引擎同步部署到 8088（`dsh-prod-src/scripts/alignment_check.py` + prod 触发器）。

## 1. 机制是什么

- **引擎**：`scripts/alignment_check.py`（Python 标准库，无第三方依赖，只读为主）
- **双端部署**：同一引擎以 `--role dev`（3080）或 `--role prod`（8088）运行；
  权威源共享（omni-meta 队列/autopilot 状态/omni git/端口 health），视角对偶（各自仓库+home 为基准，对侧为对照）
- **定时**：两侧各 30 分钟触发器（`--report-only` 只读），产出各自报告
- **报告**：dev `data/release_control/ALIGNMENT_REPORT.md` + `ALIGNMENT_STATE.json`
  ；prod `dsh-prod-src/data/release_control/` 同名文件（机器可读，供对侧读取对比）

## 2. 手动运行

```sh
# dev 侧（3080，本仓库目录）
python scripts/alignment_check.py                    # 只读审计并落报告
python scripts/alignment_check.py --fix-ledger       # 修正本侧追踪器陈账（先备份）——仅 dev 惯例
# prod 侧（8088，dsh-prod-src）
python scripts/alignment_check.py --role prod        # 只读审计（生产侧默认只读）
```

## 3. 校验面一览

| 面 | 查什么 | 出现缺口时怎么办 |
|---|---|---|
| A 管道对账 | 队列权威 vs 本侧追踪器即 router-*.json 状态分叉 | dev 侧 `--fix-ledger`；两侧报告都是权威队列优先 |
| B 队列在途 | 非终态 RC + needs_human 遗留（替代项覆盖豁免） | 沿 8008→8027→8028 推进或驳回归档 |
| C 开发未提交 | 本仓/omni-meta git 未提交、未跟踪、未合并 | 按区块提交；产物归档或 .gitignore |
| D 生产未同步 | 生产源 9 目录 mtime 漂移 + preset 缺失 | 备份后 `/E /XO` 增量同步；preset promote 后需重启生效 |
| E 服务存活 | 8008/8027/8028 health、8066 基准文件、8088 | 恢复服务；8066 是 `.v3_baseline.json` 文件不是端口 |
| F 全流程追踪 | F1 在途轨迹 / F2 artifact commit∈代码树 / F3 驳回→重提闭环 / F4 审核吞吐 | F2 缺失=已收口未上线需重提；F3 孤驳需补备注或重提 |
| G 对侧对比 | 读对侧 ALIGNMENT_STATE.json 出缺口面差集 | 角色固有差（dev 独有 C-dev-* git 面）属预期，不告警 |
| H git 卫生 | 近 500 提交中 >1000 文件的超大提交 + 对象库体积 | 9/5 事故类；评估 filter-repo 清理或接受并监测 |

## 4. 双侧对比怎么用

- dev 报告 G 节给出 prod 报告的缺口面差集；prod 报告反之。
- 实绩：双侧上线首日，prod 侧发现 **8088 自身追踪器 23 行陈账**（dev 侧不可见）→ 已修（备份 `router-*.bak-align-20260908-032429`）。
- 若某一侧报告缺失/超时，G 节 `peer_read=false`，仅表示对侧还没跑，不代表缺漏。

## 5. 生产侧安全边界（铁律）

1. 定时触发器与手动运行默认**只读**；`--fix-ledger` 只写本侧 router JSON 并先备份，不触服务、不写队列。
2. 引擎不启动/停止/重启任何端口服务（实例生命周期归 `scripts/v3_servers.py` + 总管理授权）。
3. 引擎不修改队列状态、不运行测试、不合并代码、不产生发布。
4. 807 报告路径与脚本本体都在 `dsh-prod-src`（生产源的只读审计面），不碰 `dsh-prod-home` 的运行数据。
5. **问题归口原则（2026-09-08 起）**：8088 侧发现「开发链路问题」（git 历史/大提交/对象库膨胀/预设漂移等
   本应由开发侧处置的事项）→ 一律**只报告不处理**，回投接力卡（relay_write，industry=software，备注"归口 3080"）
   或写入台账；生产环境不执行历史重写、filter-repo、force-push 等开发动作。
   已开专项交接卡：**RL-000022**（git 历史瘦身，由 3080 专项会话 session-4033bd53 执行）。

## 6. git 卫生规则（2026-09-05 事故存档，防再犯）

**事故**：`5120dd87c7`（09-05 14:22 "chore: WIP checkpoint before upstream dsh-0.1.3-alpha.1 merge"）
一次性提交 **30,674 文件 / 425 万行**；该批实际正当修改约 59 个文件，其余为工作树快照杂物。
后果：dev-repo 对象库膨胀（当前 size-pack ≈ 189 MiB）、PR/评审噪声、diff 不可读。
H 面每 30 分钟监测该模式，任何 >1000 文件提交触发 high 告警。

**提交前强制习惯**（写入交接纪律）：
1. `git diff --stat` / `git status --porcelain` 先看改动面：>500 文件必须停下解释。
2. 禁止用「WIP checkpoint / 一把梭」式提交代替分块提交；
   确实需要临时保存用 stash 或局部提交，且必须排除 node_modules/构建产物/数据快照。
3. RC 的 `artifact_ref` 必须带可解析 commit（分支名/@latest 会进 F2「无法核验」，上线不可追踪）。
4. 大提交历史清理（filter-repo 瘦身）如需执行：列为独立专项，需本仓全部协作会话
   force-push 迁移配合，先备份仓库再动。

## 7. 常见故障排查（本机制自测记录）

| 症状 | 原因 | 处置 |
|---|---|---|
| `AttributeError: 'list' object has no attribute 'items'` | ALIGNMENT_STATE 序列化遇列表 section（F1） | 已修：v2 序列化兼容 list |
| G 面误报 divergence | Python 运算符优先级 `a \| b - c` 先减后或 | 已修：显式括号 |
| 8066 报 DOWN | 把基准文件当 HTTP 端口探测 | 已修：读 `.v3_baseline.json` 判据 |
| prod 侧 C 面报 no-git | dsh-prod-src 无 .git（拷贝源）| 预期：git 面只 dev 侧跑，omni-meta git 两侧共享 |

## 8. 本次部署物清单

- 引擎：dev `scripts/alignment_check.py` = prod `dsh-prod-src/scripts/alignment_check.py`（字节一致，已核对）
- 触发器模板：`data/release_control/triggers/alignment-check.dev.json` / `alignment-check.prod.json`
- 已注册：dev `dsh-home/data/automation/signals/triggers/alignment-check.json`
  ；prod `dsh-prod-home/data/automation/signals/triggers/alignment-check.json`
- 台账：`data/release_control/ITERATION_LEDGER.md` 第 7 节（持续对账记录）