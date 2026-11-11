#!/usr/bin/env node
/**
 * verify-data-hardening.mjs — a runnable proof of the HARDENING fixes against
 * real SQLite in a real forked child process, inside an isolated tmp directory.
 * It covers the seven items the hardening pass had to solve: native/database
 * bounds, transactional replacement, serialized per-Bot steps, explicit export
 * failures, precise card reads, execution-layer checks and worker lifecycle.
 *
 * It never touches user data, makes no model calls and needs no network. Run:
 *   node scripts/verify-data-hardening.mjs
 */

import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataEngine } from '../packages/orchestration/src/bot-data-engine.mjs'
import { DATA_LIMITS, sanitizeDataMessage } from '../packages/orchestration/src/bot-data-surface.mjs'
import { openDb, runRead, runWrite } from '../packages/orchestration/src/bot-data-worker.mjs'

const results = []
const check = (label, condition, detail = '') => {
  results.push({ label, pass: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}
const expectsFailure = async (label, fn, code) => {
  try { await fn(); check(label, false, 'expected a failure but it succeeded') } catch (error) {
    const got = error?.error?.code ?? error?.code
    check(label, got === code || (code instanceof RegExp && code.test(error?.error?.message ?? error?.message ?? '')), `${got}: ${String(error?.error?.message ?? error?.message ?? error).slice(0, 90)}`)
  }
}

const SALES = 'region,product,sales,day\nNorth,Widget,120,2026-01-01\nSouth,Widget,80,2026-01-02\nNorth,Gadget,60,2026-02-01\nSouth,Gadget,200,2026-02-05\nEast,Widget,95,2026-03-01'
const dir = await mkdtemp(join(tmpdir(), 'mb-data-harden-verify-'))
const tinyDir = await mkdtemp(join(tmpdir(), 'mb-data-harden-verify-tiny-'))
const engine = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000 })
const tiny = createDataEngine({ dataDir: tinyDir, sqlTimeoutMs: 4000, limits: { maxPageCount: 40 } })
const quiet = async path => { for (let i = 0; i < 8; i++) { try { await rm(path, { recursive: true, force: true }); return } catch (e) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e?.code)) return; await new Promise(r => setTimeout(r, 120 * (i + 1))) } } }

try {
  console.log('— 1. native and file bounds inside the fixed worker —')
  const tinyBot = tiny.forBot('tiny-bot')
  await tinyBot.load({ from: 'content', content: 'n\n1\n2\n3', name: 'small' })
  let heartbeat = false
  const timer = setTimeout(() => { heartbeat = true }, 20)
  await expectsFailure('an oversized allocation is refused by SQLite itself', () => tinyBot.sql({ sql: 'CREATE TABLE flood AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x, x * 2 AS y FROM c' }), /full|disk|memory/i)
  clearTimeout(timer)
  check('the host event loop stayed responsive', heartbeat)
  const afterBound = await tinyBot.sql({ sql: 'SELECT COUNT(*) AS n FROM small' })
  check('the next query works after a refused allocation', JSON.stringify(afterBound.rows) === JSON.stringify([[3]]))

  console.log('\n— 2. transactional replacement —')
  const replaceBot = engine.forBot('replace-bot')
  await replaceBot.load({ from: 'content', content: 'keep\n1\n2', name: 'keepme' })
  await replaceBot.sql({ sql: 'SELECT 7 AS a', name: 'r' })
  await expectsFailure('a failing materialisation fails', () => replaceBot.sql({ sql: 'SELECT nope FROM r', name: 'r' }), 'sql_error')
  const survivor = await replaceBot.sql({ sql: 'SELECT * FROM __mb_q_r' })
  check('the previous result table survives a failed replace', JSON.stringify(survivor.rows) === JSON.stringify([[7]]))
  await expectsFailure('a failing import fails', () => replaceBot.load({ from: 'content', content: 'x\n"unterminated', name: 'keepme' }), 'import_failed')
  check('the previous table survives a failed import', (await replaceBot.describe('keepme')).rowCount === 2)

  console.log('\n— 3. per-Bot serialization —')
  const concurrent = engine.forBot('concurrent-bot')
  await Promise.all([
    concurrent.load({ from: 'content', content: 'a\n1', name: 't1' }),
    concurrent.load({ from: 'content', content: 'b\n2', name: 't2' }),
    concurrent.load({ from: 'content', content: 'c\n3', name: 't3' }),
  ])
  await Promise.all([
    concurrent.show({ table: 't1', kind: 'table', title: 'one' }),
    concurrent.show({ table: 't2', kind: 'table', title: 'two' }),
  ])
  const catalog = await concurrent.catalog()
  check('no source entry is lost', JSON.stringify(catalog.sources.map(s => s.name).sort()) === JSON.stringify(['t1', 't2', 't3']))
  check('no card is lost', JSON.stringify(catalog.cards.map(c => c.title).sort()) === JSON.stringify(['one', 'two']))

  console.log('\n— 4. explicit export failures —')
  const exportBot = engine.forBot('export-bot')
  await exportBot.load({ from: 'content', content: SALES, name: 'sales' })
  const inline = await exportBot.exportCsv({ table: 'sales' })
  check('without a writer the export reports content and no path', inline.path === undefined && inline.rowCount === 5 && inline.sourceRowCount === 5)
  const tooLarge = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, libraryWriter: () => { throw Object.assign(new Error('文件超过 1048576 字节。'), { code: 'LIBRARY_FILE_TOO_LARGE' }) } })
  try {
    await expectsFailure('a library size limit is output_too_large', () => tooLarge.forBot('export-bot').exportCsv({ table: 'sales' }), 'output_too_large')
    const failure = await tooLarge.forBot('export-bot').exportCsv({ table: 'sales' }).catch(error => error.error)
    check('a failed export reports no path', failure.path === undefined)
  } finally { await tooLarge.closeAll() }
  const broken = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, libraryWriter: () => { throw new Error('disk on fire') } })
  try {
    await expectsFailure('any other write failure is write_refused', () => broken.forBot('export-bot').exportCsv({ table: 'sales' }), 'write_refused')
  } finally { await broken.closeAll() }
  const written = []
  const ok = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, libraryWriter: (botId, relPath, content) => { written.push(relPath); return { bytes: Buffer.byteLength(content) } } })
  try {
    const value = await ok.forBot('export-bot').exportCsv({ table: 'sales', filename: 'sales' })
    check('a successful export reports its path, rows and source total', value.path === 'exports/sales.csv' && value.rowCount === 5 && value.sourceRowCount === 5 && written.length === 1)
  } finally { await ok.closeAll() }

  console.log('\n— 5. precise card reads —')
  const cardBot = engine.forBot('card-bot')
  await cardBot.load({ from: 'content', content: SALES, name: 'sales' })
  const chart = await cardBot.show({ table: 'sales', kind: 'chart', title: 'By region', chart: { type: 'bar', x: 'region', y: 'sales', agg: 'sum' } })
  const reopened = await cardBot.show({ cardId: chart.id })
  check('a chart card re-opens by its id', reopened.kind === 'chart' && JSON.stringify(reopened.chart.series[0].points.map(p => p.y).sort((a, b) => a - b)) === JSON.stringify([95, 180, 280]))
  const tableCard = await cardBot.show({ table: 'sales', kind: 'table', title: 'Sales' })
  check('a table card re-opens by its id', (await cardBot.show({ cardId: tableCard.id })).rows.length === 5)
  await expectsFailure('an unknown card id is refused', () => cardBot.show({ cardId: 'c_nope' }), 'card_not_found')
  await cardBot.remove({ table: 'sales' })
  await expectsFailure('a card whose source is gone fails honestly', () => cardBot.show({ cardId: chart.id }), /no such table/i)

  console.log('\n— 6. execution layer —')
  const db = openDb(join(dir, 'exec.sqlite'))
  try {
    check('a read statement is a reader', db.prepare('SELECT 1 AS a').reader === true)
    check('a CREATE is not a reader', db.prepare('CREATE TABLE zz(a)').reader === false)
    await expectsFailure('a non-reader read is refused', () => runRead(db, 'CREATE TABLE zz2(a)'), 'write_refused')
    await expectsFailure('a DELETE is refused as a write', () => runWrite(db, 'DELETE FROM zz'), 'write_refused')
    await expectsFailure('a WITH … DELETE is refused as a write', () => runWrite(db, 'WITH x AS (SELECT 1 AS a) DELETE FROM zz'), 'write_refused')
    await expectsFailure('extension loading is still unavailable', () => runRead(db, "SELECT load_extension('/tmp/evil')"), /not authorized/i)
    check('a message never carries the host layout', !sanitizeDataMessage('unable to open database file: /home/secret/state/bot.sqlite').includes('secret'))
    check('a stack is stripped from a message', sanitizeDataMessage('boom\n    at open (C:\\Users\\me\\x.mjs:1:2)') === 'boom')
  } finally { db.close() }

  console.log('\n— 7. worker lifecycle —')
  const events = []
  const children = []
  const spyFork = (url, args, options) => {
    const child = fork(url, args, options)
    const record = { url: String(url), forkedAt: Date.now(), exitedAt: null, options }
    events.push(record); children.push(child)
    child.on('exit', () => { record.exitedAt = Date.now() })
    return child
  }
  const spied = createDataEngine({ dataDir: dir, sqlTimeoutMs: 1200, forkImpl: spyFork })
  try {
    const bot = spied.forBot('race-bot')
    await bot.load({ from: 'content', content: 'n\n1\n2', name: 'n' })
    const { options } = events[0]
    check('the worker entry is fixed and hidden', options.windowsHide === true && options.execPath === process.execPath && /bot-data-worker\.mjs$/.test(events[0].url))
    check('the child heap is bounded', JSON.stringify(options.execArgv) === JSON.stringify([`--max-old-space-size=${DATA_LIMITS.workerHeapMb}`]))
    check('the child env is minimal', Object.keys(options.env).every(key => key === 'MB_DATA_WORKER' || ['Path', 'PATH', 'SYSTEMROOT', 'SystemRoot', 'windir', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'].includes(key)))
    await expectsFailure('a runaway statement is cancelled', () => bot.sql({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c' }), 'timeout')
    const afterCancel = await bot.sql({ sql: 'SELECT COUNT(*) AS n FROM n' })
    check('the next query works after a cancel', JSON.stringify(afterCancel.rows) === JSON.stringify([[2]]))
    check('the killed child exited before the replacement was forked', events.length >= 2 && events[0].exitedAt !== null && events[0].exitedAt <= events[1].forkedAt,
      `forks=${events.length} exit0=${events[0].exitedAt} fork1=${events[1]?.forkedAt}`)
  } finally {
    await spied.closeAll()
    check('closeAll waits for real exits', children.every(child => child.exitCode !== null || child.signalCode !== null))
  }

  const live = () => children.filter(child => child.exitCode === null && child.signalCode === null).length
  const capped = createDataEngine({ dataDir: dir, sqlTimeoutMs: 4000, forkImpl: spyFork })
  let capOk = true
  try {
    for (const botId of ['cap-a', 'cap-b', 'cap-c', 'cap-d', 'cap-e', 'cap-f']) {
      await capped.forBot(botId).load({ from: 'content', content: 'a\n1', name: 't' })
      if (live() > DATA_LIMITS.activeWorkersMax) capOk = false
    }
  } finally { await capped.closeAll() }
  check(`at most ${DATA_LIMITS.activeWorkersMax} Bot workers stay resident`, capOk, `live at the end: ${live()}`)

  console.log('\n— 8. the strict cap refuses instead of queueing —')
  const children2 = []
  const spyFork2 = (url, args, options) => { const child = fork(url, args, options); children2.push(child); return child }
  const live2 = () => children2.filter(child => child.exitCode === null && child.signalCode === null).length
  const strict = createDataEngine({ dataDir: dir, sqlTimeoutMs: 2500, forkImpl: spyFork2 })
  try {
    const runaway = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c'
    const busy = Array.from({ length: DATA_LIMITS.activeWorkersMax }, (_, index) => strict.forBot(`strict-${index}`).sql({ sql: runaway }))
    await new Promise(resolve => setTimeout(resolve, 400))
    check('every slot is busy', live2() === DATA_LIMITS.activeWorkersMax, `live: ${live2()}`)
    const before = children2.length
    await expectsFailure('a new Bot is refused while every slot is busy', () => strict.forBot('strict-extra').sql({ sql: 'SELECT 1 AS a' }), 'engine_unavailable')
    check('the refusal starts no worker', children2.length === before, `forks: ${before} -> ${children2.length}`)
    const settled = await Promise.allSettled(busy)
    check('the busy statements time out and free their slots', settled.every(row => row.status === 'rejected' && row.reason.error.code === 'timeout'))
    const served = await strict.forBot('strict-extra').sql({ sql: 'SELECT 1 AS a' })
    check('the refused Bot is served once a slot is free', JSON.stringify(served.rows) === JSON.stringify([[1]]))
    const report = await strict.closeAll()
    check('closeAll reports no unconfirmed close', report.unconfirmed.length === 0, `closed: ${report.closed.length}, unconfirmed: ${report.unconfirmed.length}`)
    check('every real worker confirmed its exit', live2() === 0)
  } finally { for (const child of children2) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }

  console.log('\n— gate negatives (unchanged) —')
  const gateBot = engine.forBot('gate-bot')
  await gateBot.load({ from: 'content', content: 'n\n1', name: 'nums' })
  await expectsFailure('ATTACH is refused', () => gateBot.sql({ sql: "ATTACH DATABASE '/tmp/x.sqlite' AS z" }), 'write_refused')
  await expectsFailure('PRAGMA is refused', () => gateBot.sql({ sql: 'PRAGMA journal_mode' }), 'write_refused')
  await expectsFailure('DROP is refused', () => gateBot.sql({ sql: 'DROP TABLE nums' }), 'write_refused')
  await expectsFailure('multiple statements are refused', () => gateBot.sql({ sql: 'SELECT 1; SELECT 2' }), 'invalid_input')
} finally {
  await engine.closeAll()
  await tiny.closeAll()
  await quiet(dir)
  await quiet(tinyDir)
}

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
if (failed.length) { console.log('FAILED:', failed.map(r => r.label).join('; ')); process.exit(1) }
console.log('ALL DATA-HARDENING CHECKS PASSED')
