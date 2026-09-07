# @deepseek-ai/dsh-client-ui-mindmap

English | [中文](README.zh.md)

**思维导图对话画布** — 线性聊天记录的空间化、节点图替代品。每个节点都是一个 *Issue* 或 *PR*，携带完整的 DSH 能力（工具、子代理、目标、审批、文件、快照）。画布是主要对话界面；传统聊天视图成为同一持久会话日志的一个 *透镜*。

---

## 核心理念

| 传统聊天 | 思维导图画布 |
|----------|-------------|
| 线性、按时间排序的气泡 | 空间化、语义化的图（Issue→PR→Issue…） |
| 一次只有一个活跃轮次 | 多个并发 *工作流*（分支） |
| 滚动查找上下文 | 缩放/平移 + 语义搜索 + 缩略图 |
| 通过 fork 隐含父子关系 | 显式边带类型化关系 |
| 会话 = 一条记录 | 会话 = 一个 **画布**（持久化、可分享） |

---

## 节点分类

```ts
type NodeKind =
  | 'issue'           // 用户需求、问题、任务
  | 'pr'              // 代码变更、方案实现、交付物
  | 'decision'        // 架构决策、ADR、技术选型
  | 'research'        // 调研、对比、Spike
  | 'review'          // 代码审查、设计评审
  | 'test'            // 测试用例、验收标准
  | 'deploy'          // 发布、部署、回滚
  | 'incident'        // 线上故障、复盘
  | 'meta'            // 目标、里程碑、Epic
```

每个节点携带 **完整上下文**：

```ts
interface MindMapNode {
  id: string                    // ULID
  kind: NodeKind
  title: string
  body: string                  // Markdown / 富文本
  status: NodeStatus            // open | in_progress | review | merged | closed | blocked
  assignee?: AgentRef           // human | subagent | skill
  labels: string[]
  // ── DSH 原生能力绑定 ──────────────────────
  sessionId?: string            // 关联的子会话 (fork/spawn)
  goalId?: string               // 关联的 Goal
  toolCalls: ToolCallRef[]      // 本节点触发的工具调用
  approvals: ApprovalRef[]      // 审批记录
  files: FileRef[]              // 产出/修改的文件
  snapshots: SnapshotRef[]      // 关键时间点快照
  // ── 图拓扑 ─────────────────────────────
  parentIds: string[]           // 父节点 (支持多父)
  childIds: string[]            // 子节点
  edgeTypes: EdgeType[]         // derives_from | blocks | duplicates | relates_to | fixes | tests
  // ── 视觉/布局 ──────────────────────────
  position: { x: number; y: number }
  size?: { w: number; h: number }
  color?: string                // 语义色 (kind 映射)
  collapsed?: boolean           // 子树折叠
  pinned?: boolean              // 固定在画布
  // ── 元数据 ────────────────────────────
  createdAt: number
  updatedAt: number
  createdBy: IdentityRef
  version: number               // 乐观锁
}
```

---

## 边语义

| 边类型 | 语义 | 视觉 | 约束 |
|--------|------|------|------|
| `derives_from` | 子任务拆解 | 实线 ▸ | 树形，无环 |
| `blocks` | 阻塞关系 | 虚线 ⊣ | 可跨分支 |
| `duplicates` | 重复/替代 | 灰虚线 ≡ | 互斥 |
| `relates_to` | 关联/参考 | 点线 ~ | 无约束 |
| `fixes` | PR 修复 Issue | 粗实线 ✦ | PR→Issue |
| `tests` | 测试覆盖 | 绿实线 ✓ | Test→PR |
| `depends_on` | 依赖顺序 | 箭头 ⇒ | 拓扑序 |

---

## 画布功能

### 1. 多视图模式
- **Canvas** — 自由画布，拖拽布局，自动布局
- **Outline** — 树形大纲，聚焦层级
- **Timeline** — 时间轴视图，按 createdAt 排序
- **Kanban** — 按 status 分列
- **Graph** — 力导向图，自动聚类

### 2. 智能布局引擎
- **Hierarchical** (Sugiyama) — Issue/PR 树
- **Force-directed** (D3/Graphology) — 关联图
- **Radial** — 以 Epic 为中心
- **Grid/Snake** — 批量整理
- **一键自动布局** — 上下文感知

### 3. 交互原语
| 动作 | 触发 | 结果 |
|------|------|------|
| 创建节点 | 双击空白 / 右键 / 快捷键 `N` | 新 Issue 节点，光标位置 |
| 连线 | 拖拽节点句柄 → 目标节点 | 边类型选择器弹出 |
| 折叠/展开 | 点击折叠图标 / `Space` | 子树收起/展开 |
| 多选 | 框选 / `Shift+Click` | 批量操作工具栏 |
| 搜索 | `Cmd+F` / 顶栏 | 高亮匹配，mini-map 标记 |
| 筛选 | 顶栏 Filter Chip | 仅显示匹配 kind/status/label |
| 时间旅行 | 滑块 / 历史面板 | 回放 canvas 状态 |
| 分支对比 | 选中两节点 → `Diff` | 结构/内容 差异视图 |

### 4. DSH 深度集成
- **节点即会话** — 点击节点 `Open Session` 在右侧/抽屉打开关联子会话
- **工具调用可视化** — 节点悬浮显示工具调用链，点击跳转 trajectory
- **Goal 绑定** — 节点关联 Goal，进度条投影在节点上
- **Approval 流** — Review 节点原生渲染 ApprovalPanel
- **文件追踪** — Files 面板展示节点涉及文件，支持跳转编辑器
- **Subagent 并发** — 并行分支各自 spawn subagent，canvas 实时同步进度

### 5. 持久化与同步
- **单一数据源** — 复用 `session-persistence`，每个 canvas 变更 = 一个 `mindmap/mutation` event
- **CRDT 协作** — 基于 Yjs / Automerge，多端实时协作
- **Git 同步** — 导出为 `.mindmap.json`，可提交版本控制
- **导入导出** — Mermaid / PlantUML / GraphML / PNG / SVG

---

## 架构

```
packages/client/ui-mindmap/
├── src/
│   ├── canvas/           # Canvas 核心渲染引擎
│   │   ├── renderer/     # WebGL/Canvas2D/React Flow 适配器
│   │   ├── layout/       # 布局算法 (hierarchical, force, radial)
│   │   ├── interaction/  # 拖拽、选择、连线、缩放
│   │   └── viewport.ts   # 视口变换、mini-map
│   ├── store/            # 状态管理 (Zustand + Immer)
│   │   ├── mindmap.ts    # 主 store
│   │   ├── history.ts    # Undo/Redo (command pattern)
│   │   ├── selection.ts  # 选区管理
│   │   └── sync.ts       # CRDT / persistence 同步
│   ├── nodes/            # 节点组件与注册
│   │   ├── registry.ts   # NodeKind → Component 映射
│   │   ├── IssueNode.tsx
│   │   ├── PRNode.tsx
│   │   ├── DecisionNode.tsx
│   │   └── ...
│   ├── edges/            # 边组件
│   │   ├── EdgeRenderer.tsx
│   │   ├── EdgeTypes.ts
│   │   └── EdgeLabel.tsx
│   ├── panels/           # 侧边面板
│   │   ├── Inspector.tsx     # 节点详情/编辑
│   │   ├── Search.tsx        # 语义搜索
│   │   ├── Filter.tsx        # 多维筛选
│   │   ├── History.tsx       # 时间旅行
│   │   ├── MiniMap.tsx       # 缩略图导航
│   │   └── Toolbar.tsx       # 顶部工具栏
│   ├── integration/      # DSH 运行时集成
│   │   ├── sessionBridge.ts  # 双向同步 session ↔ canvas
│   │   ├── projectionHooks.ts # useProjection 适配
│   │   ├── toolCallMapper.ts  # tool-call → node 边
│   │   └── subagentTracker.ts # subagent 节点映射
│   ├── commands/         # 命令面板扩展
│   │   └── mindmapCommands.ts
│   ├── apply.ts          # 插件入口，注册 slots
│   └── contract/         # Slot 契约、共享类型
│       ├── slots.ts
│       └── types.ts
├── tests/
└── package.json
```

---

## Slot 契约 (跨包组合)

```ts
// conversation.view 新增 'mindmap' 入口
ctx.slots.register('conversation.view', {
  id: 'mindmap',
  order: 10,
  label: 'Mind-Map',
  icon: 'git-branch',
  component: MindMapView,
})

// 侧边栏扩展
ctx.slots.register('sidebar.section', {
  id: 'mindmap-outline',
  component: OutlinePanel,
})

// 节点右键菜单扩展
ctx.slots.register('mindmap.node.contextmenu', {
  id: 'spawn-subagent',
  label: 'Spawn Subagent Here',
  action: (node) => spawnSubagentForNode(node),
})
```

---

## 持久化 Schema (兼容 session-persistence)

```json
{
  "event": "mindmap/mutation",
  "payload": {
    "op": "upsert_node" | "delete_node" | "upsert_edge" | "delete_edge" | "batch",
    "nodes": MindMapNode[],
    "edges": MindMapEdge[],
    "viewport": { "x": 0, "y": 0, "zoom": 1 },
    "selection": string[],
    "timestamp": 1700000000000
  }
}
```

检查点策略：每 30s 或 50 次变更自动 checkpoint；手动 `Cmd+S` 强制。

---

## 性能目标

| 指标 | 目标 |
|------|------|
| 10k nodes 渲染 | < 100ms (WebGL) / < 300ms (React Flow) |
| 平移缩放 60fps | ✅ (GPU 加速) |
| 布局 1k nodes | < 500ms (WebWorker) |
| 搜索索引建立 | < 200ms (MiniSearch) |
| 内存占用 10k nodes | < 150MB |

---

## 迁移路径 (从 Chat 视图)

1. **只读镜像** — 现有 session 自动投影为 mindmap (启发式：turn → issue, tool-call → pr)
2. **双视图** — Chat + MindMap 标签页共存，双向同步选中
3. **默认翻转** — 新会话默认打开 MindMap，Chat 降级为 Lens
4. **遗留导入** — 旧 session 一键转换，保留完整历史

---

## 已知限制与未来规划

- [ ] 离线优先 (Service Worker + IndexedDB)
- [ ] 实时语音标注节点
- [ ] AI 辅助布局 (LLM 建议拆分/合并)
- [ ] 3D 视图 (Three.js)
- [ ] 插件市场：自定义 NodeKind / EdgeType / Layout