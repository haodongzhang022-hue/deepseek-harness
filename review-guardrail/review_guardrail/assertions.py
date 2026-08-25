"""信号灯断言运行器：逐个跑 tests/ 下的护栏脚本，红灯即阻塞。

“每修一个 bug 固化一条断言”是稳定生效的根基：断言越多机制越牢。脚本默认按数字前缀排序，
支持 .py（跨平台、确定性）与 .sh（CI runner/类 CNB 风格）；fail_fast 中止余下。
"""
from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .engine import Config


@dataclass
class AssertionResult:
    name: str
    passed: bool
    output: str = ""


@dataclass
class AssertionRun:
    results: list[AssertionResult] = field(default_factory=list)

    def all_passed(self) -> bool:
        return bool(self.results) and all(r.passed for r in self.results)


def discover(tests_dir: Path, cfg: Config) -> list[Path]:
    if not cfg.assertions.enabled:
        return []
    if not tests_dir.is_dir():
        return []
    scripts = [
        p
        for p in tests_dir.iterdir()
        if p.is_file() and p.name.startswith(("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"))
        and p.suffix in cfg.assertions.suffixes
    ]
    return sorted(scripts, key=lambda p: p.name)


def run_all(tests_dir: Path, cfg: Config) -> AssertionRun:
    run = AssertionRun()
    for script in discover(tests_dir, cfg):
        passed, output = _run_one(script)
        run.results.append(AssertionResult(name=script.name, passed=passed, output=output))
        if cfg.assertions.fail_fast and not passed:
            break
    return run


def _run_one(script: Path) -> tuple[bool, str]:
    if script.suffix == ".py":
        proc = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
    else:  # .sh
        proc = subprocess.run(
            ["sh", str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
    tail = (proc.stdout + proc.stderr).strip()
    return proc.returncode == 0, tail[-2000:]