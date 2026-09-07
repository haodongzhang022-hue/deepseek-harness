/**
 * Package invariant companion for @deepseek-ai/dsh-client-ui-automation-calendar.
 *
 * No runtime invariant: this package is a pure-consumer conversation-view
 * plugin — it registers one 'conversation.view' entry and a locale dictionary,
 * owns no service, and asserts no event/data relationship beyond the slot
 * registry's own load-time declaration checks.
 */
export const name = 'ui-automation-calendar'
export const inject: string[] = []
export function apply(): void {
  // Intentionally empty; see the module doc for the justified reason.
}
