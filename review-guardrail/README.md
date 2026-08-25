# review-guardrail — 自动代码评审 + 流水线质量护栏

三层机制（对标 CNB 的"OCI 行级评审 + .cnb.yml 流水线门禁 + changes_requested 自动修复"）：
1. **行级自动评审**（`review`/`comment`）：拉取真实 diff 新增行，按 安全→缺陷→质量→性能 优先级检查，
   评审角色与 prompt 声明化（`guardrail.yml`），输出行级 finding 与 severity，可发布为 PR 评论。
2. **流水线门禁**（`gate`）：信号灯断言 + 严重度门禁 + `--pr` 关联 GitHub 真实评审状态，红灯阻塞。
3. **评审→修复闭环**（`loop`）：打回默认直接修，轮次持久化护栏，达上限停止并反馈人类。

核心只存在本文件夹一处。Trae / deepseek-harness / 各 agent 通过 CLI 或 MCP server 薄接入，
升级只改这里，避免各处进度分叉。策略全部声明化（[guardrail.yml](guardrail.yml)），
每修一个 bug 往 [tests/](tests/) 固化一条断言——护栏随修复更牢。

## 快速开始

```sh
cd review-guardrail
python -m review_guardrail config            # 打印声明化策略
python -m review_guardrail asserts           # 信号灯断言（全绿：7/7 PASS）
python -m review_guardrail review --route static --patch -   # 行级评审
python -m review_guardrail gate --repo <repo> --base <b> --head <h>   # 合并门禁
python -m review_guardrail loop --pr 42 --route static --patch - --post  # 修复闭环（需 gh）
```

llm 路线需 `DEEPSEEK_API_KEY`（可用 `GUARDRAIL_CONFIG` 指定策略路径）；gh 相关命令需本机 `gh` CLI。

## 目录结构（按执行流程数字前缀，顺序即调用顺序）

```
review-guardrail/
  guardrail.yml            声明化策略（唯一调参入口，git revert 可回滚）
  review_guardrail/
    cli.py                 入口：config / review / asserts / gate / comment / assign / merge / loop
    engine.py              配置加载+校验 / 模型 / 严重度门禁 / 编排 / fill_template
    diff.py                真实 git diff → 新增行(新行号,文本)
    review.py              评审后端分派（llm/static/hybrid）
    loop.py                评审→修复闭环 + 轮次护栏（状态持久化）
    assertions.py          信号灯断言运行器
    output.py              渲染 text/json / PR 评论 / 修复指令
    mcp_server.py          MCP server（Trae/agent 功能调用面）
    adapters/              dsh_review(真实 dsh) · static(内置保守检测) · github(gh 薄适配)
  tests/                   NN_*.py 断言护栏（每修一 bug 加一条）
  integration/             GitHub Actions 接入 · Trae 用法
  docs/                    REVIEW / GATE / FIXLOOP / ITERATION（分功能版本化）
```

## 校验

```sh
python -m review_guardrail asserts      # 信号灯全绿即通过
```

## 文档

- 行级自动评审 → [docs/REVIEW.md](docs/REVIEW.md)
- 流水线门禁 / 信号灯 → [docs/GATE.md](docs/GATE.md)
- 评审→修复闭环 / 轮次护栏 → [docs/FIXLOOP.md](docs/FIXLOOP.md)
- 稳定生效与升级迭代 → [docs/ITERATION.md](docs/ITERATION.md)

## 版本

当前 `0.2.0`。各功能文档内含版本迭代历史，以最新版为唯一依据，旧版保留备查。