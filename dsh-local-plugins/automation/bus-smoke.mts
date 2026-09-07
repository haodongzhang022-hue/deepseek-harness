import { readFileSync, existsSync } from 'node:fs'
import { PulseLedger, buildMinutePulse } from '../../packages/automation/scheduler/src/pulse.ts'
import { loadTriggers } from '../../packages/automation/scheduler/src/triggers.ts'
import { SignalBus } from '../../packages/automation/scheduler/src/bus.ts'

const BASE = 'E:/1shuju/dsh-home/data/automation'
const triggers = loadTriggers(BASE + '/signals/triggers')
console.log('loaded triggers:', triggers.map(t => t.trigger_id + '(' + t.match.channel + ',m%' + String(t.match.slot_m_mod ?? '-') + ')').join(' '))

const ledger = new PulseLedger({ ledgerPath: BASE + '/logs/clock_pulses.jsonl', lastPulsePath: BASE + '/last_pulse_at.txt' })
ledger.ensureDirs()
const bus = new SignalBus({ receiptsPath: BASE + '/logs/signal_receipts.jsonl', dshApiBase: 'http://127.0.0.1:3080' })

// Route a REAL minute pulse from the actual current time.
const now = Date.now()
const pulse = buildMinutePulse(now)
for (const channel of ['minute', ...(pulse.slot.m === 0 ? ['hour'] : []), ...(pulse.slot.m === 0 && pulse.slot.h === 0 ? ['day'] : [])] as const) {
  const scoped = { ...pulse, channel } as const
  const summary = await bus.route(scoped, triggers.filter(t => t.match.channel === channel))
  console.log(channel + ':', JSON.stringify(summary))
}
ledger.record(pulse, [])
console.log('last_pulse_at:', readFileSync(BASE + '/last_pulse_at.txt', 'utf8').trim())
