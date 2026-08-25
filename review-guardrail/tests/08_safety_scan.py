"""断言8: 外部插件安全评审闸——block_on 命中必须阻塞，杜绝恶意插件混过门禁。

每次给安全网关打补丁/调宽松 block_on，这里都有对应断言兜底，防止：
  1. 恶意插件(子进程/原型污染/eval)却判 clean；
  2. 无信任记录的插件被激活；
  3. 信任级被静默降档越过 required。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from review_guardrail import safety  # noqa: E402
from review_guardrail.engine import Config, SafetyConfig, TrustConfig  # noqa: E402

_BLOCK_ON = ["child_process", "eval_code", "prototype_pollution", "shell_meta"]


def _cfg(tmp: str, executor: str = "static") -> Config:
    return Config(
        version="t",
        review=None,  # type: ignore[arg-type]  # safety 独立于 review 运行
        gate=None,  # type: ignore[arg-type]
        assertions=None,  # type: ignore[arg-type]
        github=None,  # type: ignore[arg-type]
        loop=None,  # type: ignore[arg-type]
        safety=SafetyConfig(enabled=True, focus_exts=(".ts", ".js"), block_on=_BLOCK_ON,
                            allow_list=["fs_write"], executor=executor, node_bin="", timeout_ms=3000),
        trust=TrustConfig(enabled=True, file="safety_trust.json", required="verified",
                          dirty_on_change=True),
    )


def _write(tmp: str, name: str, code: str) -> str:
    p = Path(tmp) / name
    p.write_text(code, encoding="utf-8")
    return str(p)


with tempfile.TemporaryDirectory() as tmp:
    # 恶意插件：子进程 + 原型污染 → blocked
    _write(tmp, "malware.ts", 'const cp = require("child_process");\ncp.exec("rm -rf /");')
    _write(tmp, "pwn.ts", "globalThis.__proto__ = process.env;")
    assert safety.scan_dir(Path(tmp), _cfg(tmp)).verdict == "blocked", "恶意能力未阻塞"

with tempfile.TemporaryDirectory() as tmp:
    # 干净插件：fs_write 在白名单 → clean
    _write(tmp, "ok.ts", "import fs from 'node:fs';\nfs.writeFileSync('/tmp/x', '1');")
    assert safety.scan_dir(Path(tmp), _cfg(tmp)).verdict == "clean", "白名单能力被误阻"

with tempfile.TemporaryDirectory() as tmp:
    # 未知能力(网络)不在 allow_list 也不在 block_on 子集之外 → 本配置网络不在 block_on，判 warning
    _write(tmp, "net.ts", "fetch('https://evil.example');")
    assert safety.scan_dir(Path(tmp), _cfg(tmp)).verdict == "warning", "未知能力应判 warning"

# 信任门：无记录 blocked；verified OK；verified+dirty blocked；低于 required(verified) 的 blocked 级 blocked
cfg = _cfg(".")
assert safety.evaluate_plugin_trust(cfg, "NONEXIST") == (False, "无信任记录(视为 blocked)")
null_record_levels = ["verified", "trusted"]
for lvl in null_record_levels:
    rec = safety.TrustRecord(level=lvl, updated_at="2000-01-01T00:00:00+00:00", signature="")
    rec.signature = safety.signature_of(rec)
    assert rec.meets("verified"), f"{lvl} 应满足 verified"
    rec.dirty = True
    assert not rec.meets("verified"), "dirty 不得激活"

print("PASS 08_safety_scan")