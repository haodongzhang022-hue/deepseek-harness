---
name: omni-meta-release-collaboration
description: Use when working under the omni-meta meta-learning framework (V3 admin console) and you will write code, change config, or submit work that lands in the shared release queue. Loads the cross-market release-collaboration mode: port ring, promotion flow, release-control MCP tools, and multi-agent cooperation rules so you can file a correct RC Issue and never touch the 8008/8027/8028 ports.
---

# omni-meta 统一发布协作模式（cross-market）

> 这是一个**模式（mode）**，不是市场专属技能。omni-meta 已跨多个市场（crypto / cn-futures / us-futures / tiku …），发布协作只针对**管理台发布队列**（8008 / 8027 / 8028），**不以市场为边界**。任何被分配到 8009–8016 测试端口、或要提交成果进入共享发布队列的 AI，都必须遵循本模式。

## 1. 何时使用本模式

在以下情况必须加载本模式：

- 你要**写代码 / 改配置 / 新增功能**，且成果要进入 omni-meta 的共享发布队列。
- 你被分配到 8009–8016 独立测试端口做单模块开发。
- 你担任 8008（整合）或 8027（预发布）责任 AI，需要走门禁。
- 你需要向总管理/发布责任人说明如何晋升 8028。

以下情况**不需要**本模式（只读/查询/诊断，不进发布队列）：数据查询、状态查看、回测运行、架构评审、方案设计、风险评估。

## 2. 端口三环与晋升流程（权威，2026-08）

```text
8066 基准（跟随已发布 8028）
      ↓ 对齐
8009–8016：独立、解耦功能开发与单模块测试
      ↓ 提交 RC Issue
8008：唯一整合责任 AI 的队列与整合测试
      ↓ 8008 放行
8027：唯一预发布责任 AI 的验证队列
      ↓ 8027 放行 + 人工发布批准
8028：正式生产版本
      ↓
8066：更新为下一轮开发基准
```

| 端口 | 角色 | 谁能操作 |
|------|------|---------|
| 8009–8016 | 独立测试 | 各功能 AI，session 心跳登记 |
| 8008 | 整合审批 | 唯一整合责任 AI（领取队列/整合/门禁） |
| 8027 | 预发布验证 | 唯一预发布责任 AI |
| 8028 | 正式生产 | 仅发布责任人显式批准，绝不自动发布 |
| 8066 | 发布后基准 | 8028 发布后 `anchor` 更新 |

## 3. 边界铁律（不可绕过）

1. **任何普通开发 AI 不得启动、停止、重启、kill 或绑定 8008 / 8027 / 8028 的监听端口。** 实例生命周期只按 `python scripts/v3_servers.py list|start|stop|restart|promote|logs` 和总管理授权执行。
2. `release_control` 只管理 Issue、租约、证据、反馈、状态；它**绝不触碰监听进程**、不运行测试、不合并代码、不自动发布 8028。
3. 8027 通过**只**进入 `awaiting_production_approval`，**不会自动推送 8028**。8028 必须由发布责任人显式记录批准。
4. 被 8008/8027 reject 时，读取 `feedback` 修复后重新提交，**不得绕过队列直接推 8027/8028**。

## 4. 进入测试端口前

1. `python scripts/v3_servers.py list` 检查实例，不要假设端口空闲或属于自己。
2. 开发前确认与 8066/8028 基准对齐（既有 sync/基准流程）。
3. 声明端口 / Harness session / AI 标识 / 能力，之后每 5 分钟心跳一次：
   ```powershell
   python scripts/release_control.py register-agent --port 8012 --session <SESSION_ID> --agent <AGENT_ID> --capability api --capability data
   ```
4. 若端口已被未过期 session 登记，不得挤占；联系总管理重新配送。
5. 每个任务必须是**可独立验证、可回退的解耦模块**，不要在同一条 Issue 里混入无关重构。
6. 严格执行 TDD：先写失败测试 → 最小实现 → 跑测试。用 conda `bian` Python。
7. 保留实际测试命令、通过数量、HTTP/API 冒烟证据；这些是 8008 门禁的输入。

## 5. 提交 RC Issue（强制声明）

完成单模块测试**不等于**可以改 8008，也不等于可进 8027。必须提交 Release Control Issue（`change.json`），并含以下必填字段：

| 字段 | 为什么必须有 |
|---|---|
| `affected_components` | 8008 能定位整合影响范围、冲突与回归范围 |
| `objective` | 希望达到的用户/系统效果 |
| `acceptance_criteria` | 可被 AI 和人工实际验证的通过条件 |
| `before_behavior` | bug 必填；判断问题是否真的被修好 |
| `change_summary` | 说明改进方式，而不是只写“已修复” |
| `artifact_ref` | 指向可被整合者复现的分支/提交/补丁 |

提交：
```powershell
python scripts/release_control.py submit --file change.json
```

## 6. 门禁 / 生产（仅责任 AI）

- 8008 整合：`claim --port 8008 --actor integrator-8008`，按验收标准整合测试，通过 `approve`（进 `queued_8027`），不通过 `reject` 并写明失败标准、实际输出、修复建议。
- 8027 预发布：`claim --port 8027 --actor staging-owner`，通过只进入待生产批准。
- 8028 生产（仅发布责任人）：`python scripts/release_control.py production <RC-id> --actor release-manager --approve --reason ...`，随后 `promote`、`anchor` 更新 8066。

## 7. MCP / Harness 工具（DSH 环境）

当 DeepSeek Harness 已按 `docs/RELEASE_CONTROL_PIPELINE.md` 的 MCP 配置启用后，使用命名空间工具 `mcp__releasecontrol__*` 完成同样操作；**不得同时用 CLI 与 MCP 对同一 Issue 做冲突动作**。

| MCP 工具 | 用途 |
|----------|------|
| `mcp__releasecontrol__register_test_agent` | 心跳登记测试端口 session + 能力（每 5 分钟） |
| `mcp__releasecontrol__submit_change` | 提交完整 RC Issue（8009–8016 开发完成后） |
| `mcp__releasecontrol__claim_gate_item` / `record_gate_result` | 8008/8027 门禁（仅责任 AI） |
| `mcp__releasecontrol__record_production_decision` | 8028 生产决策（仅发布责任人） |
| `mcp__releasecontrol__dispatch_task` / `list_release_state` / `list_modules` / `bump_module` / `pipeline_status` | 配送/审计/模块版本 |

**MCP 能做**：提交、领取、记录测试结论、登记 session、配送、查询。
**MCP 不能做**：监听端口管理、运行测试、合并代码、向 8028 自动发布。AI 必须先以受控测试工具获得证据，再调用门禁结果工具。

## 8. 禁止事项（任何一条都视为协作事故）

- 抢占或重启他人正在使用的 8008 / 8027 / 8028 监听端口。
- 绕过 Issue 队列直接将测试端改动推到 8027/8028。
- 将“测试通过”写成无命令、无结果、无验收标准的口头结论。
- bug 没有旧行为说明、没有拒绝理由、没有 artifact ref。
- 用队列工具执行服务器命令、执行任意 shell、改代码或自动生产发布。
- 把 AI session heartbeat 当成对 DSH session 的控制权；它只是可审计的能力声明。

## 9. 权威参考

- `E:\1shuju\omni-meta\docs\AI_RELEASE_COLLABORATION_RULES.md`（必读）
- `E:\1shuju\omni-meta\docs\RELEASE_CONTROL_PIPELINE.md`
- `E:\1shuju\omni-meta\docs\MODULE_REGISTRY.md`（模块级版本注册表；`affected_components` 必须映射到已注册模块）
- `E:\1shuju\omni-meta\docs\V3_COLLABORATION.md`
- `E:\1shuju\omni-meta\AGENTS.md`（仓库根规则）