# @deepseek-ai/dsh-automation-scheduler

日历型自动化触发器：按间隔计划触发配置的 exec/HTTP 动作，带单次超时、连败倍增退避、错峰抖动与只追加的 NDJSON 审计日志。外部管线把幂等的 once 端点挂到这里即可（频率、错峰、重试策略归本包；端点自身保证幂等安全）。

## 模型

- `SchedulerEngine.sweep()` —— 触发所有到期任务；插件按固定节奏扫描，调度粒度即 `sweepIntervalMs`。
- 动作：`exec`（子进程，以退出码为准）或 `http`（JSON 请求，2xx 即成功）。
- 退避：连续失败使下次间隔翻倍，至八倍基准；任一次成功即复位。
- 日志：每次触发展开一行 `{at, job, ok, detail, durationMs}` —— 幂等外部端点的审计轨迹。

## 已知限制与延期工作

- 仅间隔计划（everyMs + 可选 jitterMs）；cron 表达式随日历UI集成落地。
- 退避/到期状态不跨重启持久化：重启可能立即再触发一次，仅对幂等端点安全（这正是本包文档化的契约）。
