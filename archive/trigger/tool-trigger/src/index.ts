/**
 * Trigger tools for DeepSeek Harness.
 * 
 * This module provides model-facing tools for managing triggers:
 * - trigger_create: Create a new trigger
 * - trigger_list: List all triggers
 * - trigger_delete: Delete a trigger
 * - trigger_arm: Arm a trigger
 * - trigger_disarm: Disarm a trigger
 * 
 * @module @deepseek-ai/dsh-tool-trigger
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type {
  TriggerEngine,
  TriggerRecord,
  TriggerId,
  CreateTriggerRequest
} from '@deepseek-ai/dsh-trigger'
import { createTriggerId } from '@deepseek-ai/dsh-trigger'

export const name = 'tool-trigger'
export const inject = ['tools', 'triggers', 'systemPrompt']

/**
 * Tool configuration.
 */
export interface Config {
  /** Tool name prefix. */
  toolPrefix?: string
}

export const Config: z<Config> = z.object({
  toolPrefix: z.string().default('trigger')
})

type ResolvedConfig = Required<Config>

/**
 * Schema for trigger_create tool.
 */
const createTriggerSchema = z.object({
  name: z.string().describe('Human-readable trigger name'),
  description: z.string().optional().describe('Optional description'),
  condition: z.object({
    type: z.enum(['event', 'file', 'http', 'schedule', 'composite']),
    config: z.record(z.unknown())
  }).describe('Trigger condition'),
  action: z.object({
    type: z.enum(['workflow', 'tool', 'message', 'webhook']),
    config: z.record(z.unknown())
  }).describe('Action to execute when triggered'),
  maxTriggers: z.number().optional().describe('Maximum trigger count'),
  cooldownSeconds: z.number().optional().describe('Cooldown period in seconds')
})

/**
 * Schema for trigger_list tool.
 */
const listTriggersSchema = z.object({
  state: z.enum(['idle', 'armed', 'triggered', 'disabled']).optional(),
  conditionType: z.enum(['event', 'file', 'http', 'schedule', 'composite']).optional()
})

/**
 * Schema for trigger_delete tool.
 */
const deleteTriggerSchema = z.object({
  id: z.string().describe('Trigger ID to delete')
})

/**
 * Schema for trigger_arm tool.
 */
const armTriggerSchema = z.object({
  id: z.string().describe('Trigger ID to arm')
})

/**
 * Schema for trigger_disarm tool.
 */
const disarmTriggerSchema = z.object({
  id: z.string().describe('Trigger ID to disarm')
})

/**
 * Create the tool-trigger plugin.
 */
export default function toolTriggerPlugin(config?: Config) {
  return (ctx: Context) => {
    const resolvedConfig: ResolvedConfig = {
      toolPrefix: config?.toolPrefix ?? 'trigger'
    }

    // Register trigger_create tool
    ctx.tools.register(defineTool({
      name: `${resolvedConfig.toolPrefix}_create`,
      description: 'Create a new trigger that responds to conditions',
      schema: createTriggerSchema,
      async execute(args, context): Promise<ToolResultView> {
        const triggers: TriggerEngine = ctx.triggers
        
        const request: CreateTriggerRequest = {
          name: args.name,
          description: args.description,
          condition: args.condition as any,
          action: args.action as any,
          maxTriggers: args.maxTriggers,
          cooldownSeconds: args.cooldownSeconds
        }

        const record = await triggers.create(request)
        
        return {
          content: [{ type: 'text', text: JSON.stringify(record, null, 2) }]
        }
      }
    }))

    // Register trigger_list tool
    ctx.tools.register(defineTool({
      name: `${resolvedConfig.toolPrefix}_list`,
      description: 'List all triggers with optional filters',
      schema: listTriggersSchema,
      async execute(args, context): Promise<ToolResultView> {
        const triggers: TriggerEngine = ctx.triggers
        
        const records = await triggers.list({
          state: args.state,
          conditionType: args.conditionType
        })
        
        return {
          content: [{ type: 'text', text: JSON.stringify(records, null, 2) }]
        }
      }
    }))

    // Register trigger_delete tool
    ctx.tools.register(defineTool({
      name: `${resolvedConfig.toolPrefix}_delete`,
      description: 'Delete a trigger',
      schema: deleteTriggerSchema,
      async execute(args, context): Promise<ToolResultView> {
        const triggers: TriggerEngine = ctx.triggers
        const id = createTriggerId(args.id)
        
        await triggers.delete(id)
        
        return {
          content: [{ type: 'text', text: `Trigger ${args.id} deleted successfully` }]
        }
      }
    }))

    // Register trigger_arm tool
    ctx.tools.register(defineTool({
      name: `${resolvedConfig.toolPrefix}_arm`,
      description: 'Arm (enable) a trigger',
      schema: armTriggerSchema,
      async execute(args, context): Promise<ToolResultView> {
        const triggers: TriggerEngine = ctx.triggers
        const id = createTriggerId(args.id)
        
        await triggers.arm(id)
        
        return {
          content: [{ type: 'text', text: `Trigger ${args.id} armed successfully` }]
        }
      }
    }))

    // Register trigger_disarm tool
    ctx.tools.register(defineTool({
      name: `${resolvedConfig.toolPrefix}_disarm`,
      description: 'Disarm (disable) a trigger',
      schema: disarmTriggerSchema,
      async execute(args, context): Promise<ToolResultView> {
        const triggers: TriggerEngine = ctx.triggers
        const id = createTriggerId(args.id)
        
        await triggers.disarm(id)
        
        return {
          content: [{ type: 'text', text: `Trigger ${args.id} disarmed successfully` }]
        }
      }
    }))

    ctx.logger.info('Trigger tools loaded')
    
    return () => {
      ctx.logger.info('Trigger tools unloaded')
    }
  }
}
