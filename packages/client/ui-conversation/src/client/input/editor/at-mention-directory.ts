/**
 * Default at-mention directories: the architect-team role roster
 * (collab.roles mirror) plus the external agent directory, so typing '@' in
 * the composer offers both @架构·X roles and @release-control/@staging/...
 * external agents. The resolver filters by label/insert prefix match against
 * the caret query (case-insensitive).
 */
/** One suggestion the directory resolver produced. */
export interface AtMentionCandidate {
  /** Stable id (dedup key). */
  readonly id: string
  /** Display label in the menu row. */
  readonly label: string
  /** Inserted text, including the leading '@' (e.g. '@架构·秘书'). */
  readonly insert: string
  /** Short role description (optional). */
  readonly detail?: string
}

/** Query-to-candidates resolver; may be async. */
export type AtMentionResolver = (query: string) => readonly AtMentionCandidate[] | Promise<readonly AtMentionCandidate[]>

/** Architect-team roles (mirrors the collab.roles catalog). */
const ROLE_CANDIDATES: readonly AtMentionCandidate[] = [
  { id: 'role-secretary', label: '架构·秘书', insert: '@架构·秘书', detail: '强制入口：接收诉求、翻译意图、分类路由' },
  { id: 'role-architect', label: '架构·总师', insert: '@架构·总师', detail: '架构八步：调研→拓扑→可行性→方案→分工→协作→进度→索引' },
  { id: 'role-architect-assistant', label: '架构·总师助理', insert: '@架构·总师助理', detail: '协助总师推进架构方案' },
  { id: 'role-product', label: '架构·产品', insert: '@架构·产品', detail: '需求转化/澄清' },
  { id: 'role-manager', label: '架构·经理', insert: '@架构·经理', detail: '需求拆分/任务分配调度核心（四层分发）' },
  { id: 'role-lead', label: '架构·小组长', insert: '@架构·小组长', detail: '小组内工作组织' },
  { id: 'role-dev', label: '架构·开发', insert: '@架构·开发', detail: '解耦式模块开发，dev-standard 规范强约束' },
  { id: 'role-reviewer', label: '架构·评审', insert: '@架构·评审', detail: '评审/复评，输出契约绑定处置标签' },
  { id: 'role-tester', label: '架构·测试', insert: '@架构·测试', detail: '联调信号灯' },
  { id: 'role-delivery', label: '架构·交付', insert: '@架构·交付', detail: '全流程呈现+收尾交付（CP3 人类确认）' },
  { id: 'role-sentinel', label: '架构·监控哨兵', insert: '@架构·监控哨兵', detail: '防无效努力' },
  { id: 'role-data', label: '架构·数据管理员', insert: '@架构·数据管理员', detail: '数据归口' },
]

/** External agent directory (delegation targets). */
const EXTERNAL_CANDIDATES: readonly AtMentionCandidate[] = [
  { id: 'ext-release-control', label: 'release-control', insert: '@release-control', detail: '发布控制 Agent：整合测试与门禁' },
  { id: 'ext-staging', label: 'staging', insert: '@staging', detail: '预发布验证 Agent' },
  { id: 'ext-production', label: 'production', insert: '@production', detail: '生产发布 Agent' },
  { id: 'ext-matrix', label: 'matrix', insert: '@matrix', detail: '数据矩阵 Agent' },
  { id: 'ext-memory', label: 'memory', insert: '@memory', detail: '记忆管理 Agent' },
]

const ALL_CANDIDATES: readonly AtMentionCandidate[] = [...ROLE_CANDIDATES, ...EXTERNAL_CANDIDATES]

/**
 * Default directory resolver: exact '@' shows the full roster; a query
 * narrows by substring match on insert text (e.g. '架构·秘' → 秘书).
 */
export const directoryResolver: AtMentionResolver = (query) => {
  const q = query.trim()
  if (q === '') return ALL_CANDIDATES
  const folded = q.toLocaleLowerCase()
  return ALL_CANDIDATES.filter(c =>
    c.insert.toLocaleLowerCase().includes(folded) || c.label.toLocaleLowerCase().includes(folded))
}