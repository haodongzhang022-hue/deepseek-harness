import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileLedger } from '../src/ledger.ts'
import { LogWakeTransport, buildWakeText } from '../src/wake-transport.ts'
import type { WakeTransport } from '../src/wake-transport.ts'
import { RouterEngine } from '../src/engine.ts'
import type { GateItem, PipelineGateAdapter, WakeTargetResolver } from '@deepseek-ai/dsh-automation-gate'

function item(id: string, state: GateItem['state'], detail?: string): GateItem {
  return { id, sourceLane: '8010', title: '任务' + id, state, ...(detail === undefined ? {} : { detail }) }
}

/** Mutable snapshot backing one fake adapter; swaps drive state transitions. */
function fakeAdapter(items: GateItem[]): PipelineGateAdapter & { set(next: GateItem[]): void } {
  let current = items
  return {
    name: 'fake',
    listItems: async () => current,
    set(next) { current = next },
  }
}

const delivered: { session: string; text: string }[] = []
const recorder: WakeTransport = {
  name: 'recorder',
  deliver: async (sessionId, item) => {
    delivered.push({ session: sessionId, text: buildWakeText(item) })
  },
}

function fakeResolver(sessionId: string | null): WakeTargetResolver & { calls: number } {
  const view = { calls: 0 }
  return {
    get calls() { return view.calls },
    resolve: async () => {
      view.calls += 1
      return sessionId
    },
  }
}

describe('RouterEngine', () => {
  it('seeds the ledger on first tick without waking', async () => {
    delivered.length = 0
    const engine = new RouterEngine({
      adapter: fakeAdapter([item('RC-1', 'queued')]),
      ledger: new FileLedger(tempFile('seed')),
      transport: recorder,
    })

    const summary = await engine.tick()
    expect(summary.events).toHaveLength(1)
    expect(summary.woken).toHaveLength(0)
    expect(delivered).toHaveLength(0)
  })

  it('wakes the resolved session exactly once when an item turns rejected', async () => {
    delivered.length = 0
    const adapter = fakeAdapter([item('RC-1', 'queued')])
    const resolver = fakeResolver('session-abc')
    const engine = new RouterEngine({
      adapter,
      ledger: new FileLedger(tempFile('reject')),
      transport: recorder,
      resolver,
    })

    await engine.tick()
    expect(resolver.calls).toBe(0)

    adapter.set([item('RC-1', 'rejected', '单测未过')])
    const summary = await engine.tick()
    expect(summary.woken).toEqual(['RC-1'])
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.session).toBe('session-abc')
    expect(delivered[0]!.text).toContain('驳回')
    expect(delivered[0]!.text).toContain('单测未过')

    // Same snapshot again: no duplicate wake.
    await engine.tick()
    expect(delivered).toHaveLength(1)
  })

  it('suppresses re-wake after restart on the same ledger file', async () => {
    delivered.length = 0
    const path = tempFile('restart')

    const seed = new RouterEngine({ adapter: fakeAdapter([item('RC-9', 'testing')]), ledger: new FileLedger(path), transport: recorder })
    await seed.tick()

    const reject = new RouterEngine({
      adapter: fakeAdapter([item('RC-9', 'rejected')]),
      ledger: new FileLedger(path),
      transport: recorder,
      resolver: fakeResolver('s1'),
    })
    await reject.tick()
    expect(delivered).toHaveLength(1)

    // Fresh engine over the same file simulates a process restart.
    const after = new RouterEngine({
      adapter: fakeAdapter([item('RC-9', 'rejected')]),
      ledger: new FileLedger(path),
      transport: recorder,
      resolver: fakeResolver('s1'),
    })
    await after.tick()
    expect(delivered).toHaveLength(1)
  })

  it('retries while no target resolves, then wakes once it appears', async () => {
    delivered.length = 0
    let target: string | null = null
    const resolver: WakeTargetResolver = { resolve: async () => target }

    const adapter = fakeAdapter([item('RC-2', 'queued')])
    const engine = new RouterEngine({
      adapter,
      ledger: new FileLedger(tempFile('retry')),
      transport: recorder,
      resolver,
    })
    await engine.tick()

    adapter.set([item('RC-2', 'rejected')])
    await engine.tick()
    expect(delivered).toHaveLength(0)

    target = 'session-late'
    const summary = await engine.tick()
    expect(summary.woken).toEqual(['RC-2'])
    expect(delivered).toHaveLength(1)
  })

  it('persists ledger rows to disk under the schema version header', async () => {
    const path = tempFile('persist')
    const engine = new RouterEngine({
      adapter: fakeAdapter([item('RC-3', 'passed')]),
      ledger: new FileLedger(path),
      transport: new LogWakeTransport(),
    })
    await engine.tick()

    expect(existsSync(path)).toBe(true)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { version: number; items: Record<string, { lastState: string }> }
    expect(raw.version).toBe(1)
    expect(raw.items['RC-3']?.lastState).toBe('passed')
  })
})

function tempFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'router-spec-')), name + '.json')
}

describe('RouterEngine delivery failures', () => {
  it('leaves the item un-notified when delivery throws, then wakes on a later tick', async () => {
    delivered.length = 0
    let shouldFail = true
    const flaky: WakeTransport = {
      name: 'flaky',
      deliver: async (sessionId, item) => {
        if (shouldFail) throw new Error('host down')
        await recorder.deliver(sessionId, item)
      },
    }

    const adapter = fakeAdapter([item('RC-4', 'queued')])
    const ledger = new FileLedger(tempFile('flaky'))
    const engine = new RouterEngine({ adapter, ledger, transport: flaky, resolver: fakeResolver('s-flaky') })
    await engine.tick()

    adapter.set([item('RC-4', 'rejected')])
    const first = await engine.tick()
    expect(first.failed).toEqual([{ id: 'RC-4', error: 'host down' }])
    expect(delivered).toHaveLength(0)

    shouldFail = false
    const second = await engine.tick()
    expect(second.woken).toEqual(['RC-4'])
    expect(delivered).toHaveLength(1)
  })
})
