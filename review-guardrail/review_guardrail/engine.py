"""配置加载与校验、数据模型、严重度门禁判定、评审编排。

本文件承载“同功能步骤合一”的核心：配置(guardrail.yml 声明化) + 模型 + 门禁判定 + 一条
求证编排 run_review。路线(route)与前后端(adapter)都通过配置参数控制，便于折中参考，
核心逻辑只有一份，避免各处重复实现导致进度分叉。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any

SEVERITIES = ("critical", "warning", "info")
CATEGORIES = ("security", "bug", "quality", "performance")

# 默认评审角色 prompt（声明化，可在 guardrail.yml 覆盖；{role}/{priority}/{payload} 为注入点）
DEFAULT_SYSTEM_PROMPT = (
    "你是{role}。只评审下面真实 diff 的新增行（只读 + 新增行，不看未改动老代码）。"
    "按优先级检查：{priority}。逐条给出行级结论并落严重度，不编造 diff 里不存在的问题。"
)
DEFAULT_USER_PROMPT = (
    "逐条给出行级结论，严重度 critical / warning / info。只输出一个 JSON 数组，"
    "不要任何其他文字或格式，每一项结构严格为："
    '{"file": str, "line_start": int, "line_end": int, '
    '"severity": "critical|warning|info", "category": "security|bug|quality|performance", '
    '"message": str, "suggestion": str}。若没有发现问题，只输出空数组 []。'
    "评审对象（文件 → 新增行）:\n{payload}"
)
DEFAULT_FEEDBACK_MESSAGE = (
    "评审→修复已达上限，自动修复已停止。需要人工介入：调整需求 / 修改框架 / 收紧评审标准，"
    "而不是继续盲修。"
)


# ---------- 配置：声明化策略（guardrail.yml） ----------

def _scalar(value: str) -> Any:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1].strip()
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if value.lower() in ("null", "none"):
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    return value


def parse_config(text: str) -> dict[str, Any]:
    """解析本项目固定 schema 的缩进型 YAML 子集（字典 + 标量列表 + 标量 + 块标量 + 行内注释）。

    块标量（``key: |`` / ``key: |-``）把后续更深缩进的连续行拼成多行字符串（去公共缩进，
    ``|-`` 再去末尾换行）。块内不支持空行与 ``#``（首轮过滤已删除），prompt 写作时请避让。
    只覆盖 guardrail.yml 用到的有限结构；缩进/未知结构解析错误会抛出（fail loud），
    字段合法性由各 *Config.from_dict 兜底校验。
    """
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if line.strip():
            lines.append(line)

    def emit(start: int, indent: int) -> tuple[dict[str, Any], int]:
        result: dict[str, Any] = {}
        i = start
        last_key: str | None = None
        list_key: str | None = None
        while i < len(lines):
            line = lines[i]
            content = line.strip()
            cur = len(line) - len(line.lstrip(" "))
            if cur < indent:
                break
            if content.startswith("- "):
                value = _scalar(content[2:])
                if list_key is None:
                    list_key = last_key
                    if list_key is None or list_key not in result:
                        raise ValueError(f"列表前没有键: {line!r}")
                    result[list_key] = []
                result[list_key].append(value)
                i += 1
                continue
            if ":" not in content:
                raise ValueError(f"无法解析的行: {line!r}")
            key, _, val = content.partition(":")
            key = key.strip()
            val = val.strip()
            list_key = None
            last_key = key
            if val == "":
                if i + 1 < len(lines) and lines[i + 1].strip().startswith("- "):
                    lst: list[Any] = []
                    j = i + 1
                    while j < len(lines):
                        lc = lines[j].strip()
                        if len(lines[j]) - len(lines[j].lstrip(" ")) > cur and lc.startswith("- "):
                            lst.append(_scalar(lc[2:]))
                            j += 1
                        else:
                            break
                    result[key] = lst
                    i = j
                else:
                    child, i = emit(i + 1, cur + 1)
                    result[key] = child
            elif val in ("|", "|-"):
                block: list[str] = []
                j = i + 1
                while j < len(lines):
                    if len(lines[j]) - len(lines[j].lstrip(" ")) <= cur:
                        break
                    block.append(lines[j])
                    j += 1
                indents = [len(b) - len(b.lstrip(" ")) for b in block if b.strip()]
                dedent = min(indents) if indents else 0
                text = "\n".join(b[dedent:] if b.strip() else "" for b in block)
                if val == "|-":
                    text = text.rstrip("\n")
                result[key] = text
                i = j
            else:
                result[key] = _scalar(val)
                i += 1
        return result, i

    parsed, _ = emit(0, 0)
    return parsed


def fill_template(template: str, **values: Any) -> str:
    """安全替换 {token} 占位符：只替换已知 token，其余花括号（如 JSON 结构示例）原样保留。

    不使用 str.format()，因为 user_prompt 里含 JSON 结构字面量（{、}），format 会误解析。
    """
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


@dataclass
class ReviewConfig:
    route: str
    adapter: str
    priority: list[str]
    exclude_files: list[str]            # 正则，文件名全匹配
    only_added_lines: bool
    role: str                           # 评审角色名（对应云端 npc:go 的 role）
    system_prompt: str                  # 声明化评审系统提示词
    user_prompt: str                    # 声明化评审用户提示词（含 {payload} 注入点）

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ReviewConfig":
        allowed = {"adapter", "route", "priority", "file_filter", "only_added_lines",
                   "role", "system_prompt", "user_prompt"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"review 节含未知字段: {sorted(unknown)}")
        adapter = raw.get("adapter", "dsh")
        if adapter not in ("dsh", "pr-agent"):
            raise ValueError("review.adapter 必须是 dsh 或 pr-agent")
        route = raw.get("route", "llm")
        if route not in ("llm", "static", "hybrid"):
            raise ValueError("review.route 必须是 llm / static / hybrid")
        ff = raw.get("file_filter") or {}
        prio = raw.get("priority") or ["security", "bug", "quality", "performance"]
        if not isinstance(prio, list) or not prio:
            raise ValueError("review.priority 必须是非空列表")
        return cls(
            route=route,
            adapter=adapter,
            priority=prio,
            exclude_files=ff.get("exclude") or [],
            only_added_lines=bool(raw.get("only_added_lines", True)),
            role=str(raw.get("role", "代码审查员")),
            system_prompt=str(raw.get("system_prompt", DEFAULT_SYSTEM_PROMPT)),
            user_prompt=str(raw.get("user_prompt", DEFAULT_USER_PROMPT)),
        )


@dataclass
class GateConfig:
    max_critical: int
    max_warning: int
    max_info: int
    verdict_gate: str                    # 达到该严重度即打回: critical / needs_modification
    merge_requires: str                  # merged 前置要求: approved

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "GateConfig":
        allowed = {"max_critical", "max_warning", "max_info", "verdict_gate", "merge_requires"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"gate 节含未知字段: {sorted(unknown)}")
        # 只校验显式给出的字段；缺省时走下方默认值，否则空 gate 节也会被误拒
        if "verdict_gate" in raw and raw.get("verdict_gate") not in ("critical", "needs_modification"):
            raise ValueError("gate.verdict_gate 必须是 critical 或 needs_modification")
        if "merge_requires" in raw and raw.get("merge_requires") != "approved":
            raise ValueError("gate.merge_requires 当前仅支持 approved")
        return cls(
            max_critical=int(raw.get("max_critical", 0)),
            max_warning=int(raw.get("max_warning", 3)),
            max_info=int(raw.get("max_info", 10)),
            verdict_gate=raw.get("verdict_gate", "needs_modification"),
            merge_requires=raw.get("merge_requires", "approved"),
        )


@dataclass
class AssertionsConfig:
    enabled: bool
    dir: str
    fail_fast: bool
    suffixes: tuple[str, ...]

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "AssertionsConfig":
        allowed = {"enabled", "dir", "fail_fast", "suffixes"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"assertions 节含未知字段: {sorted(unknown)}")
        return cls(
            enabled=bool(raw.get("enabled", True)),
            dir=raw.get("dir", "tests"),
            fail_fast=bool(raw.get("fail_fast", False)),
            suffixes=tuple(raw.get("suffixes") or [".py", ".sh"]),
        )


@dataclass
class GithubConfig:
    squash: bool                        # 自动合并方式：squash
    delete_branch: bool                 # 合并后删除源分支（对应云端 git:auto-merge）
    reviewers: list[str]                # 自动分配评审人（空 = 不自动分配）

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "GithubConfig":
        allowed = {"squash", "delete_branch", "reviewers"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"github 节含未知字段: {sorted(unknown)}")
        return cls(
            squash=bool(raw.get("squash", True)),
            delete_branch=bool(raw.get("delete_branch", True)),
            reviewers=list(raw.get("reviewers") or []),
        )


@dataclass
class LoopConfig:
    max_rounds: int                     # 评审→修复最多 N 轮，达上限停止自动修复
    state_dir: str                      # 闭环状态/产物目录（相对配置文件所在目录）
    feedback_message: str               # 超限后写给人类的反馈文案

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "LoopConfig":
        allowed = {"max_rounds", "state_dir", "feedback_message"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"loop 节含未知字段: {sorted(unknown)}")
        max_rounds = int(raw.get("max_rounds", 10))
        if max_rounds < 1:
            raise ValueError("loop.max_rounds 至少为 1")
        return cls(
            max_rounds=max_rounds,
            state_dir=raw.get("state_dir", "data/review_loop"),
            feedback_message=str(raw.get("feedback_message", DEFAULT_FEEDBACK_MESSAGE)),
        )


@dataclass
class SafetyConfig:
    """外部插件安全评审闸：扫描粒度、block/allow 清单、沙箱预跑执行器。

    视图:外部拉取的插件视为完全不可信。扫描命中的能力(白名单允许的除外)必须全部
    落在 allow 清单才判干净；命中了 block_on 里的任意一项即直接打回(blocked)。
    """
    enabled: bool
    focus_exts: tuple[str, ...]        # 只扫描这些源码扩展名
    block_on: list[str]                # 命中即 blocked 的能力 id
    allow_list: list[str]              # 允许、不阻塞的能力 id
    executor: str                      # 预跑路线: static | node
    node_bin: str                      # 沙箱预跑用的 node 可执行；空 => 从 PATH 探测
    timeout_ms: int                    # node 沙箱预跑超时

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SafetyConfig":
        allowed = {"enabled", "focus_exts", "block_on", "allow_list",
                   "executor", "node_bin", "timeout_ms"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"safety 节含未知字段: {sorted(unknown)}")
        executor = raw.get("executor", "static")
        if executor not in ("static", "node"):
            raise ValueError("safety.executor 必须是 static 或 node")
        return cls(
            enabled=bool(raw.get("enabled", True)),
            focus_exts=tuple(raw.get("focus_exts") or [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]),
            block_on=list(raw.get("block_on") or ["child_process", "eval_code", "network"]),
            allow_list=list(raw.get("allow_list") or []),
            executor=executor,
            node_bin=str(raw.get("node_bin") or ""),
            timeout_ms=int(raw.get("timeout_ms", 5000)),
        )


@dataclass
class TrustConfig:
    """信任标记：插件必须达到最低信任级才允许激活；改动后降级为 dirty 需重新评审。"""
    enabled: bool
    file: str                          # 信任记录文件名（相对配置文件所在目录）
    required: str                      # 进入激活所需最低信任级: verified | trusted
    dirty_on_change: bool

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "TrustConfig":
        allowed = {"enabled", "file", "required", "dirty_on_change"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"trust 节含未知字段: {sorted(unknown)}")
        required = raw.get("required", "verified")
        if required not in ("verified", "trusted"):
            raise ValueError("trust.required 必须是 verified 或 trusted")
        return cls(
            enabled=bool(raw.get("enabled", True)),
            file=str(raw.get("file", "safety_trust.json")),
            required=required,
            dirty_on_change=bool(raw.get("dirty_on_change", True)),
        )


@dataclass
class Config:
    version: str
    review: ReviewConfig
    gate: GateConfig
    assertions: AssertionsConfig
    github: GithubConfig
    loop: LoopConfig
    safety: SafetyConfig
    trust: TrustConfig

    @classmethod
    def load(cls, path: str) -> "Config":
        with open(path, encoding="utf-8") as handle:
            return cls.from_mapping(parse_config(handle.read()))

    @classmethod
    def from_mapping(cls, raw: dict[str, Any]) -> "Config":
        allowed = {"version", "review", "gate", "assertions", "github", "loop", "safety", "trust"}
        unknown = set(raw) - allowed
        if unknown:
            raise ValueError(f"guardrail.yml 顶层含未知字段: {sorted(unknown)}")
        return cls(
            version=str(raw.get("version")),
            review=ReviewConfig.from_dict(raw.get("review") or {}),
            gate=GateConfig.from_dict(raw.get("gate") or {}),
            assertions=AssertionsConfig.from_dict(raw.get("assertions") or {}),
            github=GithubConfig.from_dict(raw.get("github") or {}),
            loop=LoopConfig.from_dict(raw.get("loop") or {}),
            safety=SafetyConfig.from_dict(raw.get("safety") or {}),
            trust=TrustConfig.from_dict(raw.get("trust") or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------- 模型 ----------

@dataclass
class Finding:
    file: str
    line_start: int
    line_end: int
    severity: str           # critical / warning / info
    category: str           # security / bug / quality / performance
    message: str
    suggestion: str = ""


@dataclass
class Report:
    findings: list[Finding]
    verdict: str            # passed / needs_modification / critical

    def counts(self) -> dict[str, int]:
        return {s: sum(1 for f in self.findings if f.severity == s) for s in SEVERITIES}


@dataclass
class LoopState:
    """修复闭环的持久化状态：轮次计数与历史，跨调用存活，避免云端“轮次靠人记”丢失。"""
    pr: str
    round: int = 0
    history: list[dict] = field(default_factory=list)   # [{round, verdict, counts}, ...]
    feedback: bool = False                              # 已达上限已反馈人类

    def to_dict(self) -> dict[str, Any]:
        return {"pr": self.pr, "round": self.round, "history": self.history, "feedback": self.feedback}

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "LoopState":
        return cls(
            pr=str(raw.get("pr", "")),
            round=int(raw.get("round", 0)),
            history=list(raw.get("history") or []),
            feedback=bool(raw.get("feedback", False)),
        )


# ---------- 严重度门禁判定 ----------

def classify_verdict(findings: list[Finding], gate: GateConfig) -> str:
    """门禁判定。critical 超过上限 → critical；否则 warning/info 超限 → needs_modification；否则 passed。"""
    counts = {s: sum(1 for f in findings if f.severity == s) for s in SEVERITIES}
    if counts["critical"] > gate.max_critical:
        return "critical"
    if gate.verdict_gate == "critical" and counts["critical"] > 0:
        return "critical"
    if counts["warning"] > gate.max_warning:
        return "needs_modification"
    if counts["info"] > gate.max_info:
        return "needs_modification"
    return "passed"


# ---------- 编排 ----------

def run_review(
    cfg: Config,
    added_lines: dict[str, list[tuple[int, str]]],
    review_fn: Any,
) -> Report:
    """统一编排：对过滤后的新增行跑评审后端，做门禁判定，返回报告。

    review_fn(added_lines, cfg) -> list[Finding]，由具体后端（llm/static/hybrid）实现。
    """
    findings = review_fn(added_lines, cfg)
    verdict = classify_verdict(findings, cfg.gate)
    return Report(findings=findings, verdict=verdict)


def filter_added(
    added_lines: dict[str, list[tuple[int, str]]],
    cfg: Config,
) -> dict[str, list[tuple[int, str]]]:
    """把策略里 exclude_files 的正则套到文件名上，剔除 lock/产物/文档等非评审对象。"""
    patterns = [re.compile(p) for p in cfg.review.exclude_files]
    result: dict[str, list[tuple[int, str]]] = {}
    for path, lines in added_lines.items():
        if any(p.search(path) for p in patterns):
            continue
        if lines:
            result[path] = lines
    return result