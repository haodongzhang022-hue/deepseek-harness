# 将长运行 agent-loop 默认值提升约3-5倍

日期：2026-08-24

## 背景

长时自主会话（目标延续、深委派树、守卫下的重复工具调用）过早触及出厂默认：目标轮次上限256、委派深度3、并行工具调用10、重复工具提醒在连续3/5/8次即触发。多阶段构建半途而废，或在预算真正耗尽之前就被提醒噪音淹没。

## 决策

四个默认值成套提升，规模以"一次完整自主构建能装进单个会话"为准：

| 配置项 | 旧 | 新 |
| --- | --- | --- |
| `defaultMaxGoalRounds`（goal） | 256 | 1024 |
| `maxDepth`（tool-subagent） | 3 | 12 |
| `DEFAULT_MAX_PARALLEL_TOOL_CALLS`（agent-loop） | 10 | 50 |
| `thresholds`（repeat-tool-reminder） | [3, 5, 8] | [15, 25, 40] |

全部仍是经校验的配置字段，仅默认值移动。断言旧值的测试与README在同一变更内更新；guard行为规格现在显式固定阈值（`{ thresholds: [3] }`），使链语义覆盖与默认值解耦。

## 否决的替代方案

- **完全移除上限**：无界递归与无界提醒静默比宽松上限更糟；深度与轮次仍是最后的安全闸。
- **只提目标轮次**：瓶颈只会移动到最先触及的上限；成套提升才保住深委派可用的比例关系。

## 后果

- 依赖紧默认作为隐式安全网的部署应在 cordis.yml 显式设值；误配置仍在加载时响亮失败。
- 提醒阈值高于典型循环长度后，guard瞄准的是真死循环而非合法重复——但真正失控的同参调用在首次提醒前会烧更多token。

## 验证

- `node node_modules\vitest\vitest.mjs run packages/goal/goal/tests packages/guard/repeat-tool-reminder/tests packages/subagent/tool-subagent/tests packages/core/agent-loop/tests` —— 变更后462个测试全绿。