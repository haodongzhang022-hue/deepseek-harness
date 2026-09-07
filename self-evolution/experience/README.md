# experience-store

经验蒸馏入库/检索/镜像的独立可安装包。把已解决的 Case（问题→解法）蒸馏为可复用经验，
写入唯一事实库（SQLite + FTS5），支持加权检索回灌复用，并自动渲染人类可读镜像。

纯标准库，零第三方依赖，不耦合 deepseek-harness / review-guardrail，可独立安装、独立开源。

## 特性

- **蒸馏写入**：`add` 把 Case 写入经验库；置信度低于 `distill.min_confidence` 时 **fail loud 拒绝**，禁止模拟数据。
- **唯一事实库**：SQLite（`experiences` 表 + FTS5 trigram 索引），支持中文子串检索。
- **统一时间戳**：行与其镜像共用同一 `created_ts`，保证时间序列一致。
- **加权检索（回灌）**：`search` 按 置信度 + 新鲜度（新版本最高权重）+ 复用频次 加权排序；真实 FTS5 命中，短词回退真实 LIKE。
- **复用晋升**：`promote` 复用频次+1，达阈值置信度上探，鼓励反复验证过的经验。
- **镜像**：`render` 全量重渲染 Markdown，新时间戳在前（最高权重），旧经验保留不作直接参考。
- **跨进程持久化**：SQLite 保证进程 A 写入、进程 B 可检索（已验证）。

## 安装

```sh
pip install -e .            # 从本目录（无第三方依赖，离线可装）
pip install experience-store # 发布到 PyPI 后
```

## 用法（CLI）

```sh
# 蒸馏一条经验入库（--ts 缺省用当前 UTC 时间戳，与镜像一致）
experience-store add --case case-x --title "标题" --problem "问题" --solution "解法" \
    --tags tag1,tag2 --confidence 0.9

# 加权检索（回灌复用）
experience-store search "关键词"

# 复用一次（累计频次，达阈值置信度上探）
experience-store promote --case case-x

# 重渲染镜像 Markdown
experience-store render
```

`--config experience.yml` 指定策略文件（缺省用包同级示例），db/mirror 路径相对该文件所在目录。

## 用法（Python API）

```python
from experience_store import ExperienceStore, parse_policy

store = ExperienceStore(parse_policy(open("experience.yml", encoding="utf-8").read()), "experience.yml")
store.add("case-a", "标题", "问题", "解法", tags=["t1"], confidence=0.9)
for e in store.search("标题"):
    print(e.case_id, e.score, e.created_ts)
```

## 策略（experience.yml 声明化，改配置即调参）

| 段 | 说明 |
|---|---|
| `store` | db 路径 / 表名 / FTS 表名 / 时间戳格式 |
| `distill` | 最低置信度、复用晋升阈值 |
| `rank` | 检索权重（confidence/recency/usage）与 top_k |
| `mirror` | 镜像路径与自动渲染开关 |

## 版本迭代

### v0.3.0 · 2026-08-26
- 从 `self-evolution/experience` 解耦为独立可安装包：`experience_store/` 包 + `pyproject.toml` + CLI 入口。
- 公开 API：`ExperienceStore / Experience / parse_policy / DEFAULT_POLICY`；构造函数支持缺省策略。
- 验证：低置信拒收、FTS5 中文子串、新版本最高权重、统一时间戳、复用晋升、跨进程持久化均通过。
- 解耦 e2e 护栏：`tests/test_installed_pkg.py`——构建 wheel + `pip install --target` 到独立目录（零依赖）→ 外部 import OK → CLI 全链路 add→search→render → 跨进程持久化（进程 A 写 / 进程 B 读）真实生效。

### v0.1.0~v0.2.0（前身，`self-evolution/experience` 内）
- 蒸馏/落库/加权检索/镜像核心与测试护栏成型（详见 `self-evolution/README.md` 版本迭代）。

## License

[MIT](LICENSE)
