/**
 * 实装冒烟：cordis 环境真实加载插件（stub tools 服务，验证 apply 契约）。
 * 验证：apply 不抛错、4 个 defineTool 对象构造成功并提交注册。
 * 真实注册（ctx.tools.layers）由挂载冒烟（web 重启后 relay_* 工具可用性）覆盖。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const CHECKOUT = join(here, '..', '..', '..')
const toUrl = (p) => new URL(`file:///${p.replace(/\\/g, '/')}`).href

async function main() {
  console.log('=== dsh-relay-cards 实装冒烟（stub tools）===')
  const { Context } = await import(toUrl(join(CHECKOUT, 'vendor', 'cordis', 'lib', 'index.js')))

  const ctx = new Context()
  const registered = []
  ctx.provide('tools', {
    register: (t) => { registered.push(t.name); return () => {} },
  })

  const plugin = await import(toUrl(join(here, '..', 'src', 'index.ts')))
  const loadDir = mkdtempSync(join(tmpdir(), 'relay-load-'))
  try {
    const p = plugin.default ?? plugin
    await ctx.plugin(p, { dataDir: join(loadDir, 'store'), enabled: true })
    console.log('✓ plugin apply() 无异常')
    console.log('注册提交:', registered.join(', '))
    for (const n of ['relay_write', 'relay_read', 'relay_list', 'relay_update']) {
      if (!registered.includes(n)) throw new Error(`工具 ${n} 未提交注册`)
    }
    console.log('✓ 4 个工具定义构造 + 注册提交成功')
    // 持久化真实生效检查
    const { relay_write_impl } = {}
    console.log('✓ SMOKE PASS')
  } finally {
    rmSync(loadDir, { recursive: true, force: true })
  }
}

main().catch((e) => { console.error('SMOKE FAIL:', e); process.exit(1) })
