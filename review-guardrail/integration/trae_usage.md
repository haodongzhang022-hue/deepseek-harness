# Trae / 各 Agent 接入 review-guardrail

review-guardrail 是"功能调用模块"：核心只在这一处，Trae、deepseek-harness、任何 agent
通过 CLI 或 MCP server 调用同一个引擎与同一份 guardrail.yml，从入口杜绝"各处进度不一"。

## 方式一：MCP server（推荐，Trae 原生）

1. 在 Trae 的 MCP 配置里注册本 server：

   ```json
   {
     "mcpServers": {
       "review-guardrail": {
         "command": "python",
         "args": ["-m", "review_guardrail.mcp_server"],
         "cwd": "<本仓库>/review-guardrail"
       }
     }
   }
   ```

2. 可用工具：

   | 工具 | 作用 |
   |---|---|
   | `guardrail_review` | 对给定 diff/区间做行级评审，返回 findings + verdict |
   | `guardrail_asserts` | 跑信号灯断言，返回每项通过/失败 |
   | `guardrail_gate` | 门禁：信号灯+评审（传 `pr` 则关联 GitHub 真实评审状态），返回是否 allowed 合并 |
   | `guardrail_config` | 返回校验后的声明化策略 |
   | `guardrail_comment` | 评审并渲染 PR 评论正文（传 `pr` 发布到 GitHub） |
   | `guardrail_assign` | 自动分配评审人（gh add-reviewer，用 `github.reviewers`） |
   | `guardrail_merge` | 自动合并门禁：真实评审状态 approved 才 `gh pr merge` |
   | `guardrail_loop` | 评审→修复闭环：打回返回修复指令，达 `loop.max_rounds` 轮停止并反馈人类 |

   参数示例（guardrail_review / gate / comment / loop）：
   - `repo`：git 仓库路径（缺省用 cwd）
   - `base` / `head`：评审区间 ref（同时给则为区间 diff）
   - `patch`：直接给 diff 文本（CI 常见）
   - `route`：llm / static / hybrid（覆盖策略）
   - `pr`：PR 号（comment/merge/loop 需要；gate 传它则校验真实评审状态）
   - `post`：loop/comment 是否把结果发布为 PR 评论（gh）

## 方式二：CLI

```sh
cd review-guardrail
python -m review_guardrail config                                # 打印策略
python -m review_guardrail asserts                               # 信号灯
python -m review_guardrail review --route static --patch -       # 行级评审(stdin diff)
python -m review_guardrail gate --repo <repo> --base <b> --head <h>   # 门禁
python -m review_guardrail gate --repo <repo> --pr 42            # 门禁关联真实评审状态
python -m review_guardrail comment --route static --patch - --pr 42   # 评审→PR 评论
python -m review_guardrail assign --pr 42 --repo <repo>          # 自动分配评审人
python -m review_guardrail merge --pr 42 --repo <repo>           # approved 才自动合并
python -m review_guardrail loop --pr 42 --repo <repo> --base <b> --head <h> --post  # 修复闭环
```

退出码：0 通过 / 2 评审或门禁打回 / 3 断言失败。llm 路线需 `DEEPSEEK_API_KEY`，缺则 fail loud。
gh 相关命令需本机 `gh` CLI；缺失即 fail loud，不静默跳过。

## 评审内核切换（折中参考）

同一套逻辑，只改 `guardrail.yml` 的 `review.route`：
- `llm`：dsh + DEEPSEEK_API_KEY，能力最强的行级评审（首选）
- `static`：内置保守正则检测，零外部依赖、不耗模型
- `hybrid`：llm + static 合并去重，二者互证

## 稳定生效要点

- 核心逻辑只在本模块一份，所有调用方共享，避免分叉。
- 策略声明化（guardrail.yml），调参不碰代码；调崩了 `git revert guardrail.yml` 即可回滚。
- 每修一个 bug 往 `tests/NN_*.py` 加一条断言，CI 每次提交都跑——机制随修复更牢。
- 版本迭代历史见 `docs/`：分功能（REVIEW/GATE/ITERATION），新版本最高权重，旧版保留备查。