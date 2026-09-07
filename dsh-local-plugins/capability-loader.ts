/**
 * Local capability-configs plugin (integration artifact, not a shipped package).
 *
 * Function plugin per the loader contract (`name` / `inject` / `Config` / `apply`,
 * no default export — mixing the class form discards the namespace). Loads the four
 * capability config documents under the repo root, validates their required top-level
 * sections, exposes them as `ctx.capabilityConfigs`, and contributes one system-prompt
 * section rendering the external-agent directory so the model can address @patterns.
 *
 * Referenced from `dsh-config/collaboration.patch.yml` via an absolute `file:` URL,
 * which resolves regardless of the composing layer's baseUrl.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

export const name = 'capability-configs'

/** `systemPrompt` must be active before we contribute our section. */
export const inject = ['systemPrompt']

export interface CapabilityConfigsOptions {
  /** Repo root holding the config documents; defaults to the parent of this file's directory. */
  root?: string
}

export const Config: z<CapabilityConfigsOptions> = z.object({
  root: z.string(),
})

const HERE = dirname(fileURLToPath(import.meta.url))

/** Repo-root-relative config documents this plugin owns, keyed by slot. */
const CONFIG_SOURCES = {
  collaboration: 'dsh-collaboration-rules.yaml',
  joinMode: 'dsh-agent-join-mode-config.yaml',
  pluginMemory: 'dsh-plugin-memory-config.yaml',
  undoManager: 'dsh-undo-manager-config.yaml',
} as const

type ConfigSlot = keyof typeof CONFIG_SOURCES

/** Required top-level key per document; a missing key fails the load loud. */
const REQUIRED_SECTIONS: Record<ConfigSlot, string> = {
  collaboration: 'collaboration',
  joinMode: 'agent_join_mode',
  pluginMemory: 'plugin_memory',
  undoManager: 'undo_manager',
}

type ConfigDocs = Record<ConfigSlot, Record<string, unknown>>

interface ExternalAgent {
  id?: string
  endpoint?: string
  description?: string
  rules?: Array<{ pattern?: string }>
}

/**
 * Render the model-facing agent directory from the collaboration document.
 * Returns '' when collaboration is disabled or no external agents are declared;
 * empty sections are dropped at render, so that is the off switch.
 */
function renderAgentDirectory(doc: Record<string, unknown>): string {
  const collab = doc.collaboration as { enabled?: boolean; agents?: { external?: ExternalAgent[] } } | undefined
  if (!collab?.enabled) return ''
  const agents = collab.agents?.external ?? []
  if (agents.length === 0) return ''
  const lines = [
    '## External agent directory',
    '',
    'Declared delegation targets. When a task matches one, coordinate by addressing its pattern explicitly:',
    '',
  ]
  for (const agent of agents) {
    const patterns = (agent.rules ?? []).map((rule) => rule.pattern).filter((p): p is string => typeof p === 'string')
    if (patterns.length === 0) continue
    lines.push(`- ${patterns.join(' / ')} — ${agent.description ?? agent.id ?? 'unnamed'} (${agent.endpoint ?? 'local'})`)
  }
  lines.push('', 'State the target agent and the expected deliverable in the request; verify returned results before accepting them.')
  return lines.join('\n')
}

export function apply(ctx: Context, config: CapabilityConfigsOptions): void {
  const root = config.root ?? resolve(HERE, '..')
  const docs = {} as ConfigDocs

  for (const slot of Object.keys(CONFIG_SOURCES) as ConfigSlot[]) {
    const path = resolve(root, CONFIG_SOURCES[slot])
    const parsed: unknown = yaml.load(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`capability config ${slot} (${path}) must be a YAML mapping`)
    }
    const doc = parsed as Record<string, unknown>
    if (!(REQUIRED_SECTIONS[slot] in doc)) {
      throw new Error(`capability config ${slot} (${path}) misses required section '${REQUIRED_SECTIONS[slot]}'`)
    }
    docs[slot] = doc
  }

  // The parsed documents stay local to this fiber; the model-facing surface is
  // the section below, and any future programmatic consumer should inject a
  // dedicated service rather than a bare context property.

  const sectionText = renderAgentDirectory(docs.collaboration)
  if (sectionText !== '') {
    ctx.systemPrompt.section({ name: 'collaboration:rules', order: 120, text: sectionText })
  }
}
