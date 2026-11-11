import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The panel is JSX; bundle it (resolving ui-icons, keeping react external) so we
// can render its declarative pieces on the server and assert the contract. The
// bundle is written inside the repo so Node resolves react from its node_modules.
let DataTable
let DataChart
const out = 'tmp/integration/data-tools/data-panel.bundle.mjs'

before(async () => {
  await build({
    entryPoints: ['apps/integration-client/data-panel.jsx'],
    bundle: true, format: 'esm', jsx: 'automatic', write: true, outfile: out,
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
    absWorkingDir: process.cwd(),
  })
  ;({ DataTable, DataChart } = await import(pathToFileURL(out).href))
})

test('panel: a table renders declared cells as text, and never executes injected HTML/JS', () => {
  const markup = renderToStaticMarkup(React.createElement(DataTable, {
    columns: [{ name: 'note', type: 'TEXT' }, { name: 'n', type: 'INTEGER' }],
    rows: [['<img src=x onerror=alert(1)>', 5], ['<script>alert(2)</script>', null]],
  }))
  // The payload is escaped into text, not parsed as markup.
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(markup, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/)
  assert.ok(!markup.includes('<img'))
  assert.ok(!markup.includes('<script'))
  // No dangerous sink is used anywhere in the panel markup.
  assert.ok(!/dangerouslySetInnerHTML/.test(markup))
})

test('panel: a bar chart draws the declared series as SVG and carries no script', () => {
  const markup = renderToStaticMarkup(React.createElement(DataChart, {
    chart: { kind: 'chart', type: 'bar', xLabel: 'region', yLabel: 'sales', series: [{ key: 'series', points: [{ x: 'North', y: 180 }, { x: 'South', y: 280 }] }] },
  }))
  assert.match(markup, /<svg/)
  assert.match(markup, /role="img"/)
  assert.match(markup, /North/)
  assert.match(markup, /South/)
  assert.ok(!markup.includes('<script'))
  assert.ok(!/onerror|onclick|javascript:/i.test(markup))
})

test('panel: a line chart draws a path through the declared points', () => {
  const markup = renderToStaticMarkup(React.createElement(DataChart, {
    chart: { kind: 'chart', type: 'line', xLabel: 'day', yLabel: 'sales', series: [{ key: 's', points: [{ x: 'd1', y: 1 }, { x: 'd2', y: 4 }, { x: 'd3', y: 2 }] }] },
  }))
  assert.match(markup, /<path/)
  assert.match(markup, /<circle/)
  assert.ok(!markup.includes('<script'))
})
