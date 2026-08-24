/**
 * Package invariant companion for @deepseek-ai/dsh-automation-router.
 *
 * No runtime invariant yet: the engine is a pure orchestrator over injected
 * interfaces and asserts no event/data relationship of its own. The daemon
 * plugin apply() arrives with the adapter wiring and brings its invariant
 * (poll produces events; rejected items wake their source session exactly
 * once per state) in the same change.
 */
export const name = 'automation-router'
export const inject: string[] = []
export function apply(): void {
  // Intentionally empty; see the module doc for the justified reason.
}
