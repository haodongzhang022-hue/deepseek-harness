"""经验库核心：Case→经验→SQLite(FTS5)→镜像，单点一份逻辑，纯标准库。

设计：声明化策略(experience.yml) + 唯一事实库(SQLite) + 测试护栏。无任何第三方依赖，
不依赖 deepseek-harness / review-guardrail，可独立安装、独立开源。

规则：
  - 经验新版本永远最高权重(recency)，旧经验保留但不作直接参考；
  - 行与其镜像文档共用同一 created_ts(统一时间戳)，保证时间序列一致；
  - 仅接受真实、达到最低置信度的经验；没有就 fail loud，禁止模拟数据。
"""
from __future__ import annotations

import datetime as _dt
import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

DEFAULT_POLICY = {
    "version": "0.3.0",
    "store": {"db": "data/experiences.db", "table": "experiences",
              "fts_table": "experiences_fts", "ts_fmt": "%Y-%m-%dT%H:%M:%S%z"},
    "distill": {"min_confidence": 0.30, "promote_after_uses": 3},
    "rank": {"confidence": 0.4, "recency": 0.3, "usage": 0.3, "top_k": 5},
    "mirror": {"file": "data/experiences.md", "auto_render": True},
}


def _scalar(value: str):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if re.fullmatch(r"-?\d+(\.\d+)?", value):
        return float(value) if "." in value else int(value)
    return value


def parse_policy(text: str) -> dict:
    """解析本 schema 用到的缩进 YAML 子集：字典 + 列表 + 标量。未知/坏结构 fail loud。"""
    lines = [ln.split("#", 1)[0].rstrip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln.strip()]

    def emit(start, indent):
        result, i = {}, start
        while i < len(lines):
            line = lines[i]
            content = line.strip()
            cur = len(line) - len(line.lstrip(" "))
            if cur < indent:
                break
            if content.startswith("- "):
                if not list_key or list_key not in result:
                    raise ValueError(f"列表前没有键: {line!r}")
                result[list_key].append(_scalar(content[2:]))
                i += 1
                continue
            if ":" not in content:
                raise ValueError(f"无法解析的行: {line!r}")
            key, _, val = content.partition(":")
            key, val = key.strip(), val.strip()
            list_key = key if val == "" and i + 1 < len(lines) and lines[i + 1].strip().startswith("- ") else None
            if val == "":
                child, i = emit(i + 1, cur + 1)
                result[key] = child
            else:
                result[key] = _scalar(val)
                i += 1
        return result, i

    parsed, _ = emit(0, 0)
    return _deep_merge({k: v for k, v in DEFAULT_POLICY.items()}, parsed)


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@dataclass
class Experience:
    created_ts: str
    case_id: str
    title: str
    problem: str
    solution: str
    tags: list[str]
    confidence: float
    use_count: int = 0
    score: float = 0.0


class ExperienceStore:
    def __init__(self, policy: dict | None = None, config_path: str | None = None):
        """唯一事实库入口。

        policy 未提供时从 config_path 指向的 experience.yml 解析；两者皆缺省时用 DEFAULT_POLICY。
        config_path 决定 db/mirror 的相对基准目录(相对该配置文件所在目录)。
        """
        self.policy = policy or (parse_policy(Path(config_path).read_text(encoding="utf-8"))
                                 if config_path else {k: v for k, v in DEFAULT_POLICY.items()})
        self.base = Path(config_path).resolve().parent if config_path else Path.cwd()
        self.ts_fmt = self.policy["store"]["ts_fmt"]
        self.db = self.base / self.policy["store"]["db"]
        self.table = self.policy["store"]["table"]
        self.fts = self.policy["store"]["fts_table"]
        self._ensure_schema()

    # ---------- 底层 ----------
    def _conn(self) -> sqlite3.Connection:
        self.db.parent.mkdir(parents=True, exist_ok=True)
        return sqlite3.connect(str(self.db))

    @contextmanager
    def _session(self):
        conn = self._conn()
        try:
            with conn:  # 成功即 commit、异常即 rollback
                yield conn
        finally:
            conn.close()  # Windows 需显式关闭释放文件锁

    def _ensure_schema(self) -> None:
        with self._session() as c:
            c.execute(
                f"CREATE TABLE IF NOT EXISTS {self.table} ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " created_ts TEXT NOT NULL,"
                " case_id TEXT NOT NULL UNIQUE,"
                " title TEXT NOT NULL,"
                " problem TEXT NOT NULL,"
                " solution TEXT NOT NULL,"
                " tags TEXT NOT NULL DEFAULT '',"
                " confidence REAL NOT NULL DEFAULT 0.5,"
                " use_count INTEGER NOT NULL DEFAULT 0)"
            )
            # 独立 FTS5 索引表：trigram 支持中文子串命中；rowid 与经验 id 对齐
            c.execute(
                f'CREATE VIRTUAL TABLE IF NOT EXISTS {self.fts} USING fts5('
                " title, problem, solution,"
                " tokenize='trigram')"
            )

    @staticmethod
    def _now(fmt: str) -> str:
        return _dt.datetime.now(_dt.timezone.utc).strftime(fmt)

    # ---------- 蒸馏写入 ----------
    def add(self, case_id: str, title: str, problem: str, solution: str,
            tags: list[str] | None = None, confidence: float | None = None,
            created_ts: str | None = None) -> Experience:
        """把已解决 Case 蒸馏成经验写入唯一事实库；统一时间戳同时落到行与(后续)镜像。

        置信度未达 distill.min_confidence 时报错(fail loud)，不写入。
        """
        confidence = confidence if confidence is not None else self.policy["distill"]["min_confidence"]
        if confidence < self.policy["distill"]["min_confidence"]:
            raise ValueError(
                f"置信度 {confidence:.2f} 低于最低 {self.policy['distill']['min_confidence']:.2f}，拒绝入库"
            )
        created_ts = created_ts or self._now(self.ts_fmt)
        exp = Experience(created_ts=created_ts, case_id=case_id, title=title,
                         problem=problem, solution=solution,
                         tags=tags or [], confidence=confidence)
        with self._session() as c:
            c.execute(
                f"INSERT OR REPLACE INTO {self.table} "
                "(created_ts, case_id, title, problem, solution, tags, confidence) "
                "VALUES (?,?,?,?,?,?,?)",
                (created_ts, case_id, title, problem, solution, ",".join(exp.tags), confidence),
            )
            row = c.execute(f"SELECT id FROM {self.table} WHERE case_id=?", (case_id,)).fetchone()
            c.execute(f"DELETE FROM {self.fts} WHERE rowid=?", (row[0],))
            c.execute(f"INSERT INTO {self.fts} (rowid, title, problem, solution) VALUES (?,?,?,?)",
                      (row[0], title, problem, solution))
        if self.policy["mirror"]["auto_render"]:
            self.render_mirror()
        return exp

    def promote(self, case_id: str) -> None:
        """复用一次：count+1，达阈值后置信度上探一档(鼓励反复验证过的经验)。"""
        with self._session() as c:
            row = c.execute("SELECT confidence FROM {0} WHERE case_id=?".format(self.table),
                            (case_id,)).fetchone()
            if not row:
                raise KeyError(case_id)
            use = c.execute("SELECT use_count FROM {0} WHERE case_id=? AND 1=1".format(self.table),
                            (case_id,)).fetchone()[0] + 1
            conf = row[0]
            if use >= self.policy["distill"]["promote_after_uses"]:
                conf = min(1.0, conf + 0.05)
            else:
                conf = row[0]
            c.execute(f"UPDATE {self.table} SET use_count=?, confidence=? WHERE case_id=?",
                      (use, conf, case_id))
        if self.policy["mirror"]["auto_render"]:
            self.render_mirror()

    # ---------- 复用检索 ----------
    def search(self, query: str, top_k: int | None = None) -> list[Experience]:
        """按置信度/新鲜度(新版本最高权重)/复用频次加权排序，真实 FTS5 命中。"""
        top_k = top_k or self.policy["rank"]["top_k"]
        # 新鲜度基底：按 created_ts 倒序位置归一，最新=1.0、最旧=0.0（新版本最高权重）
        recency = self._recency_map()
        tokens = [t for t in query.split() if len(t) >= 3]
        if tokens:
            match = " ".join('"' + t + '"' for t in tokens)
            with self._session() as c:
                try:
                    ids = [r[0] for r in c.execute(
                        f"SELECT rowid FROM {self.fts} WHERE {self.fts} MATCH ? "
                        f"ORDER BY bm25({self.fts}) LIMIT 200", (match,),
                    ).fetchall()]
                except sqlite3.OperationalError:
                    raise ValueError(f"FTS5 检索失败(查询词/语法): {query!r}")
        else:
            # 短词(<3 字符) trigram 无法命中：回退真实 LIKE（AND 语义），同样禁模拟
            with self._session() as c:
                conds = " AND ".join(
                    f"({self.table}.title LIKE ? OR {self.table}.problem LIKE ? "
                    f"OR {self.table}.solution LIKE ?)" for _ in query.split())
                params = [f"%{t}%" for t in query.split() for _ in range(3)]
                ids = [r[0] for r in c.execute(
                    f"SELECT id FROM {self.table} WHERE {conds} ORDER BY created_ts DESC "
                    f"LIMIT 200", params).fetchall()]
        if not ids:
            return []
        placeholders = ",".join("?" for _ in ids)
        with self._session() as c:
            rows = c.execute(
                f"SELECT id, created_ts, case_id, title, problem, solution, tags, confidence, use_count "
                f"FROM {self.table} WHERE id IN ({placeholders})", ids,
            ).fetchall()
        exps = []
        for (eid, ts, case_id, title, problem, solution, tags, conf, uses) in rows:
            e = Experience(created_ts=ts, case_id=case_id, title=title, problem=problem,
                           solution=solution, tags=tags.split(",") if tags else [],
                           confidence=conf, use_count=uses)
            e.score = self._score(conf, recency.get(eid, 0.0), uses)
            exps.append(e)
        exps.sort(key=lambda e: e.score, reverse=True)
        return exps[:top_k]

    def _recency_map(self) -> dict[int, float]:
        with self._session() as c:
            rows = c.execute(
                f"SELECT id FROM {self.table} ORDER BY created_ts DESC").fetchall()
        total = len(rows)
        if total <= 1:
            return {r[0]: 1.0 for r in rows}
        return {r[0]: (total - 1 - i) / (total - 1) for i, r in enumerate(rows)}

    def _score(self, confidence: float, recency: float, uses: int) -> float:
        w = self.policy["rank"]
        usage = min(1.0, uses / max(1, self.policy["distill"]["promote_after_uses"]))
        return w["confidence"] * confidence + w["recency"] * recency + w["usage"] * usage

    # ---------- 镜像(人类可读, md 按功能一份) ----------
    def render_mirror(self) -> Path:
        """全量重渲染镜像 Markdown：与唯一事实库一致，按时间戳倒序(新版本在前/最高权重)。"""
        with self._session() as c:
            rows = c.execute(
                f"SELECT created_ts, case_id, title, problem, solution, tags, confidence, use_count "
                f"FROM {self.table} ORDER BY created_ts DESC"
            ).fetchall()
        mirror = self.base / self.policy["mirror"]["file"]
        mirror.parent.mkdir(parents=True, exist_ok=True)
        sections = ["# 经验库镜像 · 由唯一事实库自动渲染，勿手改\n",
                    "> 新版本(新时间戳)在前，最高权重；旧经验保留但不作直接参考。\n"]
        for r in rows:
            sections.append(
                f"\n## [{r[2]}]({r[1]}) · {r[0]}\n"
                f"- 置信度: {r[6]:.2f}  复用: {r[7]}  标签: {r[5] or '无'}\n"
                f"- 问题: {r[3]}\n- 解法: {r[4]}\n"
            )
        mirror.write_text("\n".join(sections), encoding="utf-8")
        return mirror
