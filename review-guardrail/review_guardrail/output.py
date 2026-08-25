"""输出渲染：findings → 行级评论块 / 控制台表格 / JSON 报告。"""
from __future__ import annotations

import json

from .engine import Report

_VERDICT_LABEL = {"passed": "PASSED", "needs_modification": "NEEDS_MODIFICATION", "critical": "CRITICAL"}


def render_text(report: Report) -> str:
    lines = [f"verdict: {_VERDICT_LABEL.get(report.verdict, report.verdict)}"]
    counts = report.counts()
    lines.append(
        f"critical={counts['critical']} warning={counts['warning']} info={counts['info']}"
    )
    ordered = sorted(report.findings, key=lambda f: (f.file, f.line_start))
    current = None
    for f in ordered:
        if f.file != current:
            lines.append(f"\n[{f.file}]")
            current = f.file
        lines.append(
            f"  {f.line_start}-{f.line_end} {f.severity}/{f.category}: {f.message}"
        )
        if f.suggestion:
            lines.append(f"      -> {f.suggestion}")
    return "\n".join(lines)


def render_json(report: Report) -> str:
    return json.dumps(
        {
            "verdict": report.verdict,
            "counts": report.counts(),
            "findings": [
                {
                    "file": f.file,
                    "line_start": f.line_start,
                    "line_end": f.line_end,
                    "severity": f.severity,
                    "category": f.category,
                    "message": f.message,
                    "suggestion": f.suggestion,
                }
                for f in report.findings
            ],
        },
        ensure_ascii=False,
        indent=2,
    )


def render_pr_comment(report: Report, role: str) -> str:
    """渲染成可直接发到 PR 评论的 Markdown 评审结论（对应云端 npc:go 的 PR 评论输出）。"""
    counts = report.counts()
    lines = [
        f"## 代码审查（{role}）",
        "",
        f"**结论**: {_VERDICT_LABEL.get(report.verdict, report.verdict)}",
        f"critical={counts['critical']} warning={counts['warning']} info={counts['info']}",
        "",
    ]
    if not report.findings:
        lines.append("未发现需要修改的问题。")
        return "\n".join(lines)
    lines.append("### 需修改点")
    ordered = sorted(report.findings, key=lambda f: (f.file, f.line_start))
    current = None
    for f in ordered:
        if f.file != current:
            lines.append(f"\n**{f.file}**")
            current = f.file
        lines.append(f"- `{f.line_start}-{f.line_end}` [{f.severity}/{f.category}] {f.message}")
        if f.suggestion:
            lines.append(f"  - 建议: {f.suggestion}")
    return "\n".join(lines)


def render_fix_instructions(report: Report, round_no: int, max_rounds: int) -> str:
    """渲染成修复闭环给 agent 的指令：默认直接改 + 轮次护栏说明。"""
    lines = [
        f"## 评审打回 · 自动修复指令（第 {round_no}/{max_rounds} 轮）",
        "",
        "评审未通过，请默认直接修复下列问题并重新提交，不要反复询问。",
        f"本轮已计入修复闭环：第 {round_no} 轮，最多 {max_rounds} 轮。",
        "每修复一个点尽量补一条测试断言，防止回退。",
        "",
    ]
    for f in sorted(report.findings, key=lambda x: (x.file, x.line_start)):
        lines.append(f"- [{f.severity}/{f.category}] `{f.file}:{f.line_start}-{f.line_end}` {f.message}")
        if f.suggestion:
            lines.append(f"  - 建议: {f.suggestion}")
    return "\n".join(lines)