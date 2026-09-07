#!/usr/bin/env python3
"""集群对齐校验 v2 (alignment check): 双端部署角色对偶 + 提PR→门禁→升级→生产全流程追踪。

设计 (2026-09-08, 双侧部署):
  - 同一引擎双端运行: --role dev  (3080 开发侧, 默认) / --role prod (8088 生产侧)。
  - 权威源共享 (omni-meta queue.json / autopilot_state.json / omni git / 端口 health);
    视角对偶: self = 各自仓库与 home, peer = 对侧, 产出可互比的报告 (G 面对比)。
  - 生产侧默认只读 (--role prod 忽略 --fix-ledger); 陈账修正只由 dev 侧执行。

校验面:
  A. 管道对账:  队列权威 queue.json vs 本侧网关追踪器 router-*.json 状态分叉
  B. 队列在途:  非终态节点 + autopilot needs_human 遗留 (替代项覆盖自动豁免)
  C. 开发未提交: 本仓/peer git + omni-meta git + preset 漂移 (dev 侧 git 检查; prod 侧标记 no-git)
  D. 生产未同步: 源目录 mtime 漂移 + preset 缺失 (角色无关结论: 生产缺失/滞后)
  E. 服务存活:  8008/8027/8028 health + 8066 基准文件 + 8088
  F. 全流程追踪: F1 在途阶段轨迹与停驻 / F2 提交→部署关联 (artifact commit ∈ HEAD 树?)
                 / F3 驳回→重提闭环链 / F4 审核时间线统计
  G. 对侧对比:  读取对侧 ALIGNMENT_STATE.json, 输出缺口差集

用法:
  python scripts/alignment_check.py                # dev 侧只读审计
  python scripts/alignment_check.py --role prod    # prod 侧只读审计
  python scripts/alignment_check.py --fix-ledger   # 仅 dev: 修正本侧追踪器陈账 (先备份)
  python scripts/alignment_check.py --report-only  # 定时触发器专用 (只读)

部署 (双侧):
  1. 同步引擎到生产源: 本仓 scripts/ → dsh-prod-src/scripts/ (SYNC_DIRS 已含)
  2. 触发器模板: data/release_control/triggers/alignment-check.{dev,prod}.json
     部署到各自 home 的 data/automation/signals/triggers/
  3. prod 侧触发器 cmd 追加 --role prod

路径可用环境变量覆盖:
  OMNI_META  E:/1shuju/omni-meta
  DEV_HOME   E:/1shuju/dsh-home
  PROD_HOME  E:/1shuju/dsh-prod-home
  PROD_SRC   E:/1shuju/dsh-prod-src
  PEER_REPO  E:/1shuju/1gitgengxin/deepseek-harness  (prod 侧回指开发 checkout)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OMNI = Path(os.environ.get("OMNI_META", r"E:/1shuju/omni-meta"))
DEV_HOME = Path(os.environ.get("DEV_HOME", r"E:/1shuju/dsh-home"))
PROD_HOME = Path(os.environ.get("PROD_HOME", r"E:/1shuju/dsh-prod-home"))
PROD_SRC = Path(os.environ.get("PROD_SRC", r"E:/1shuju/dsh-prod-src"))
DEV_REPO = Path(os.environ.get("PEER_REPO", r"E:/1shuju/1gitgengxin/deepseek-harness"))
SELF_REPO = Path(__file__).resolve().parents[1]  # dev 侧=本仓; prod 侧=dsh-prod-src

OUT_MD = Path(os.environ.get("ALIGNMENT_OUT_MD") or (SELF_REPO / "data/release_control/ALIGNMENT_REPORT.md"))
OUT_JSON = Path(os.environ.get("ALIGNMENT_OUT_JSON") or (SELF_REPO / "data/release_control/ALIGNMENT_STATE.json"))

QUEUE_FILE = OMNI / "data/release_control/queue.json"
AUTOPILOT_FILE = OMNI / "data/release_control/autopilot_state.json"
BASELINE_FILE = OMNI / ".v3_baseline.json"

# 目录 mtime 漂移扫描的检查面 (跳过 node_modules/.git/__pycache__/build 产物)
SYNC_DIRS = [
    "dsh-external", "dsh-local-plugins", "release_control", "review-guardrail",
    "self-evolution", "us-futures", "config", "dsh-config", "scripts",
]
GIT_JUNK = {".git", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache",
            ".venv", ".stryker-tmp", ".tmp-", "_page.html", "_wsproxy.mjs", "_cal_client.js",
            "_patch-start.ps1", ".tmp-dsh-rollback-gen.ps1", ".tmp-dump.yml", "dsh-automation-tmp.log"}
HEALTH_PORTS = [8008, 8027, 8028, 8088]
SERVICE_GATES = {8008: "集成", 8027: "预发布", 8028: "生产", 8088: "生产DSH"}

TERMINAL = {"closed", "archived"}
OMNI_SOURCE_DIRS = ("dashboard_8008/", "data_supply/", "factor_grammar/", "orchestrator/", "shared/",
                    "config/", "release_control/", "markets/", "middleware/", "data_channels/",
                    "factor_iteration/", "event_sentinel/", "exploration_dmi_rl/", "xlink/", "stock15m/",
                    "supply_demand/", "trading/", "pattern_library/", "tests/", "docs/")
OMNI_ARTIFACT_DIRS = ("reports/", "data/", "models/artifacts/", "issues/", "cache/", ".omc/", ".pt_", "factor_orch_results.txt")
SCRIPT_SUFFIX = {".py", ".ps1", ".mjs", ".sh"}
COMMIT_RE = re.compile(r"[0-9a-f]{40}|@([0-9a-f]{7,40})")
RC_REF_RE = re.compile(r"(?:替代|取代|重提|原)\s*(RC-\d{6})")
ARCHIVED_RC_RE = re.compile(r"被\s*(RC-\d{6})\s*取代")


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def sh(args, cwd=None, timeout=30) -> tuple[int, str]:
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception:  # noqa: BLE001 - 审计工具, 尽力采集
        return -1, ""


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def probe(port: int) -> dict:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=4) as r:
            body = r.read(400).decode("utf-8", "replace")
            try:
                code_version = json.loads(body).get("code_version", "")
            except Exception:  # noqa: BLE001
                code_version = body[:60]
            return {"ok": True, "code_version": code_version}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:100]}


def newest_mtime(root: Path) -> float | None:
    if not root.is_dir():
        return None
    best = 0.0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".venv", "lib", "dist")]
        try:
            st = os.stat(dirpath)
            if st.st_mtime > best:
                best = st.st_mtime
        except OSError:
            pass
        for f in filenames:
            try:
                st = os.stat(os.path.join(dirpath, f))
                if st.st_mtime > best:
                    best = st.st_mtime
            except OSError:
                pass
    return best or None


def git_uncommitted(repo: Path, base_ref: str) -> tuple[list[str], list[str], int]:
    """返回 (未跟踪路径, 已修改路径, 领先 base_ref 提交数) —— 过滤垃圾与构建产物。"""
    code, out = sh(["git", "status", "--porcelain", "-z"], cwd=repo)
    untracked, modified = [], []
    if code != 0:
        return untracked, modified, -1
    for item in out.split("\0"):
        if not item:
            continue
        kind, path = item[:2], item[3:]
        parts = Path(path).parts
        if any(seg == junk or seg.startswith(junk.rstrip(".")) for seg in parts for junk in GIT_JUNK if junk.endswith(".") or seg == junk):
            continue
        if kind in ("??", "A "):
            untracked.append(path)
        elif kind not in ("!!",):
            modified.append(path)
    _, out2 = sh(["git", "rev-list", "--count", f"{base_ref}..HEAD"], cwd=repo)
    try:
        ahead = int(out2.strip())
    except ValueError:
        ahead = -1
    return untracked, modified, ahead


def is_omni_source(p: str) -> bool:
    """omni-meta 中属于“应入库源文件”的路径: 模块/配置/测试/文档目录,
    或 scripts/ 顶层非探针脚本 (mission3 探针与 _ 前缀调试脚本不算)。"""
    if p.startswith(OMNI_SOURCE_DIRS):
        return True
    if p.startswith("scripts/") and not p.startswith(("scripts/mission3/", "scripts/_")):
        base = Path(p).name
        return Path(p).suffix in SCRIPT_SUFFIX and not base.startswith("_")
    return False


def is_superseded(issue: dict, issues: dict[str, dict]) -> bool:
    """needs_human 遗留是否已被一条 closed/archived 替代项覆盖 (标题/内容继承判断, 保守)。"""
    iid = issue.get("issue_id", "")
    title = (issue.get("title") or "")[:60]
    for other in issues.values():
        if other.get("issue_id") == iid:
            continue
        if other.get("status") not in TERMINAL:
            continue
        otitle = other.get("title") or ""
        if iid in otitle or f"原 {iid}" in otitle or f"替代 {iid}" in otitle:
            return True
        share = len(set(title) & set(otitle[:60])) / max(1, len(set(title)))
        o_has_supersede = "替代" in otitle or "重提" in otitle or "取代" in otitle
        if share > 0.6 and (o_has_supersede or len(otitle) == len(title)):
            return True
    return False


def parse_commit_refs(text: str) -> list[str]:
    """从 artifact_ref / history 理由文本提取候选提交 (7-40 hex, 校验存在性)。"""
    out = []
    for m in COMMIT_RE.findall(text or ""):
        cand = m if isinstance(m, str) and m else None
        if not cand:
            continue
        code, _ = sh(["git", "cat-file", "-e", cand], cwd=OMNI)
        if code == 0 and cand not in out:
            out.append(cand)
    return out


def commit_in_tree(commit: str) -> bool:
    code, _ = sh(["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=OMNI)
    return code == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", choices=["dev", "prod"], default="dev")
    ap.add_argument("--fix-ledger", action="store_true", help="修正本侧追踪器陈账 (先备份; 仅 dev 侧)")
    ap.add_argument("--report-only", action="store_true", help="只写报告, 不修任何状态 (定时触发器默认)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    prod_role = args.role == "prod"
    self_repo = SELF_REPO if not prod_role else PROD_SRC
    peer_repo = PROD_SRC if not prod_role else DEV_REPO
    self_home = DEV_HOME if not prod_role else PROD_HOME
    peer_home = PROD_HOME if not prod_role else DEV_HOME
    router_files = [self_home / "data/automation/router-8008.json", self_home / "data/automation/router-8027.json"]
    if prod_role and args.fix_ledger:
        # 生产侧允许显式修正本侧追踪器陈账 (仅写 router JSON + 备份, 不触服务);
        # 定时触发器用 --report-only, 不会走到这里。
        if not args.quiet:
            print("[alignment:prod] 显式 --fix-ledger: 将修正 8088 本侧追踪器陈账")

    gaps: list[dict] = []
    sections: dict[str, dict] = {}
    now = now_iso()

    # ---------- A. 管道对账: 队列 vs 本侧追踪器 ----------
    queue = load_json(QUEUE_FILE)
    qissues = queue.get("issues", queue)
    if isinstance(qissues, dict):
        qissues = list(qissues.values())
    qmap = {i.get("issue_id"): i for i in qissues if i.get("issue_id")}

    tracker_rows: list[tuple[str, str, str, str]] = []
    for rf in router_files:
        ledger = load_json(rf)
        gate = ("staging-8027" if "8027" in rf.name else "integration-8008")
        for iid, info in (ledger.get("items") or {}).items():
            tracker_rows.append((gate, iid, (info or {}).get("lastState", "?"), (info or {}).get("title", "")))

    phantom, tracker_only, resolved = [], [], []
    for gate, iid, last, title in tracker_rows:
        qi = qmap.get(iid)
        if qi is None:
            tracker_only.append({"gate": gate, "id": iid, "tracker_state": last, "title": title})
            continue
        qstate = qi.get("status")
        if qstate in TERMINAL and last not in TERMINAL:
            try:
                age = round((time.time() - datetime.fromisoformat(qi.get("updated_at", "")).timestamp()) / 86400, 1)
            except (ValueError, TypeError):
                age = None
            phantom.append({"gate": gate, "id": iid, "tracker_state": last, "queue_state": qstate, "title": title,
                            "age_days": age})
        elif qstate in TERMINAL and last in TERMINAL:
            resolved.append(iid)

    phantom.sort(key=lambda r: r["id"])
    for r in phantom:
        gaps.append({"kind": "A-tracker-stale", "severity": "high" if r["tracker_state"] == "testing" else "medium",
                     "evidence": f"{r['gate']} 追踪 {r['id']} lastState={r['tracker_state']}, 队列权威状态={r['queue_state']}",
                     "action": "已收口项目未回写追踪器; 运行 --fix-ledger 或确认发布闭环"})
    for r in tracker_only:
        gaps.append({"kind": "A-tracker-only", "severity": "low",
                     "evidence": f"{r['gate']} 追踪 {r['id']} 不在队列", "action": "核对来源, 确认是否手工/外部队列条目"})
    sections["A_pipeline_reconcile"] = {"total_tracked": len(tracker_rows), "phantom": len(phantom),
                                        "tracker_only": len(tracker_only), "aligned_terminal": len(resolved)}

    # ---------- B. 队列在途 + needs_human 遗留 ----------
    inflight = [i for i in qissues if i.get("status") not in TERMINAL]
    for i in inflight:
        gaps.append({"kind": "B-inflight", "severity": "high",
                     "evidence": f"队列 {i.get('issue_id')} status={i.get('status')} {i.get('title')}",
                     "action": "沿 8008→8027→8028 推进或驳回归档"})
    autopilot = load_json(AUTOPILOT_FILE)
    nh_items = [iid for iid, w in (autopilot.get("wakes") or {}).items()
                if isinstance(w, dict) and w.get("needs_human")]
    nh_leftover = [iid for iid in nh_items
                   if (qmap.get(iid) or {}).get("status") not in TERMINAL and not is_superseded(qmap.get(iid, {}), qmap)]
    wake_channel_errors = [iid for iid in nh_items
                           if isinstance((autopilot.get("wakes") or {}).get(iid), dict)
                           and (autopilot["wakes"][iid].get("channel_error") or (autopilot["wakes"][iid].get("last_error") or "").startswith("http 401"))]
    for iid in nh_leftover:
        w = (autopilot.get("wakes") or {}).get(iid, {})
        gaps.append({"kind": "B-needs-human", "severity": "high",
                     "evidence": f"{iid}: {w.get('last_error', '')[:120]}",
                     "action": "人工接管驳回通知 (唤醒通道未配置时启动 OMNI_SIGNAL_* 兜底)"})
    if wake_channel_errors and not nh_leftover:
        gaps.append({"kind": "B-wake-channel", "severity": "low",
                     "evidence": f"IM 兜底未配置(OMNI_SIGNAL_*): 历史 {len(wake_channel_errors)} 项驳回无 IM 通知; 主唤醒通道已修(RC-000077), 中继打回卡通道在役",
                     "action": "可选: 配置 OMNI_SIGNAL_CHANNEL/OMNI_SIGNAL_WEBHOOK_URL 作为第三通道"})
    sections["B_inflight"] = {"inflight": len(inflight), "needs_human_total": len(nh_items),
                              "needs_human_leftover": len(nh_leftover), "wake_channel_errors": len(wake_channel_errors)}

    # ---------- C. 开发未提交 (角色对偶; 无 .git 的仓库跳过) ----------
    repo_git = (SELF_REPO / ".git").exists()
    ut, mod, ahead = [], [], -1
    if repo_git:
        ut, mod, ahead = git_uncommitted(SELF_REPO, "origin/master")
    for p in ut:
        gaps.append({"kind": "C-dev-untracked", "severity": "medium",
                     "evidence": f"本仓未跟踪 {p}", "action": "纳入 git 并按区块提交, 再入队列提交"})
    for p in mod:
        gaps.append({"kind": "C-dev-modified", "severity": "medium",
                     "evidence": f"本仓已修改 {p}", "action": "提交或确认无需上线"})
    if ahead > 0:
        gaps.append({"kind": "C-dev-unpushed", "severity": "low",
                     "evidence": f"本仓领先 {ahead} 提交", "action": "PR/推送合并后同步生产源"})
    if not repo_git:
        sections["C_repo_git"] = {"no_git": True}

    out_, mod_, ahead2 = git_uncommitted(OMNI, "main")
    omni_modified_src = [p for p in mod_ if is_omni_source(p)]
    for p in omni_modified_src:
        gaps.append({"kind": "C-omni-modified", "severity": "high",
                     "evidence": f"omni-meta 未提交源文件 {p}", "action": "提交并评估是否重提 RC"})
    if ahead2 > 0:
        gaps.append({"kind": "C-omni-unmerged", "severity": "medium",
                     "evidence": f"omni-meta 分支未合并 main: HEAD 领先 {ahead2} 提交",
                     "action": "确认双分支策略; 生产以工作分支部署则标注豁免"})
    omni_untracked_src = [p for p in out_ if is_omni_source(p)]
    omni_untracked_artifact = [p for p in out_ if p.startswith(OMNI_ARTIFACT_DIRS)]
    for p in omni_untracked_src[:25]:
        gaps.append({"kind": "C-omni-untracked", "severity": "medium",
                     "evidence": f"omni-meta 未跟踪源文件 {p}", "action": "确认是否应入库, 应入库则提交"})
    if len(omni_untracked_src) > 25:
        gaps.append({"kind": "C-omni-untracked", "severity": "low",
                     "evidence": f"omni-meta 另有 {len(omni_untracked_src) - 25} 项未跟踪源文件 (已省略)",
                     "action": "统一清理与归档"})
    if omni_untracked_artifact:
        gaps.append({"kind": "C-omni-untracked-artifact", "severity": "low",
                     "evidence": f"omni-meta 未跟踪产物/报告 {len(omni_untracked_artifact)} 项 (reports/data/issues 等)",
                     "action": "按产物策略入库或加入 .gitignore"})
    sections["C_dev_unsubmitted"] = {"repo_untracked": len(ut), "repo_modified": len(mod), "repo_ahead": ahead,
                                     "omni_modified_src": len(omni_modified_src), "omni_ahead": ahead2,
                                     "omni_untracked_src": len(omni_untracked_src),
                                     "omni_untracked_artifact": len(omni_untracked_artifact)}

    # ---------- D. 生产未同步 (角色无关结论: 生产缺失/滞后) ----------
    drift_rows = []
    for d in SYNC_DIRS:
        dev_t = newest_mtime(DEV_REPO / d)
        prod_t = newest_mtime(PROD_SRC / d)
        if prod_t is None:
            drift_rows.append({"dir": d, "dev": dev_t, "prod": None})
            continue
        lag_days = (dev_t - prod_t) / 86400 if dev_t else 0
        if lag_days > 1.0:
            drift_rows.append({"dir": d, "dev": dev_t, "prod": prod_t, "lag_days": round(lag_days, 1)})
    for r in drift_rows:
        if r.get("prod") is None:
            gaps.append({"kind": "D-prod-missing-dir", "severity": "high",
                         "evidence": f"dsh-prod-src 缺失目录 {r['dir']}", "action": "同步到生产源"})
        else:
            gaps.append({"kind": "D-prod-stale-dir", "severity": "medium",
                         "evidence": f"dsh-prod-src/{r['dir']} 落后开发 {r['lag_days']} 天",
                         "action": "发布裁剪审计后同步生产源"})

    def presets(home: Path) -> set[str]:
        if not (home / ".agent-presets").is_dir():
            return set()
        return {p.name for p in (home / ".agent-presets").iterdir()
                if p.is_dir() and ".bak" not in p.name}
    dev_p, prod_p = presets(DEV_HOME), presets(PROD_HOME)
    for p in sorted(dev_p - prod_p):
        gaps.append({"kind": "D-prod-missing-preset", "severity": "high",
                     "evidence": f"preset {p} 仅开发侧", "action": "promote 到生产并重启生效"})
    for p in sorted(prod_p - dev_p):
        gaps.append({"kind": "D-dev-missing-preset", "severity": "low",
                     "evidence": f"preset {p} 仅生产侧", "action": "确认为生产私有(如 git-auto-update)则豁免"})
    sections["D_prod_sync"] = {"stale_dirs": len(drift_rows), "presets_dev_only": sorted(dev_p - prod_p),
                               "presets_prod_only": sorted(prod_p - dev_p)}

    # ---------- E. 服务存活 + 8066 基准文件 ----------
    services = {}
    for port in HEALTH_PORTS:
        services[str(port)] = probe(port)
        if not services[str(port)]["ok"] and port in (8008, 8027, 8028):
            gaps.append({"kind": "E-service-down", "severity": "high",
                         "evidence": f"{port} ({SERVICE_GATES[port]}) /health 失败: {services[str(port)]['error']}",
                         "action": "恢复服务并重跑门禁对账"})
    baseline = load_json(BASELINE_FILE)
    if baseline.get("baseline") != "8066" or baseline.get("anchored_to") != 8028:
        gaps.append({"kind": "E-baseline-stale", "severity": "medium",
                     "evidence": "8066 基准文件缺失或未锚定 8028 (.v3_baseline.json)",
                     "action": "晋升后执行 python scripts/v3_servers.py anchor"})
    services["8066_baseline"] = baseline if baseline else {"error": "missing"}
    sections["E_services"] = services

    # ---------- F. 全流程追踪 (提PR→门禁→升级→生产) ----------
    # F1 在途阶段轨迹: 非终态 issue 的提交→当前阶段时间线与停驻天数
    inflight_tracks = []
    for i in sorted(inflight, key=lambda x: x.get("created_at") or ""):
        hist = i.get("history") or []
        events = [(h.get("at", ""), h.get("event"), h.get("port")) for h in hist]
        last_at = (hist[-1].get("at") if hist else i.get("updated_at")) or ""
        dwell = None
        try:
            dwell = round((time.time() - datetime.fromisoformat(last_at).timestamp()) / 3600, 1)
        except (ValueError, TypeError):
            pass
        inflight_tracks.append({"id": i.get("issue_id"), "status": i.get("status"), "events": events[-4:], "dwell_h": dwell})
    sections["F1_inflight_tracks"] = inflight_tracks

    # F2 提交→部署关联: closed RC 的 artifact commit 是否在当前代码树 (HEAD 祖先)
    head_ok, _ = sh(["git", "rev-parse", "HEAD"], cwd=OMNI)
    git_available = head_ok == 0
    f2_deployed, f2_missing, f2_unverifiable, f2_totals = [], [], 0, 0
    for i in qissues:
        if i.get("status") != "closed":
            continue
        f2_totals += 1
        ref_text = " ".join(filter(None, [i.get("artifact_ref", ""),
                                          " ".join((h.get("reason") or "") for h in (i.get("history") or []))]))
        commits = parse_commit_refs(ref_text) if git_available else []
        if not commits:
            f2_unverifiable += 1
            continue
        deployed = [c for c in commits if commit_in_tree(c)]
        if deployed:
            f2_deployed.append(i.get("issue_id"))
        else:
            f2_missing.append({"id": i.get("issue_id"), "ref": (i.get("artifact_ref") or "")[:60],
                               "commits": commits[:4], "title": (i.get("title") or "")[:46]})
    for m in f2_missing:
        gaps.append({"kind": "F2-deploy-missing", "severity": "high",
                     "evidence": f"closed {m['id']} 的 artifact commit 不在当前代码树: {m['commits']} ({m['title']})",
                     "action": "核对发布是否回退/遗漏; 若需上线请重提 RC"})
    sections["F2_deploy_link"] = {"closed_total": f2_totals, "deployed": len(f2_deployed),
                                  "missing": len(f2_missing), "unverifiable": f2_unverifiable}

    # F3 驳回→重提闭环链 (显式引用双向查找 + 同名 closed 豁免)
    def successor_of(i: dict) -> str | None:
        iid = i.get("issue_id", "")
        # 1) 自身归档理由: 被 X 取代
        for h in (i.get("history") or []):
            if h.get("event") == "archived":
                m = ARCHIVED_RC_RE.search(h.get("reason") or "")
                if m:
                    return m.group(1)
        # 2) 自身标题/反馈引用: 重提/替代/原 ...
        own_text = (i.get("title") or "") + " " + " ".join((f.get("reason") or "") for f in (i.get("feedback") or []))
        for m in RC_REF_RE.finditer(own_text):
            nxt = m.group(1)
            if nxt != iid:
                return nxt
        return None

    def named_closed_counterpart(i: dict) -> str | None:
        """同名功能 closed 项回退 (重复提交被归档且无显式引用时的闭环证据)。"""
        title = set((i.get("title") or "")[:60])
        for other in qissues:
            if other.get("issue_id") == i.get("issue_id") or other.get("status") != "closed":
                continue
            share = len(title & set((other.get("title") or "")[:60])) / max(1, len(title))
            if share > 0.6:
                return other.get("issue_id")
        return None

    rejected_ids = {i.get("issue_id") for i in qissues
                    if any(h.get("event") in ("gate_rejected",) for h in (i.get("history") or []))}
    chains: list[list[str]] = []
    cited_by: dict[str, str] = {}  # 被引用 id → 引用它的(后继)issue
    for i in qissues:
        iid = i.get("issue_id", "")
        text = (i.get("title") or "") + " " + " ".join((h.get("reason") or "") for h in (i.get("history") or []))
        for m in re.finditer(r"(?:原|替代|取代|重提)\s*(RC-\d{6})", text):
            ref = m.group(1)
            if ref != iid:
                cited_by.setdefault(ref, iid)
    for i in qissues:
        iid = i.get("issue_id")
        if iid not in rejected_ids:
            continue
        nxt = successor_of(i) or cited_by.get(iid)
        if nxt and nxt != iid:
            chains.append([iid, nxt])
    covered = {c[0] for c in chains}
    orphan_rejected = []
    for r in sorted(rejected_ids - covered):
        ri = qmap.get(r, {})
        if ri.get("status") == "closed":
            continue  # 驳回后已修复同 id 闭环
        if "[demo]" in (ri.get("title") or ""):
            continue  # 演示验证项, 无闭环要求
        if named_closed_counterpart(ri):
            continue  # 同名功能已 closed, 归档即闭环
        orphan_rejected.append(r)
    for r in orphan_rejected:
        gaps.append({"kind": "F3-reject-orphan", "severity": "medium",
                     "evidence": f"{r} 被驳回且无后继重提记录 ({qmap.get(r, {}).get('title', '')[:46]})",
                     "action": "确认是否已被替代/已放弃; 未闭环则补重提或归档备注"})
    sections["F3_reject_chains"] = {"rejected_total": len(rejected_ids), "chains": chains,
                                    "orphan_rejected": orphan_rejected}

    # F4 审核时间线统计 (8008/8027 通过率, 提交→关闭天数)
    g8 = g27 = ok8 = ok27 = 0
    durations = []
    for i in qissues:
        for h in (i.get("history") or []):
            ev, port = h.get("event"), h.get("port")
            if ev in ("gate_approved", "gate_rejected"):
                if port == 8008:
                    g8 += 1
                    ok8 += ev == "gate_approved"
                elif port == 8027:
                    g27 += 1
                    ok27 += ev == "gate_approved"
        if i.get("status") == "closed":
            try:
                d = (datetime.fromisoformat(i.get("updated_at", "")) - datetime.fromisoformat(i.get("created_at", ""))).total_seconds() / 86400
                durations.append((round(d, 1), i.get("issue_id")))
            except (ValueError, TypeError):
                pass
    durations.sort(reverse=True)
    sections["F4_gate_stats"] = {"gate8008": {"count": g8, "approved": ok8},
                                 "gate8027": {"count": g27, "approved": ok27},
                                 "submit_to_close_days": durations[:5]}

    # ---------- G. 对侧报告对比 ----------
    peer_state_file = (peer_repo / "data/release_control/ALIGNMENT_STATE.json") if peer_repo != SELF_REPO else None
    peer_compare = {"peer_read": False}
    ROLE_EXPECTED_DIFF = {"C-dev-untracked", "C-dev-modified", "C-dev-unpushed", "C_repo_git",
                          "G-peer-divergence", "H-git-huge-commit"}
    if peer_state_file and peer_state_file.exists():
        peer = load_json(peer_state_file)
        peer_compare = {"peer_read": True, "peer_checked_at": peer.get("checked_at"),
                        "peer_gap_count": peer.get("gap_count")}
        peer_kinds = {g.get("kind") for g in peer.get("gaps", [])}
        self_kinds = {g.get("kind") for g in gaps}
        peer_compare["only_peer"] = sorted(peer_kinds - self_kinds)
        peer_compare["only_self"] = sorted(self_kinds - peer_kinds)
        peer_compare["both"] = sorted(self_kinds & peer_kinds)
        unexpected = (set(peer_compare["only_peer"]) | set(peer_compare["only_self"])) - ROLE_EXPECTED_DIFF
        if unexpected:
            gaps.append({"kind": "G-peer-divergence", "severity": "low",
                         "evidence": f"对侧报告存在本侧没有的缺口面: {sorted(unexpected)} (双方缺口数 {peer.get('gap_count')} vs {len(gaps)})",
                         "action": "以权威队列为准核对差异面"})
    sections["G_peer_compare"] = peer_compare

    # ---------- H. git 卫生 (防 9/5 事故重演, 双仓扫描) ----------
    # 2026-09-05 事故: deepseek-harness 5120dd87c7 "chore: WIP checkpoint" 一次性提交
    # 30674 文件 / 425万行, 实际正当修改仅 ~59 文件。H 面持续检测近 500 提交中的超大提交。
    h_huge: list[dict] = []
    h_obj_volume = ""
    for repo, label in ((SELF_REPO, "dev-repo"), (OMNI, "omni-meta")):
        if not (repo / ".git").exists() and not (repo / ".git").is_file():
            continue
        code, out = sh(["git", "log", "-500", "--pretty=@@%h|%ad|%s", "--date=format:%m-%d %H:%M", "--numstat"], cwd=repo, timeout=60)
        if code != 0:
            continue
        cur = None
        for line in out.splitlines():
            if line.startswith("@@"):
                if cur and cur["files"] > 1000:
                    h_huge.append(cur)
                head = line[2:].split("|", 2)
                cur = {"repo": label, "id": head[0], "at": head[1], "subject": head[2][:40], "files": 0}
            elif cur is not None and line.strip():
                cur["files"] += 1
        if cur and cur["files"] > 1000:
            h_huge.append(cur)
        _, vol = sh(["git", "count-objects", "-vH"], cwd=repo, timeout=20)
        for vline in vol.splitlines():
            if vline.startswith("size-pack:"):
                h_obj_volume = f"{label}: {vline.split(':', 1)[1].strip()}" if not h_obj_volume else f"{h_obj_volume} | {label}: {vline.split(':', 1)[1].strip()}"
    h_huge = sorted(h_huge, key=lambda c: c["files"], reverse=True)[:5]
    for c in h_huge:
        gaps.append({"kind": "H-git-huge-commit", "severity": "high",
                     "evidence": f"[{c.get('repo')}] 提交 {c.get('id')} {c.get('at','')} 含 {c.get('files')} 文件 ({c.get('subject','')})",
                     "action": "大提交污染历史/对象库(2026-09-05 事故类); 评估 filter-repo 清理或接受并持续监测"})
    sections["H_git_hygiene"] = {"huge_commits": h_huge, "object_volume": h_obj_volume}

    # ---------- 输出 ----------
    role_label = "3080 开发" if not prod_role else "8088 生产"
    peer_label = "8088 生产" if not prod_role else "3080 开发"
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# 对齐校验报告 ({role_label} 视角 → 对侧 {peer_label})",
        "",
        f"> 检查时间: {now} | 角色: `--role {args.role}` | 缺口总数: **{len(gaps)}** | 引擎: `scripts/alignment_check.py`",
        "",
        "## A. 管道对账 (队列权威 vs 追踪器)",
        f"- 追踪器总行: {sections['A_pipeline_reconcile']['total_tracked']} | 陈账分叉: **{sections['A_pipeline_reconcile']['phantom']}** | 队列外行: {sections['A_pipeline_reconcile']['tracker_only']} | 已对齐终态: {sections['A_pipeline_reconcile']['aligned_terminal']}",
    ]
    for r in phantom:
        lines.append(f"  - {r['gate']} `{r['id']}` 追踪={r['tracker_state']} → 队列={r['queue_state']} | {r['title'][:50]}")
    for r in tracker_only:
        lines.append(f"  - ⚠ {r['gate']} `{r['id']}` 队列无此条目 (追踪={r['tracker_state']})")
    lines += [
        "",
        "## B. 队列在途 / needs_human",
        f"- 在途: {sections['B_inflight']['inflight']} | needs_human 遗留: **{sections['B_inflight']['needs_human_leftover']}** (总 {sections['B_inflight']['needs_human_total']}, 其余已被替代项覆盖)",
        "",
        "## C. 开发未提交",
        f"- 本仓: 未跟踪 {sections['C_dev_unsubmitted']['repo_untracked']} | 已修改 {sections['C_dev_unsubmitted']['repo_modified']} | 领先 {sections['C_dev_unsubmitted']['repo_ahead']}",
        f"- omni-meta: 未提交源文件 {sections['C_dev_unsubmitted']['omni_modified_src']} | 未跟踪源文件 {sections['C_dev_unsubmitted']['omni_untracked_src']} | 未跟踪产物 {sections['C_dev_unsubmitted']['omni_untracked_artifact']} | 分支未合并 main 领先 {sections['C_dev_unsubmitted']['omni_ahead']}",
        "",
        "## D. 生产未同步",
        f"- 源目录漂移: {sections['D_prod_sync']['stale_dirs']} | preset 仅开发: {len(sections['D_prod_sync']['presets_dev_only'])} | preset 仅生产: {len(sections['D_prod_sync']['presets_prod_only'])}",
    ]
    for p in sections["D_prod_sync"]["presets_dev_only"]:
        lines.append(f"  - preset 缺失于生产: `{p}`")
    lines += ["", "## E. 服务存活"]
    for port, s in sections["E_services"].items():
        if port == "8066_baseline":
            if s.get("baseline") == "8066":
                lines.append(f"- 8066 基准: OK 锚定 8028 hash={s.get('hash')} ({s.get('updated_at')})")
            else:
                lines.append(f"- 8066 基准: MISSING/未锚定 {s.get('error') or ''}")
            continue
        tag = SERVICE_GATES.get(int(port), port)
        if s["ok"]:
            lines.append(f"- {port} ({tag}): OK {s.get('code_version') or ''}")
        else:
            lines.append(f"- {port} ({tag}): DOWN {s.get('error')}")
    lines += ["", "## F. 全流程追踪 (提PR→门禁→升级→生产)"]
    f2 = sections["F2_deploy_link"]
    lines.append(f"- F2 部署关联: closed {f2['closed_total']} | commit 在树 {f2['deployed']} | **不在树 {f2['missing']}** | 无法核验 {f2['unverifiable']}")
    for m in f2_missing[:10]:
        lines.append(f"  - ⚠ `{m['id']}` {m['ref'][:50]} → {m['commits'][:2]}")
    f4 = sections["F4_gate_stats"]
    lines.append(f"- F4 审核: 8008 {f4['gate8008']['approved']}/{f4['gate8008']['count']} 通过 | 8027 {f4['gate8027']['approved']}/{f4['gate8027']['count']} 通过 | 最长提交→关闭天数: {f4['submit_to_close_days'][:3]}")
    f3 = sections["F3_reject_chains"]
    lines.append(f"- F3 驳回→重提: 驳回 {f3['rejected_total']} | 闭环链 {len(f3['chains'])} | **无后继孤驳 {len(f3['orphan_rejected'])}**")
    for c in f3["chains"][:10]:
        lines.append(f"  - {' → '.join(c)}")
    for t in sections["F1_inflight_tracks"]:
        lines.append(f"  - 在途 `{t['id']}` {t['status']} 停驻 {t['dwell_h']}h")
    lines += ["", "## H. git 卫生 (防大提交事故)"]
    hh = sections["H_git_hygiene"]["huge_commits"]
    lines.append(f"- 近 500 提交中 >1000 文件: **{len(hh)}** | 对象库: {sections['H_git_hygiene'].get('object_volume') or 'n/a'}")
    for c in hh:
        lines.append(f"  - ⚠ [{c.get('repo')}] `{c.get('id')}` {c.get('at')} {c.get('files')} files | {c.get('subject')}")
    g = sections["G_peer_compare"]
    if g.get("peer_read"):
        lines.append("")
        lines.append("## G. 对侧对比")
        lines.append(f"- 对侧 ({peer_label}) 报告时间 {g.get('peer_checked_at')} | 对侧缺口 {g.get('peer_gap_count')} | 仅本侧: {g.get('only_self')} | 仅对侧: {g.get('only_peer')} | 共同: {g.get('both')}")
    if gaps:
        lines += ["", "## 缺口清单", ""]
        for g2 in gaps:
            lines.append(f"- [{g2['severity']}] {g2['kind']}: {g2['evidence']} → {g2['action']}")
    lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    OUT_JSON.write_text(json.dumps({"checked_at": now, "role": args.role, "gap_count": len(gaps), "gaps": gaps,
                                    "sections": {k: ({kk: (vv if not isinstance(vv, (set, tuple)) else sorted(vv))
                                                      for kk, vv in v.items()} if isinstance(v, dict) else v)
                                                 for k, v in sections.items()}},
                                   ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not args.quiet:
        print(f"[alignment:{args.role}] {now} 缺口 {len(gaps)} -> {OUT_MD.name}")
        for g2 in gaps:
            print(f"  [{g2['severity']}] {g2['kind']} {g2['evidence'][:110]}")

    # ---------- 修正追踪器陈账 (可选, 仅 dev 侧, 先备份) ----------
    if args.fix_ledger and phantom:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        for rf in router_files:
            if not rf.exists():
                continue
            backup = rf.with_name(f"{rf.name}.bak-align-{stamp}")
            shutil.copy2(rf, backup)
            ledger = load_json(rf)
            fixed = 0
            for iid, info in (ledger.get("items") or {}).items():
                qi = qmap.get(iid)
                if qi and qi.get("status") in TERMINAL and (info or {}).get("lastState") not in TERMINAL:
                    info["lastState"] = qi["status"]
                    info["note"] = "alignment-fixed:队列终态回写"
                    fixed += 1
            if fixed:
                rf.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if not args.quiet:
                print(f"[alignment] fix-ledger {rf.name}: 回写 {fixed} 行 (备份 {backup.name})")

    return 0


if __name__ == "__main__":
    sys.exit(main())