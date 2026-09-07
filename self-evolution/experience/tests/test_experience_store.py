"""断言: 经验库(⑥) 蒸馏/落库/加权检索/镜像/复用晋升 都真实生效且确定性。

护栏覆盖:
  1. 低于 min_confidence 的经验必须被拒(fail loud)，不得入库→不得被当成事实。
  2. 检索是真实 FTS5/真实 LIKE 命中，不是空返回/全量返回/模拟数据。
  3. 新版本(新时间戳)最高权重：同置信度下较新经验排前。
  4. 行与其镜像共用同一 created_ts(统一时间戳)，时间序列一致。
  5. promote 达阈值后置信度上探。
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experience_store import ExperienceStore, parse_policy  # noqa: E402

POLICY_PATH = Path(__file__).resolve().parent.parent / "experience.yml"
POLICY = parse_policy(POLICY_PATH.read_text(encoding="utf-8"))


def _store(tmp: str) -> ExperienceStore:
    p = {k: (dict(v) if isinstance(v, dict) else v) for k, v in dict(POLICY).items()}
    p["store"] = dict(p["store"]); p["store"]["db"] = f"{tmp}/exp.db"
    p["mirror"] = dict(p["mirror"]); p["mirror"]["file"] = f"{tmp}/exp.md"
    p["mirror"]["auto_render"] = True
    return ExperienceStore(p, "config.yml")


with tempfile.TemporaryDirectory() as tmp:
    st = _store(tmp)

    # 1) 低于最低置信度必须拒绝入库
    try:
        st.add("bad", "低置信", "p", "s", confidence=0.10)
        raise AssertionError("低置信度经验不应入库")
    except ValueError:
        pass

    # 2+3) 两条同置信度、不同时间戳、共享检索词的插件主题经验
    ts_old = "2026-01-01T00:00:00+00:00"
    ts_new = "2026-08-26T00:00:00+00:00"
    st.add("case-hotload", "插件热加载方案", "如何在运行中热挂载插件", "用 DynamicCordisRegistry 挂载/定义/撤销",
           tags=["cordis", "hot-load"], confidence=0.8, created_ts=ts_old)
    st.add("case-safety", "插件安全评审方案", "如何评审外部拉取插件", "静态扫描加沙箱预跑加信任门",
           tags=["safety", "cordis"], confidence=0.8, created_ts=ts_new)

    # 2) FTS5 trigram 中文子串命中
    hits = st.search("热加载")
    assert any(e.case_id == "case-hotload" for e in hits), "FTS5 应命中真实经验"

    # 3) 新版本最高权重：同 conf 下较新经验排前（共享检索词"插件"，短词走真实 LIKE）
    ranked = st.search("插件", top_k=5)
    ids = [e.case_id for e in ranked]
    assert "case-safety" in ids and "case-hotload" in ids, f"两条应都被命中, got {ids}"
    assert ranked[0].case_id == "case-safety", f"较新经验应最高权重, got {ids}"

    # 4) 行与镜像共用同一时间戳（统一时间戳保证时间序列一致）
    mirror = Path(tmp) / "exp.md"
    assert mirror.is_file(), "镜像应被自动渲染"
    assert ts_new.split("T")[0] in mirror.read_text(encoding="utf-8"), "镜像应含该经验时间戳"

    # 5) promote 达阈值回升置信度
    before = next(e.confidence for e in st.search("热加载") if e.case_id == "case-hotload")
    for _ in range(st.policy["distill"]["promote_after_uses"]):
        st.promote("case-hotload")
    after = next(e.confidence for e in st.search("热加载") if e.case_id == "case-hotload")
    assert after > before, "复用达阈值后置信度应上探"

print("PASS test_experience_store")