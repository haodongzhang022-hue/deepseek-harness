# 准入验收记录 — dsh-relay-cards（2026-09-04）

状态：**测试通过，已挂载（等待 web 重启生效）**。

## 测试证据

| 关卡 | 结果 | 命令/证据 |
|---|---|---|
| L1 单元测试 | 10/10 通过 | `node --test tests/store.test.mjs` |
| L2 cordis 冒烟 | PASS | apply 无异常 + 4 工具注册提交（stub tools） |
| 参数 schema | 已修正 | defineTool parameters = per-property value schema（冒烟发现并修复） |
| YAML 挂载块 | 已校验 | pyyaml safe_load 通过，patch 顶层条目数正常 |

单测覆盖：五要素回读一致 / gid 递增 / 必填缺失拒绝 / industry·status·priority 非法拒绝 /
list 四维过滤 / 状态流转 + history 留痕 / done 终态不可回退 / 持久化重载续号 / 损坏文件隔离留档自愈。

## 稳定性契约（防崩设计）

1. apply 内任何异常 → 仅 logger.warn，不抛出（不崩 web 主体）；
2. 工具 execute 内部异常 → 返回 {ok:false,error} 文本，不 throw；
3. config.enabled=false 一键停用；
4. 存储损坏 → 自动隔离留档 + 空启动。

## 回滚预案

- undo 快照：20260904-123831-bcc0（manual，配置变更前）
- 配置备份：cordis.patch.yml.bak-relaycards-20260904-123831 / cordis.yml.bak-relaycards-20260904-123831
- 回滚命令：删除 patch 中 relay-cards 块 → 重启 web（或 `undo_restore mode=id 20260904-123831-bcc0`）

## 生效验证清单（重启后）

1. web.log 出现 `[relay-cards] store ready: ...` 与 `tools registered: relay_write, relay_read, relay_list, relay_update`；
2. web.err.log 无新增 ERROR；
3. 会话里真实调用：relay_write 建卡 → relay_list 见卡 → relay_read 回读 → relay_update 置 done；
4. GUI 无异常（3080 可用、会话恢复）。
