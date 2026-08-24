import { describe, expect, it } from 'vitest'
import { ReleaseControlGateAdapter, mapReleaseStatus, toGateItems } from '../src/adapters/release-control.ts'

describe('mapReleaseStatus', () => {
  it('maps the known finance statuses onto generic states', () => {
    expect(mapReleaseStatus('queued_8008')).toBe('queued')
    expect(mapReleaseStatus('testing_8008')).toBe('testing')
    expect(mapReleaseStatus('rejected_8008')).toBe('rejected')
    expect(mapReleaseStatus('rejected_8027')).toBe('rejected')
    expect(mapReleaseStatus('approved_8008')).toBe('approved')
  })

  it('lands unknown statuses on unmapped instead of guessing', () => {
    expect(mapReleaseStatus('staging_weird')).toBe('unmapped')
    expect(mapReleaseStatus('production_approved')).toBe('unmapped')
  })
})

describe('toGateItems', () => {
  it('carries the rejection reason as detail and ports as lanes', () => {
    const items = toGateItems([
      {
        issue_id: 'RC-7',
        title: '因子校准',
        status: 'rejected_8008',
        source_port: 8011,
        rejection_reason: 'http:8008:/health 未通过',
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'RC-7',
      sourceLane: '8011',
      state: 'rejected',
      detail: 'http:8008:/health 未通过',
    })
  })

  it('drops records without an issue id', () => {
    expect(toGateItems([{ title: 'no id here' }])).toHaveLength(0)
  })
})

describe('ReleaseControlGateAdapter', () => {
  it('aggregates items across statuses through one call per status', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = []
    const adapter = new ReleaseControlGateAdapter(async (name, args) => {
      calls.push({ name, args })
      if (args.agents === true) return []
      if (args.status === 'testing_8008') {
        return [{ issue_id: 'RC-2', title: 't2', status: 'testing_8008', source_port: 8012 }]
      }
      return []
    })

    const items = await adapter.listItems()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('RC-2')
    expect(calls.every(c => c.name === 'list_release_state')).toBe(true)
  })

  it('resolves a live agent port to its registered session, null otherwise', async () => {
    const adapter = new ReleaseControlGateAdapter(async (_name, args) => {
      if (args.agents === true) {
        return [
          { agent_id: 'a', port: 8010, session_id: 'session-live', live: true },
          { agent_id: 'b', port: 8011, session_id: 'session-dead', live: false },
        ]
      }
      return []
    })

    await expect(adapter.resolve('8010')).resolves.toBe('session-live')
    // A dead heartbeat must not route work into a corpse.
    await expect(adapter.resolve('8011')).resolves.toBeNull()
    await expect(adapter.resolve('9999')).resolves.toBeNull()
  })
})
