#!/usr/bin/env node
/**
 * verify-data-loop.mjs — a runnable proof of the Bot data tools against real
 * SQLite (forked child) in an isolated tmp directory. It exercises the full
 * load → describe → sql → show → page → export → catalog loop and the security
 * negatives (dangerous functions unavailable, ATTACH/PRAGMA/DROP refused, a
 * runaway query cancelled without hanging the host), then prints PASS/FAIL.
 *
 * It never touches user data, makes no model calls and needs no network. Run:
 *   node scripts/verify-data-loop.mjs
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataEngine } from '../packages/orchestration/src/bot-data-engine.mjs'

const results = []
const check = (label, condition, detail = '') => {
  results.push({ label, pass: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}
const expectsFailure = async (label, fn, code) => {
  try { await fn(); check(label, false, 'expected a failure but it succeeded') } catch (error) {
    check(label, error?.error?.code === code || (code instanceof RegExp && code.test(error?.error?.message ?? '')), `${error?.error?.code ?? 'error'}: ${String(error?.error?.message ?? error).slice(0, 80)}`)
  }
}

const SALES = 'region,product,sales,day\nNorth,Widget,120,2026-01-01\nSouth,Widget,80,2026-01-02\nNorth,Gadget,60,2026-02-01\nSouth,Gadget,200,2026-02-05\nEast,Widget,95,2026-03-01'

const dir = await mkdtemp(join(tmpdir(), 'mb-data-verify-'))
const engine = createDataEngine({ dataDir: dir, sqlTimeoutMs: 1500 })
const bot = engine.forBot('verify-bot')
const quiet = async path => { for (let i = 0; i < 6; i++) { try { await rm(path, { recursive: true, force: true }); return } catch (e) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e?.code)) return; await new Promise(r => setTimeout(r, 120 * (i + 1))) } } }

try {
  const loaded = await bot.load({ from: 'content', content: SALES, name: 'sales' })
  check('load returns typed columns and row count', loaded.tables[0].rowCount === 5 && loaded.tables[0].columns.map(c => c.type).join(',') === 'TEXT,TEXT,INTEGER,TEXT', `${loaded.tables[0].rowCount} rows`)

  const described = await bot.describe('sales')
  check('describe reports exact row count + samples', described.rowCount === 5 && described.columns.every(c => Array.isArray(c.sample)))

  const query = await bot.sql({ sql: 'SELECT region, SUM(sales) AS total FROM sales GROUP BY region ORDER BY total DESC' })
  check('sql aggregates and returns bounded rows', JSON.stringify(query.rows) === JSON.stringify([['South', 280], ['North', 180], ['East', 95]]) && query.truncated === false)

  const table = await bot.show({ table: 'sales', kind: 'table', title: 'Sales' })
  const page = await bot.page({ cardId: table.id, offset: 2, limit: 2 })
  check('show(table) + page paginate the card result', table.rowCount === 5 && page.offset === 2 && page.rows.length === 2)

  const chart = await bot.show({ table: 'sales', kind: 'chart', chart: { type: 'bar', x: 'region', y: 'sales', agg: 'sum' } })
  check('show(chart) returns a declarative series', chart.kind === 'chart' && chart.chart.series[0].points.length === 3)

  const exported = await bot.exportCsv({ table: 'sales' })
  check('export CSV is byte-bounded and formula-safe', exported.rowCount === 5 && /region,product,sales,day/.test(exported.content))

  const catalog = await bot.catalog()
  check('catalog lists the loaded table', catalog.tables.some(t => t.name === 'sales'))

  console.log('\n— security negatives (proven at execution, not by regex) —')
  await expectsFailure('load_extension is unavailable', () => bot.sql({ sql: "SELECT load_extension('/tmp/evil')" }), /not authorized/)
  await expectsFailure('readfile is unavailable', () => bot.sql({ sql: "SELECT readfile('/etc/hostname')" }), /no such function/)
  await expectsFailure('ATTACH is refused by the gate', () => bot.sql({ sql: "ATTACH DATABASE '/tmp/x.sqlite' AS z" }), 'write_refused')
  await expectsFailure('PRAGMA is refused by the gate', () => bot.sql({ sql: 'PRAGMA journal_mode' }), 'write_refused')
  await expectsFailure('DROP is refused by the gate', () => bot.sql({ sql: 'DROP TABLE sales' }), 'write_refused')
  await expectsFailure('multiple statements are refused', () => bot.sql({ sql: 'SELECT 1; SELECT 2' }), 'invalid_input')

  console.log('\n— cancellation —')
  let heartbeat = false
  const timer = setTimeout(() => { heartbeat = true }, 250)
  const started = Date.now()
  await expectsFailure('an unbounded query is cancelled', () => bot.sql({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c' }), 'timeout')
  clearTimeout(timer)
  check('the host event loop stayed responsive during the runaway', heartbeat, `cancelled after ${Date.now() - started}ms`)
  const after = await bot.sql({ sql: 'SELECT COUNT(*) AS n FROM sales' })
  check('the next query works after a cancel (worker respawned)', JSON.stringify(after.rows) === JSON.stringify([[5]]))

  console.log('\n— per-Bot isolation —')
  await engine.forBot('other-bot').load({ from: 'content', content: 'x\n1', name: 'only_other' })
  const names = (await bot.catalog()).tables.map(t => t.name)
  check('one Bot never sees another Bot’s tables', !names.includes('only_other'))
} finally {
  await engine.closeAll()
  await quiet(dir)
}

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
if (failed.length) { console.log('FAILED:', failed.map(r => r.label).join('; ')); process.exit(1) }
console.log('ALL DATA-LOOP CHECKS PASSED')
