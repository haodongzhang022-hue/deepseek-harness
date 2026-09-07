# 自动化门面板：Web GUI 内的管道状态表

状态：PROPOSED —— 未实现。

## 需求

用户要求在 dsh web GUI 内看到门管道表，位置是会话视图右侧的大块区域（automation-calendar 所在区域），并带三个筛选：仅本对话、仅当前项目文件夹、全部。

## 数据通路决策

- 门数据的真相在宿主侧：各gate账本加每次tick摘要（packages/automation/router）。浏览器读不到这些文件，必须有传输。
- 否决：会话帧。Jobs 以 frame.frames 折进 jobsBySession 镜像到达浏览器，但门条目是管道级全局态而非会话级；塞进会话帧会错述归属，还要拖动重放协议。
- 选定方向：专用全局列表镜像，形状与 jobsBySession 相同但不按会话键：
  1. 宿主：router daemon 为每个配置的 gate 维护权威快照（条目含 id/lane/state/notifiedState/notifyCount/wakeTarget/updatedAt），仅在变化时于提交点发布。
  2. 线路：一条广播帧或 SSE 事件携带 { gates: GateSnapshot[] }；连接层按 job 帧同样对待——替换不合并，id 由宿主铸造。
  3. 运行时：SessionManager（或对象层同级store）折叠为 gatesSnapshot，经现有客户端服务面暴露。
  4. 客户端插件 ui-automation-gates：注入 conversation.view 与日历并列，从绑定该镜像的 useGates() 框架钩子渲染表格；插件零RPC，与 ui-jobs 同构。

## 筛选

- 全部：所有gate行。
- 本对话：记录的唤醒目标等于当前打开会话的行。需要引擎在投递时把解析到的目标记入账本（小改：markNoticed 簿记带上目标）。
- 项目文件夹：来源 lane 解析到当前打开工作区的行（lane到工作区映射随 Phase C intake 到位；此前该筛选按 adapter/gate 名分组——对金融管道即 omni-meta 项目）。

## 非目标 / 延期

- v1 面板只读不做操作；重新提交仍归源会话。
- 不新增 session-log 事件：面板数据是展示侧计算态，非模型可见输入。