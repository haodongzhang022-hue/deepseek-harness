/**
 * Package invariant companion for @deepseek-ai/dsh-automation-scheduler.
 * @module ui-automation-scheduler/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-automation-scheduler'

/** Cordis companion plugin name. */
export const name = 'automation-scheduler-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// The scheduler owns no cross-package event or snapshot: its fire-to-journal
// relation is covered by the engine spec against real temp files, and its
// only host interaction is logging.
const install: InvariantInstaller = () => {}

/**
 * Register this package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
