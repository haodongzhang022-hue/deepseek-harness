import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { extractRecordsFromToolResult } from '../src/plugin.ts'
import * as daemon from '../src/plugin.ts'

describe('extractRecordsFromToolResult', () => {
  it('parses a bare-array JSON text block', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify([{ issue_id: 'RC-1' }]) }] }
    expect(extractRecordsFromToolResult(result)).toEqual([{ issue_id: 'RC-1' }])
  })

  it('unwraps an envelope holding one array', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ issues: [{ issue_id: 'RC-2' }] }) }] }
    expect(extractRecordsFromToolResult(result)).toEqual([{ issue_id: 'RC-2' }])
  })

  it('returns empty on error results and non-JSON text', () => {
    expect(extractRecordsFromToolResult({ isError: true, content: [] })).toEqual([])
    expect(extractRecordsFromToolResult({ content: [{ type: 'text', text: 'gateway timeout html' }] })).toEqual([])
  })
})

describe('automation-router daemon plugin', () => {
  it('performs a first tick at startup, persists the ledger, and disposes its timer', async () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), 'router-plugin-')), 'ledger.json')
    const calls: string[] = []
    const execute = async (input: { name: string; arguments: unknown }): Promise<unknown> => {
      calls.push(input.name)
      if (input.arguments && typeof input.arguments === 'object' && 'agents' in input.arguments) return []
      const status = (input.arguments as { status?: string }).status ?? ''
      const records = status === 'rejected_8008'
        ? [{ issue_id: 'RC-77', title: 't', status, source_port: 8010, rejection_reason: 'r' }]
        : []
      return { content: [{ type: 'text', text: JSON.stringify(records) }] }
    }
    const ctx = new Context()
    const logs: string[] = []
    const capture = (level: string) => (...args: unknown[]): void => { logs.push(level + ': ' + args.map(String).join(' ')) }
    ctx.provide('logger', { info: capture('info'), warn: capture('warn'), error: capture('error'), debug: capture('debug'), success: capture('success') })
    ctx.provide('tools', { execute })

    // Awaiting the mount itself joins async apply completion (fiber.ready does not).
    const fiber = await ctx.plugin(daemon, {
      gates: [{ name: 'itg-8008', serverName: 'releasecontrol', ledgerPath }],
    })

    const errs = logs.filter(l => l.startsWith('error'))
    expect(errs, errs.join(' || ')).toEqual([])

    // Loader timing may resolve ready before the inline first tick settles.
    await vi.waitFor(() => {
      expect(calls.some(c => c === 'mcp__releasecontrol__list_release_state')).toBe(true)
      expect(existsSync(ledgerPath)).toBe(true)
    })
    const raw = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { items: Record<string, { lastState: string }> }
    expect(raw.items['RC-77'].lastState).toBe('rejected')

    // Disposal clears the poll timer.
    await fiber.dispose()
  })

  it('watches the 8027 staging gate with its own vocabulary and wake policy', async () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), 'router-staging-')), 'ledger.json')
    const execute = async (input: { arguments?: { status?: string; agents?: boolean } }): Promise<unknown> => {
      if (input.arguments?.agents === true) return []
      const records = input.arguments?.status === 'rejected_8027'
        ? [{ issue_id: 'RC-50', title: 'staging', status: 'rejected_8027', source_port: 8010 }]
        : []
      return { content: [{ type: 'text', text: JSON.stringify(records) }] }
    }
    const ctx = new Context()
    ctx.provide('tools', { execute })

    await ctx.plugin(daemon, {
      gates: [{ name: 'stg-8027', serverName: 'releasecontrol', ledgerPath, gate: 'staging-8027' }],
    })

    const raw = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { items: Record<string, { lastState: string }> }
    expect(raw.items['RC-50'].lastState).toBe('rejected')
  })

  it('serves the http-rest channel with no tools service present in the host', async () => {
    const ledgerPath = join(mkdtempSync(join(tmpdir(), 'router-http-')), 'ledger.json')
    const fetchCalls: string[] = []
    const stubFetch = (async (url: unknown): Promise<unknown> => {
      fetchCalls.push(String(url))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active_agents: [],
          issues_by_status: { rejected_8008: [{ issue_id: 'RC-88', source_port: 8015, title: 'rest' }] },
        }),
      }
    }) as unknown as typeof fetch
    const originalFetch = globalThis.fetch
    globalThis.fetch = stubFetch
    try {
      const ctx = new Context()
      // Deliberately no tools service: the http channel must not need one.

      await ctx.plugin(daemon, {
        gates: [{ name: 'itg-http', serverName: 'unused', ledgerPath, channel: 'http-rest', httpBaseUrl: 'http://gate.test' }],
      })

      await vi.waitFor(() => {
        expect(fetchCalls.some(u => u.includes('/api/v3/pipeline/status'))).toBe(true)
        expect(existsSync(ledgerPath)).toBe(true)
      })
      const raw = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { items: Record<string, { lastState: string }> }
      expect(raw.items['RC-88'].lastState).toBe('rejected')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fails loud at watcher start when the mcp channel lacks a tools service', async () => {
    const ctx = new Context()
    ctx.provide('logger', { info(): void {}, warn(): void {}, error(): void {}, debug(): void {}, success(): void {} })

    await expect(ctx.plugin(daemon, {
      gates: [{ name: 'no-tools', serverName: 'releasecontrol', ledgerPath: join(mkdtempSync(join(tmpdir(), 'router-missing-')), 'l.json') }],
    })).rejects.toThrow(/requires the tools service/)
  })
})
