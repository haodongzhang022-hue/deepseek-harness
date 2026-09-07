import { readFileSync, existsSync } from 'node:fs'
import { buildMinutePulse } from '../../packages/automation/scheduler/src/pulse.ts'
import { loadTriggers } from '../../packages/automation/scheduler/src/triggers.ts'
import { SignalBus } from '../../packages/automation/scheduler/src/bus.ts'

const BASE = 'E:/1shuju/dsh-home/data/automation'
const triggers = loadTriggers(BASE + '/signals/triggers')
const bus = new SignalBus({ receiptsPath: BASE + '/logs/signal_receipts.jsonl', dshApiBase: 'http://127.0.0.1:3080' })

// Slot :50 — divisible by both 5 and 2 → rejection-dispatch AND release-autopilot hit.
const target = Date.UTC(2026, 7, 26, 7, 50)
const pulse = { ...buildMinutePulse(target), channel: 'minute' as const }
const summary = await bus.route(pulse, triggers)
console.log('route:', JSON.stringify(summary))
await new Promise(r => setTimeout(r, 3000))
const receipts = existsSync(BASE + '/logs/signal_receipts.jsonl')
  ? readFileSync(BASE + '/logs/signal_receipts.jsonl', 'utf8').trim().split('\n').slice(-3)
  : []
for (const line of receipts) {
  const r = JSON.parse(line) as Record<string, unknown>
  console.log(String(r.trigger_id) + ' -> ' + String(r.status) + ' (' + String(r.duration_ms) + 'ms)' + (r.error ? ' err=' + String(r.error) : ''))
}
