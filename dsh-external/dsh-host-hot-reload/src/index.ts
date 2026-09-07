/**
 * @dsh-external/dsh-host-hot-reload — 宿主插件热重载入口 (调用式, 无需重启)。
 *
 * 为运行中的 DSH 实例提供"改完插件源码 → 立即重载生效"的能力:
 * - HTTP  GET  /@dsh/hot-reload                 列出可重载的 file:// 条目
 * - HTTP  POST /@dsh/hot-reload {"name": "<entry>"} 重载一个条目
 * - HTTP  POST /@dsh/hot-reload {"all": true}       重载全部 file:// 条目
 * - 模型工具 hot_reload(target) 同一实现, 会话内可直接调用。
 *
 * 机制 (与 cordis-plugin-hmr 的 partial reload 同一配方, 全部公开 API):
 * 1) 备份并清除 ESM loadCache 与 CJS require.cache 中该插件源码目录的模块;
 * 2) loader.import(entryUrl) 重新导入模块得到新插件对象;
 * 3) registry.delete(oldPlugin) 释放旧 fiber 树;
 * 4) 用旧 fiber 的 parent.registry.plugin(newPlugin, config) 重建同构 fiber,
 *    使新代码立即接管原条目的服务/工具/路由;
 * 5) 任一失败回滚缓存与插件 (失败时进程保持旧代码, 不会半新半旧)。
 *
 * 仅处理 name 为 file:// (源码插件) 的条目; 包名条目由 loader 管理, 不在
 * 本工具范围 (其代码变更走包重建 + 常规加载)。
 * @module @dsh-external/dsh-host-hot-reload
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '@dsh-external/dsh-host-hot-reload'

/** 工具注册所需的宿主工具服务。 */
export const inject = ['tools'] as const

/** 最小 loader 面 (避免深类型依赖)。 */
interface LoaderFace {
  entries(): Array<{
    options: { id?: string; name: string }
    disabled?: boolean
    fiber?: { state?: number; runtime?: { callback?: unknown } } | null
  }>
  import(url: string, getOuterStack?: () => string[]): Promise<unknown>
  unwrapExports(exports: unknown): unknown
  internal?: { loadCache?: Map<unknown, unknown> }
}

type RegistryFace = {
  get(plugin: unknown): { fibers: Array<Fiber & { _config?: unknown }> } | undefined
  delete(plugin: unknown): void
}

/** 一个待重载条目的视图。 */
interface ReloadTarget {
  entry: { options: { id?: string; name: string } }
  url: string
}

/** logger 最小面。 */
interface LogFace {
  info(format: string, ...args: unknown[]): void
  warn(format: string, ...args: unknown[]): void
  warn(reason: unknown): void
}

/**
 * 收集可重载条目: name 以 file:// 开头且在插件源码目录内的条目。
 * @param loader - 加载器服务。
 * @returns 条目列表。
 */
function listTargets(loader: LoaderFace): ReloadTarget[] {
  const out: ReloadTarget[] = []
  for (const entry of loader.entries()) {
    const name = entry.options.name
    if (typeof name !== 'string') continue
    if (!name.startsWith('file://')) continue
    if (!/\/dsh-external\/|\/packages\/automation\//.test(name)) continue
    out.push({ entry, url: new URL(name).href })
  }
  return out
}

/**
 * 清理一个源码目录前缀下的全部模块缓存 (ESM loadCache + CJS require.cache),
 * 返回备份供失败回滚。
 * @param loadCache - loader 的 ESM 模块缓存。
 * @param url - 条目入口 URL (用其目录前缀匹配所有同源模块)。
 * @returns 备份与回滚函数。
 */
function clearModuleCaches(
  loadCache: Map<unknown, unknown>,
  url: string,
): { rollback: () => void } {
  const prefix = url.slice(0, url.lastIndexOf('/') + 1)
  const esmBackup = new Map<unknown, unknown>()
  const cjsBackup = new Map<string, unknown>()
  const require = createRequire(import.meta.url)
  for (const key of [...loadCache.keys()]) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue
    esmBackup.set(key, Map.prototype.get.call(loadCache, key))
    Map.prototype.delete.call(loadCache, key)
  }
  try {
    const filepath = fileURLToPath(prefix)
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(filepath)) {
        cjsBackup.set(key, require.cache[key])
        delete require.cache[key]
      }
    }
  } catch {
    // prefix 不是合法文件路径时跳过 CJS 面 (例如纯 URL 前缀)。
  }
  return {
    rollback: () => {
      for (const [key, job] of esmBackup) {
        if (job === undefined) Map.prototype.delete.call(loadCache, key)
        else Map.prototype.set.call(loadCache, key, job)
      }
      for (const [key, mod] of cjsBackup) require.cache[key] = mod
    },
  }
}

/**
 * 重载一个 file:// 插件条目: 清缓存 → 重导入 → 替换插件 → 重建同一组 fiber。
 * @param ctx - 宿主上下文。
 * @param target - 目标条目 (含解析后的入口 URL)。
 * @returns 结果摘要 (成功时含旧/新条目 id)。
 */
export async function reloadEntry(ctx: Context, target: ReloadTarget): Promise<{ ok: boolean; error?: string; name?: string; disposed?: number }> {
  const loader = ctx.get('loader') as LoaderFace | undefined
  // registry 是 Context 的原生插件注册表面 (cordis 内部), 不是服务表条目。
  const registry = (ctx as unknown as { registry?: RegistryFace }).registry
  const log = ctx.logger as unknown as LogFace
  if (loader === undefined || registry === undefined) {
    return { ok: false, error: 'loader/registry 服务不可用' }
  }
  const { url, entry } = target
  try {
    const loadCache = loader.internal?.loadCache
    if (loadCache === undefined) {
      return { ok: false, error: 'loader 模块缓存不可用 (internal.loadCache)' }
    }
    // loadCache 的 key 形式可能与条目 name 的 URL 大小写/编码有差异
    // (Windows 盘符大小写、路径编码), 做不敏感匹配。
    let realKey: unknown = url
    if (Map.prototype.get.call(loadCache, url) === undefined) {
      const wanted = String(url).toLowerCase()
      for (const key of [...loadCache.keys()]) {
        if (typeof key === 'string' && key.toLowerCase() === wanted) {
          realKey = key
          break
        }
      }
    }
    // 旧插件对象来自条目 fiber 的运行时回调 (不依赖 loadCache 内容——
    // Node 24 下被 delete 的 key 残留值为 undefined)。
    const entryRef = entry as { fiber?: { runtime?: { callback?: unknown } } | null }
    const oldPlugin = entryRef.fiber?.runtime?.callback
    const runtime = oldPlugin === undefined ? undefined : registry.get(oldPlugin)
    if (oldPlugin === undefined || runtime === undefined) {
      const hints = [...loadCache.keys()].filter(k => typeof k === 'string' && k.includes('automation-console'))
        .slice(0, 4).map(String).join('; ')
      return { ok: false, error: `条目 ${entry.options.name} 无活动 fiber (未激活或已卸载)。相近 key: ${hints}` }
    }
    const oldFibers = runtime.fibers
    const backup = clearModuleCaches(loadCache, String(realKey))

    const newPlugin = loader.unwrapExports(await loader.import(url, []))
    if (newPlugin === undefined || newPlugin === null) {
      backup.rollback()
      return { ok: false, error: '重新导入后插件导出为空, 已回滚' }
    }

    // 释放旧插件; 失败回滚 (缓存 + 旧插件)。
    try {
      registry.delete(oldPlugin)
    } catch (error) {
      backup.rollback()
      return { ok: false, error: '卸载旧插件失败: ' + String(error) }
    }

    // 用旧 fiber 的注册表与配置重建同构 fiber, 新代码立即接管。
    const rebuilt: Fiber[] = []
    try {
      for (const oldFiber of oldFibers) {
        const fiber = oldFiber.parent.registry.plugin(newPlugin, oldFiber._config, [])
        const entryRef = (oldFiber as unknown as { entry?: unknown }).entry
        ;(fiber as unknown as { entry?: unknown }).entry = entryRef
        if (entryRef !== undefined) {
          ;(entryRef as { fiber?: unknown }).fiber = fiber
        }
        rebuilt.push(fiber)
      }
    } catch (error) {
      // 重建失败: 回滚缓存并尝试恢复旧插件。
      backup.rollback()
      try {
        registry.delete(newPlugin)
        for (const oldFiber of oldFibers) {
          const fiber = oldFiber.parent.registry.plugin(oldPlugin, oldFiber._config, [])
          const entryRef = (oldFiber as unknown as { entry?: unknown }).entry
          ;(fiber as unknown as { entry?: unknown }).entry = entryRef
          if (entryRef !== undefined) {
            ;(entryRef as { fiber?: unknown }).fiber = fiber
          }
        }
      } catch (rollbackError) {
        log.warn('hot-reload 回滚失败: %C', rollbackError)
      }
      return { ok: false, error: 'fiber 重建失败: ' + String(error) }
    }

    log.info('hot-reload plugin at %C', entry.options.name)
    return { ok: true, name: entry.options.name, disposed: oldFibers.length }
  } catch (error) {
    log.warn('hot-reload failed for %C: %C', entry.options.name, error)
    return { ok: false, error: String(error) }
  }
}

/**
 * 插件入口: 注册 HTTP 路由与模型工具。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: Context): void {
  // 模型工具: 会话内直接调用, 改完源码立即热重载目标插件。
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'host_hot_reload',
    description: 'Hot-reload one running host plugin from its on-disk source without restarting DSH. Targets file:// source plugins (dsh-external/* and packages/automation/*). Use after editing their src files so the running instance picks up the new code immediately; failed reloads roll back to the previous code.',
    parameters: {
      target: {
        type: 'string',
        description: 'Plugin entry name to reload: an exact file:// name, an entry id (e.g. automation-console, automation-scheduler), or the literal "all" to reload every reloadable file:// entry.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value: unknown) => [{
        type: 'text',
        text: typeof (value as { summary?: string }).summary === 'string'
          ? (value as { summary: string }).summary
          : JSON.stringify(value),
      }],
    },
    execute: async (args: { target: string }) => {
      const loader = ctx.get('loader') as LoaderFace | undefined
      if (loader === undefined) return { summary: '失败: loader 服务不可用' }
      const wanted = String(args.target ?? '').trim()
      let targets = listTargets(loader)
      if (wanted !== '' && wanted !== 'all') {
        targets = targets.filter(t =>
          t.entry.options.name === wanted
          || t.entry.options.id === wanted
          || t.entry.options.name.endsWith('/' + wanted + '/src/index.ts'))
      }
      if (targets.length === 0) {
        const known = listTargets(loader).map(t => t.entry.options.name).join(', ')
        return { summary: `没有匹配的 file:// 插件条目: ${wanted || '(空)'}。当前可重载: ${known || '(无)'}` }
      }
      const results = []
      for (const target of targets) {
        results.push(await reloadEntry(ctx, target))
      }
      const lines = results.map(r => r.ok
        ? `✓ ${r.name} (重建 ${String(r.disposed)} fibers)`
        : `✗ ${r.error}`)
      return { summary: ['热重载 ' + String(results.length) + ' 个条目:', ...lines].join('\n') }
    },
  })), 'hot-reload:tool')

  const webServer = ctx.get('webServer') as
    | { register(route: { kind: 'exact'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void }
    | undefined

  const writeJson = (res: unknown, status: number, body: unknown): void => {
    const response = res as { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }

  const resolveRequest = async (req: unknown): Promise<ReloadTarget[]> => {
    const loader = ctx.get('loader') as LoaderFace | undefined
    if (loader === undefined) return []
    const method = (req as { method?: string }).method ?? 'GET'
    if (method === 'GET') return listTargets(loader)
    const body = await readBody(req as ReqLike)
    const parsed = JSON.parse(body) as { name?: string; id?: string; all?: boolean }
    const targets = listTargets(loader)
    if (parsed.all === true) return targets
    const wanted = parsed.name ?? parsed.id ?? ''
    return targets.filter(t => t.entry.options.name === wanted || t.entry.options.id === wanted)
  }

  ctx.effect(() => webServer?.register({
    kind: 'exact',
    path: '/@dsh/hot-reload',
    handler: async (req, res) => {
      try {
        const targets = await resolveRequest(req)
        if ((req as { method?: string }).method === 'GET') {
          writeJson(res, 200, targets.map(t => ({
            id: t.entry.options.id,
            name: t.entry.options.name,
          })))
          return
        }
        if (targets.length === 0) {
          writeJson(res, 404, { ok: false, error: 'no matching file:// entry' })
          return
        }
        const results = []
        for (const target of targets) {
          results.push(await reloadEntry(ctx, target))
        }
        const failed = results.filter(r => !r.ok)
        writeJson(res, failed.length === 0 ? 200 : 409, { ok: failed.length === 0, results })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'hot-reload:http-route')
}

/** Body 读取面 (事件流契约, 与控制台宿主一致)。 */
type ReqLike = {
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
  on(event: 'end', cb: () => void): unknown
  on(event: 'error', cb: (error: Error) => void): unknown
}

/** 读取完整请求体。 */
function readBody(req: ReqLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}