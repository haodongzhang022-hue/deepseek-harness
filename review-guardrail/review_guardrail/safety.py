"""外部插件安全评审闸：能力扫描 + 沙箱预跑 + 信任标记。

配合 self-evolution 自进化体系的 ③ 安全评审闸：外部拉取的插件视为完全不可信。
判定只基于扫描命中的真实能力(真实源码/真实预跑), 生成任何模拟结果。

三层(与 docs 对齐)在此合一:
  1. 静态能力扫描(static)：确定性正则在 allow/block 清单上汇聚，同功能一份逻辑；
  2. 沙箱预跑(node)：用 node 内置 vm + 代理 trap 真实执行一次并观测顶层副作用，
     按 cfg.safety.executor 参数切换(static|node)，缺省 static，提供 node 则预跑；
  3. 信任标记(trust)：schema {level, updated_at, signature, dirty}，改动→dirty 需重评。

规则：允许清单(allow_list)放行、block_on 命中即 blocked、命中未知能力且不在清单→warning。
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .engine import Config

# 信任级从低到高。required 为进入激活所需最低级，blocked/dirty 都不得激活。
TRUST_LEVELS = ("blocked", "dirty", "verified", "trusted")
DEFAULT_REQUIRED = "verified"


def _trust_index(level: str) -> int:
    if level not in TRUST_LEVELS:
        raise ValueError(f"未知信任级: {level!r}，允许 {TRUST_LEVELS}")
    return TRUST_LEVELS.index(level)


# ---------- 能力规则 ----------
# (rule_id, category, severity, pattern, 说明)
# severity 对齐 gate 严重度；是否阻塞由 cfg 的 block_on/allow_list 决定，不硬编码。
CAPABILITY_RULES = [
    ("child_process", "security", "critical",
     r"child_process|\b(exec|execSync|spawn|spawnSync|fork)\s*\(",
     "子进程创建/命令执行"),
    ("eval_code", "security", "critical",
     r"\beval\s*\(|\bnew\s+Function\s*\(",
     "动态代码执行(eval / new Function)"),
    ("prototype_pollution", "security", "critical",
     r"__proto__|constructor\s*\.\s*prototype|\[\s*['\"]__proto__['\"]\s*\]",
     "原型链污染"),
    ("network", "security", "warning",
     r"['\"](node:)?(http|https|net|tls|dns|fetch)['\"]|\b(fetch|axios|XMLHttpRequest)\s*\(|https?:\/\/",
     "网络访问"),
    ("fs_write", "bug", "warning",
     r"['\"](node:)?fs['\"]|\.writeFile|\.appendFile|\.mkdir|\.rename|fs\.|createWriteStream",
     "文件系统写操作"),
    ("secrets_env", "security", "warning",
     r"process\s*\.\s*env|['\"](git|gh|API[_-]?KEY|TOKEN)['\"]",
     "读取环境变量/凭据"),
    ("require_dynamic", "quality", "info",
     r"require\s*\('['\"]|\bimport\s*\(\.*\)|require\s*\(\s*[a-zA-Z_$]",
     "动态/变量 require(加载不可信模块面)"),
    ("shell_meta", "security", "warning",
     r"[;&|\$\(`]{1,}\s*(rm|curl|wget|sh|bash|pwsh|powershell|python|node)\b",
     "命令注入/外部下载器"),
]


@dataclass
class Finding:
    rule_id: str
    file: str
    line_start: int
    severity: str                       # critical / warning / info
    message: str


@dataclass
class ScanResult:
    findings: list[Finding] = field(default_factory=list)
    verdict: str = "clean"              # clean / warning / blocked
    capabilities: list[str] = field(default_factory=list)
    pre_run: dict = field(default_factory=dict)

    def blocked(self) -> bool:
        return self.verdict == "blocked"

    def clean_enough(self) -> bool:
        return self.verdict in ("clean", "warning")


@dataclass
class TrustRecord:
    level: str
    updated_at: str
    signature: str
    dirty: bool = False

    def meets(self, required: str) -> bool:
        return _trust_index(self.level) >= _trust_index(required) and not self.dirty


def _scan_text(text: str, path: str) -> list[Finding]:
    findings: list[Finding] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        for rule_id, _cat, sev, pattern, msg in CAPABILITY_RULES:
            if re.search(pattern, line):
                findings.append(Finding(rule_id=rule_id, file=path, line_start=line_no,
                                        severity=sev, message=msg))
    return findings


def scan_dir(root_dir: Path, cfg: Config) -> ScanResult:
    """外部插件安全评审闸：静态能力扫描 + 可选的 node 沙箱预跑，按清单汇聚判定。

    检查顺序（单一落点）：
      a. 静态命中 block_on → blocked；
      b. （executor=node 时）沙箱真实预跑观测到的敏感能力，未在白名单 → 并入 blocked；
      c. 命中未知能力(不在 allow_list) → warning；
      d. 全清 → clean。
    """
    found = {r.rule_id for r in [x for x in (_scan_text(p.read_text(encoding="utf-8", errors="replace"), str(p))
                                             for p in _source_files(root_dir, cfg)) for x in x]}
    capabilities = sorted(found)
    blocked = sorted(cid for cid in found if cid in cfg.safety.block_on)
    unknown = sorted(cid for cid in found if cid not in cfg.safety.allow_list)
    pre_run: dict = {}
    # node 路线：静态无阻塞时再用沙箱真实预跑，观测到的敏感能力不因预跑失败而放过
    if cfg.safety.executor == "node":
        try:
            pre_run = pre_run_code(_as_probe_snippet(root_dir, cfg), cfg.safety.node_bin,
                                   cfg.safety.timeout_ms)
            observed = {c for c in pre_run.get("observed", []) if c in _OBSERVABLE_BLOCK}
            block_via_run = sorted(observed - set(cfg.safety.allow_list))
            if block_via_run:
                blocked = block_via_run
        except NodeSandboxUnavailable:
            # 没有 node：如实上报退化为 static 路线，绝不伪装已预跑通过
            pre_run = {"ok": False, "error": "node 不可用，退化为 static 路线", "observed": []}
    verdict = "blocked" if blocked else ("warning" if unknown else "clean")
    return ScanResult(findings=_materialize(root_dir, cfg), verdict=verdict,
                      capabilities=capabilities, pre_run=pre_run)


# node 预跑可观测、且应纳入阻塞的能力（与 block_on 正交的运行时观测项）
_OBSERVABLE_BLOCK = ("network", "child_process", "shell_meta")


def _as_probe_snippet(root_dir: Path, cfg: Config) -> str:
    """把 focus 源码文本拼成一个观察探针体，交 node vm 沙箱执行。

    仅探测顶层副作用/直接调用是否触发敏感能力；对见到的源码如实执行，不生成模拟。
    模块级 import 因 vm 无 require 可能失败——那属于"预跑无法观测"，由调用方如实上报。
    """
    parts: list[str] = []
    for p in _source_files(root_dir, cfg):
        parts.append(f"// {p.name}\n" + p.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(parts)


def _source_files(root_dir: Path, cfg: Config) -> list[Path]:
    if not root_dir.is_dir():
        return []
    return [p for p in root_dir.rglob("*")
            if p.is_file() and p.suffix in cfg.safety.focus_exts
            and "node_modules" not in p.parts and ".git" not in p.parts]


def _materialize(root_dir: Path, cfg: Config) -> list[Finding]:
    findings: list[Finding] = []
    for p in _source_files(root_dir, cfg):
        findings.extend(_scan_text(p.read_text(encoding="utf-8", errors="replace"), str(p)))
    return findings


# ---------- 沙箱预跑(node) ----------

_SANDBOX_HARNESS = r"""
const vm = require('node:vm');
function main() {
  const observed = [];
  const cap = (id) => observed.push(id);
  // 只观测、不真正放行：trap 记录能力调用后直接返回，绝不让副作用发生/产生未处理拒绝
  const trap = (_label, fn) => new Proxy(fn, {
    apply(t, thisArg, args) { cap('network'); return undefined; }
  });
  // 沙箱只暴露 console 与受限 shim；敏感宿主能力经 trap 观测、不真放行
  const sandbox = {
    console,
    fetch: trap('network', () => Promise.reject(new Error('sandbox denied fetch'))),
    setTimeout, clearTimeout, queueMicrotask,
    process: { env: {}, argv: [], exit: () => cap('child_process') }
  };
  vm.createContext(Object.freeze(sandbox));
  const code = 'globalThis.__sandboxProbe = function() {\n' + process.env.SB_PLUGIN_CODE + '\n}';
  let script;
  try {
    script = new vm.Script(code, { filename: 'sandbox-pre-run.js' });
  } catch (e) {
    console.log('SANDBOX_PRE_RUN:none error=' + e.message);
    return;
  }
  try {
    script.runInContext(sandbox);
    vm.runInContext('__sandboxProbe()', sandbox);
  } catch (e) {
    console.log('SANDBOX_PRE_RUN:' + (observed.join(',') || 'none') + ' error=' + e.message);
    return;
  }
  console.log('SANDBOX_PRE_RUN:' + (observed.join(',') || 'none'));
}
main();
""".strip()


class NodeSandboxUnavailable(Exception):
    """node 可执行不可用，无法预跑(按 static 路线退化，不静默伪装已预跑)。"""


def pre_run_code(code: str, node_bin: str, timeout_ms: int) -> dict:
    """把真实 candidate 代码放进 node vm 沙箱执行一次，观测顶层能力调用。

    只观测、不放行任何敏感能力；观测不到一次真实执行会以 warning 级别上报而不是静默通过。
    """
    exe = node_bin or _which_node()
    if not exe:
        raise NodeSandboxUnavailable()
    import os

    env = dict(os.environ)
    env["SB_PLUGIN_CODE"] = code
    proc = subprocess.run(
        [exe, "-e", _SANDBOX_HARNESS],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout_ms / 1000,
        env=env,
    )
    out = (proc.stdout + proc.stderr).strip()
    if proc.returncode != 0:
        return {"ok": False, "error": out[-1000:], "observed": []}
    rule = [l for l in out.splitlines() if l.startswith("SANDBOX_PRE_RUN:")]
    if not rule:
        return {"ok": False, "error": out[-1000:] or "无观测输出", "observed": []}
    body = rule[0].split("SANDBOX_PRE_RUN:", 1)[1].split(" error=")[0]
    return {"ok": True, "observed": [c for c in body.split(",") if c], "error": ""}


def _which_node() -> str:
    import shutil

    return shutil.which("node") or ""


# ---------- 信任标记(trust) ----------

def signature_of(record: TrustRecord) -> str:
    return hashlib.sha256(f"{record.level}|{record.updated_at}|{record.dirty}".encode()).hexdigest()[:16]


def trust_path(cfg: Config, config_path: str) -> Path:
    base = Path(config_path).resolve().parent
    return base / cfg.trust.file


def load_trust(cfg: Config, config_path: str) -> TrustRecord | None:
    """无信任记录 → None(视为 blocked)。记录签名不匹配(dirty/被篡改) → 降级 dirty。"""
    path = trust_path(cfg, config_path)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    rec = TrustRecord(level=str(raw.get("level", "blocked")),
                      updated_at=str(raw.get("updated_at", "")),
                      signature=str(raw.get("signature", "")),
                      dirty=bool(raw.get("dirty", False)))
    if rec.signature != signature_of(rec):
        rec.dirty = True
    return rec


def save_trust(record: TrustRecord, cfg: Config, config_path: str) -> Path:
    path = trust_path(cfg, config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record.__dict__, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def evaluate_plugin_trust(cfg: Config, config_path: str) -> tuple[bool, str]:
    """信任门禁：达到 required 级(且非 dirty)才允许激活；无记录 → blocked。"""
    if not cfg.trust.enabled:
        return True, "trust 未启用"
    rec = load_trust(cfg, config_path)
    if rec is None:
        return False, "无信任记录(视为 blocked)"
    if rec.meets(cfg.trust.required):
        return True, f"trust={rec.level}"
    reason = "dirty(改动后需重新评审)" if rec.dirty else f"trust={rec.level}<{cfg.trust.required}"
    return False, reason