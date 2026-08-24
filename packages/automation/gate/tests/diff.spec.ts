import { describe, expect, it } from 'vitest'
import { diffGateSnapshots } from '../src/index.ts'
import type { GateItem } from '../src/index.ts'

function item(id: string, state: GateItem['state'], sourceLane = '8010'): GateItem {
  return { id, sourceLane, title: `t-${id}`, state }
}

describe('diffGateSnapshots', () => {
  it('emits item-submitted for ids absent from the previous snapshot', () => {
    const events = diffGateSnapshots([], [item('RC-1', 'queued'), item('RC-2', 'testing')])

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'item-submitted', item: { id: 'RC-1' } })
  })

  it('emits state-changed only for items whose state moved', () => {
    const before = [item('A', 'queued'), item('B', 'testing'), item('C', 'rejected')]
    const after = [item('A', 'testing'), item('B', 'testing'), item('C', 'rejected', '8012')]

    // Lane-only edits are not state events; A is the sole transition.
    const events = diffGateSnapshots(before, after)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'item-state-changed',
      id: 'A',
      from: 'queued',
      to: 'testing',
    })
  })

  it('returns nothing when snapshots agree', () => {
    const snap = [item('A', 'queued')]
    expect(diffGateSnapshots(snap, [...snap])).toHaveLength(0)
  })

  it('throws on duplicate ids within either snapshot', () => {
    const dup = [item('A', 'queued'), item('A', 'testing')]
    expect(() => diffGateSnapshots([], dup)).toThrow(/duplicate id/)
    expect(() => diffGateSnapshots(dup, [])).toThrow(/duplicate ids/)
  })
})
