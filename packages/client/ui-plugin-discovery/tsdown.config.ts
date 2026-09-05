import type { UserConfig } from 'tsdown'

/**
 * Package work is suspended: the sources are not part of any TypeScript
 * project reference, so there are no lib/ artifacts to bundle. The falsey
 * entry removes this package from the workspace build before entry
 * resolution.
 */
export default { entry: '' } satisfies UserConfig