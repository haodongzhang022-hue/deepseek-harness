/**
 * MCP Bridge for external trigger signals.
 * 
 * This module provides an HTTP server that accepts external trigger signals
 * and forwards them to the trigger engine.
 * 
 * @module @deepseek-ai/dsh-trigger-mcp-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TriggerEngine, Signal } from '@deepseek-ai/dsh-trigger'

/**
 * MCP Bridge configuration.
 */
export interface Config {
  /** HTTP server port. */
  port?: number
  /** Server host. */
  host?: string
  /** API key for authentication (optional). */
  apiKey?: string
  /** Enable CORS. */
  enableCors?: boolean
  /** Request timeout in milliseconds. */
  timeoutMs?: number
}

/**
 * HTTP request handler type.
 */
type RequestHandler = (req: any, res: any) => Promise<void>

/**
 * MCP Bridge server.
 */
class TriggerMcpBridge {
  private server: any = null
  private engine: TriggerEngine
  private config: Required<Config>
  private context: Context

  constructor(context: Context, engine: TriggerEngine, config: Config) {
    this.context = context
    this.engine = engine
    this.config = {
      port: config.port ?? 8030,
      host: config.host ?? '127.0.0.1',
      apiKey: config.apiKey ?? '',
      enableCors: config.enableCors ?? true,
      timeoutMs: config.timeoutMs ?? 30000
    }
  }

  /**
   * Start the HTTP server.
   */
  async start(): Promise<void> {
    const http = await import('node:http')
    const { URL } = await import('node:url')

    this.server = http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res)
      } catch (error) {
        this.context.logger.error(`Request handling error: ${error}`)
        this.sendError(res, 500, 'Internal server error')
      }
    })

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.context.logger.info(
          `Trigger MCP bridge listening on ${this.config.host}:${this.config.port}`
        )
        resolve()
      })
    })
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.context.logger.info('Trigger MCP bridge stopped')
          resolve()
        })
      })
    }
  }

  /**
   * Handle incoming HTTP request.
   */
  private async handleRequest(req: any, res: any): Promise<void> {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const path = url.pathname

    // CORS headers
    if (this.config.enableCors) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
    }

    // Authentication
    if (this.config.apiKey) {
      const authHeader = req.headers.authorization
      if (!authHeader || authHeader !== `Bearer ${this.config.apiKey}`) {
        this.sendError(res, 401, 'Unauthorized')
        return
      }
    }

    // Route handling
    if (path === '/trigger/status' && req.method === 'GET') {
      await this.handleStatus(req, res)
    } else if (path.startsWith('/trigger/') && req.method === 'POST') {
      await this.handleTrigger(req, res, path)
    } else if (path === '/trigger/test' && req.method === 'POST') {
      await this.handleTest(req, res)
    } else {
      this.sendError(res, 404, 'Not found')
    }
  }

  /**
   * Handle status request.
   */
  private async handleStatus(req: any, res: any): Promise<void> {
    const triggers = await this.engine.list()
    
    this.sendJson(res, 200, {
      status: 'ok',
      triggerCount: triggers.length,
      triggers: triggers.map(t => ({
        id: t.id,
        name: t.name,
        state: t.state,
        triggerCount: t.triggerCount
      }))
    })
  }

  /**
   * Handle trigger signal.
   */
  private async handleTrigger(req: any, res: any, path: string): Promise<void> {
    // Parse path: /trigger/:triggerId/:source
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 3) {
      this.sendError(res, 400, 'Invalid path format: /trigger/:triggerId/:source')
      return
    }

    const triggerId = parts[1]
    const source = parts[2]

    // Read request body
    const body = await this.readBody(req)
    
    // Create signal
    const signal: Signal = {
      type: source,
      data: body,
      source: `http:${triggerId}`,
      timestamp: new Date().toISOString()
    }

    // Process signal
    await this.engine.processSignal(signal)

    this.sendJson(res, 200, {
      status: 'ok',
      message: 'Signal processed',
      triggerId,
      source
    })
  }

  /**
   * Handle test request.
   */
  private async handleTest(req: any, res: any): Promise<void> {
    const body = await this.readBody(req)
    
    if (!body.triggerId) {
      this.sendError(res, 400, 'Missing triggerId in request body')
      return
    }

    try {
      await this.engine.trigger(body.triggerId, body.data)
      
      this.sendJson(res, 200, {
        status: 'ok',
        message: 'Test trigger executed',
        triggerId: body.triggerId
      })
    } catch (error) {
      this.sendError(res, 404, `Trigger not found: ${body.triggerId}`)
    }
  }

  /**
   * Read request body as JSON.
   */
  private async readBody(req: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1024 * 1024) { // 1MB limit
          req.destroy()
          reject(new Error('Request body too large'))
          return
        }
        chunks.push(chunk)
      })
      
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (error) {
          reject(new Error('Invalid JSON'))
        }
      })
      
      req.on('error', reject)
    })
  }

  /**
   * Send JSON response.
   */
  private sendJson(res: any, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data, null, 2))
  }

  /**
   * Send error response.
   */
  private sendError(res: any, statusCode: number, message: string): void {
    this.sendJson(res, statusCode, { status: 'error', message })
  }
}

/**
 * Create the MCP bridge plugin.
 */
export default function triggerMcpBridgePlugin(config?: Config) {
  return (ctx: Context) => {
    const bridge = new TriggerMcpBridge(ctx, ctx.triggers, config ?? {})
    
    // Start the server
    bridge.start().catch((error) => {
      ctx.logger.error(`Failed to start MCP bridge: ${error}`)
    })
    
    ctx.logger.info('Trigger MCP bridge plugin loaded')
    
    return () => {
      bridge.stop().catch(() => {})
      ctx.logger.info('Trigger MCP bridge plugin unloaded')
    }
  }
}
