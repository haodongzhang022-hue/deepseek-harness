/**
 * Package-owned invariant companion.
 * @module @deepseek-ai/dsh-host-plugin-aggregator/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-aggregator'

/** Cordis companion plugin name. */
export const name = 'host-plugin-aggregator-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Runtime invariant: verify vector store is accessible and aggregator is running. */
const install: InvariantInstaller = (ctx) => {
  // Check that vector store service is registered
  const vectorStore = ctx.get('plugin-aggregator-vector-store')
  if (!vectorStore) {
    throw new Error('plugin-aggregator-vector-store service not registered')
  }

  // Check that aggregator service is registered
  const aggregator = ctx.get('plugin-aggregator')
  if (!aggregator) {
    throw new Error('plugin-aggregator service not registered')
  }

  // Check that embedding provider is registered
  const embedding = ctx.get('plugin-aggregator-embedding')
  if (!embedding) {
    throw new Error('plugin-aggregator-embedding service not registered')
  }
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
