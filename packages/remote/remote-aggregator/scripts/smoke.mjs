// Smoke test: spawn `opencode acp`, drive it through the ACP SDK directly
// (bypassing the package wrapper) to verify the protocol path works end to
// end. Run from the package directory after `pnpm install`:
//   node scripts/smoke.mjs /path/to/workdir
// If no workdir is passed, the package cwd is used.
//
// Windows note: `spawn('opencode', ...)` hits the .ps1 shim and ENOENTs; use
// the bare .exe under node_modules. Override either via OPENCODE_BIN env var.

import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { client as createAcpClientApp, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const cwd = process.argv[2] ?? process.cwd()
const command = process.env.OPENCODE_BIN
  ?? (process.platform === 'win32'
    ? 'C:\\Users\\dongdong\\AppData\\Local\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe'
    : 'opencode')
console.log(`[smoke] cwd=${cwd} command=${command}`)

const child = spawn(command, ['acp'], {
  cwd,
  stdio: ['pipe', 'pipe', 'inherit'],
})

const app = createAcpClientApp({ name: 'smoke' })
  .onNotification(methods.client.session.update, ({ params }) => {
    const text = JSON.stringify(params)
    console.log(`[update] ${text.length > 180 ? text.slice(0, 180) + '…' : text}`)
  })
  .onRequest(methods.client.session.requestPermission, () => {
    console.log('[permission] rejected (unattended smoke)')
    return Promise.resolve({ outcome: { outcome: 'cancelled' } })
  })

const connection = app.connect(ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
))
const agent = connection.agent

let sessionId
try {
  const init = await agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  console.log(`[init] agent=${init.agentInfo?.name} v${init.agentInfo?.version} protocol=${init.protocolVersion}`)

  const list = await agent.request(methods.agent.session.list, {})
  console.log(`[list] ${list.sessions?.length ?? 0} session(s)`)

  const session = await agent.request(methods.agent.session.new, { cwd, mcpServers: [] })
  sessionId = session.sessionId
  console.log(`[new] sessionId=${sessionId}`)

  const prompt = await agent.request(methods.agent.session.prompt, {
    sessionId,
    prompt: [{ type: 'text', text: 'Reply with exactly: hello' }],
  })
  console.log(`[prompt done] stopReason=${prompt.stopReason}`)

  await agent.request(methods.agent.session.close, { sessionId })
  console.log('[closed]')
  console.log('[smoke] OK')
} catch (error) {
  console.error('[smoke] FAIL:', error)
  process.exitCode = 1
} finally {
  connection.dispose()
  child.stdin?.end()
  await new Promise((resolve) => child.once('exit', resolve))
}
