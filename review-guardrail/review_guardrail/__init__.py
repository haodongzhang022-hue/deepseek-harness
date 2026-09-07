"""review-guardrail: 可复用的自动代码评审 + 流水线质量护栏模块。

两层机制（对应 CNB 的 OCI 行级评审 + .cnb.yml 流水线门禁）:
  1. 行级自动评审（review）: 拉取真实 diff 的新增行，按优先级做安全/缺陷/质量/性能检查，输出行级 finding。
  2. 流水线门禁（gate）: 信号灯断言（asserts）+ 严重度门禁，红灯阻塞、合并前校验。

核心进程只存在于本文件夹，Trae / deepseek-harness / 各 agent 通过 CLI 或 MCP server 薄接入，
升级只改此处，避免各处进度分叉。策略一律声明化（guardrail.yml），每修一个 bug 固化一条断言。
"""

__version__ = "0.1.0"