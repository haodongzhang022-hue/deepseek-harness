# @deepseek-ai/dsh-automation-gate

监控外部管道门并将条目快照差分为事件的通用契约。消费方：automation-router 守护插件；未来通用插件实现同一接缝。

## 模型

- `GateItem` —— 单个被跟踪条目：id、sourceLane、title、state（`queued | testing | passed | rejected | approved | unmapped`）、可选 detail。
- `PipelineGateAdapter` —— 数据源读取面：`listItems()`。
- `WakeTargetResolver` —— 可选寻址面：lane 到会话 id，未知返回 null。
- `diffGateSnapshots(previous, current)` —— 纯快照差分，产出 `item-submitted` / `item-state-changed`；重复 id 抛错。

适配器必须显式映射外部状态；未知状态落在 `unmapped`，路由绝不猜测。

## 已知限制与延期工作

- 本包不含传输：投递由 router 包负责。
