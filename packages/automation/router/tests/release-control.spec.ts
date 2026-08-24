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
  it('carries the rejection reason as detail and ports as lanes (gate_results first)', () => {
    const items = toGateItems([
      {
        issue_id: 'RC-7',
        title: '因子校准',
        status: 'rejected_8008',
        source_port: 8011,
        gate_results: [
          { decision: 'approved', at: 'earlier' },
          { decision: 'rejected', at: 'later', rejection_reason: '门禁未通过：健康检查失败' },
        ],
        feedback: [{ reason: '更早的反馈' }],
      },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'RC-7',
      sourceLane: '8011',
      state: 'rejected',
      detail: '门禁未通过：健康检查失败',
    })
  })

  it('falls back to the feedback trail then flat legacy fields', () => {
    const [viaFeedback] = toGateItems([
      { issue_id: 'A', status: 'rejected_8008', feedback: [{ reason: 'feedback原因' }] },
    ])
    expect(viaFeedback.detail).toBe('feedback原因')

    const [viaFlat] = toGateItems([
      { issue_id: 'B', status: 'rejected_8008', rejection_reason: 'flat原因' },
    ])
    expect(viaFlat.detail).toBe('flat原因')
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
