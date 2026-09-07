/**
 * @dsh-external/dsh-release-board — host half.
 * 发布看板数据源：直读 omni-meta release_control 权威 queue.json（与 release_control
 * MCP 工具同一真相源，不依赖 8008 门禁在线）+ 门禁端口健康探活。
 * 提供：模型工具 release_board_snapshot + 面板 HTTP API /api/snapshot。
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync, statSync } from 'node:fs'
import z from 'schemastery'

export const name = '@dsh-external/dsh-release-board'
export const inject = ['tools', 'webServer']

export interface Config {
  /** 权威队列文件（默认读 RELEASE_QUEUE_PATH 环境变量，兜底 omni-meta 默认路径） */
  queuePath: string
  /** 探活端口清单 */
  probePorts: number[]
}

export const Config = z.object({
  queuePath: z.string().default(''),
  probePorts: z.array(z.number()).default([8008, 8009, 8010, 8011, 8012, 8013, 8014, 8015, 8016, 8027, 8028]),
})

const PORT_ENV: Record<number, string> = {
  8008: 'integ', 8027: 'staging', 8028: 'prod',
}
const STATUS_ORDER = [
  'production_approved', 'queued_8027', 'testing_8027', 'queued_8008',
  'testing_8008', 'rejected_8027', 'rejected_8008',
]
const STATUS_LABEL: Record<string, string> = {
  production_approved: '生产已批准(待人工晋升)',
  queued_8027: '8027 排队', testing_8027: '8027 测试中',
  queued_8008: '8008 排队', testing_8008: '8008 测试中',
  rejected_8027: '8027 驳回', rejected_8008: '8008 驳回',
}

interface DecisionInfo {
  gate: string
  decision: string
  at: string
  reason: string
}

function lastDecision(item: Record<string, unknown>): DecisionInfo | null {
  const results = item.gate_results as Array<{ port?: unknown; decision?: unknown; rejection_reason?: unknown; at?: unknown }> | undefined
  if (!Array.isArray(results) || results.length === 0) return null
  const last = results[results.length - 1]
  const reason = String(last.rejection_reason ?? '')
  return {
    gate: Number(last.port) === 8027 ? '8027' : '8008',
    decision: String(last.decision ?? ''),
    at: String(last.at ?? ''),
    reason: reason.length > 220 ? reason.slice(0, 220) + '…' : reason,
  }
}

async function probePort(port: number): Promise<{ port: number; env: string; up: boolean; http: number | null; note: string }> {
  const env = PORT_ENV[port] ?? (port >= 8009 && port <= 8016 ? 'test' : 'other')
  try {
    const response = await fetch('http://127.0.0.1:' + String(port) + '/health', {
      signal: AbortSignal.timeout(1500),
    })
    return { port, env, up: true, http: response.status, note: response.status === 200 ? '健康' : '响应 ' + String(response.status) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cause = (error as { cause?: { code?: string; message?: string } }).cause
    const refused = /ECONNREFUSED|积极拒绝|10061/i.test(message) || cause?.code === 'ECONNREFUSED'
    return { port, env, up: false, http: null, note: refused ? '未监听(拒绝连接)' : (message.includes('timeout') || message.includes('abort') ? '探活超时' : (String(cause?.message ?? message).slice(0, 60))) }
  }
}

export function apply(ctx: Context & { webServer?: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void } }, rawConfig: Config): void {
  const queuePath = rawConfig.queuePath !== ''
    ? rawConfig.queuePath
    : (process.env.RELEASE_QUEUE_PATH ?? 'E:/1shuju/omni-meta/data/release_control/queue.json')

  const buildSnapshot = async (): Promise<Record<string, unknown>> => {
    const mtime = existsSync(queuePath) ? statSync(queuePath).mtime.toISOString() : null
    let queueRaw: string | null = null
    let parseError: string | null = null
    try {
      queueRaw = existsSync(queuePath) ? readFileSync(queuePath, 'utf8') : null
    } catch (error) {
      parseError = 'queue.json 读取失败: ' + String(error instanceof Error ? error.message : error)
    }
    let state: Record<string, unknown> | null = null
    try {
      state = queueRaw !== null ? JSON.parse(queueRaw) as Record<string, unknown> : null
    } catch (error) {
      parseError = 'queue.json JSON 解析失败: ' + String(error instanceof Error ? error.message : error)
    }
    const issues = Array.isArray(state?.issues) ? state.issues as Array<Record<string, unknown>> : []
    const counts: Record<string, number> = {}
    const byStatus: Record<string, Array<Record<string, unknown>>> = {}
    for (const status of STATUS_ORDER) counts[status] = 0
    for (const issue of issues) {
      const status = String(issue.status ?? 'unknown')
      counts[status] = (counts[status] ?? 0) + 1
      if (byStatus[status] === undefined) byStatus[status] = []
      byStatus[status].push(issue)
    }
    const now = Date.now()
    const buckets = STATUS_ORDER
      .filter(s => (byStatus[s]?.length ?? 0) > 0)
      .map(s => ({
        status: s,
        label: STATUS_LABEL[s] ?? s,
        count: counts[s] ?? 0,
        items: [...(byStatus[s] ?? [])]
          .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
          .slice(0, 30)
          .map(issue => {
            const upd = String(issue.updated_at ?? '')
            const ageMs = now - new Date(upd).getTime()
            return {
              issue_id: String(issue.issue_id ?? ''),
              title: String(issue.title ?? ''),
              change_type: String(issue.change_type ?? ''),
              source_port: Number(issue.source_port ?? 0),
              target_modules: Array.isArray(issue.target_modules) ? issue.target_modules : [],
              updated_at: upd,
              age_days: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 86400000)) : null,
              last_decision: lastDecision(issue),
            }
          }),
      }))
    const modules = (state?.modules ?? {}) as Record<string, { version?: unknown }>
    const agentsRaw = (state?.agents ?? {}) as Record<string, Record<string, unknown>>
    const agents = Object.entries(agentsRaw)
      .map(([port, a]) => ({
        port: Number(port),
        agent_id: String(a.agent_id ?? ''),
        session_id: String(a.session_id ?? ''),
        expires_at: String(a.expires_at ?? ''),
        status: String(a.status ?? ''),
        expired: new Date(String(a.expires_at ?? '0')).getTime() < now,
      }))
      .sort((a, b) => a.port - b.port)
    const probePorts = Array.isArray(rawConfig.probePorts) && rawConfig.probePorts.length > 0 ? rawConfig.probePorts : [8008, 8009, 8010, 8011, 8012, 8013, 8014, 8015, 8016, 8027, 8028]
    const infra = await Promise.all(probePorts.map(port => probePort(port)))
    return {
      generatedAt: new Date().toISOString(),
      queuePath,
      queueMtime: mtime,
      parseError,
      schema_version: state?.schema_version ?? null,
      next_sequence: state?.next_sequence ?? null,
      counts,
      buckets,
      modules: Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, v?.version ?? '?'])),
      agents,
      infra,
    }
  }

  // 模型工具：agent 快速读进度（无需文件访问）
  ctx.tools.register(defineTool({
    name: 'release_board_snapshot',
    description: '发布看板: 直读 omni-meta release_control queue.json 权威状态 (RC issue 按状态分桶统计/最近更新/驳回原因) + 8008-8028 门禁端口探活。用于快速判断发布进度。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const snap = await buildSnapshot()
      const lines: string[] = []
      lines.push('== 发布看板 ' + String(snap.generatedAt) + ' ==')
      if (snap.parseError !== null && snap.parseError !== undefined) lines.push('⚠️ ' + String(snap.parseError))
      lines.push('-- 状态桶 --')
      const buckets = snap.buckets as Array<{ label: string; count: number; status: string }>
      const bucketDetail = (snap.buckets as Array<{ status: string; items: Array<{ issue_id: string; updated_at: string }> }>)
      for (const b of buckets) {
        const recent = bucketDetail.find(x => x.status === b.status)?.items.slice(0, 6) ?? []
        lines.push('- ' + b.label + ' (' + String(b.count) + '): ' + recent.map(i => i.issue_id + '@' + String(i.updated_at).slice(0, 10)).join(', '))
      }
      lines.push('-- 门禁端口 --')
      for (const p of snap.infra as Array<{ port: number; env: string; up: boolean; note: string }>) {
        lines.push('- ' + String(p.port) + ' (' + p.env + '): ' + (p.up ? 'UP ' + p.note : 'DOWN ' + p.note))
      }
      lines.push('-- agent --')
      const agents = snap.agents as Array<{ port: number; expired: boolean; agent_id: string }>
      lines.push('- ' + (agents.length > 0 ? agents.map(a => String(a.port) + (a.expired ? '(过期)' : '(live)') + ' ' + a.agent_id).join('; ') : '无注册'))
      return lines.join('\n')
    },
  }))

  // 面板 HTTP API
  const webServer = ctx.get('webServer') as { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void } | undefined
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/@dsh-external/dsh-release-board/api/snapshot',
      handler: async (_req, res) => {
        const response = res as { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }
        try {
          const body = JSON.stringify(await buildSnapshot())
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(body)
        } catch (error) {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          response.end(String(error instanceof Error ? error.message : error))
        }
      },
    }), 'release-board:snapshot-api')
  }
}
