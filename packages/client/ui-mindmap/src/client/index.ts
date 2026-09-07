/**
 * Mind-Map client entry - registers the locale dictionary and the
 * 'conversation.view' tab. This is the entry shell of the (unimplemented)
 * Mind-Map canvas: it mounts the tab under the archived 'mindmap' id and
 * renders a placeholder presenter so the surface exists for later work.
 * @module ui-mindmap/client/index
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by ui-conversation)
// must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Pulls the renderer Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Pulls the SessionStandardProps merge ('useSession') into the runtime props.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { MINDMAP_LOCALE_NS, mindmapEn, mindmapZh } from './locales.ts'
import { MindMapRoot } from './components/MindMapRoot.tsx'
import type { MindMapInjected } from './contract/slots.ts'

export const name = 'ui-mindmap'

/**
 * Slot dependencies: registry seats for composition and the locale service for
 * the seat binding. Everything else arrives through standard-kit props shares.
 */
export const inject = ['slots', 'locale'] as const

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(MINDMAP_LOCALE_NS, { zh: mindmapZh, en: mindmapEn }), 'ui-mindmap: dictionaries')
  const t = ctx.locale.bind(MINDMAP_LOCALE_NS)

  const injectMindMap = (): MindMapInjected => ({ stage: 'entry-shell' })

  // The Mind-Map conversation canvas tab. Sole mount on the entry shell.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'mindmap',
    order: 12,
    locale: MINDMAP_LOCALE_NS,
    label: () => t('view.mindmap'),
    inject: injectMindMap,
  }, MindMapRoot))
}