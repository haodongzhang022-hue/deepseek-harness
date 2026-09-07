# @dsh-external/dsh-relay-cards

0903 主干「自动化接力卡流转」的最小落地插件：给会话补上接力卡工具
（`relay_write / relay_read / relay_list / relay_update`），替代「人肉 @ 找人」。

对应 preset 规则：architecture-common-team-0903 → 自动化接力卡流转（分工协作主通道）。

## 工具契约

| 工具 | 作用 |
|---|---|
| `relay_write` | 无 gid = 新建（五要素必填）；有 gid = 全量覆盖更新（可带 status 置 done 收尾） |
| `relay_read` | 拿完整上下文（input_context / output_contract / history），接手前必读 |
| `relay_list` | 队列过滤（status / assignee_role / industry / limit），默认最新 50 条 |
| `relay_update` | 部分更新 + 状态机推进（open→in_progress→done；done 为终态不可回退） |

字段（snake_case，与 omni-meta `relay_card_template_0903.md` 对齐）：

- 五要素必填：`task_brief` / `current_progress` / `next_step` / `assignee_role`
- `input_context` / `output_contract`：对象，可空
- 0903 增量：`industry`（generic/finance/game/video/novel/software，默认 generic）、
  `architect_type`（默认 generic）、`capabilities_required`（字符串数组，混合角色任务必填）
- `priority`（P0-P3，默认 P2）、`note`、`status`（open/in_progress/done）

状态机：`open → in_progress → done`；**done 为终态**，不可回退（防抵赖），只可追加
note / output_contract（验收证据）。每次变更 append `history`，审计可追溯。

## 存储

单文件 JSON，默认 `${DSH_HOME}/data/relay-cards/relay-cards.json`（可经 config
`dataDir` 覆盖）。写入 = tmp + rename 原子替换；文件损坏时自动重命名留档并空启动，
**不抛错、不崩主体**。gid 格式 `RL-XXXXXX` 顺序递增，重载后续号不冲突。

## 稳定性契约（准入）

1. apply 内任何异常仅 `logger.warn`，绝不抛出（不崩 web 主体）；
2. 所有工具 execute 内部异常 → 返回 `{ok:false, error}` 文本，不 throw；
3. `config.enabled=false` 一键停用（工具消失，插件空转）；
4. 单元测试 `npm test`（node --test，核心逻辑零 cordis 依赖）；
5. 挂载冒烟：`tests/load-smoke.mjs`（cordis 环境真实 apply + 工具注册验证）。

## 挂载（profiles/web/cordis.patch.yml）

```yaml
- insert:
    - id: relay-cards
      name: 'file:///E:/1shuju/1gitgengxin/deepseek-harness/dsh-external/dsh-relay-cards/src/index.ts'
      config:
        dataDir: 'E:/1shuju/dsh-home/data/relay-cards'
```
