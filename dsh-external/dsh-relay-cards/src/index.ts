/**
 * @dsh-external/dsh-relay-cards — 0903 主干「自动化接力卡流转」工具插件。
 *
 * 挂载方式：profiles/web/cordis.patch.yml insert，name = 本文件（file:// 形式）。
 * 工具：relay_write（创建或全量更新）/ relay_read / relay_list / relay_update（部分更新+状态机）。
 * 存储：单文件 JSON（默认 DSH_HOME/data/relay-cards/relay-cards.json），原子写，损坏自愈。
 * 稳定性契约：apply 内部任何异常只记日志，绝不抛出（不崩 web 主体）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { join } from 'node:path'
import { RelayStore, RelayError } from './store.ts'

export const name = '@dsh-external/dsh-relay-cards'
export const inject = ['tools']

export const Config = z.object({
  /** 接力卡 JSON 存储目录；空 = ${DSH_HOME}/data/relay-cards。 */
  dataDir: z.string().default(''),
  /** 总开关：false 时插件空转（工具不可用但可一键恢复）。 */
  enabled: z.boolean().default(true),
})

export type ConfigType = z.infer<typeof Config>

const STATUS_ENUM = ['open', 'in_progress', 'done'] as const
const INDUSTRY_ENUM = ['generic', 'finance', 'game', 'video', 'novel', 'software'] as const
const PRIORITY_ENUM = ['P0', 'P1', 'P2', 'P3'] as const

/** 接力卡共用字段（value schema per-property 形态，可选）。 */
const CARD_PROPS = {
  task_brief: { type: 'string' as const, description: '一句话任务目标（新建必填）' },
  input_context: { type: 'json' as const, description: '输入上下文（数据引用/前置卡/约束）' },
  current_progress: { type: 'string' as const, description: '当前进度（新建必填）' },
  next_step: { type: 'string' as const, description: '下一步动作（新建必填）' },
  assignee_role: { type: 'string' as const, description: '接手角色（注册表角色 ID）' },
  output_contract: { type: 'json' as const, description: '输出契约（产物路径/验收/评审人）' },
  industry: { type: 'string' as const, enum: INDUSTRY_ENUM, description: '行业 id（0903 必填，默认 generic）' },
  architect_type: { type: 'string' as const, description: '路由目标架构师类型（默认 generic）' },
  capabilities_required: { type: 'array' as const, items: { type: 'string' as const }, description: '所需行业能力集（混合角色任务必填）' },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM, description: '优先级，默认 P2' },
  note: { type: 'string' as const, description: '备注（如路由命中歧义标注）' },
  status: { type: 'string' as const, enum: STATUS_ENUM, description: '状态：open→in_progress→done' },
}

const out = () => ({
  schema: { type: 'object' as const, additionalProperties: true },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

export function apply(ctx: Context, config: ConfigType): void {
  const logger = { warn: (m: string) => ctx.logger.warn(m) }
  if (!config.enabled) {
    logger.warn('[relay-cards] disabled by config')
    return
  }
  let store: RelayStore
  try {
    const dataDir = config.dataDir
      ? config.dataDir
      : process.env.DSH_HOME
        ? join(process.env.DSH_HOME, 'data', 'relay-cards')
        : join(process.cwd(), '.dsh-home', 'relay-cards')
    store = new RelayStore(dataDir)
    logger.warn(`[relay-cards] store ready: ${dataDir}`)
  } catch (e) {
    logger.warn(`[relay-cards] init failed (plugin stays inert): ${String(e)}`)
    return
  }
  const tc = { store, logger }

  const safe = (fn: (args: Record<string, unknown>) => unknown) => async (args: Record<string, unknown>) => {
    try {
      return await fn(args)
    } catch (e) {
      if (e instanceof RelayError) return { ok: false, error: e.message }
      logger.warn(`[relay-cards] tool error: ${String(e)}`)
      return { ok: false, error: `internal error: ${String(e)}` }
    }
  }

  const tools = [
    defineTool({
      name: 'relay_write',
      description: '接力卡写入：无 gid = 新建（五要素必填）；有 gid = 全量覆盖式更新（可带 status 置 done 收尾）。0903 补 industry/architect_type/capabilities_required。',
      parameters: { gid: { type: 'string', description: '已有卡 gid（更新时传）' }, ...CARD_PROPS },
      output: out(),
      execute: safe(async (args) => {
        const { gid, ...rest } = args
        if (typeof gid === 'string' && gid) {
          const card = tc.store.update(gid, rest)
          if (!card) return { ok: false, error: `接力卡 ${gid} 不存在（可用 relay_list 查队列）` }
          return { ok: true, gid: card.gid, status: card.status, updatedAt: card.updatedAt, summary: card.task_brief }
        }
        const card = tc.store.create(rest)
        return { ok: true, gid: card.gid, status: card.status, createdAt: card.createdAt, summary: card.task_brief }
      }),
    }),
    defineTool({
      name: 'relay_read',
      description: '接力卡读取：拿完整上下文（含 input_context / output_contract / history 审计），接手前必读。',
      parameters: { gid: { type: 'string', description: '接力卡 gid', required: true } },
      output: out(),
      execute: safe(async (args) => {
        const card = tc.store.read(String(args.gid))
        if (!card) return { ok: false, error: `接力卡 ${args.gid} 不存在` }
        return { ok: true, card }
      }),
    }),
    defineTool({
      name: 'relay_list',
      description: '接力卡队列：按状态/角色/行业过滤，倒序返回最新卡（50 条上限）。扫描 open 卡找活干、确认入队、审计用。',
      parameters: {
        status: { type: 'string', enum: STATUS_ENUM, description: '按状态过滤' },
        assignee_role: { type: 'string', description: '按接手角色过滤' },
        industry: { type: 'string', enum: INDUSTRY_ENUM, description: '按行业过滤' },
        limit: { type: 'integer', description: '条数上限（默认 50）' },
      },
      output: out(),
      execute: safe(async (args) => {
        const cards = tc.store.list({
          status: args.status as string | undefined,
          assignee_role: args.assignee_role as string | undefined,
          industry: args.industry as string | undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        })
        return { ok: true, total: cards.length, cards: cards.map((c) => ({ gid: c.gid, status: c.status, assignee_role: c.assignee_role, industry: c.industry, task_brief: c.task_brief, updatedAt: c.updatedAt })) }
      }),
    }),
    defineTool({
      name: 'relay_update',
      description: '接力卡部分更新 + 状态机推进（open→in_progress→done）。done 为终态不可回退；只更新给出的字段。',
      parameters: { gid: { type: 'string', description: '接力卡 gid', required: true }, ...CARD_PROPS },
      output: out(),
      execute: safe(async (args) => {
        const { gid, ...rest } = args
        const card = tc.store.update(String(gid), rest)
        if (!card) return { ok: false, error: `接力卡 ${gid} 不存在` }
        return { ok: true, gid: card.gid, status: card.status, updatedAt: card.updatedAt, history: card.history.slice(-3) }
      }),
    }),
  ]

  for (const t of tools) {
    ctx.effect(() => ctx.tools.register(t))
  }
  logger.warn(`[relay-cards] tools registered: ${tools.map((t) => t.name).join(', ')}`)
}
