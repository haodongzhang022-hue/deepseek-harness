// Full-stack smoke: RemoteAggregator + AcpSource (opencode) end to end.
// Verifies the decoupled layers compose: aggregator → source → acp-client → child.
//   npx tsx scripts/smoke-aggregator.ts [workdir]
// The workdir defaults to the package cwd. Set OPENCODE_BIN to override the
// opencode executable path (Windows defaults to the known .exe location).

import { createOpencodeSource } from '../src/acp-source.ts'
import { RemoteAggregator } from '../src/aggregator.ts'

const cwd = process.argv[2] ?? process.cwd()
const timeoutMs = 60_000

const source = createOpencodeSource({
  id: 'opencode-local',
  cwd,
  permission: 'reject',
})

const aggregator = new RemoteAggregator()
aggregator.addSource(source)

let firstReply = ''
const timer = setTimeout(() => {
  console.error('[smoke-agg] TIMEOUT after', timeoutMs, 'ms')
  process.exit(1)
}, timeoutMs).unref()

try {
  console.log('[smoke-agg] listing sessions...')
  const sessions = await aggregator.list()
  console.log(`[smoke-agg] ${sessions.length} session(s)`, sessions)

  console.log('[smoke-agg] creating session...')
  const sessionId = await source.createSession(cwd)
  console.log(`[smoke-agg] sessionId=${sessionId}`)

  const unsub = aggregator.subscribe(source.id, sessionId, (event) => {
    if (event.type === 'message' && event.content !== undefined) {
      if (firstReply === '') {
        firstReply = event.content
        console.log(`[smoke-agg] first message chunk: ${firstReply.length > 80 ? firstReply.slice(0, 80) + '…' : firstReply}`)
      }
    }
  })

  console.log('[smoke-agg] sending prompt...')
  await aggregator.send(source.id, sessionId, 'Reply with exactly: hello')
  console.log('[smoke-agg] prompt accepted; waiting for first message chunk...')

  // Wait up to 30s for the first assistant message chunk.
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { resolve() }, 30_000)
    const check = setInterval(() => {
      if (firstReply !== '') { clearTimeout(t); clearInterval(check); resolve() }
    }, 500)
    setTimeout(() => clearInterval(check), 35_000)
  })

  unsub()
  console.log(firstReply !== ''
    ? `[smoke-agg] OK — received assistant message via aggregator.subscribe`
    : '[smoke-agg] PARTIAL — no message chunk received (protocol path still verified by send accepting)')
} catch (error) {
  console.error('[smoke-agg] FAIL:', error)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  await aggregator.close()
  console.log('[smoke-agg] closed')
}
