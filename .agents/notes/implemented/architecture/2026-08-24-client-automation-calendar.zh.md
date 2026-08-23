# 客户端自动化日历会话视图

日期：2026-08-24

## 背景

Web GUI 此前没有面向时间的自动化视图：任务轮次只以线性转录呈现。管理周期性AI任务的用户需要看到工作何时运行、以何种粒度重复、何时出问题（卡住的轮次、失败连发、时长离群），而不必阅读日志。

## 决策

新增 `packages/client/ui-automation-calendar`，一个纯消费者会话视图插件：

- 通过 `ctx.slots.inject` 注册一个 `conversation.view` 列表项（`id: 'automation-calendar'`）和 `calendar` 词典。无服务、无store——查看状态（粒度、窗口、选中、展开的周期组）是组件局部状态，因为尚不存在跨条目或跨重挂载的消费者。
- 全部数据经由 `useSession` 选择器从标准kit快照切片（`turnTimings`/`running`/`lastAgentError`）派生；模型体验在构造上即为零token/零KV-cache。
- 时间粒度收敛于一张契约表（16个内置级别）；自定义级别注册在引擎单例上并持久化到浏览器 `localStorage`（`dsh.automation-calendar.custom-granularities`），而非用户设置。
- 周期检测把每个任务认领进至多一个模式（置信度降序贪心）：严格的小时序列是interval组，绝不同时是daily-cron组。

## 否决的替代方案

- **立即做宿主侧资源采集**（每任务CPU/GPU/存储）：契约为字段留位，但当前没有任何生产者；没有证据就发布采集器只会伪造精度。推迟到有消费者证明必要性——见包README的Known Limitations。
- **v1做跨会话聚合**：需要对持久化会话的宿主侧rollup服务，超出"纯投影单个已加载会话"的范围。
- **用settings插件持久化自定义粒度**：为单一浏览器偏好接入过重的链路；若级别需要漫游再重启讨论。

## 后果

- 标签页只读取今天的 `ConversationSnapshot`；更丰富的每任务事实要等 `SessionEventMap` 扩展，而那是required-on-read，需要单独决策。
- 异常/卡住告警目前是信息横幅；点击跳转到任务的owner-prop路由待后续加入槽契约。

## 验证

- `node node_modules\vitest\vitest.mjs run packages/client/ui-automation-calendar/tests` —— 引擎（粒度/周期/错误/异常）与视图模型hook共31个测试。
- 三处注册面确认在场：根 `tsconfig.client.json`、`packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/web-app/package.json`。