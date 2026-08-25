"""内置静态检测器：对真实新增行做保守的正则/模式检测。

只用作 llm 之外的折中参考路线（route=static）或 hybrid 中的补充层。检测项均为可复制、
文档化的确定性规则，产出真实命中，不生成任何模拟 finding。
"""
from __future__ import annotations

import re

from ..engine import Config, Finding

# (类别, 严重度, 命名, 正则, message, suggestion)
_DETECTORS = [
    (
        "hardcoded_secret",
        "security",
        "warning",
        re.compile(r"(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['\"][^'\"]{6,}['\"]"),
        "硬编码密钥/口令写入源码",
        "改用凭据引用（env / credentials provider），不要把机密字面量提交进仓库",
    ),
    (
        "mock_or_placeholder",
        "quality",
        "info",
        re.compile(r"\b(mock|stub|fake|placeholder|dummy|sample data)\b", re.IGNORECASE),
        "出现 mock / 占位实现",
        "确认是否为临时测试桩；正式逻辑需使用唯一事实库真实数据，禁止用模拟数据污染",
    ),
    (
        "silent_exception",
        "bug",
        "warning",
        re.compile(r"except\b[^:]*:\s*$|except\b[^:]*:\s*pass\s*$"),
        "异常被静默吞掉",
        "空 catch 需命名被吞掉的是什么并说明为何不可能落到此处；否则应传播或记日志",
    ),
    (
        "todo_marker",
        "quality",
        "info",
        re.compile(r"\b(TODO|FIXME|XXX)\b"),
        "遗留 TODO / FIXME",
        "在合并前补全或登记为独立 issue，避免未完成逻辑被带进主干",
    ),
    (
        "debug_print",
        "quality",
        "info",
        re.compile(r"\bprint\s*\("),
        "疑似调试用 print，出现在非测试上下文",
        "确认是否需要保留；调试输出应走日志而非 stdout",
    ),
]


def run(added_lines: dict[str, list[tuple[int, str]]], cfg: Config) -> list[Finding]:
    findings: list[Finding] = []
    for path, lines in added_lines.items():
        for line_no, text in lines:
            for _name, category, severity, pattern, message, suggestion in _DETECTORS:
                if pattern.search(text):
                    findings.append(
                        Finding(
                            file=path,
                            line_start=line_no,
                            line_end=line_no,
                            severity=severity,
                            category=category,
                            message=message,
                            suggestion=suggestion,
                        )
                    )
    return findings