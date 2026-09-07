import { describe, expect, it } from 'vitest'
import { matches, type Trigger } from '../src/triggers.ts'
import type { ClockPulse } from '../src/pulse.ts'

/** Build one pulse the way the bus emits it: a UTC slot on a channel. */
function pulse(channel: ClockPulse['channel'], slot: ClockPulse['slot']): Pick<ClockPulse, 'channel' | 'slot'> {
  return { channel, slot }
}

function trig(overrides: Partial<Trigger> & { trigger_id: string }): Trigger {
  return {
    owner_session: 'spec',
    match: { channel: 'minute' },
    action: { kind: 'http', url: 'http://x', timeout_s: 60 },
    ...overrides,
  }
}

describe('trigger match gates', () => {
  it('matches a daily atLocal wall-clock minute', () => {
    const t = trig({ trigger_id: 'daily', tzOffsetMin: 480, match: { channel: 'minute', atLocal: { h: 9, m: 15 } } })
    // 2026-09-07 01:15 UTC = 09:15 local (UTC+8).
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 15 }), t)).toBe(true)
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 16 }), t)).toBe(false)
  })

  it('matches every N minutes via slot_m_mod', () => {
    const t = trig({ trigger_id: 'm5', match: { channel: 'minute', slot_m_mod: 5 } })
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 0 }), t)).toBe(true)
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 5 }), t)).toBe(true)
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 7 }), t)).toBe(false)
  })

  it('matches a weekly slot: atLocal on the gated local weekday only', () => {
    const t = trig({
      trigger_id: 'weekly',
      tzOffsetMin: 480,
      match: { channel: 'minute', atLocal: { h: 9, m: 0 }, slot_weekday: 1 },
    })
    // 2026-09-07 is a Monday local: UTC 01:00 = 09:00 local on Monday.
    const monday = pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 0 })
    expect(matches(monday, t)).toBe(true)
    // 2026-09-08 is a Tuesday local: same wall-clock minute, wrong weekday.
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 8, h: 1, m: 0 }), t)).toBe(false)
    // Monday but a different wall-clock minute.
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 1 }), t)).toBe(false)
  })

  it('matches a monthly slot: atLocal on the gated local day-of-month only', () => {
    const t = trig({
      trigger_id: 'monthly',
      tzOffsetMin: 480,
      match: { channel: 'minute', atLocal: { h: 9, m: 30 }, slot_dom: 15 },
    })
    // Local 09:30 on the 15th = UTC 01:30 on the 15th (UTC+8).
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 15, h: 1, m: 30 }), t)).toBe(true)
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 14, h: 1, m: 30 }), t)).toBe(false)
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 15, h: 1, m: 31 }), t)).toBe(false)
  })

  it('combines slot_dom with the day channel', () => {
    const t = trig({ trigger_id: 'monthly-day', tzOffsetMin: 480, match: { channel: 'day', slot_dom: 1 } })
    // Day-channel pulses are 00:00 UTC = 08:00 local on the same date.
    expect(matches(pulse('day', { y: 2026, mo: 10, d: 1, h: 0, m: 0 }), t)).toBe(true)
    expect(matches(pulse('day', { y: 2026, mo: 10, d: 2, h: 0, m: 0 }), t)).toBe(false)
  })

  it('never matches a disabled trigger', () => {
    const t = trig({ trigger_id: 'off', enabled: false, match: { channel: 'minute' } })
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 0 }), t)).toBe(false)
  })

  it('requires channel equality', () => {
    const t = trig({ trigger_id: 'chan', match: { channel: 'hour' } })
    expect(matches(pulse('hour', { y: 2026, mo: 9, d: 7, h: 1, m: 0 }), t)).toBe(true)
    expect(matches(pulse('minute', { y: 2026, mo: 9, d: 7, h: 1, m: 0 }), t)).toBe(false)
  })
})
