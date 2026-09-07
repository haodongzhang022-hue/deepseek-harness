import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RelayStore, RelayError, INDUSTRIES } from '../src/store.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'relay-'))
const valid = {
  task_brief: '对 E 盘永续 15m 做动量因子挖掘',
  input_context: { data_refs: ["duck_kline_path('E')"] },
  current_progress: 'G1 数据已就绪',
  next_step: '扩算子空间',
  assignee_role: '量化·因子研究员',
  output_contract: { artifact_path: 'data/factor/xxx.json', acceptance: 'G2' },
}

test('新建卡：字段回读一致 + gid 顺序递增', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    const c1 = s.create({ ...valid })
    const c2 = s.create({ ...valid, task_brief: '第二张卡' })
    assert.equal(c1.gid, 'RL-000001')
    assert.equal(c2.gid, 'RL-000002')
    assert.equal(c1.status, 'open')
    assert.equal(c1.industry, 'generic')
    assert.equal(c1.architect_type, 'generic')
    assert.equal(c1.priority, 'P2')
    assert.deepEqual(c1.input_context, valid.input_context)
    assert.deepEqual(c1.output_contract, valid.output_contract)
    assert.equal(c1.history.length, 1)
    assert.equal(c1.history[0].action, 'create')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('必填缺失 → RelayError 且不落盘', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    assert.throws(() => s.create({ ...valid, task_brief: '' }), RelayError)
    assert.throws(() => s.create({ ...valid, assignee_role: undefined }), RelayError)
    assert.throws(() => s.create({ task_brief: 'x' }), RelayError)
    assert.equal(s.list({}).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('industry / status / priority 非法 → RelayError', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    assert.throws(() => s.create({ ...valid, industry: 'space' }), RelayError)
    assert.throws(() => s.create({ ...valid, status: 'closed' }), RelayError)
    assert.throws(() => s.create({ ...valid, priority: 'P9' }), RelayError)
    assert.throws(() => s.create({ ...valid, capabilities_required: [1] }), RelayError)
    assert.throws(() => s.create({ ...valid, input_context: 'nope' }), RelayError)
    assert.throws(() => s.create({ ...valid, output_contract: 'nope' }), RelayError)
    assert.equal(s.list({}).length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('list 过滤：status / assignee_role / industry / limit', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    s.create({ ...valid, assignee_role: '架构·秘书' })
    s.create({ ...valid, assignee_role: '量化·开发', industry: 'finance' })
    s.create({ ...valid, assignee_role: '游戏·总师', industry: 'game' })
    assert.equal(s.list({ status: 'open' }).length, 3)
    assert.equal(s.list({ assignee_role: '量化·开发' }).length, 1)
    assert.equal(s.list({ industry: 'finance' }).length, 1)
    assert.equal(s.list({}).length, 3)
    assert.equal(s.list({ limit: 2 }).length, 2)
    // 倒序：最新在前
    assert.equal(s.list({ limit: 1 })[0].gid, 'RL-000003')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('update：部分字段 + 状态流转 + history 留痕', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    const c = s.create({ ...valid })
    const u1 = s.update(c.gid, { current_progress: '算子已扩展 12→20', status: 'in_progress' })
    assert.equal(u1.status, 'in_progress')
    assert.equal(u1.current_progress, '算子已扩展 12→20')
    assert.equal(u1.history.length, 2)
    assert.equal(u1.history[1].action, 'status')
    assert.deepEqual(u1.history[1].fields, ['current_progress', 'status'])
    const u2 = s.update(c.gid, { status: 'done', note: '产物已落盘，G2 门禁通过' })
    assert.equal(u2.status, 'done')
    assert.equal(u2.history.length, 3)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('done 终态：不可回退，仅可追加 note/output_contract', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    const c = s.create({ ...valid })
    s.update(c.gid, { status: 'done' })
    assert.throws(() => s.update(c.gid, { status: 'open' }), RelayError)
    assert.throws(() => s.update(c.gid, { status: 'in_progress' }), RelayError)
    const u = s.update(c.gid, { note: '复审追加' })
    assert.equal(u.status, 'done')
    assert.equal(u.note, '复审追加')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('update 不存在 gid → null；无字段 → RelayError', () => {
  const dir = tmp()
  try {
    const s = new RelayStore(dir)
    assert.equal(s.update('RL-999999', { note: 'x' }), null)
    const c = s.create({ ...valid })
    assert.throws(() => s.update(c.gid, {}), RelayError)
    assert.throws(() => s.update(c.gid, { unknown_field: 1 }), RelayError)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('持久化：重建 store 数据仍在、seq 续号不冲突', () => {
  const dir = tmp()
  try {
    let s = new RelayStore(dir)
    s.create({ ...valid })
    s.create({ ...valid })
    s.update('RL-000001', { status: 'done' })
    s = new RelayStore(dir) // 重载
    assert.equal(s.list({}).length, 2)
    assert.equal(s.read('RL-000001').status, 'done')
    const c = s.create({ ...valid })
    assert.equal(c.gid, 'RL-000003') // 续号无冲突
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('损坏文件：隔离留档 + 空启动不崩', () => {
  const dir = tmp()
  try {
    const file = join(dir, 'relay-cards.json')
    writeFileSync(file, '{broken json!!', 'utf8')
    const s = new RelayStore(dir)
    assert.equal(s.list({}).length, 0)
    const c = s.create({ ...valid })
    assert.equal(c.gid, 'RL-000001')
    // 损坏文件被重命名留档
    const files = readdirSync(dir)
    assert.ok(files.some((f) => f.startsWith('relay-cards.json.corrupt-')))
    // 新数据正常持久化
    const s2 = new RelayStore(dir)
    assert.equal(s2.list({}).length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('industry 枚举与注册表一致（generic/finance/game/video/novel/software）', () => {
  assert.ok(Array.isArray(INDUSTRIES))
  assert.deepEqual([...INDUSTRIES], ['generic', 'finance', 'game', 'video', 'novel', 'software'])
})