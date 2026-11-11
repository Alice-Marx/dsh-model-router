import test from 'node:test'
import assert from 'node:assert/strict'
import { compileChart, shapeChart } from '../packages/orchestration/src/bot-data-chart.mjs'

const columns = ['region', 'product', 'sales', 'day']

test('chart: a bar groups and aggregates, quoting every identifier', () => {
  const compiled = compileChart({ type: 'bar', x: 'region', y: 'sales', agg: 'sum' }, columns, '"sales"')
  assert.equal(compiled.sql, 'SELECT "region" AS x, SUM("sales") AS y FROM "sales" GROUP BY "region" ORDER BY x ASC LIMIT 20')
})

test('chart: a line with timeUnit buckets the x axis', () => {
  const compiled = compileChart({ type: 'line', x: 'day', y: 'sales', timeUnit: 'month' }, columns, '"sales"')
  assert.match(compiled.sql, /strftime\('%Y-%m', "day"\)/)
  assert.equal(compiled.reduction.method, 'timeBucket')
})

test('chart: count is used when y is absent; color adds a series column', () => {
  assert.match(compileChart({ type: 'bar', x: 'region' }, columns, '"sales"').sql, /COUNT\(\*\)/)
  assert.match(compileChart({ type: 'bar', x: 'region', y: 'sales', color: 'product' }, columns, '"sales"').sql, /"product" AS series/)
})

test('chart: unsupported marks and aggregations are refused, not faked', () => {
  assert.throws(() => compileChart({ type: 'pie', x: 'region' }, columns, 't'), error => error.error.code === 'spec_invalid')
  assert.throws(() => compileChart({ type: 'scatter', x: 'region' }, columns, 't'), error => error.error.code === 'spec_invalid')
  assert.throws(() => compileChart({ type: 'bar', x: 'region', agg: 'median' }, columns, 't'), error => error.error.code === 'spec_invalid')
})

test('chart: a spec that names a missing column is refused before any SQL runs', () => {
  assert.throws(() => compileChart({ type: 'bar', x: 'nope' }, columns, 't'), error => error.error.code === 'spec_invalid')
  assert.throws(() => compileChart({ type: 'bar', x: 'region', color: 'ghost' }, columns, 't'), error => error.error.code === 'spec_invalid')
})

test('chart: shapeChart builds a declarative series the panel renders without executing anything', () => {
  const shaped = shapeChart({ columns: [{ name: 'x' }, { name: 'y' }, { name: 'series' }], rows: [['a', 3, 's1'], ['b', 5, 's1'], ['a', 2, 's2']], truncated: false }, { type: 'bar', x: 'region' })
  assert.equal(shaped.kind, 'chart')
  assert.deepEqual(shaped.series.map(entry => entry.key), ['s1', 's2'])
  assert.deepEqual(shaped.series[0].points, [{ x: 'a', y: 3 }, { x: 'b', y: 5 }])
})
