/**
 * @dsh-external/dsh-automation-console — client entry.
 * Registers one 'conversation.view' tab (📅 自动化日历 — the automation
 * management surface: trigger calendar, frequency groups, ops, gates) rendering
 * the React ConsolePanel. 构建：npm run build:client（tsdown → lib/client.js）。
 * @module dsh-automation-console/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { ConsolePanel } from './ConsolePanel.tsx'

export const name = '@dsh-external/dsh-automation-console'
export const inject = ['slots'] as const

/** Minimal local face of the slot service (avoids a build dependency edge). */
interface SlotsFace {
  inject(name: string, factory: () => unknown): () => void
  register(options: Record<string, unknown>, component?: unknown): () => void
}

type ClientContext = Context & { slots?: SlotsFace }

export function apply(ctx: ClientContext): void {
  const slots = ctx.slots as SlotsFace
  ctx.effect(() => slots.inject('conversation.view', () =>
    slots.register({
      name: 'conversation.view',
      id: 'automation-console',
      order: 11,
      label: () => '📅 自动化日历',
    }, ConsolePanel),
  ), '@dsh-external/dsh-automation-console: panel')
}
