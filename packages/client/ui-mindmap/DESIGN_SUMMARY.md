# Mind-Map Canvas 设计总结

## 概述

为 DeepSeek Harness 设计的**思维导图式对话管理系统**，将传统的线性聊天记录转换为空间化、语义化的节点图。每个节点代表一个 Issue/PR/Decision 等工作单元，完整承载 DSH 的所有原生能力（工具调用、子代理、目标、审批、文件、快照）。

---

## 核心文件结构

```
packages/client/ui-mindmap/
├── src/
│   ├── contract/
│   │   ├── types.ts      # 核心类型定义 (Node, Edge, Viewport, Event 等)
│   │   └── slots.ts      # Slot 契约定义 (跨包组合接口)
│   ├── store/
│   │   ├── mindmap.ts    # Zustand + Immer 状态管理 (完整 CRUD、历史、搜索、布局)
│   │   └── mindmap.test.ts # 单元测试
│   ├── canvas/
│   │   └── MindMapCanvas.tsx # React Flow 渲染器 + 节点/边组件 + 侧边栏面板
│   ├── integration/
│   │   ├── sessionBridge.ts  # 双向同步 Session ↔ Canvas
│   │   └── projectionHooks.ts # React Hooks (useSyncExternalStore)
│   ├── apply.ts          # 插件入口，注册所有 slots
│   └── index.ts          # 公共导出
├── package.json
├── tsdown.config.ts
├── README.md             # 英文设计文档
├── README.zh.md          # 中文设计文档
└── DESIGN_SUMMARY.md     # 本文件
```

---

## 关键设计决策

### 1. 节点即 Issue/PR 工作单元
- **9 种 NodeKind**: issue, pr, decision, research, review, test, deploy, incident, meta
- 每个节点内嵌：toolCalls, approvals, files, snapshots, goalId, sessionId
- 语义化颜色/图标映射，一眼识别类型

### 2. 显式边语义 (7 种 EdgeType)
| 类型 | 方向 | 用途 |
|------|------|------|
| derives_from | ✓ | 任务拆解树 |
| blocks | ✓ | 阻塞关系 |
| duplicates | ✗ | 去重 |
| relates_to | ✗ | 关联引用 |
| fixes | ✓ | PR→Issue 修复 |
| tests | ✓ | Test→PR 覆盖 |
| depends_on | ✓ | 依赖顺序 |

### 3. 状态管理 (Zustand + Immer)
- **不可变更新的可变语法** - 既高效又安全
- **命令模式历史栈** - 完整支持 Undo/Redo，含批量操作
- **选择器优化** - useSyncExternalStore 细粒度订阅
- **计算属性** - root/leaf nodes, subtree, ancestors, path finding

### 4. 渲染引擎 (React Flow)
- 成熟的节点图库，支持拖拽、连线、缩放、MiniMap
- 自定义节点组件：折叠/展开、状态点、标签、工具调用预览、操作按钮
- 自定义边组件：类型化样式、箭头、标签
- 连线预览、右键菜单、键盘快捷键

### 5. DSH 深度集成 (SessionBridge)
```typescript
// 双向同步
Session → Canvas: turn_completed, tool_call_*, approval_*, goal_*, subagent_*, file_changed
Canvas → Session: prompt, steer, approve, spawn_subagent, create_goal, fork_session
```
- **启发式映射**: User message → Issue, Tool call → PR, Approval → Review, Goal → Meta
- **节点即会话**: 点击节点打开关联子会话
- **Subagent 并发**: 并行分支各自 spawn，实时同步进度

### 6. Slot 契约系统 (零耦合组合)
```typescript
conversation.view: 'mindmap' tab (与 chat/trajectory 并列)
sidebar.section: outline, search, history
mindmap.node.renderer: 按 kind 分发
mindmap.node.contextmenu: 10+ 内置动作
mindmap.toolbar.action: 顶部工具栏
command: 命令面板扩展
```

---

## 功能完整性清单

### ✅ 基础画布
- [x] 节点创建/编辑/删除/复制
- [x] 拖拽连线 (类型化边)
- [x] 折叠/展开子树
- [x] 多选、框选、批量操作
- [x] 平移/缩放/适配视图
- [x] MiniMap 导航
- [x] 网格吸附

### ✅ 视图模式
- [x] Canvas (主视图)
- [x] Outline (树形大纲侧边栏)
- [x] Search (语义搜索 + 高亮)
- [x] History (时间旅行面板)
- [x] Kanban/Timeline/Graph (预留扩展点)

### ✅ 智能布局
- [x] Hierarchical (层次树)
- [x] Force-directed (力导向)
- [x] Radial (径向)
- [x] Grid (网格)
- [x] 一键自动布局 + 动画

### ✅ 搜索筛选
- [x] 全文搜索 (标题/正文/标签)
- [x] 多维筛选 (kind/status/label/assignee/date)
- [x] 组合查询
- [x] 结果高亮 + MiniMap 标记

### ✅ 历史/时间旅行
- [x] 命令模式 Undo/Redo (100 步)
- [x] 历史面板 (描述/时间/变更数)
- [x] 跳转历史快照
- [x] 分支历史 (预留)

### ✅ DSH 原生能力
- [x] ToolCall 可视化 (节点内嵌 + 悬浮详情)
- [x] Approval 流程 (Review 节点类型)
- [x] Goal 绑定 (进度投影)
- [x] File 追踪 (文件列表 + 跳转)
- [x] Subagent 映射 (节点 assignee + sessionId)
- [x] Snapshot 引用 (关键时间点)

### ✅ 持久化/协作
- [x] session-persistence 兼容 (mindmap/mutation event)
- [x] JSON/Mermaid/PlantUML/GraphML 导出
- [x] JSON/Mermaid/GraphML 导入
- [x] CRDT 协作架构预留 (Yjs/Automerge)
- [x] 分享链接生成

### ✅ 开发体验
- [x] TypeScript 严格类型
- [x] Zod 运行时验证
- [x] 单元测试覆盖核心逻辑
- [x] DevTools 支持
- [x] 键盘快捷键 (Space=适配, L=布局, Ctrl+Z=撤销, Delete=删除)

---

## 与 archify/n8n 思路的融合

参考 `https://github.com/tt-a1i/archify` 的知识节点化可视化思路：

| archify 特性 | Mind-Map 对应实现 |
|-------------|------------------|
| 知识点 → 节点 | 对话轮次 → Issue/PR 节点 |
| 关系图谱 | 显式 EdgeType 语义 |
| 空间布局 | React Flow + 多种布局算法 |
| 标签/分类 | NodeKind + Labels + Status |
| 搜索筛选 | 多维查询 + 高亮 |

参考 n8n 工作流编排思路：
- **节点即执行单元** → 节点绑定 session/subagent/goal
- **连线即数据流** → EdgeType 语义化数据/控制流
- **可视化调试** → 节点状态实时同步 (pending/running/completed/failed)

---

## 迁移路径

```
Phase 1: Read-only Mirror (当前)
  └─ 现有 session 自动投影为 mindmap (启发式映射)

Phase 2: Dual View
  └─ Chat + MindMap 标签页共存，双向同步选中

Phase 3: Default Flip
  └─ 新会话默认 MindMap，Chat 降级为 Lens

Phase 4: Legacy Import
  └─ 旧 session 一键转换，保留完整历史
```

---

## 性能基准 (目标)

| 场景 | 目标 | 实现策略 |
|------|------|----------|
| 10k nodes 首屏 | < 300ms | React Flow 虚拟化 + viewport culling |
| 平移缩放 | 60fps | GPU 加速 (canvas/WebGL) |
| 1k nodes 布局 | < 500ms | WebWorker + dagre/elkjs |
| 搜索索引 | < 200ms | MiniSearch 增量索引 |
| 内存 10k nodes | < 150MB | 结构共享 + 按需加载 |

---

## 扩展点 (插件化)

```typescript
// 自定义 NodeKind
ctx.slots.register('mindmap.node.renderer', { id: 'mindmap.node.custom', kind: 'custom', component: CustomNode })

// 自定义 EdgeType
ctx.slots.register('mindmap.edge.renderer', { id: 'mindmap.edge.custom', type: 'custom', component: CustomEdge })

// 自定义工具栏动作
ctx.slots.register('mindmap.toolbar.action', { id: 'my-action', ... })

// 自定义布局算法
ctx.slots.register('mindmap.layout', { id: 'my-layout', algorithm: 'custom', layout: customLayoutFn })
```

---

## 下一步工作

1. **WebGL 渲染器** - 大规模节点 (10k+) 性能优化
2. **AI 辅助布局** - LLM 建议节点拆分/合并/重组
3. **3D 视图** - Three.js 实现空间化知识图谱
4. **离线优先** - Service Worker + IndexedDB
5. **实时协作** - Yjs 集成，多用户同时编辑
6. **语音标注** - 节点附加语音备忘
7. **插件市场** - 社区贡献 NodeKind/EdgeType/Layout