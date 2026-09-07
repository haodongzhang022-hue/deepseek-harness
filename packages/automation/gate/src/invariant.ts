/**
 * Package invariant companion for @deepseek-ai/dsh-automation-gate.
 *
 * No runtime invariant: this package declares a pure data contract (types and
 * one pure diff function). It owns no service, subscribes to no events, and
 * mutates nothing — its correctness surface is covered by unit tests on
 * diffGateSnapshots.
 */
export const name = 'automation-gate'
export const inject: string[] = []
export function apply(): void {
  // Intentionally empty; see the module doc for the justified reason.
}
