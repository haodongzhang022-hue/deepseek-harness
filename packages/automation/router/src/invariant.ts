/**
 * Package-owned invariant companion for @deepseek-ai/dsh-automation-router.
 * @module ui-automation-router/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-automation-router'

/** Cordis companion plugin name. */
export const name = 'automation-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// The engine is a pure orchestrator over injected interfaces: its wake-once,
// retry-until-target, and failure-isolation relations are covered by the
// engine spec against real ledger files, and no package-owned event or
// snapshot crosses this package for an independent companion to observe.
const install: InvariantInstaller = () => {}

/**
 * Register this package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
