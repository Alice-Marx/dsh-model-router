/**
 * The chart compiler: a tiny, safe spec the model can ask for, compiled to a
 * bounded SQL aggregation and then shaped into a declarative result the panel
 * renders as inline SVG. The model never writes a chart grammar and never
 * writes raw SQL for a chart — only {type,x,y,color,agg,…} with column names
 * that must already exist. Identifiers are quoted; values are never
 * concatenated into the SQL.
 *
 * Supported marks: bar, line, area (the required minimum). scatter, histogram,
 * pie and heatmap are intentionally refused for now rather than faked — see
 * data-report.md. Aggregations count/sum/avg/min/max are supported; median is
 * refused (SQLite has no median aggregate) rather than approximated silently.
 *
 * Ported and narrowed from OpenMausBot server/data/chart-compiler.ts (1bc4749).
 */

import { DATA_LIMITS, DataFailure, dataError, quoteIdent } from './bot-data-surface.mjs'

const fail = (code, message, extra = {}) => { throw new DataFailure(dataError(code, message, extra)) }

const MARKS = new Set(['bar', 'line', 'area'])
const AGGS = new Set(['count', 'sum', 'avg', 'min', 'max'])
const SORTS = new Set(['x', '-x', 'y', '-y'])
const TIME_FORMAT = { year: '%Y', quarter: null, month: '%Y-%m', week: '%Y-W%W', day: '%Y-%m-%d', hour: '%Y-%m-%d %H' }

/** Validate the spec against the table's real columns; throw spec_invalid otherwise. */
function validate(spec, columns) {
  if (!spec || typeof spec !== 'object') fail('spec_invalid', 'A chart spec object is required.')
  if (!MARKS.has(spec.type)) fail('spec_invalid', `Chart type ${JSON.stringify(spec.type)} is not supported yet. Supported: bar, line, area.`)
  if (typeof spec.x !== 'string' || !columns.includes(spec.x)) fail('spec_invalid', `Unknown x column ${JSON.stringify(spec.x)}. Use data_describe to list columns.`)
  if (spec.y !== undefined && (typeof spec.y !== 'string' || !columns.includes(spec.y))) fail('spec_invalid', `Unknown y column ${JSON.stringify(spec.y)}. Use data_describe to list columns.`)
  if (spec.color !== undefined && (typeof spec.color !== 'string' || !columns.includes(spec.color))) fail('spec_invalid', `Unknown color column ${JSON.stringify(spec.color)}.`)
  const agg = spec.agg ?? (spec.y ? 'sum' : 'count')
  if (!AGGS.has(agg)) fail('spec_invalid', `Aggregation ${JSON.stringify(agg)} is not supported. Supported: ${[...AGGS].join(', ')}.`)
  if (spec.sort !== undefined && !SORTS.has(spec.sort)) fail('spec_invalid', `Unknown sort ${JSON.stringify(spec.sort)}.`)
  if (spec.timeUnit !== undefined && !(spec.timeUnit in TIME_FORMAT)) fail('spec_invalid', `Unknown timeUnit ${JSON.stringify(spec.timeUnit)}.`)
  if (spec.timeUnit === 'quarter' && !spec.y) fail('spec_invalid', 'A quarter bucket needs an aggregation (set y and agg).')
  return { agg }
}

/** Build the aggregation SQL and a reduction description. `from` is the final SQL relation (a quoted identifier or a parenthesised subquery); spec columns are quoted here, never concatenated raw. */
export function compileChart(spec, columns, from) {
  const { agg } = validate(spec, columns)
  const limit = Math.min(Math.max(1, Math.trunc(spec.limit ?? 20)), 1000)
  const hasColor = spec.color !== undefined
  const groupParts = []
  const selectParts = []

  // x expression: raw column, or a time bucket when timeUnit is set.
  let xExpr
  if (spec.timeUnit) {
    const format = TIME_FORMAT[spec.timeUnit]
    xExpr = spec.timeUnit === 'quarter'
      ? `(strftime('%Y', ${quoteIdent(spec.x)}) || '-Q' || ((CAST(strftime('%m', ${quoteIdent(spec.x)}) AS INTEGER) + 2) / 3))`
      : `strftime(${`'${format}'`}, ${quoteIdent(spec.x)})`
    groupParts.push(xExpr)
    selectParts.push(`${xExpr} AS x`)
  } else {
    groupParts.push(quoteIdent(spec.x))
    selectParts.push(`${quoteIdent(spec.x)} AS x`)
  }

  // y expression: COUNT(*) or AGG(y).
  const yExpr = agg === 'count' || !spec.y ? 'COUNT(*)' : `${agg.toUpperCase()}(${quoteIdent(spec.y)})`
  selectParts.push(`${yExpr} AS y`)

  if (hasColor) { groupParts.push(quoteIdent(spec.color)); selectParts.push(`${quoteIdent(spec.color)} AS series`) }

  let orderBy
  switch (spec.sort) {
    case '-x': orderBy = 'x DESC'; break
    case 'y': orderBy = 'y ASC'; break
    case '-y': orderBy = 'y DESC'; break
    default: orderBy = 'x ASC'
  }
  const sql = `SELECT ${selectParts.join(', ')} FROM ${from} GROUP BY ${groupParts.join(', ')} ORDER BY ${orderBy} LIMIT ${limit}`
  const reduction = {
    method: spec.timeUnit ? 'timeBucket' : 'group',
    inputRows: null,
    outputRows: null,
    note: spec.timeUnit ? `Bucketed by ${spec.timeUnit}.` : `Grouped by ${spec.x}${hasColor ? ` and ${spec.color}` : ''}, ${agg}${spec.y ? ` of ${spec.y}` : ''}. Top ${limit} by ${orderBy}.`,
  }
  return { sql, xLabel: spec.x, yLabel: spec.y ?? 'count', reduction, hasColor }
}

/** Shape a bounded result (columns + rows) into a declarative chart the panel renders. */
export function shapeChart(result, spec) {
  const hasColor = result.columns.some(column => column.name === 'series')
  const seriesMap = new Map()
  let maxMarks = DATA_LIMITS.chartMaxMarks
  for (const row of result.rows) {
    if (maxMarks-- <= 0) break
    const x = row[0]
    const y = row[1]
    const key = hasColor ? String(row[2]) : 'series'
    if (!seriesMap.has(key)) seriesMap.set(key, [])
    seriesMap.get(key).push({ x: x === null ? null : String(x), y: typeof y === 'number' ? y : Number(y) || 0 })
  }
  const series = [...seriesMap.entries()].map(([key, points]) => ({ key, points }))
  return {
    kind: 'chart',
    type: spec.type,
    xLabel: spec.x,
    yLabel: spec.y ?? 'count',
    stacked: spec.stack === true,
    series,
    truncated: result.truncated || maxMarks < 0,
  }
}
