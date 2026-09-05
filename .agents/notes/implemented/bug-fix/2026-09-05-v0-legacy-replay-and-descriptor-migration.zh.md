# Agent Note: v0 迁移规范化旧版 pi-ai replay 信封与 subagent 描述符

Status: implemented

[English](2026-09-05-v0-legacy-replay-and-descriptor-migration.md) | 中文

## 问题

0.1.3-alpha.1 把适配器 replay 元数据拆分为 `{ response, blocks }` 信封，并把 subagent 描述符提升到 version 3，但已发布的 v0→v1 迁移只按新形状校验历史 payload。在本机生产 home 中，254 个已存会话里有 133 个拒绝迁移（`chunk replayState has unexpected member "kind"` 或 `subagent/descriptor uses unsupported descriptor version 2`），升级后这些对话在 Web GUI 中全部无法打开。

## 决策

`dsh-session-format-v0-to-v1` 现在规范化这两种已发布的旧形状，而不是拒绝它们：终态 `finish` chunk 或模型消息来源中结构扁平的 `replayState`（顶层含 `kind`、无 `response`）会被拆分为 `{ response: { …除去 blocks，version: 2 }, blocks }`；记录为 version 2 的 subagent 描述符被提升为 version 3，其余 payload 事实原样保留。chunk 与消息来源两半用同一函数转换，因此 v1→v2 的嵌入流一致性校验仍然通过。不支持的版本与真正畸形的形状保持原有迁移拒绝。

## 备选方案

**拒绝旧形状（维持原状）。** 否决：升级后会阻断所有拆分前的对话；迁移存在的意义就是把已提交的 generations 转换过来，而不是丢弃它们。

**直接修复磁盘上的产物。** 否决：会重写已提交的 generations，并且与持有同一批文件的运行中实例竞争。

## 后果

拆分前的会话可以加载、迁移到 v2 并渲染历史；规范化后的 replay 元数据满足当前 pi-ai 读取器的 `response.version === 2` 契约。包 README 记录了这两个规范化器，`migration.spec.ts` 用精确的旧 payload 形状覆盖了两种转换。