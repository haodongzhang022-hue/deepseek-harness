/**
 * Trigger Engine Service Definition.
 * 
 * This module defines the core interface for the condition-trigger framework.
 * The trigger engine manages triggers that respond to external or internal
 * conditions and execute corresponding actions.
 * 
 * @module @deepseek-ai/dsh-trigger
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  TriggerEngine,
  TriggerRecord,
  TriggerId,
  TriggerState,
  TriggerFilter,
  CreateTriggerRequest,
  SignalSource,
  Signal,
  TriggerEventMap
} from './types.ts'

// Re-export all types
export * from './types.ts'

// Declaration merging: extend Context to include trigger engine
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trigger engine service. */
    readonly triggers: TriggerEngine
  }
}

/**
 * Trigger plugin configuration.
 */
export interface Config {
  /** Enable debug logging. */
  debug?: boolean
  /** Maximum number of triggers per session. */
  maxTriggers?: number
  /** Default cooldown period in seconds. */
  defaultCooldownSeconds?: number
}

/**
 * Create the trigger plugin.
 * 
 * @param config - plugin configuration
 * @returns plugin installer function
 */
export default function triggerPlugin(config?: Config) {
  return (ctx: Context) => {
    // The actual implementation is provided by a trigger provider
    // (e.g., trigger-local). This plugin just declares the service.
    
    ctx.logger.info('Trigger plugin loaded')
    
    return () => {
      ctx.logger.info('Trigger plugin unloaded')
    }
  }
}

/**
 * Helper to create a branded TriggerId.
 */
export function createTriggerId(id: string): TriggerId {
  return id as TriggerId
}

/**
 * Helper to generate a unique TriggerId.
 */
export function generateTriggerId(): TriggerId {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `trg_${timestamp}_${random}` as TriggerId
}
