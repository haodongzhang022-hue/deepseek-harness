/**
 * Local trigger engine provider.
 * 
 * This module implements the TriggerEngine interface using local
 * file system and HTTP servers for signal reception.
 * 
 * @module @deepseek-ai/dsh-trigger-local
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
  Signal
} from '@deepseek-ai/dsh-trigger'
import { createTriggerId, generateTriggerId } from '@deepseek-ai/dsh-trigger'
import { assertValidTrigger, assertTriggerState } from '@deepseek-ai/dsh-trigger/invariant'

/**
 * Local trigger engine configuration.
 */
export interface Config {
  /** Enable debug logging. */
  debug?: boolean
  /** Maximum number of triggers per session. */
  maxTriggers?: number
  /** Default cooldown period in seconds. */
  defaultCooldownSeconds?: number
  /** HTTP server port for external signals. */
  httpPort?: number
  /** Enable file watching. */
  enableFileWatching?: boolean
}

/**
 * Trigger storage entry with internal metadata.
 */
interface TriggerEntry {
  record: TriggerRecord
  /** Active timers/intervals for this trigger. */
  timers: NodeJS.Timeout[]
  /** Registered file watchers. */
  watchers: any[]
  /** HTTP route handlers. */
  httpHandlers: Map<string, (signal: Signal) => Promise<void>>
}

/**
 * Local trigger engine implementation.
 */
class LocalTriggerEngine implements TriggerEngine {
  private triggers = new Map<TriggerId, TriggerEntry>()
  private signalSources = new Map<string, SignalSource>()
  private context: Context
  private config: Required<Config>

  constructor(context: Context, config: Config) {
    this.context = context
    this.config = {
      debug: config.debug ?? false,
      maxTriggers: config.maxTriggers ?? 100,
      defaultCooldownSeconds: config.defaultCooldownSeconds ?? 60,
      httpPort: config.httpPort ?? 8030,
      enableFileWatching: config.enableFileWatching ?? true
    }
  }

  /**
   * Create a new trigger.
   */
  async create(request: CreateTriggerRequest): Promise<TriggerRecord> {
    // Check max triggers limit
    if (this.triggers.size >= this.config.maxTriggers) {
      throw new Error(`Maximum trigger limit reached: ${this.config.maxTriggers}`)
    }

    const id = generateTriggerId()
    const now = new Date().toISOString()

    const record: TriggerRecord = {
      id,
      name: request.name,
      description: request.description,
      condition: request.condition,
      action: request.action,
      state: 'idle',
      createdAt: now,
      triggerCount: 0,
      maxTriggers: request.maxTriggers,
      cooldownSeconds: request.cooldownSeconds ?? this.config.defaultCooldownSeconds
    }

    const entry: TriggerEntry = {
      record,
      timers: [],
      watchers: [],
      httpHandlers: new Map()
    }

    this.triggers.set(id, entry)
    this.log(`Created trigger: ${id} (${request.name})`)
    
    return record
  }

  /**
   * Delete a trigger.
   */
  async delete(id: TriggerId): Promise<void> {
    const entry = this.triggers.get(id)
    if (!entry) {
      throw new Error(`Trigger not found: ${id}`)
    }

    // Clean up resources
    this.cleanupEntry(entry)
    this.triggers.delete(id)
    this.log(`Deleted trigger: ${id}`)
  }

  /**
   * Arm (enable) a trigger.
   */
  async arm(id: TriggerId): Promise<void> {
    const entry = this.triggers.get(id)
    if (!entry) {
      throw new Error(`Trigger not found: ${id}`)
    }

    assertTriggerState(entry.record, ['idle', 'disabled'])
    entry.record.state = 'armed'
    
    // Set up condition monitoring
    await this.setupConditionMonitoring(entry)
    this.log(`Armed trigger: ${id}`)
  }

  /**
   * Disarm (disable) a trigger.
   */
  async disarm(id: TriggerId): Promise<void> {
    const entry = this.triggers.get(id)
    if (!entry) {
      throw new Error(`Trigger not found: ${id}`)
    }

    assertTriggerState(entry.record, ['armed'])
    entry.record.state = 'disabled'
    
    // Clean up monitoring
    this.cleanupEntry(entry)
    this.log(`Disarmed trigger: ${id}`)
  }

  /**
   * Get a trigger by ID.
   */
  async get(id: TriggerId): Promise<TriggerRecord | null> {
    const entry = this.triggers.get(id)
    return entry?.record ?? null
  }

  /**
   * List triggers with optional filter.
   */
  async list(filter?: TriggerFilter): Promise<TriggerRecord[]> {
    let records = Array.from(this.triggers.values()).map(e => e.record)

    if (filter?.state) {
      records = records.filter(r => r.state === filter.state)
    }
    if (filter?.conditionType) {
      records = records.filter(r => r.condition.type === filter.conditionType)
    }
    if (filter?.actionTypes) {
      records = records.filter(r => filter.actionTypes!.includes(r.action.type))
    }

    return records
  }

  /**
   * Manually trigger a trigger.
   */
  async trigger(id: TriggerId, data?: unknown): Promise<void> {
    const entry = this.triggers.get(id)
    if (!entry) {
      throw new Error(`Trigger not found: ${id}`)
    }

    await this.executeAction(entry, data)
  }

  /**
   * Register an external signal source.
   */
  registerSignalSource(source: SignalSource): () => void {
    this.signalSources.set(source.name, source)
    this.log(`Registered signal source: ${source.name}`)
    
    return () => {
      this.signalSources.delete(source.name)
      this.log(`Unregistered signal source: ${source.name}`)
    }
  }

  /**
   * Process an incoming signal.
   */
  async processSignal(signal: Signal): Promise<void> {
    this.log(`Received signal: ${signal.type} from ${signal.source}`)
    
    // Check all armed triggers for matching conditions
    for (const entry of this.triggers.values()) {
      if (entry.record.state !== 'armed') continue
      
      const matches = await this.evaluateCondition(entry.record.condition, signal)
      if (matches) {
        await this.executeAction(entry, signal.data)
      }
    }
  }

  /**
   * Clean up entry resources.
   */
  private cleanupEntry(entry: TriggerEntry): void {
    // Clear timers
    for (const timer of entry.timers) {
      clearInterval(timer)
      clearTimeout(timer)
    }
    entry.timers = []

    // Close file watchers
    for (const watcher of entry.watchers) {
      watcher.close()
    }
    entry.watchers = []

    // Remove HTTP handlers
    entry.httpHandlers.clear()
  }

  /**
   * Set up condition monitoring based on condition type.
   */
  private async setupConditionMonitoring(entry: TriggerEntry): Promise<void> {
    const { condition } = entry.record

    switch (condition.type) {
      case 'schedule':
        this.setupScheduleCondition(entry, condition.config as any)
        break
      case 'file':
        if (this.config.enableFileWatching) {
          await this.setupFileCondition(entry, condition.config as any)
        }
        break
      case 'http':
        this.setupHttpCondition(entry, condition.config as any)
        break
      case 'event':
        this.setupEventCondition(entry, condition.config as any)
        break
      case 'composite':
        // Composite conditions are evaluated on signal receipt
        break
    }
  }

  /**
   * Set up schedule-based condition.
   */
  private setupScheduleCondition(
    entry: TriggerEntry,
    config: { schedule: number | string; timeZone?: string }
  ): void {
    if (typeof config.schedule === 'number') {
      // Interval-based schedule
      const interval = setInterval(async () => {
        if (entry.record.state === 'armed') {
          await this.executeAction(entry)
        }
      }, config.schedule * 1000)

      entry.timers.push(interval)
    }
    // Cron-based scheduling would require a cron library
  }

  /**
   * Set up file watching condition.
   */
  private async setupFileCondition(
    entry: TriggerEntry,
    config: { pattern: string; changeType: string }
  ): Promise<void> {
    // File watching implementation would use fs.watch or chokidar
    // This is a placeholder for the actual implementation
    this.log(`File watching not yet implemented for pattern: ${config.pattern}`)
  }

  /**
   * Set up HTTP endpoint condition.
   */
  private setupHttpCondition(
    entry: TriggerEntry,
    config: { path: string; method: string; bodyFilter?: Record<string, unknown> }
  ): void {
    // HTTP handler registration
    const handler = async (signal: Signal) => {
      if (entry.record.state === 'armed') {
        await this.executeAction(entry, signal.data)
      }
    }

    const routeKey = `${config.method}:${config.path}`
    entry.httpHandlers.set(routeKey, handler)
  }

  /**
   * Set up event condition.
   */
  private setupEventCondition(
    entry: TriggerEntry,
    config: { event: string; filter?: Record<string, unknown> }
  ): void {
    // Event listening implementation
    // Would integrate with Cordis event system
    this.log(`Event listening not yet implemented for: ${config.event}`)
  }

  /**
   * Evaluate a condition against a signal.
   */
  private async evaluateCondition(
    condition: any,
    signal: Signal
  ): Promise<boolean> {
    switch (condition.type) {
      case 'event':
        return signal.type === condition.config.event
      case 'http':
        return signal.source === 'http' && signal.type === condition.config.path
      case 'file':
        return signal.type === 'file_change' && signal.source === condition.config.pattern
      case 'schedule':
        return signal.type === 'schedule_tick'
      case 'composite':
        return this.evaluateCompositeCondition(condition.config, signal)
      default:
        return false
    }
  }

  /**
   * Evaluate composite condition.
   */
  private async evaluateCompositeCondition(
    config: { operator: string; conditions: any[] },
    signal: Signal
  ): Promise<boolean> {
    const results = await Promise.all(
      config.conditions.map(c => this.evaluateCondition(c, signal))
    )

    switch (config.operator) {
      case 'AND':
        return results.every(r => r)
      case 'OR':
        return results.some(r => r)
      case 'NOT':
        return !results[0]
      default:
        return false
    }
  }

  /**
   * Execute a trigger's action.
   */
  private async executeAction(entry: TriggerEntry, data?: unknown): Promise<void> {
    const { record } = entry
    
    // Check cooldown
    if (record.lastTriggeredAt && record.cooldownSeconds) {
      const lastTriggered = new Date(record.lastTriggeredAt).getTime()
      const cooldownMs = record.cooldownSeconds * 1000
      if (Date.now() - lastTriggered < cooldownMs) {
        this.log(`Trigger ${record.id} in cooldown, skipping`)
        return
      }
    }

    // Check max triggers
    if (record.maxTriggers && record.triggerCount >= record.maxTriggers) {
      this.log(`Trigger ${record.id} reached max triggers, disabling`)
      record.state = 'disabled'
      return
    }

    // Update trigger state
    record.state = 'triggered'
    record.lastTriggeredAt = new Date().toISOString()
    record.triggerCount++

    this.log(`Executing action for trigger: ${record.id}`)

    try {
      switch (record.action.type) {
        case 'workflow':
          // Would integrate with workflow engine
          this.log(`Workflow action not yet implemented`)
          break
        case 'tool':
          // Would call the tool
          this.log(`Tool action not yet implemented`)
          break
        case 'message':
          // Would send a message
          this.log(`Message action not yet implemented`)
          break
        case 'webhook':
          // Would make HTTP request
          this.log(`Webhook action not yet implemented`)
          break
      }
    } catch (error) {
      this.context.logger.error(`Action execution failed: ${error}`)
    }

    // Return to armed state if still active
    if (record.state === 'triggered') {
      record.state = 'armed'
    }
  }

  /**
   * Log a debug message.
   */
  private log(message: string): void {
    if (this.config.debug) {
      this.context.logger.debug(`[Trigger] ${message}`)
    }
  }
}

/**
 * Create the local trigger engine plugin.
 */
export default function triggerLocalPlugin(config?: Config) {
  return (ctx: Context) => {
    const engine = new LocalTriggerEngine(ctx, config ?? {})
    
    // Register the engine as a service
    ;(ctx as any).triggers = engine
    
    ctx.logger.info('Local trigger engine loaded')
    
    return () => {
      // Clean up all triggers
      for (const entry of (engine as any).triggers.values()) {
        (engine as any).cleanupEntry(entry)
      }
      ctx.logger.info('Local trigger engine unloaded')
    }
  }
}
