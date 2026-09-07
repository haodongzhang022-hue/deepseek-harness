/**
 * Sandbox scheduler daemon: interval schedules firing exec/HTTP actions
 * with jitter, failure backoff, and an NDJSON audit journal. Self-contained
 * deployment copy of packages/automation/scheduler; loaded via file:// URL.
 * @module sandbox/automation/scheduler-plugin
 */

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Node timers cap at 2^31-1 ms; config clamps below it (dsh-timeout parity). */
const MAX_TIMER_DELAY_MS = 2_147_483_646

export const name = "automation-scheduler"
export const inject: string[] = []

interface ActionResult { ok: boolean; detail: string }
interface ActionRunner { run(): Promise<ActionResult> }

class ExecRunner implements ActionRunner {
  constructor(private readonly options: { command: string; args?: string[]; cwd?: string; timeoutMs: number }) {}
  async run(): Promise<ActionResult> {
    return new Promise((resolve) => {
      const parts = this.options.command.trim().split(/\s+/)
      const file = parts[0]!
      const child = spawn(file, [...parts.slice(1), ...this.options.args ?? []], {
        cwd: this.options.cwd === undefined || this.options.cwd === '' ? undefined : this.options.cwd,
        stdio: 'ignore',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
      child.on('error', (error) => resolve({ ok: false, detail: error.message }))
      child.on('exit', (code, signalName) => {
        if (signalName !== null) resolve({ ok: false, detail: 'killed by ' + signalName })
        else if (code === 0) resolve({ ok: true, detail: 'exit 0' })
        else resolve({ ok: false, detail: 'exit ' + String(code) })
      })
    })
  }
}

class HttpRunner implements ActionRunner {
  constructor(private readonly options: { url: string; method: string; body?: string; timeoutMs: number }) {}
  async run(): Promise<ActionResult> {
    try {
      const response = await fetch(this.options.url, {
        method: this.options.method,
        headers: { 'content-type': 'application/json' },
        body: this.options.method === 'GET' || this.options.body === undefined ? undefined : this.options.body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
      return response.ok
        ? { ok: true, detail: 'http ' + String(response.status) }
        : { ok: false, detail: 'http ' + String(response.status) + ': ' + (await response.text()).slice(0, 160) }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
}

export interface JobConfig {
  name: string
  everyMs: number
  jitterMs?: number
  timeoutMs?: number
  action: { kind: 'exec'; command: string; args?: string[]; cwd?: string } | { kind: 'http'; url: string; method?: string; body?: string }
}

export interface RouterGateConfig {
  name: string
  serverName: string
  ledgerPath: string
  pollIntervalMs?: number
  gate?: 'integration-8008' | 'staging-8027' | 'production-8028'
  /** Data channel: mcp = stdio tool calls via serverName; http = direct REST. */
  transport?: 'mcp' | 'http'
  /** Required when transport is http; e.g. http://localhost:8008 */
  httpBaseUrl?: string
}

export interface SchedulerConfig {
  jobs: JobConfig[]
  sweepIntervalMs: number
  journalPath: string
  /** Optional resident gate watchers hosted by this same plugin fiber. */
  routerGates?: RouterGateConfig[]
}

const JOB_SCHEMA: z<JobConfig> = z.object({
  name: z.string().required(),
  everyMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS),
  jitterMs: z.number().min(0).max(MAX_TIMER_DELAY_MS),
  timeoutMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS),
  // Loose shape: schemastery unions reject the merged object, so the exec/http
  // discrimination happens at runner build time and fails loud there.
  action: z.object({
    kind: z.string().required(),
    command: z.string(),
    args: z.array(String),
    cwd: z.string(),
    url: z.string(),
    method: z.string(),
    body: z.string(),
  }),
}) as unknown as z<JobConfig>

export const Config: z<SchedulerConfig> = z.object({
  jobs: z.array(JOB_SCHEMA),
  sweepIntervalMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS).default(30_000),
  journalPath: z.string().required(),
  // Without this declaration schemastery strips the field before apply sees it.
  routerGates: z.array(z.object({
    name: z.string().required(),
    serverName: z.string().required(),
    ledgerPath: z.string().required(),
    pollIntervalMs: z.number().min(1_000).max(MAX_TIMER_DELAY_MS),
    gate: z.union([z.const('integration-8008'), z.const('staging-8027'), z.const('production-8028')]),
    transport: z.union([z.const('mcp'), z.const('http')]),
    httpBaseUrl: z.string(),
  })),
}) as unknown as z<SchedulerConfig>

const DEFAULT_TIMEOUT_MS = 120_000

interface JournalEntry { at: string; job: string; ok: boolean; detail: string; durationMs: number }

export async function apply(ctx: Context, config: SchedulerConfig): Promise<void> {
  appendFileSync(config.journalPath + '.version', 'V4 routerGates=' + JSON.stringify(config.routerGates) + '\n', 'utf8');
  // One-shot diagnostics: can this host module pipeline import the router
  // plugin at all? Outcome lands beside the journal for post-mortem.
  void import('file:///E:/1shuju/1gitgengxin/dsh-sandbox-A1/dsh-local-plugins/automation/router-plugin.ts')
    .then(m => { const line = 'IMPORT OK keys=' + Object.keys(m).join(',') + '\n'; appendFileSync(config.journalPath + '.probe', line, 'utf8') })
    .catch(e => { const line = 'IMPORT FAIL ' + (e instanceof Error ? e.message : String(e)) + '\n'; appendFileSync(config.journalPath + '.probe', line, 'utf8') })
  try {
    const rootCtx = (ctx as unknown as { root?: { get(name?: string): unknown } }).root ?? ctx;
    const getter = (rootCtx as unknown as { get(name?: string): unknown });
    const loader = getter.get ? getter.get('loader') : undefined;
    const lines: string[] = [];
    if (loader && typeof loader === 'object') {
      const l = loader as { resolve?(id: string): unknown; getTasks?(): unknown[] };
      for (const id of ['automation-router', 'automation-router-b', 'automation-mini-c']) {
        const fiber = l.resolve ? l.resolve(id) : undefined;
        if (fiber === undefined) { lines.push(id + ': NOT RESOLVED'); continue; }
        const f = fiber as { status?: string; error?: unknown; domain?: unknown };
        let err = '';
        if (f.error !== undefined) err = ' error=' + String(f.error).slice(0, 300);
        lines.push(id + ': status=' + String(f.status) + err);
      }
    } else {
      lines.push('loader service unavailable');
    }
    appendFileSync(config.journalPath + '.tree', lines.join('\n') + '\n', 'utf8');
  } catch (e) {
    appendFileSync(config.journalPath + '.tree', 'TREE DUMP FAIL ' + String(e) + '\n', 'utf8');
  }
  const nextDueAt = new Map<string, number>()
  const failures = new Map<string, number>()

  const makeRunner = (job: JobConfig): ActionRunner => {
    const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (job.action.kind === 'exec') {
      if (typeof job.action.command !== 'string' || job.action.command === '') {
        throw new Error('automation-scheduler(' + job.name + '): exec action requires command')
      }
      return new ExecRunner({ command: job.action.command, args: job.action.args, cwd: job.action.cwd, timeoutMs })
    }
    if (job.action.kind === 'http') {
      if (typeof job.action.url !== 'string' || job.action.url === '') {
        throw new Error('automation-scheduler(' + job.name + '): http action requires url')
      }
      return new HttpRunner({ url: job.action.url, method: job.action.method ?? 'POST', body: job.action.body, timeoutMs })
    }
    throw new Error('automation-scheduler(' + job.name + '): unknown action kind ' + String(job.action.kind))
  };

  const fire = async (job: JobConfig): Promise<void> => {
    const began = Date.now()
    let result: ActionResult;
    try {
      result = await makeRunner(job).run()
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
    const count = result.ok ? 0 : (failures.get(job.name) ?? 0) + 1;
    failures.set(job.name, count)
    const base = job.everyMs * Math.min(2 ** count, 8)
    const jitter = job.jitterMs === undefined ? 0 : Math.floor(Math.random() * job.jitterMs)
    nextDueAt.set(job.name, began + base + jitter)
    const entry: JournalEntry = { at: new Date(began).toISOString(), job: job.name, ok: result.ok, detail: result.detail, durationMs: Date.now() - began };
    mkdirSync(dirname(config.journalPath), { recursive: true })
    appendFileSync(config.journalPath, JSON.stringify(entry) + '\n', 'utf8')
  };

  const sweep = async (): Promise<void> => {
    for (const job of config.jobs) {
      if ((nextDueAt.get(job.name) ?? 0) > Date.now()) continue
      await fire(job)
      ctx.logger.info("automation-scheduler(%s): fired", job.name)
    }
  };

  await sweep()
  ctx.effect(() => {
    const timer = setInterval(() => { void sweep() }, config.sweepIntervalMs)
    return () => { clearInterval(timer) }
  }, "automation-scheduler.tick")

  // ---- resident gate watchers (router role hosted in this fiber) ----
  appendFileSync(config.journalPath + '.version', 'V4 loop start gates=' + String(config.routerGates?.length) + '\n', 'utf8');
  for (const gate of config.routerGates ?? []) {
    startGateWatcher(ctx, gate).catch((error) => {
      ctx.logger.error("automation-router(%s): watcher crashed: %s", gate.name, error instanceof Error ? error.message : String(error))
    })
  }
}

// Gate status vocabularies observed in production; unknown statuses land on unmapped.
const GATE_VOCABULARIES: Record<string, Record<string, string>> = {
  "integration-8008": {
    queued_8008: "queued",
    testing_8008: "testing",
    rejected_8008: "rejected",
    rejected_8027: "rejected",
    approved_8008: "approved",
  },
  "staging-8027": {
    testing_8027: "testing",
    rejected_8027: "rejected",
    approved_8027: "approved",
    passed_8027: "approved",
  },
  "production-8028": {
    production_approved: "approved",
  },
}

function extractRejectionDetail(record: Record<string, unknown>): string | undefined {
  const gates = record.gate_results;
  if (Array.isArray(gates)) {
    const rejected = gates.filter((g): g is Record<string, unknown> => typeof g === "object" && g !== null && (g as Record<string, unknown>).decision === "rejected");
    const last = rejected[rejected.length - 1];
    if (last !== undefined && typeof last.rejection_reason === "string") return last.rejection_reason;
  }
  const feedback = record.feedback;
  if (Array.isArray(feedback)) {
    const records = feedback.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
    const last = records[records.length - 1];
    if (last !== undefined && typeof last.reason === "string") return last.reason;
  }
  return undefined;
}

interface LedgerRow { id: string; sourceLane: string; title: string; lastState: string; notifiedState?: string; notifyCount: number; updatedAt: number }

/** Issue summary shape from GET /api/v3/pipeline/status issues_by_status. */
interface IssueSummaryRecord {
  issue_id?: unknown
  source_port?: unknown
  title?: unknown
}

class GateLedger {
  private readonly items = new Map<string, LedgerRow>();
  private loaded = false;
  constructor(private readonly filePath: string) {}
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { version?: number; items?: Record<string, LedgerRow> };
      if (parsed.version === 1 && parsed.items) for (const row of Object.values(parsed.items)) this.items.set(row.id, row);
    } catch { /* absent or corrupt ledger starts empty */ }
  }
  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify({ version: 1, items: Object.fromEntries(this.items) }, null, 2) + "\n", "utf8");
    renameSync(tmp, this.filePath);
  }
  all(): LedgerRow[] { this.load(); return [...this.items.values()] }
  get(id: string): LedgerRow | undefined { this.load(); return this.items.get(id) }
  track(item: { id: string; sourceLane: string; title: string; state: string }): void {
    this.load();
    const old = this.items.get(item.id);
    if (old !== undefined && old.lastState === item.state && old.sourceLane === item.sourceLane && old.title === item.title) return;
    this.items.set(item.id, { id: item.id, sourceLane: item.sourceLane, title: item.title, lastState: item.state, notifiedState: old?.notifiedState, notifyCount: old?.notifyCount ?? 0, updatedAt: Date.now() });
    this.persist();
  }
  markNotified(id: string, state: string): void {
    this.load();
    const row = this.items.get(id);
    if (row === undefined) return;
    row.notifiedState = state;
    row.notifyCount += 1;
    row.updatedAt = Date.now();
    this.persist();
  }
}

async function startGateWatcher(ctx: Context, gate: RouterGateConfig): Promise<void> {
  // ctx.tools property access blocks forever on hosts where the service never
  // activates, so it is touched ONLY on the mcp path; http needs no tools.
  const resolveTools = (): { execute(input: Record<string, unknown>): Promise<unknown> } | undefined => {
    const bag = ctx as unknown as { get?(name: string): unknown };
    if (typeof bag.get !== "function") return undefined;
    return bag.get("tools") as { execute(input: Record<string, unknown>): Promise<unknown> } | undefined;
  };
  const vocabulary = GATE_VOCABULARIES[gate.gate ?? "integration-8008"]!;
  const ledger = new GateLedger(gate.ledgerPath);
  const statuses = Object.keys(vocabulary);

  const listItems = async (): Promise<{ id: string; sourceLane: string; title: string; state: string; detail?: string }[]> => {
    if ((gate.transport ?? 'mcp') === 'http') {
      if (typeof gate.httpBaseUrl !== 'string' || gate.httpBaseUrl === '') throw new Error('http transport requires httpBaseUrl');
      const response = await fetch(gate.httpBaseUrl + '/api/v3/pipeline/status', { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('http ' + String(response.status) + ' from pipeline status');
      const payload = await response.json() as { issues_by_status?: Record<string, IssueSummaryRecord> };
      const byStatus = payload.issues_by_status ?? {};
      const vocabularyMap = vocabulary as Record<string, string>;
      const items: { id: string; sourceLane: string; title: string; state: string }[] = [];
      for (const [status, issues] of Object.entries(byStatus)) {
        const state = vocabularyMap[status] ?? (status.endsWith('_8027') || status.endsWith('_8008') ? undefined : undefined);
        if (state === undefined) continue;
        for (const issue of Array.isArray(issues) ? issues : []) {
          if (typeof issue.issue_id !== 'string') continue;
          items.push({ id: issue.issue_id, sourceLane: String(issue.source_port ?? 'unknown'), title: typeof issue.title === 'string' ? issue.title : issue.issue_id, state });
        }
      }
      return items;
    }
    const tools = resolveTools();
    if (tools === undefined) throw new Error("tools service unavailable on this host");
    const snapshots = await Promise.all(statuses.map((status) => tools.execute({
      callId: "automation-router:" + status + ":" + String(Date.now()),
      name: "mcp__" + gate.serverName + "__list_release_state",
      arguments: { status },
      signal: new AbortController().signal,
    }).then(extractListingRecords)));
    const map = vocabulary as Record<string, string>;
    const items: { id: string; sourceLane: string; title: string; state: string; detail?: string }[] = [];
    for (const record of snapshots.flat()) {
      const id = typeof record.issue_id === "string" ? record.issue_id : undefined;
      if (id === undefined) continue;
      const status = typeof record.status === "string" ? record.status : "";
      const state = map[status] ?? "unmapped";
      const detail = state === "rejected" ? extractRejectionDetail(record) : undefined;
      items.push({ id, sourceLane: String(record.source_port ?? "unknown"), title: typeof record.title === "string" ? record.title : id, state, ...(detail !== undefined ? { detail } : {}) });
    }
    return items;
  };

  const tick = async (): Promise<void> => {
    try {
      const current = await listItems();
      let woke = 0;
      for (const item of current) ledger.track(item);
      for (const item of current) {
        if (item.state !== "rejected") continue;
        const row = ledger.get(item.id);
        if (row !== undefined && row.notifiedState === "rejected") continue;
        ctx.logger.warn("automation-router(%s): WAKE %s lane=%s :: %s", gate.name, item.id, item.sourceLane, item.detail ?? "(no reason captured)");
        ledger.markNotified(item.id, item.state);
        woke += 1;
      }
      ctx.logger.info("automation-router(%s): items=%d woke=%d", gate.name, current.length, woke);
      appendFileSync(gate.ledgerPath + ".trace.log", new Date().toISOString() + " items=" + String(current.length) + " woke=" + String(woke) + "\n", "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendFileSync(gate.ledgerPath + ".errors.log", new Date().toISOString() + " " + message + "\n", "utf8");
    }
  };

  await tick();
  ctx.effect(() => {
    const timer = setInterval(() => { void tick() }, gate.pollIntervalMs ?? 60_000);
    return () => { clearInterval(timer) };
  }, "automation-router.poll." + gate.name);
}

function extractListingRecords(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null) return [];
  const bag = result as Record<string, unknown>;
  if (bag.isError === true) return [];
  if (!Array.isArray(bag.content)) return [];
  const text = (bag.content as unknown[]).map((block) => typeof block === "object" && block !== null && typeof (block as Record<string, unknown>).text === "string" ? (block as Record<string, unknown>).text as string : "").join("");
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
    if (typeof parsed === "object" && parsed !== null) {
      for (const value of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(value)) return value.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
      }
    }
    return [];
  } catch {
    return [];
  }
}