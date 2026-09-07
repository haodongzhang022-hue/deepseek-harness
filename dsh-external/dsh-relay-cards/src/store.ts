/**
 * @dsh-external/dsh-relay-cards — 接力卡核心逻辑（纯 Node，零 cordis 依赖）。
 *
 * 实现 0903 主干「自动化接力卡流转」契约的持久化与校验：
 *  - 五要素：task_brief / input_context / current_progress / next_step / assignee_role / output_contract
 *  - 0903 增量字段：industry / architect_type / capabilities_required / priority / note
 *  - 状态机：open → in_progress → done（done 为终态，不可回退；仅可追加 note/验收证据）
 *  - 每次变更追加 history，审计可追溯
 *  - JSON 单文件原子持久化（tmp + rename），损坏文件自动隔离不崩溃
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const INDUSTRIES = ['generic', 'finance', 'game', 'video', 'novel', 'software'] as const
export type Industry = (typeof INDUSTRIES)[number]

export const STATUSES = ['open', 'in_progress', 'done'] as const
export type RelayStatus = (typeof STATUSES)[number]

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const
export type Priority = (typeof PRIORITIES)[number]

/** 对外字段（snake_case，与 preset/接力卡模板一致）。 */
export interface RelayInput {
  task_brief?: string
  input_context?: Record<string, unknown>
  current_progress?: string
  next_step?: string
  assignee_role?: string
  output_contract?: Record<string, unknown>
  industry?: string
  architect_type?: string
  capabilities_required?: string[]
  priority?: string
  note?: string
  status?: string
}

export interface ChangeRecord {
  at: string
  action: 'create' | 'update' | 'status'
  fields: string[]
  from?: RelayStatus
  to?: RelayStatus
}

export interface RelayCard {
  gid: string
  task_brief: string
  input_context: Record<string, unknown>
  current_progress: string
  next_step: string
  assignee_role: string
  output_contract: Record<string, unknown>
  industry: Industry
  architect_type: string
  capabilities_required: string[]
  priority: Priority
  note: string
  status: RelayStatus
  createdAt: string
  updatedAt: string
  history: ChangeRecord[]
}

/** 参数校验失败（工具层转换为可读错误返回，绝不 throw 出插件）。 */
export class RelayError extends Error {}

const REQUIRED: Array<[keyof RelayInput, string]> = [
  ['task_brief', 'task_brief'],
  ['current_progress', 'current_progress'],
  ['next_step', 'next_step'],
  ['assignee_role', 'assignee_role'],
]

function fail(msg: string): never {
  throw new RelayError(msg)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 校验（新建或更新共用）；带 requiredOnly 时强制必填。 */
export function validate(input: RelayInput, requireRequired: boolean): void {
  if (requireRequired) {
    for (const [key, label] of REQUIRED) {
      const v = input[key]
      if (typeof v !== 'string' || v.trim() === '') fail(`缺少必填字段 ${label}`)
    }
  }
  if (input.industry !== undefined && !(INDUSTRIES as readonly string[]).includes(input.industry)) {
    fail(`industry 非法: ${input.industry}（可选值: ${INDUSTRIES.join(', ')}）`)
  }
  if (input.status !== undefined && !(STATUSES as readonly string[]).includes(input.status)) {
    fail(`status 非法: ${input.status}（可选值: ${STATUSES.join(', ')}）`)
  }
  if (input.priority !== undefined && !(PRIORITIES as readonly string[]).includes(input.priority)) {
    fail(`priority 非法: ${input.priority}（可选值: ${PRIORITIES.join(', ')}）`)
  }
  if (input.capabilities_required !== undefined) {
    if (!Array.isArray(input.capabilities_required) || input.capabilities_required.some((c) => typeof c !== 'string')) {
      fail('capabilities_required 必须是字符串数组')
    }
  }
  if (input.input_context !== undefined && !isRecord(input.input_context)) fail('input_context 必须是对象')
  if (input.output_contract !== undefined && !isRecord(input.output_contract)) fail('output_contract 必须是对象')
}

/** 接力卡商店: 单文件 JSON 原子持久化。 */
export class RelayStore {
  private cards = new Map<string, RelayCard>()
  private seq = 0
  private readonly file: string
  readonly dataDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'relay-cards.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      this.isolateCorrupt('unreadable')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.isolateCorrupt('bad-json')
      return
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.cards)) {
      this.isolateCorrupt('bad-shape')
      return
    }
    for (const c of parsed.cards) {
      if (!isRecord(c) || typeof c.gid !== 'string') continue
      this.cards.set(c.gid, c as unknown as RelayCard)
      const n = parseInt(c.gid.slice(3), 10)
      if (Number.isFinite(n) && n > this.seq) this.seq = n
    }
  }

  /** 损坏文件隔离：重命名留档，从空重新开始，绝不抛给启动流程。 */
  private isolateCorrupt(reason: string): void {
    try {
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}-${reason}`)
    } catch {
      // 隔离失败也不抛出：启动优先。
    }
  }

  private persist(): void {
    const payload = JSON.stringify({ seq: this.seq, cards: [...this.cards.values()] }, null, 2)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, payload, 'utf8')
    renameSync(tmp, this.file)
  }

  private nextGid(): string {
    this.seq += 1
    return `RL-${String(this.seq).padStart(6, '0')}`
  }

  /** 新建接力卡（五要素必填）。 */
  create(input: RelayInput): RelayCard {
    validate(input, true)
    const now = new Date().toISOString()
    const status: RelayStatus = input.status ?? 'open'
    const card: RelayCard = {
      gid: this.nextGid(),
      task_brief: input.task_brief as string,
      input_context: input.input_context ?? {},
      current_progress: input.current_progress as string,
      next_step: input.next_step as string,
      assignee_role: input.assignee_role as string,
      output_contract: input.output_contract ?? {},
      industry: (input.industry as Industry) ?? 'generic',
      architect_type: input.architect_type ?? 'generic',
      capabilities_required: input.capabilities_required ?? [],
      priority: (input.priority as Priority) ?? 'P2',
      note: input.note ?? '',
      status,
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, action: 'create', fields: ['全部'], to: status }],
    }
    this.cards.set(card.gid, card)
    this.persist()
    return card
  }

  read(gid: string): RelayCard | undefined {
    return this.cards.get(gid)
  }

  /** 列表过滤（默认全部，倒序，limit 默认 50）。 */
  list(filter: { status?: string; assignee_role?: string; industry?: string; limit?: number }): RelayCard[] {
    let out = [...this.cards.values()]
    if (filter.status !== undefined) out = out.filter((c) => c.status === filter.status)
    if (filter.assignee_role !== undefined) out = out.filter((c) => c.assignee_role === filter.assignee_role)
    if (filter.industry !== undefined) out = out.filter((c) => c.industry === filter.industry)
    out.sort((a, b) => (a.gid < b.gid ? 1 : -1))
    return out.slice(0, filter.limit ?? 50)
  }

  /** 部分更新 + 状态机校验（done 为终态）。返回 null 表示 gid 不存在。 */
  update(gid: string, input: RelayInput): RelayCard | null {
    const card = this.cards.get(gid)
    if (!card) return null
    validate(input, false)
    if (card.status === 'done' && input.status !== undefined && input.status !== 'done') {
      fail(`接力卡 ${gid} 已 done（终态），不可回退为 ${input.status}`)
    }
    const now = new Date().toISOString()
    const fields: string[] = []
    if (input.task_brief !== undefined) { card.task_brief = input.task_brief; fields.push('task_brief') }
    if (input.input_context !== undefined) { card.input_context = input.input_context; fields.push('input_context') }
    if (input.current_progress !== undefined) { card.current_progress = input.current_progress; fields.push('current_progress') }
    if (input.next_step !== undefined) { card.next_step = input.next_step; fields.push('next_step') }
    if (input.assignee_role !== undefined) { card.assignee_role = input.assignee_role; fields.push('assignee_role') }
    if (input.output_contract !== undefined) { card.output_contract = input.output_contract; fields.push('output_contract') }
    if (input.industry !== undefined) { card.industry = input.industry as Industry; fields.push('industry') }
    if (input.architect_type !== undefined) { card.architect_type = input.architect_type; fields.push('architect_type') }
    if (input.capabilities_required !== undefined) { card.capabilities_required = input.capabilities_required; fields.push('capabilities_required') }
    if (input.priority !== undefined) { card.priority = input.priority as Priority; fields.push('priority') }
    if (input.note !== undefined) { card.note = input.note; fields.push('note') }
    let from: RelayStatus | undefined
    if (input.status !== undefined && input.status !== card.status) {
      from = card.status
      card.status = input.status as RelayStatus
      fields.push('status')
    }
    if (fields.length === 0) fail('未提供任何可更新字段')
    card.updatedAt = now
    card.history.push({ at: now, action: from !== undefined ? 'status' : 'update', fields, from, to: input.status as RelayStatus | undefined })
    this.persist()
    return card
  }
}
