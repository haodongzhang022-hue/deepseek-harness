/**
 * Package invariant companion for @deepseek-ai/dsh-client-ui-mindmap.
 *
 * No runtime invariant: this package is the entry shell for the (unimplemented)
 * Mind-Map canvas — it registers one 'conversation.view' tab and a locale
 * dictionary, owns no service, and asserts no event/data relationship beyond
 * the slot registry's own load-time declaration checks.
 */
export const name = 'ui-mindmap'
export const inject: string[] = []
export function apply(): void {
  // Intentionally empty; see the module doc for the justified reason.
}