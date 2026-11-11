import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataEngine } from '../packages/orchestration/src/bot-data-engine.mjs'

// A short default timeout so the cancellation test is quick; the loop tests are fast regardless.
let engine
let dir

const SALES = 'region,product,sales,day\nNorth,Widget,120,2026-01-01\nSouth,Widget,80,2026-01-02\nNorth,Gadget,60,2026-02-01\nSouth,Gadget,200,2026-02-05\nEast,Widget,95,2026-03-01'

const removeQuietly = async path => {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await rm(path, { recursive: true, force: true }); return } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mb-data-test-'))
  engine = createDataEngine({ dataDir: dir, sqlTimeoutMs: 1500 })
})

after(async () => {
  await engine.closeAll()
  await removeQuietly(dir)
})

test('engine: first use creates a missing Host data directory before opening SQLite', async () => {
  const fresh = createDataEngine({ dataDir: join(dir, 'first-use', 'nested') })
  try {
    const bot = fresh.forBot('new-bot')
    await bot.load({ from: 'content', format: 'csv', name: 'first', content: 'value\n7' })
    assert.deepEqual((await bot.sql({ sql: 'SELECT value FROM first' })).rows, [[7]])
  } finally { assert.equal((await fresh.closeAll()).unconfirmed.length, 0) }
})

test('engine: a blocked storage directory gives a bounded error without the Host filesystem path', async () => {
  const blocked = join(dir, 'blocked-directory')
  await writeFile(blocked, 'fixture')
  const fresh = createDataEngine({ dataDir: join(blocked, 'nested') })
  try {
    await assert.rejects(fresh.forBot('new-bot').catalog(), error => {
      assert.equal(error.error.code, 'engine_unavailable')
      assert.doesNotMatch(error.error.message, /blocked-directory|nested|ENOTDIR|EEXIST/)
      return true
    })
  } finally { assert.equal((await fresh.closeAll()).unconfirmed.length, 0) }
})

test('engine: load → describe → sql → show(table) → page → export → catalog is a real loop', async () => {
  const bot = engine.forBot('loop-bot')
  const loaded = await bot.load({ from: 'content', content: SALES, name: 'sales' })
  assert.equal(loaded.tables[0].rowCount, 5)
  assert.deepEqual(loaded.tables[0].columns.map(column => column.type), ['TEXT', 'TEXT', 'INTEGER', 'TEXT'])

  const described = await bot.describe('sales')
  assert.equal(described.rowCount, 5)
  assert.ok(described.columns.every(column => Array.isArray(column.sample)))

  const query = await bot.sql({ sql: 'SELECT region, SUM(sales) AS total FROM sales GROUP BY region ORDER BY total DESC' })
  assert.deepEqual(query.rows, [['South', 280], ['North', 180], ['East', 95]])
  assert.equal(query.truncated, false)

  const card = await bot.show({ table: 'sales', kind: 'table', title: 'Sales' })
  assert.equal(card.kind, 'table')
  assert.equal(card.rowCount, 5)
  assert.equal(card.rows.length, 5)

  const page = await bot.page({ cardId: card.id, offset: 2, limit: 2 })
  assert.equal(page.offset, 2)
  assert.equal(page.rowCount, 5)
  assert.equal(page.rows.length, 2)

  const exported = await bot.exportCsv({ table: 'sales' })
  assert.equal(exported.rowCount, 5)
  assert.match(exported.content, /region,product,sales,day/)

  const catalog = await bot.catalog()
  assert.ok(catalog.tables.some(table => table.name === 'sales'))
})

test('engine: a chart card returns a declarative series, not executable output', async () => {
  const bot = engine.forBot('loop-bot')
  const card = await bot.show({ table: 'sales', kind: 'chart', chart: { type: 'bar', x: 'region', y: 'sales', agg: 'sum' } })
  assert.equal(card.kind, 'chart')
  assert.equal(card.chart.type, 'bar')
  const series = card.chart.series[0].points
  assert.deepEqual(series.map(point => point.x).sort(), ['East', 'North', 'South'])
})

test('engine: a duplicate dataset name either replaces or gets a verifiable suffix', async () => {
  const bot = engine.forBot('dup-bot')
  await bot.load({ from: 'content', content: 'a\n1', name: 't' })
  const replaced = await bot.load({ from: 'content', content: 'a\n1\n2', name: 't' })
  assert.equal(replaced.tables[0].name, 't')
  assert.equal(replaced.tables[0].rowCount, 2)
  const suffixed = await bot.load({ from: 'content', content: 'a\n9', name: 't', replace: false })
  assert.equal(suffixed.tables[0].name, 't_2')
})

test('engine: a failed import leaves no partial table behind', async () => {
  const bot = engine.forBot('fail-bot')
  await bot.load({ from: 'content', content: 'a,b\n1,2', name: 'good' })
  await assert.rejects(() => bot.load({ from: 'content', content: 'a,b\n"oops', name: 'bad' }), error => error.error.code === 'import_failed')
  const catalog = await bot.catalog()
  assert.ok(catalog.tables.some(table => table.name === 'good'))
  assert.ok(!catalog.tables.some(table => table.name === 'bad'))
})

test('engine: datasets are isolated per Bot — one Bot never sees another’s tables', async () => {
  const a = engine.forBot('iso-a')
  const b = engine.forBot('iso-b')
  await a.load({ from: 'content', content: 'secret\n1', name: 'only_a' })
  const namesA = (await a.catalog()).tables.map(table => table.name)
  const namesB = (await b.catalog()).tables.map(table => table.name)
  assert.ok(namesA.includes('only_a'))
  assert.ok(!namesB.includes('only_a'))
})

test('engine: a Bot id that is not valid is refused before any database is opened', async () => {
  await assert.rejects(async () => engine.forBot('../escape').catalog(), error => error.error?.code === 'invalid_input')
})

test('engine: dangerous functions are unavailable at execution (proven, not asserted by regex)', async () => {
  const bot = engine.forBot('sec-bot')
  await bot.load({ from: 'content', content: 'n\n1', name: 'nums' })
  await assert.rejects(() => bot.sql({ sql: "SELECT load_extension('/tmp/evil')" }), error => /not authorized/.test(error.error.message))
  await assert.rejects(() => bot.sql({ sql: "SELECT readfile('/etc/hostname')" }), error => /no such function/.test(error.error.message))
  await assert.rejects(() => bot.sql({ sql: "SELECT writefile('/tmp/x', 'y')" }), error => /no such function/.test(error.error.message))
  await assert.rejects(() => bot.sql({ sql: "ATTACH DATABASE '/tmp/x.sqlite' AS z" }), error => error.error.code === 'write_refused')
  await assert.rejects(() => bot.sql({ sql: 'PRAGMA journal_mode' }), error => error.error.code === 'write_refused')
  await assert.rejects(() => bot.sql({ sql: 'DROP TABLE nums' }), error => error.error.code === 'write_refused')
})

test('engine: a runaway cartesian query is cancelled and never hangs the host; the next query still works', async () => {
  const bot = engine.forBot('cancel-bot')
  await bot.load({ from: 'content', name: 'n', content: Array.from({ length: 40 }, (_, i) => `${i}`).join('\n').replace(/^/, 'n\n') })
  let heartbeat = false
  const timer = setTimeout(() => { heartbeat = true }, 250)
  const started = Date.now()
  // An unbounded recursive CTE never finishes, so cancellation is deterministic.
  await assert.rejects(() => bot.sql({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c' }), error => error.error.code === 'timeout')
  clearTimeout(timer)
  assert.ok(Date.now() - started < 5000, 'the runaway was cancelled within the timeout window')
  assert.equal(heartbeat, true, 'the host event loop stayed responsive during the runaway')
  const after = await bot.sql({ sql: 'SELECT COUNT(*) AS n FROM n' })
  assert.deepEqual(after.rows, [[40]])
})
