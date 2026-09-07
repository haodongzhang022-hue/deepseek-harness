/**
 * Task-fold core: deterministic, dependency-free task splitting and delivery
 * recognition. Shared verbatim between the host tools (tf_index / tf_get) and
 * the browser fold layer, so a task id always resolves to the same segment.
 *
 * Task id scheme (message-local): "t<index>" (1-based). Fully-addressed id:
 * "<sessionId>:<seq>:t<index>" — assembled by the caller that knows the
 * message seq.
 */
export interface TaskSegment {
  /** 1-based segment index within its message. */
  readonly index: number
  /** Message-local id: "t<index>". */
  readonly localId: string
  /** Cleaned heading / first meaningful line. */
  readonly title: string
  /** Truncated one-line summary, safe for compact task bars. */
  readonly summary: string
  /** True when this segment is recognized delivery content (never folded by default). */
  readonly delivery: boolean
  /** Line range in the source text (inclusive start, exclusive end). */
  readonly start: number
  readonly end: number
}
export interface SplitResult {
  readonly tasks: readonly TaskSegment[]
  readonly text: string
}
export interface SplitOptions {
  /** Delivery-heading keywords (matched against cleaned titles). */
  readonly deliveryHeadings?: readonly string[]
  /** Delivery prefix markers for non-heading final segments. */
  readonly deliveryPrefix?: RegExp
  /** Max title length before truncation. */
  readonly maxTitle?: number
  /** Only the LAST segment may carry delivery=true. */
  readonly deliveryOnlyLast?: boolean
}
export const DEFAULT_DELIVERY_HEADINGS: readonly string[] = [
  '总结', '小结', '交付', '交付物', '交付内容', '交付成果', '结果', '完成', '完成情况',
  '结论', '下一步', '后续', '回顾', '摘要', '成果', '最终输出', '输出', '成品', '收尾',
  'Summary', 'Result', 'Conclusion', 'Deliverable', 'Deliverables', 'Done', 'Next',
  'Outcome', 'Completion', 'Wrap-up', 'Review', 'Recap', 'Final',
]
export const DEFAULT_DELIVERY_PREFIX = /^(?:✅|🎉|🎯|✔|☑|已完成|完成|交付|结果|结论|总结)[：:\s]/u
const HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/
const TASK_HEADING_RE = /^(?:任务|步骤|阶段|工作|子任务|里程碑|Task|Step|Phase|Action|Milestone|Work)\s*[0-9０-９一二三四五六七八九十]*\s*[:：.\-—_]?\s*(.*)$/i
const MARKER_RE = /^\s*(?:[-*+]\s*)?(?:\[[ xX]\]|✅|☑️?|✔|📌|🛠|🔧|📝|🎯|🧩|⭐)\s*(.+)$/u
const NUMBERED_RE = /^\s*(\d{1,3})[.、)）]\s+(.+)$/
function cleanTitle(raw: string, max: number): string {
  let t = raw.replace(/^#+\s*/, '').trim()
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/[*_\`~]/g, '').trim()
  if (t.length > max) t = t.slice(0, max - 1) + '…'
  return t
}
export function isDeliveryHeading(title: string, headings: readonly string[] = DEFAULT_DELIVERY_HEADINGS): boolean {
  const t = title.replace(/[：:，,。.!！?？\s]/g, '').toLowerCase()
  for (const h of headings) {
    if (h.length <= 1) continue
    const norm = h.replace(/[：:，,。.!！?？\s]/g, '').toLowerCase()
    if (t === norm) return true
    if (t.startsWith(norm) && t.length - norm.length <= 8) return true
  }
  return false
}
export function splitTasks(text: string, options: SplitOptions = {}): SplitResult {
  const headings = options.deliveryHeadings ?? DEFAULT_DELIVERY_HEADINGS
  const prefix = options.deliveryPrefix ?? DEFAULT_DELIVERY_PREFIX
  const maxTitle = options.maxTitle ?? 64
  const onlyLast = options.deliveryOnlyLast ?? true
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  interface Acc { start: number; title: string }
  const accs: Acc[] = []
  let cur: { start: number; title: string } | null = null
  const push = (start: number, rawTitle: string): void => {
    cur = { start, title: cleanTitle(rawTitle, maxTitle) }
    accs.push(cur)
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const h = HEADING_RE.exec(line)
    const isH = h !== null && h[1] !== undefined && h[1]!.trim().length > 0
    if (isH) {
      const title = cleanTitle(h![1]!, maxTitle)
      if (title.length > 0) push(i, title)
      continue
    }
    const shortEnough = trimmed.length < 80
    const tm = TASK_HEADING_RE.exec(trimmed)
    const mk = MARKER_RE.exec(trimmed)
    const nm = NUMBERED_RE.exec(trimmed)
    const isTaskLine = shortEnough && (
      (tm !== null && (tm[1] !== undefined && tm[1]!.trim().length > 0 || (tm[2] ?? '').trim().length > 0))
      || (mk !== null && mk[1] !== undefined && mk[1]!.trim().length > 0)
      || (nm !== null && nm[2] !== undefined && nm[2]!.trim().length > 0)
    )
    if (isTaskLine) {
      const raw = (tm !== null && (tm[2] ?? '').trim().length > 0) ? (tm[2] ?? trimmed)
        : (mk !== null ? (mk[1] ?? trimmed) : (nm !== null ? (nm[2] ?? trimmed) : trimmed))
      push(i, raw)
      continue
    }
    if (cur === null) push(i, trimmed)
  }
  if (accs.length === 0) accs.push({ start: 0, title: cleanTitle(text, maxTitle) || '（未命名任务）' })
  const ends = [...accs.slice(1).map(a => a.start), lines.length]
  const tasks: TaskSegment[] = accs.map((acc, idx) => {
    const end = ends[idx] ?? lines.length
    const bodyLines = lines.slice(acc.start, end).filter(l => l.trim().length > 0)
    const body = bodyLines.join('\n')
    const last = idx === accs.length - 1
    let delivery = false
    if (last) {
      if (isDeliveryHeading(acc.title, headings)) delivery = true
      else {
        const head = bodyLines.slice(0, 4).join('\n')
        if (prefix.test(head)) delivery = true
      }
    }
    if (!onlyLast) delivery = delivery || isDeliveryHeading(acc.title, headings)
    const summary = acc.title.length > 0 ? acc.title : cleanTitle(bodyLines[0] ?? '', maxTitle)
    return { index: idx + 1, localId: 't' + String(idx + 1), title: acc.title, summary, delivery, start: acc.start, end }
  })
  return { tasks, text }
}
export function taskIdOf(sessionId: string, seq: number, localId: string): string {
  return sessionId + ':' + String(seq) + ':' + localId
}
/** Parse a fully-addressed task id back into parts; returns null when malformed. */
export function parseTaskId(taskId: string): { sessionId: string; seq: number; localId: string } | null {
  const m = /^([^:]+):(\d+):(t\d+)$/.exec(taskId)
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null
  const seq = Number(m[2])
  if (!Number.isSafeInteger(seq) || seq < 0) return null
  return { sessionId: m[1], seq, localId: m[3] }
}
