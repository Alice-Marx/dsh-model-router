import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataEngine } from '../packages/orchestration/src/bot-data-engine.mjs'
import { DATA_LIMITS, sanitizeDataMessage } from '../packages/orchestration/src/bot-data-surface.mjs'
import { openDb, runRead, runWrite } from '../packages/orchestration/src/bot-data-worker.mjs'

// The hardening tests. Everything here runs against real SQLite in a real forked
// child process inside an isolated tmp directory: no user data, no model calls,
// no network. They target the seven fixes, not the original 33 cases.

const SALES = 'region,product,sales,day\nNorth,Widget,120,2026-01-01\nSouth,Widget,80,2026-01-02\nNorth,Gadget,60,2026-02-01\nSouth,Gadget,200,2026-02-05\nEast,Widget,95,2026-03-01'

test('hardening: query intermediates stay in SQLite memory under the native heap ceiling', () => {
  const db = openDb(':memory:')
  try {
    assert.equal(db.pragma('temp_store', { simple: true }), 2)
    assert.ok(db.pragma('hard_heap_limit', { simple: true }) > 0)
    assert.ok(db.pragma('hard_heap_limit', { simple: true }) <= DATA_LIMITS.dbHardHeapLimitBytes)
  } finally { db.close() }
})
const removeQuietly = async path => {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await rm(path, { recursive: true, force: true }); return } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

let dir
let engine
/** An engine whose databases may only hold a few pages: the native bound is real. */
let tinyEngine
let tinyDir

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mb-data-harden-'))
  engine = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000 })
  tinyDir = await mkdtemp(join(tmpdir(), 'mb-data-harden-tiny-'))
  // ~40 pages of 4096 bytes: a small table fits, an unbounded one cannot.
  tinyEngine = createDataEngine({ dataDir: tinyDir, sqlTimeoutMs: 4000, limits: { maxPageCount: 40 } })
})

after(async () => {
  await engine.closeAll()
  await tinyEngine.closeAll()
  await removeQuietly(dir)
  await removeQuietly(tinyDir)
})

test('hardening: an oversized native allocation is refused by SQLite itself and the Host survives', async () => {
  const bot = tinyEngine.forBot('tiny-bot')
  await bot.load({ from: 'content', content: 'n\n1\n2\n3', name: 'small' })
  // A statement that would allocate far more than the file bound. SQLite refuses
  // it (SQLITE_FULL) inside the child; the Host's event loop keeps running.
  let heartbeat = false
  const timer = setTimeout(() => { heartbeat = true }, 20)
  await assert.rejects(() => bot.sql({ sql: 'CREATE TABLE flood AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x, x * 2 AS y FROM c' }),
    error => error.error.code === 'sql_error' && /full|disk|memory/i.test(error.error.message))
  clearTimeout(timer)
  assert.equal(heartbeat, true, 'the host event loop stayed responsive')
  // The next query on the same Bot still works (the worker reopened cleanly).
  const after = await bot.sql({ sql: 'SELECT COUNT(*) AS n FROM small' })
  assert.deepEqual(after.rows, [[3]])
})

test('hardening: a failed replace leaves the previous table in place, not a half-written one', async () => {
  const bot = engine.forBot('replace-bot')
  await bot.load({ from: 'content', content: 'keep\n1\n2', name: 'keepme' })
  // A result table that exists…
  const first = await bot.sql({ sql: 'SELECT 7 AS a', name: 'r' })
  assert.equal(first.table, 'r')
  // …then a materialisation that fails. The old result table must survive.
  await assert.rejects(() => bot.sql({ sql: 'SELECT nope FROM r', name: 'r' }), error => error.error.code === 'sql_error')
  const stillThere = await bot.sql({ sql: 'SELECT * FROM __mb_q_r' })
  assert.deepEqual(stillThere.rows, [[7]])
  // And a failed load leaves the previous table intact too.
  await assert.rejects(() => bot.load({ from: 'content', content: 'x\n"unterminated', name: 'keepme' }), error => error.error.code === 'import_failed')
  const describe = await bot.describe('keepme')
  assert.equal(describe.rowCount, 2)
})

test('hardening: concurrent steps for one Bot are serialized — no lost source, no lost card', async () => {
  const bot = engine.forBot('concurrent-bot')
  await Promise.all([
    bot.load({ from: 'content', content: 'a\n1', name: 't1' }),
    bot.load({ from: 'content', content: 'b\n2', name: 't2' }),
    bot.load({ from: 'content', content: 'c\n3', name: 't3' }),
  ])
  await Promise.all([
    bot.show({ table: 't1', kind: 'table', title: 'one' }),
    bot.show({ table: 't2', kind: 'table', title: 'two' }),
  ])
  const catalog = await bot.catalog()
  assert.deepEqual(catalog.tables.map(table => table.name).sort(), ['t1', 't2', 't3'])
  assert.deepEqual(catalog.sources.map(source => source.name).sort(), ['t1', 't2', 't3'])
  assert.deepEqual(catalog.cards.map(card => card.title).sort(), ['one', 'two'])
  // A same-named table is not replaced twice behind the caller's back.
  const suffixed = await bot.load({ from: 'content', content: 'a\n9', name: 't1', replace: false })
  assert.equal(suffixed.tables[0].name, 't1_2')
})

test('hardening: a failed library write is a failed export — no path, no success', async () => {
  const bot = engine.forBot('export-bot')
  await bot.load({ from: 'content', content: SALES, name: 'sales' })
  // No writer wired: the content comes back and the panel must not claim a file.
  const inline = await bot.exportCsv({ table: 'sales' })
  assert.equal(inline.path, undefined)
  assert.equal(inline.rowCount, 5)
  assert.equal(inline.sourceRowCount, 5)
  assert.match(inline.content, /region,product,sales,day/)

  let engineWithWriter
  try {
    engineWithWriter = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, libraryWriter: () => { throw Object.assign(new Error('文件超过 1048576 字节。'), { code: 'LIBRARY_FILE_TOO_LARGE' }) } })
    await assert.rejects(() => engineWithWriter.forBot('export-bot').exportCsv({ table: 'sales' }), error => {
      assert.equal(error.error.code, 'output_too_large')
      assert.equal(error.error.path, undefined, 'a failed export reports no path')
      assert.match(error.error.message, /1048576/)
      return true
    })
  } finally { await engineWithWriter?.closeAll() }

  let plainFailure
  try {
    plainFailure = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, libraryWriter: () => { throw new Error('disk on fire') } })
    await assert.rejects(() => plainFailure.forBot('export-bot').exportCsv({ table: 'sales' }), error => {
      assert.equal(error.error.code, 'write_refused')
      assert.equal(error.error.path, undefined)
      assert.match(error.error.message, /nothing was exported/)
      return true
    })
  } finally { await plainFailure?.closeAll() }

  const written = []
  const okEngine = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, libraryWriter: (botId, relPath, content) => { written.push({ botId, relPath, bytes: Buffer.byteLength(content) }); return { bytes: Buffer.byteLength(content) } } })
  try {
    const value = await okEngine.forBot('export-bot').exportCsv({ table: 'sales', filename: 'sales' })
    assert.equal(value.path, 'exports/sales.csv')
    assert.equal(value.rowCount, 5)
    assert.equal(value.sourceRowCount, 5)
    assert.equal(value.truncated, false)
    assert.equal(written[0].relPath, 'exports/sales.csv')
  } finally { await okEngine.closeAll() }
})

test('hardening: a truncated export reports the source total and the exported rows', async () => {
  const bot = engine.forBot('truncate-bot')
  await bot.load({ from: 'content', content: 'n\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10', name: 'ten' })
  const card = await bot.show({ table: 'ten', kind: 'table', title: 'Ten' })
  const value = await bot.exportCsv({ cardId: card.id })
  assert.equal(value.sourceRowCount, 10)
  assert.equal(value.rowCount, 10)
  const limited = await bot.exportCsv({ sql: 'SELECT * FROM ten LIMIT 4' })
  assert.equal(limited.sourceRowCount, 4)
  assert.equal(limited.rowCount, 4)
  assert.equal(limited.truncated, false)
})

test('hardening: a saved chart card re-opens from its saved spec, and a missing source fails honestly', async () => {
  const bot = engine.forBot('card-bot')
  await bot.load({ from: 'content', content: SALES, name: 'sales' })
  const chart = await bot.show({ table: 'sales', kind: 'chart', title: 'By region', chart: { type: 'bar', x: 'region', y: 'sales', agg: 'sum' } })
  assert.equal(chart.kind, 'chart')

  // Re-open by card id: the series is recomputed from the live database.
  const reopened = await bot.show({ cardId: chart.id })
  assert.equal(reopened.id, chart.id)
  assert.equal(reopened.kind, 'chart')
  assert.equal(reopened.chart.type, 'bar')
  assert.deepEqual(reopened.chart.series[0].points.map(point => point.x).sort(), ['East', 'North', 'South'])
  assert.deepEqual(reopened.chart.series[0].points.map(point => point.y).sort((a, b) => a - b), [95, 180, 280])

  const table = await bot.show({ table: 'sales', kind: 'table', title: 'Sales' })
  const reopenedTable = await bot.show({ cardId: table.id })
  assert.equal(reopenedTable.kind, 'table')
  assert.equal(reopenedTable.rowCount, 5)
  assert.equal(reopenedTable.rows.length, 5)

  await assert.rejects(() => bot.show({ cardId: 'c_does_not_exist' }), error => error.error.code === 'card_not_found')

  // The source is gone: re-opening the card fails with the real error instead of
  // rendering an empty or invented chart.
  await bot.remove({ table: 'sales' })
  await assert.rejects(() => bot.show({ cardId: chart.id }), error => error.error.code === 'sql_error' && /no such table/i.test(error.error.message))
})

test('hardening: the execution layer refuses a non-reader read and a non-CREATE write', async () => {
  const db = openDb(join(dir, 'exec-layer.sqlite'))
  // A refusal carries its code on the DataFailure it wraps.
  const refused = error => (error?.error?.code ?? error?.code) === 'write_refused'
  try {
    db.prepare('CREATE TABLE t(a)').run()
    assert.equal(db.prepare('SELECT 1 AS a').reader, true)
    assert.equal(db.prepare('CREATE TABLE t2(a)').reader, false)
    // better-sqlite3 itself refuses a multi-statement string.
    assert.throws(() => runRead(db, 'SELECT 1; SELECT 2'), /more than one statement/i)
    // A statement that returns no data is not a read, whatever it was labelled.
    assert.throws(() => runRead(db, 'CREATE TABLE t3(a)'), refused)
    assert.throws(() => runRead(db, 'INSERT INTO t VALUES (1)'), refused)
    // A write must still classify as CREATE … AS at the point of execution.
    assert.deepEqual(runWrite(db, 'CREATE TABLE made AS SELECT 1 AS a'), { changes: 0 })
    assert.throws(() => runWrite(db, 'DELETE FROM t'), refused)
    assert.throws(() => runWrite(db, 'WITH x AS (SELECT 1 AS a) DELETE FROM t'), refused)
    assert.throws(() => runWrite(db, "UPDATE t SET a = 1"), refused)
    // Extension loading stays disabled at execution.
    assert.throws(() => runRead(db, "SELECT load_extension('/tmp/evil')"), /not authorized/i)
  } finally { db.close() }
})

test('hardening: engine error messages never carry the Host path or a stack', () => {
  assert.equal(sanitizeDataMessage('unable to open database file: /home/secret/state/data/bot.sqlite'), 'unable to open database file: <path>')
  assert.equal(sanitizeDataMessage('boom\n    at Object.open (C:\\Users\\me\\app\\x.mjs:12:3)'), 'boom')
  assert.ok(!sanitizeDataMessage('failed', ['/home/secret/state/data/bot.sqlite']).includes('secret'))
  assert.equal(sanitizeDataMessage('x'.repeat(900)).length, 401)
})

test('hardening: a database that cannot be opened fails without leaking the Host layout', async () => {
  const invalidFile = join(dir, 'not-a-sqlite-database')
  await writeFile(invalidFile, 'This is intentionally not a SQLite database.')
  const broken = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, dbPathFor: () => invalidFile })
  try {
    await assert.rejects(() => broken.forBot('open-bot').catalog(), error => {
      assert.equal(error.error.code, 'sql_error')
      assert.ok(!error.error.message.includes(dir), 'the Host directory must not appear in the message')
      assert.ok(!/^\s+at\s/m.test(error.error.message), 'no stack frames')
      return true
    })
  } finally { await broken.closeAll() }
})

test('hardening: the worker is forked with a fixed entry, a minimal env and a bounded heap', async () => {
  const events = []
  const seen = []
  const forkImpl = (url, args, options) => {
    events.push({ type: 'fork' })
    seen.push({ url, args, options })
    return fork(url, args, options)
  }
  const spied = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, forkImpl })
  try {
    await spied.forBot('env-bot').load({ from: 'content', content: 'a\n1', name: 't' })
    const { url, args, options } = seen[0]
    assert.equal(args.length, 0, 'the worker entry is fixed, never a caller path')
    assert.match(url, /bot-data-worker\.mjs$/)
    assert.equal(options.windowsHide, true, 'no console window on Windows')
    assert.equal(options.execPath, process.execPath, 'the Host pins the Node binary')
    assert.deepEqual(options.execArgv, [`--max-old-space-size=${DATA_LIMITS.workerHeapMb}`])
    assert.equal(options.env.MB_DATA_WORKER, '1')
    const allowed = new Set(['Path', 'PATH', 'SYSTEMROOT', 'SystemRoot', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'MB_DATA_WORKER'])
    assert.deepEqual(Object.keys(options.env).filter(key => !allowed.has(key)), [], 'nothing else crosses into the child')
    assert.equal(options.env.NODE_OPTIONS, undefined)
  } finally { await spied.closeAll() }
})

test('hardening: a killed worker really exits before the next one opens the same database', async () => {
  const events = []
  const children = []
  const forkImpl = (url, args, options) => {
    const child = fork(url, args, options)
    const record = { child, forkedAt: Date.now(), exitedAt: null }
    events.push(record)
    child.on('exit', () => { record.exitedAt = Date.now() })
    children.push(record)
    return child
  }
  const spied = createDataEngine({ dataDir: dir, sqlTimeoutMs: 1200, forkImpl })
  try {
    const bot = spied.forBot('race-bot')
    await bot.load({ from: 'content', content: 'n\n1\n2', name: 'n' })
    // A runaway statement is cancelled by SIGKILL.
    await assert.rejects(() => bot.sql({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c' }), error => error.error.code === 'timeout')
    const after = await bot.sql({ sql: 'SELECT COUNT(*) AS n FROM n' })
    assert.deepEqual(after.rows, [[2]])
    assert.ok(children.length >= 2, 'the worker was respawned')
    // The killed child must have exited BEFORE the replacement was forked.
    const [first, second] = children
    assert.ok(first.exitedAt !== null, 'the killed child exited')
    assert.ok(first.exitedAt <= second.forkedAt, 'no new process starts while the old one may hold the write lock')
    // Nothing in flight was replayed: the respawn is a fresh database open.
    assert.equal(after.error, undefined)
  } finally {
    await spied.closeAll()
    for (const record of children) assert.ok(record.exitedAt !== null, 'every child exited before the engine closed')
  }
})

test('hardening: a Bot without the data grant is refused with the Host reason, and a card re-opens through the tool', async () => {
  const { registerDataTools } = await import('../packages/orchestration/src/bot-data-tools.mjs')
  const registered = []
  const ctx = { tools: { register: tool => { registered.push(tool); return () => {} } } }
  const exec = { agent: {} }
  const ungranted = registerDataTools(ctx, { engine, botIdFor: () => { throw Object.assign(new Error('当前 Bot 未获得 tool/data 授权。'), { code: 'TOOL_NOT_GRANTED' }) } })
  try {
    const value = await registered.filter(tool => tool.name === 'data_sql').at(-1).execute({ sql: 'SELECT 1' }, exec)
    assert.equal(value.error.code, 'unauthorized', 'a missing grant is not reported as a vague unknown subject')
    assert.match(value.error.message, /tool\/data/)
  } finally { ungranted() }

  const granted = registerDataTools(ctx, { engine, botIdFor: () => 'tool-bot' })
  try {
    const load = await registered.filter(tool => tool.name === 'data_load').at(-1).execute({ from: 'content', content: 'city,pop\nNYC,8000000\nLA,4000000', name: 'cities' }, exec)
    assert.equal(load.tables[0].rowCount, 2)
    const shown = await registered.filter(tool => tool.name === 'data_show').at(-1).execute({ table: 'cities', kind: 'chart', title: 'Pop', chart: { type: 'bar', x: 'city', y: 'pop' } }, exec)
    const reopened = await registered.filter(tool => tool.name === 'data_show').at(-1).execute({ cardId: shown.id, kind: 'chart' }, exec)
    assert.equal(reopened.kind, 'chart')
    assert.deepEqual(reopened.chart.series[0].points.map(point => point.x).sort(), ['LA', 'NYC'])
  } finally { granted() }
})

test('hardening: only a bounded number of Bot workers stay resident', async () => {  const children = []
  const forkImpl = (url, args, options) => {
    const child = fork(url, args, options)
    children.push(child)
    return child
  }
  const spied = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, forkImpl })
  const live = () => children.filter(child => child.exitCode === null && child.signalCode === null).length
  try {
    for (const botId of ['cap-a', 'cap-b', 'cap-c', 'cap-d', 'cap-e', 'cap-f', 'cap-g']) {
      await spied.forBot(botId).load({ from: 'content', content: 'a\n1', name: 't' })
      assert.ok(live() <= DATA_LIMITS.activeWorkersMax, `at most ${DATA_LIMITS.activeWorkersMax} workers stay resident (saw ${live()})`)
    }
    // Every Bot still works, whether or not its worker is resident right now.
    const catalog = await spied.forBot('cap-a').catalog()
    assert.ok(catalog.tables.some(table => table.name === 't'))
  } finally { await spied.closeAll() }
})
