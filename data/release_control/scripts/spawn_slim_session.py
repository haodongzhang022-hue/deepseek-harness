#!/usr/bin/env python3
"""创建新 DSH 会话并注入 git 历史瘦身专项任务书 (3080 本地, 一次性)。"""
import json
import sys
import uuid
import urllib.request
from urllib.request import Request, urlopen

sys.path.insert(0, r"E:\1shuju\omni-meta\release_control")
from wake import load_browser_auth_cookie  # type: ignore

BASE = "http://127.0.0.1:3080"


def rpc(method: str, args: dict, timeout: float = 30) -> dict:
    request_id = str(uuid.uuid4())
    envelope = {
        "type": "client-request", "rpcId": request_id, "method": method,
        "payload": {"args": args},
    }
    headers = {"Content-Type": "application/json"}
    cookie = load_browser_auth_cookie(BASE, authority="127.0.0.1:3080")
    if cookie:
        headers["Cookie"] = cookie
    req = Request(f"{BASE}/api/{method}",
                  data=json.dumps(envelope, ensure_ascii=False).encode("utf-8"),
                  headers=headers, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read(64_000).decode("utf-8", errors="replace"))
    result = body.get("result") if isinstance(body, dict) else None
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError(f"rpc {method} failed: {json.dumps(result, ensure_ascii=False)[:400]}")
    return result.get("value") if isinstance(result.get("value"), dict) else result


created = rpc("session/create", {"request": {}})
sid = created["sessionId"]
print("SESSION_CREATED", sid)

mission = """【专项任务】git 历史瘦身:清理 2026-09-05 事故大提交(3080 开发侧执行,8088 只报告不处理)

## 背景(权威信息,无需再勘查可先读这些文件)
- 事故提交:deepseek-harness `5120dd87c7`(09-05 14:22 "chore: WIP checkpoint before upstream dsh-0.1.3-alpha.1 merge"),
  一次提交 30,674 文件 / 4,255,267 行;实际正当修改约 59 个文件(已由后续提交 a584925285+41301d0567 等承载)。
- 后果:dev-repo git 对象库膨胀,当前 `git count-objects -vH` size-pack ≈ 188.89 MiB。
- 机制存档:`E:/1shuju/1gitgengxin/deepseek-harness/data/release_control/HANDOVER_8088.md` 第 6 节
  (事故存档+git 卫生纪律);台账 `data/release_control/ITERATION_LEDGER.md` 第 7 节。
- 针对本专项的接力卡:relay_read <gid> 拿完整契约(gid 见 harness 平台 relay_list)。

## 目标
安全降低对象库体积:移除 5120dd87c7 及其同类巨型 blob 对历史的污染,
重写后仓库功能、分支拓扑、正当修改内容必须与现状等价。

## 硬约束
1. 先做完整仓库备份(git bundle 或整体拷贝)再动任何历史;备份路径写入报告。
2. 优先 git filter-repo(无则 filter-branch);只剔除事故 blob/路径,不得误删 59 个正当修改
   (它们在后续提交中,重写后必须仍在)。
3. 重写会改变全部提交哈希:需 force-push 协调——先确认本仓 remote(fork/origin)现状,
   用 relay 卡与 8088/其他协作会话同步重写计划,取得确认窗口后再推。
4. 完成判定:size-pack 显著下降(目标 < 50 MiB 或至少减半)、`git log --stat` 无 >1000 文件提交
   (可由后续对齐校验 H 面复核)、正当修改文件内容 diff 为空(git diff 旧/新树 grep 验证)。
5. 全程可回退:保留 pre-rewrite bundle,失败即还原。

## 输出契约
1. 瘦身方案与执行证据(命令、前后 size-pack、重写提交数统计 log 文件)
2. force-push 协调记录(通知了谁、确认时间)
3. 复核:对齐校验 `python scripts/alignment_check.py` H 面不再报 5120dd87c7;
   HANDOVER/台账追加瘦身完成记录
4. 接力卡置 done 回执(附报告路径)"""

rpc("session/prompt", {"request": {
    "requestId": str(uuid.uuid4()),
    "sessionId": sid,
    "mode": "queue",
    "content": [{"type": "text", "text": mission}],
}})
print("MISSION_QUEUED into", sid)