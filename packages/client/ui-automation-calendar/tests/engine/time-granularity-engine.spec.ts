import { describe, expect, it } from 'vitest'
import { TimeGranularityEngine, getTimeGranularityEngine } from '../../src/client/engine/time-granularity-engine.ts'

const HOUR = 3_600_000

describe('TimeGranularityEngine', () => {
  it('creates contiguous buckets covering the whole range', () => {
    const engine = new TimeGranularityEngine()
    const range = { start: 0, end: 6 * HOUR }
    const buckets = engine.createBuckets(range, 'hour')

    expect(buckets).toHaveLength(6)
    expect(buckets[0]).toMatchObject({ start: 0, end: HOUR })
    expect(buckets[5]!.end).toBe(6 * HOUR)
  })

  it('finds bucket indexes by binary search, -1 outside the range', () => {
    const engine = new TimeGranularityEngine()
    const buckets = engine.createBuckets({ start: 0, end: 3 * HOUR }, 'hour')

    expect(engine.findBucketIndex(0, buckets)).toBe(0)
    expect(engine.findBucketIndex(HOUR + 1, buckets)).toBe(1)
    expect(engine.findBucketIndex(2.5 * HOUR, buckets)).toBe(2)
    expect(engine.findBucketIndex(-1, buckets)).toBe(-1)
    expect(engine.findBucketIndex(3 * HOUR, buckets)).toBe(-1)
  })

  it('generates major ticks with labels and minor ticks without', () => {
    const engine = new TimeGranularityEngine()
    const ticks = engine.generateTicks({ start: 0, end: 12 * HOUR }, 'three-hours')

    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks[0]!.major).toBe(true)
    expect(ticks[0]!.label.length).toBeGreaterThan(0)
    // Every majorEvery-th tick carries the label; minors are silent spacers.
    const labeled = ticks.filter(t => t.label.length > 0)
    expect(labeled.length).toBeGreaterThanOrEqual(2)
  })

  it('maps an interval onto the smallest level at or above it', () => {
    const engine = new TimeGranularityEngine()
    // An hourly cadence lands on the hour row, not three-hours.
    expect(engine.mapIntervalToGranularity(HOUR)).toBe('hour')
    expect(engine.mapIntervalToGranularity(HOUR * 4)).toBe('six-hours')
    expect(engine.mapIntervalToGranularity(500)).toBe('second')
    // Beyond the coarsest builtin, clamp to month.
    expect(engine.mapIntervalToGranularity(400 * 24 * HOUR)).toBe('month')
  })

  it('registers custom granularities visible through getConfig', () => {
    const engine = new TimeGranularityEngine()
    const dispose = engine.registerCustomGranularity({
      id: 'custom-45s',
      name: '每45秒',
      nameKey: 'granularity.custom-45s',
      intervalMs: 45_000,
      color: '#000',
      icon: 'x',
      tickFormat: 'ss',
      collapseThresholdMs: 90_000,
      builtin: false,
    })

    expect(engine.getConfig('custom-45s')?.intervalMs).toBe(45_000)
    dispose()
    expect(engine.getConfig('custom-45s')).toBeUndefined()
  })

  it('addPersistentCustomGranularity registers immediately; remove clears both views', () => {
    const engine = new TimeGranularityEngine()
    engine.addPersistentCustomGranularity({
      id: 'custom-x',
      name: 'x',
      nameKey: 'granularity.custom-x',
      intervalMs: 90_000,
      color: '#000',
      icon: 'x',
      tickFormat: 'ss',
      collapseThresholdMs: 180_000,
      builtin: false,
    })

    expect(engine.getCustomGranularities().some(c => c.id === 'custom-x')).toBe(true)
    // Node env has no localStorage; the registry half must still hold. The
    // persistence half is exercised by the browser-side GUI tier.
    expect(engine.removePersistentCustomGranularity('custom-x')).toBe(true)
    expect(engine.removePersistentCustomGranularity('custom-x')).toBe(false)
    expect(engine.getCustomGranularities()).toHaveLength(0)
  })

  it('rolls buckets up preserving totals and drills one bucket down', () => {
    const engine = new TimeGranularityEngine()
    const hours = engine.createBuckets({ start: 0, end: 3 * HOUR }, 'hour')
    hours.forEach((bucket, i) => { bucket.taskCount = i + 1 })

    const rolled = engine.rollUp(hours, 'three-hours')
    expect(rolled?.taskCount).toBe(6)
    expect(rolled?.granularity).toBe('three-hours')

    const drilled = engine.drillDown({ ...rolled!, taskCount: 0 }, 'hour')
    expect(drilled).toHaveLength(3)
  })

  it('serves one singleton across getTimeGranularityEngine calls', () => {
    expect(getTimeGranularityEngine()).toBe(getTimeGranularityEngine())
  })
})
