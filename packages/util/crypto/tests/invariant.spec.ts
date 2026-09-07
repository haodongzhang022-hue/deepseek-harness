/**
 * The package-invariant companion is a Cordis function plugin with no runtime
 * invariant of its own (its value algebra is unit-tested). This suite pins the
 * registration contract so the companion cannot regress silently.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('util-crypto invariant', () => {
  it('registers under the package manifest name and returns a disposer', async () => {
    const register = vi.fn(() => () => {})
    const ctx = { invariants: { register } } as unknown as Context
    const dispose = await apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-util-crypto', expect.any(Function))
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('exposes the companion name and its required injection', () => {
    expect(name).toBe('util-crypto-invariant')
    expect(inject).toEqual(['invariants'])
  })
})
