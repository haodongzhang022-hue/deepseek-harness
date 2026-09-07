# Agent Note: 注册时校验工具名

Status: implemented

[English](2026-09-08-tool-name-validation-at-registration.md) | 中文

## 问题

外部插件 `mindmap-conversation` 注册了 5 个带点号的工具名（`mindmap.expand`、`mindmap.history`、`mindmap.request`、`mindmap.search`、`mindmap.threads`）。Console Go 类 OpenAI 兼容上游强制函数名匹配 `^[a-zA-Z0-9_-]+$`，在 `tools[40]`（`mindmap.expand`）处以无法归因的 `400 invalid_request_error` 拒绝，整轮模型调用随之终止。DSH 此前在注册时从不校验工具名，因此这一错误配置只能以外循环无法归因的上游错误形式暴露。

## 决策

`@deepseek-ai/dsh-tools` 的 `ToolRuntime.register()` 现在拒绝任何不匹配 `^[a-zA-Z0-9_-]+$` 的工具名（各请求侧函数名 API 的公共字符集：OpenAI 兼容 schema、Anthropic 工具名、Gemini 函数声明）。失败形式为注册时抛出的 `TypeError`，带违规名字与允许的模式，非法注册在插件加载时即 fail loud，而不是在第一个模型请求时失败。作用域注册共享同一入口，因此同样受检。

## 备选方案

**在 provider 边界消毒或改名。** 否决：在请求边缘改名需要双向名字映射，并且会在静默改名后隐藏插件 bug；持久注册键必须就是线上名字。

**维持上游报错。** 否决：这正是原始 bug 类别——一个包含该工具的每次请求都被终止的、无法归因的 400。

## 后果

非法工具名现在会在加载时以可操作的消息使插件注册失败。对全部 147 个已注册工具名字面量的仓库扫描（加上使用 `mcp__server__tool` 下划线约定的 MCP 桥名字）未发现其他违规；`mindmap-conversation` 插件已在其自身仓库中改名为 `mindmap_*`，因此该改动不破坏任何现有注册。`tools.spec.ts` 覆盖了点号、冒号、空格、中文与空名字的拒绝，以及字母、数字、下划线与连字符的接受；包 README 双语对记录了命名规则。