# Agent Note: 自动化触发器的每月门控 + 日历/频次管理界面

Status: implemented

[English](2026-09-07-automation-trigger-slot-dom.md) | 中文

## Problem

自动化总线(`packages/automation/scheduler`)可以调度每分钟一次、每小时一次、每天一次(以及通过已有的 `slot_weekday` 门控每周一次)的任务,但没有每月单位,因此"每月15日运行"无法在触发器注册表中表达。管理侧,自动化控制台(外部包 `dsh-external/dsh-automation-console`)只渲染一个扁平的按频率分组列表,偏向持续运行的分钟级触发器;低频自动化(每天/每周/每月)没有稳定的按日呈现,也没有任何视图为每个触发器传达周期单位与下次运行时间。

## Decision

1. **调度器匹配语言新增 `slot_dom`。** `Trigger.match` 接受 `slot_dom?: number`(1..31),这是本地时区"每月第几号"门控,与 `atLocal`、`slot_weekday`、`slot_m_mod`、`slot_h_mod` 按 AND 组合,语义与星期门控完全对齐。`matches()` 用 UTC 时间槽加触发器偏移计算本地几号;`TriggerStore.validate()` 拒绝非整数或越界值。"每月第N日 @HH:MM"(minute 通道)或 day 通道按日触发变得可表达;匹配依旧是对脉冲内容的纯函数。
2. **控制台呈现两种互补视图与周/月编辑器。** 面板(客户端包,tsdown 重建)改为四个标签页。「📅 日历」把每个 每天/每周/每月 自动化铺到滚动日网格上(本周一起,2/5/9 周窗口),让低频自动化持续可见:计划触发点标注本地时刻,下次运行带高亮边框,过去日期显示真实回执结果,亚日间隔触发器合并为每日"N 个周期"计数芯片。「⏲ 频次」按周期单位分组(每N分钟 / 每N小时 / 每天 / 每周 / 每月 / 已停用),行内含上次运行状态、下次运行绝对时间加倒计时、连败徽标与 8 事件健康圆点条。「📡 运行」收纳在飞调度、运行日志、脉冲时钟与已停用触发器;「🚦 门禁」保留门禁面板。触发器编辑器新增 每N小时、每周@星期几、每月@第N日 三种调度方式。全部调度测算在客户端完成,镜像调度器纯匹配规则,数据来自原始注册表(`GET /api/triggers`),回执历史来自 `GET /api/overview?level=1d&bins=N`——面板本身无需重启宿主。
3. **控制台宿主镜像保持解耦但同步。** 控制台宿主的本地 `matchesPulse`/`describeMatch`/`triggerLevel` 面同步 `slot_dom` 门控与每周/每月文案,使 `automation_overview` 工具文本与重启后的快照能正确描述每月规则。

## Consequences

- 每月触发器需在调度器进程以含 `slot_dom` 的 `triggers.ts` 重启后才真正触发;此前编辑器可创建规则,但运行中的脉冲循环会忽略新字段。
- 每周规则在运行中的调度器里本就可触发(`slot_weekday` 门控早于本次变更);控制台现在才在编辑器与视图中暴露它。
- 间隔触发器(每N分钟/每N小时)不占独立日格;日历以每日一个"N 个周期"聚合芯片呈现,保证大注册表下网格可读。
- 过去日期显示真实回执结果,未来日期显示计划时刻;漏跑表现为一个空计划槽。

## Verification

- 新增 `tests/triggers.spec.ts`(7 例):每天 atLocal、每N分钟、每周星期门控、每月几号门控、day 通道每月、停用排除、通道相等。调度器全量测试:3 文件 22 例通过。
- 控制台 `tsc --noEmit` 通过;`tsdown` 包重建;实机 GUI 检查:⚙️ 控制台 标签渲染四个页签,日历网格带真实按日标记(如 daily-data-replenish @08:00、omni-ashare-quant-daily @05:35)与周期芯片,频次视图列出带下次运行倒计时的分组。

## Related

- [自动化日历会话视图](../architecture/2026-08-24-client-automation-calendar.md)——本界面补足的会话轮次日历(自动化而非轮次)。