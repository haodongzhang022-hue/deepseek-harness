/** Shared client-side view types (snapshot face mirrors the host payload). */
export interface Snapshot {
  generatedAt: string
  jobs: Array<{ name: string; everyMs: number | null; target: string; lastRunAt: string | null; lastOk: boolean | null; lastDetail: string; nextDueApprox: string | null }>
  runs: Array<{ at: string; job: string; ok: boolean; detail: string; durationMs: number }>
  gates: Array<{ name: string; label: string; items: Array<{ id: string; sourceLane: string; title: string; lastState: string; notifyCount: number }> }>
  agents: Array<{ port: number; sessionId: string; live: boolean }>
  triggers: Array<{
    trigger_id: string
    channel: string
    matchText: string
    actionSummary: string
    enabled: boolean
    ownerSession: string
    lastReceiptAt: string | null
    lastReceiptStatus: string | null
    consecutiveInfo: string
  }>
  runningNow: Array<{ trigger_id: string; elapsedMs: number }>
  externalClocks: Array<{ name: string; schedule: string; state: string }>
}
