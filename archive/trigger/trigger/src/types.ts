/**
 * Core types for the condition-trigger framework.
 * 
 * @module @deepseek-ai/dsh-trigger
 */

import type { Branded } from '@deepseek-ai/cordis'

/**
 * Trigger ID - unique identifier for a trigger within a session.
 */
export type TriggerId = Branded<string, 'TriggerId'>

/**
 * Trigger states.
 */
export type TriggerState = 'idle' | 'armed' | 'triggered' | 'disabled'

/**
 * Condition type discriminator.
 */
export type ConditionType = 'event' | 'file' | 'http' | 'schedule' | 'composite'

/**
 * Action type discriminator.
 */
export type ActionType = 'workflow' | 'tool' | 'message' | 'webhook'

/**
 * Event condition - listens for DSH events.
 */
export interface EventCondition {
  /** Event name to listen for. */
  readonly event: string
  /** Optional event filter (key-value pairs that must match). */
  readonly filter?: Record<string, unknown>
}

/**
 * File condition - watches for file system changes.
 */
export interface FileCondition {
  /** File path glob pattern. */
  readonly pattern: string
  /** Type of change to watch for. */
  readonly changeType: 'create' | 'modify' | 'delete' | 'any'
}

/**
 * HTTP condition - listens for HTTP requests.
 */
export interface HttpCondition {
  /** Endpoint path (e.g., "/deploy"). */
  readonly path: string
  /** HTTP method. */
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Optional request body filter. */
  readonly bodyFilter?: Record<string, unknown>
}

/**
 * Schedule condition - triggers on a time-based schedule.
 */
export interface ScheduleCondition {
  /** 
   * Schedule specification.
   * - number: interval in seconds (minimum 300)
   * - string: cron expression (5-field format)
   */
  readonly schedule: number | string
  /** Optional timezone (IANA format, e.g., "America/New_York"). */
  readonly timeZone?: string
}

/**
 * Composite condition - combines multiple conditions with logical operators.
 */
export interface CompositeCondition {
  /** Logical operator. */
  readonly operator: 'AND' | 'OR' | 'NOT'
  /** Child conditions. */
  readonly conditions: Condition[]
}

/**
 * Condition - union of all condition types.
 */
export interface Condition {
  /** Condition type discriminator. */
  readonly type: ConditionType
  /** Condition configuration. */
  readonly config: EventCondition | FileCondition | HttpCondition | ScheduleCondition | CompositeCondition
}

/**
 * Workflow action - executes a workflow script.
 */
export interface WorkflowAction {
  /** JavaScript workflow script body. */
  readonly script: string
  /** Workflow metadata. */
  readonly meta: {
    readonly name: string
    readonly description: string
    readonly whenToUse?: string
  }
}

/**
 * Tool action - calls a registered tool.
 */
export interface ToolAction {
  /** Tool name. */
  readonly toolName: string
  /** Tool arguments. */
  readonly args: Record<string, unknown>
}

/**
 * Message action - sends a message to a session.
 */
export interface MessageAction {
  /** Message content. */
  readonly content: string
  /** Target session ID (optional, defaults to current session). */
  readonly sessionId?: string
}

/**
 * Webhook action - sends an HTTP request.
 */
export interface WebhookAction {
  /** Target URL. */
  readonly url: string
  /** HTTP method. */
  readonly method: 'GET' | 'POST' | 'PUT'
  /** Optional request body. */
  readonly body?: Record<string, unknown>
}

/**
 * Action - union of all action types.
 */
export interface Action {
  /** Action type discriminator. */
  readonly type: ActionType
  /** Action configuration. */
  readonly config: WorkflowAction | ToolAction | MessageAction | WebhookAction
}

/**
 * Trigger record - persistent trigger state.
 */
export interface TriggerRecord {
  /** Unique trigger ID. */
  readonly id: TriggerId
  /** Human-readable trigger name. */
  readonly name: string
  /** Optional description. */
  readonly description?: string
  /** Trigger condition. */
  readonly condition: Condition
  /** Trigger action. */
  readonly action: Action
  /** Current state. */
  readonly state: TriggerState
  /** Creation timestamp (RFC 3339 UTC). */
  readonly createdAt: string
  /** Last trigger timestamp (RFC 3339 UTC). */
  readonly lastTriggeredAt?: string
  /** Number of times triggered. */
  readonly triggerCount: number
  /** Maximum trigger count (optional, unlimited if not set). */
  readonly maxTriggers?: number
  /** Cooldown period in seconds (optional). */
  readonly cooldownSeconds?: number
}

/**
 * Trigger event - emitted when trigger state changes.
 */
export interface TriggerEvent {
  /** Trigger ID. */
  readonly triggerId: TriggerId
  /** Event type. */
  readonly type: 'created' | 'armed' | 'triggered' | 'disabled' | 'deleted'
  /** Timestamp (RFC 3339 UTC). */
  readonly timestamp: string
  /** Optional event data. */
  readonly data?: unknown
}

/**
 * Create trigger request - input for creating a new trigger.
 */
export interface CreateTriggerRequest {
  /** Human-readable trigger name. */
  readonly name: string
  /** Optional description. */
  readonly description?: string
  /** Trigger condition. */
  readonly condition: Condition
  /** Trigger action. */
  readonly action: Action
  /** Maximum trigger count (optional). */
  readonly maxTriggers?: number
  /** Cooldown period in seconds (optional). */
  readonly cooldownSeconds?: number
}

/**
 * Trigger filter - for listing triggers.
 */
export interface TriggerFilter {
  /** Filter by state. */
  readonly state?: TriggerState
  /** Filter by condition type. */
  readonly conditionType?: ConditionType
  /** Filter by action type. */
  readonly actionTypes?: ActionType[]
}

/**
 * Signal - external signal received by the trigger system.
 */
export interface Signal {
  /** Signal type (user-defined). */
  readonly type: string
  /** Signal data. */
  readonly data: unknown
  /** Signal source identifier. */
  readonly source: string
  /** Timestamp (RFC 3339 UTC). */
  readonly timestamp: string
}

/**
 * Signal source - external system that can send signals.
 */
export interface SignalSource {
  /** Source name. */
  readonly name: string
  /** Signal handler function. */
  readonly handler: (signal: Signal) => Promise<void>
}

/**
 * Trigger engine interface - the main service definition.
 */
export interface TriggerEngine {
  /**
   * Create a new trigger.
   * @param request - trigger configuration
   * @returns the created trigger record
   */
  create(request: CreateTriggerRequest): Promise<TriggerRecord>
  
  /**
   * Delete a trigger.
   * @param id - trigger ID to delete
   */
  delete(id: TriggerId): Promise<void>
  
  /**
   * Arm (enable) a trigger.
   * @param id - trigger ID to arm
   */
  arm(id: TriggerId): Promise<void>
  
  /**
   * Disarm (disable) a trigger.
   * @param id - trigger ID to disarm
   */
  disarm(id: TriggerId): Promise<void>
  
  /**
   * Get a trigger by ID.
   * @param id - trigger ID
   * @returns trigger record or null if not found
   */
  get(id: TriggerId): Promise<TriggerRecord | null>
  
  /**
   * List triggers with optional filter.
   * @param filter - optional filter criteria
   * @returns list of trigger records
   */
  list(filter?: TriggerFilter): Promise<TriggerRecord[]>
  
  /**
   * Manually trigger a trigger.
   * @param id - trigger ID
   * @param data - optional data to pass to the action
   */
  trigger(id: TriggerId, data?: unknown): Promise<void>
  
  /**
   * Register an external signal source.
   * @param source - signal source configuration
   * @returns disposer function
   */
  registerSignalSource(source: SignalSource): () => void
}

/**
 * Trigger events map - for type-safe event handling.
 */
export interface TriggerEventMap {
  'trigger/created': TriggerEvent
  'trigger/armed': TriggerEvent
  'trigger/triggered': TriggerEvent
  'trigger/disabled': TriggerEvent
  'trigger/deleted': TriggerEvent
  'trigger/signal': Signal
}
