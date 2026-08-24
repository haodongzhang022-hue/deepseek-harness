# @deepseek-ai/dsh-automation-router

自动化门路由器：轮询 `PipelineGateAdapter`，差分快照，在持久化 JSON 账本中保存每条目状态，并对被驳回条目的源会话按状态恰好唤醒一次。以 Cordis 函数插件（`automation-router`）交付，引擎各件亦可直接复用。

## 模型

- `RouterEngine.tick()` —— 从"当前快照 + 账本"声明式推导唤醒需求；diff 事件仅作摘要。
- `FileLedger` —— 带模式版本的 JSON 文件，tmp+rename 原子写；跟踪身份/状态及唤醒簿记（notifiedState、重试计数）。
- 唤醒传输：`LogWakeTransport`（干跑）与 `InProcessWakeTransport`（同上下文会话 followup）。投递失败保持未通知、下轮重试；目标暂不可解析则静默延后。
- `ReleaseControlGateAdapter` —— 金融 release-control 绑定，经注入的 caller 接缝（插件内绑定到 `ctx.tools.execute`）；驳回原因取自 gate-results 轨迹（feedback/扁平字段兜底），lane 仅解析到存活注册会话。

## 插件配置

`serverName`（MCP 命名空间）、`ledgerPath`（必填）、`pollIntervalMs`（默认60秒）、`transport`（默认 `log` | `in-process`）。

## 已知限制与延期工作

- 跨进程唤醒未实现：托管在其他进程的 lane 需要通用插件层的桥接或单上下文托管；agents 服务缺失时 `in-process` 显式报错。
- 真实组合 Loader 测试（测试用 cordis.yml + fixture MCP 服务）待补；当前插件生命周期测试以真实 Context 加 mock tools 服务启动。
- 长期运行下账本无限增长；保留策略随 Phase B watcher 落地。
