/**
 * The ONE description of the five Bot data tools.
 *
 * The SDK registration (bot-data-tools.mjs) and the native MCP handler factory
 * (native-data-tools.mjs) both read this module, so a tool name, a description
 * or an argument projection cannot drift between the two doors: what the model
 * is told and what the Bot is actually called with are the same facts.
 *
 * Authority stays outside this file. `invokeDataTool(bot, name, args)` only
 * projects the business keys an entry declares and calls the existing Bot data
 * service exactly once; the Bot object itself is chosen by the Host
 * (data-product-access.mjs) from committed state, never from an argument. A
 * caller that tries to smuggle `botId`, a path, an endpoint or an operation id
 * through the arguments is refused by `parseDataToolArgs` before any service is
 * reached, and its extra keys would be dropped by the projection anyway.
 *
 * Two schemas describe the same contract on purpose:
 *  - `parameters` is the dsh-tools author map the installed SDK compiles, where
 *    `data_show.chart` stays the SDK's own `json` node (its narrower validator
 *    rejects the nested form);
 *  - `inputSchema` is a real MCP JSON Schema object, where `data_show.chart` is
 *    a genuinely nested, bounded object built from the fields the chart
 *    compiler in bot-data-chart.mjs actually supports. No fake string/JSON type
 *    is offered to a native client, and nothing is promised that the compiler
 *    would refuse (scatter, histogram, pie, heatmap, median are not offered).
 */

import { DATA_TOOL_NAMES } from './bot-data-surface.mjs'

/** JSON argument bytes one data call may carry; the same bound the native tools use. */
const MAX_ARGS_BYTES = 128_000

/** Chart vocabulary the compiler in bot-data-chart.mjs really supports. */
const CHART_MARKS = Object.freeze(['bar', 'line', 'area'])
const CHART_AGGS = Object.freeze(['count', 'sum', 'avg', 'min', 'max'])
const CHART_SORTS = Object.freeze(['x', '-x', 'y', '-y'])
const CHART_TIME_UNITS = Object.freeze(['year', 'quarter', 'month', 'week', 'day', 'hour'])

/**
 * The chart contract as a nested MCP object schema. `type` and `x` are required
 * because the compiler refuses a spec without them; everything else is optional
 * exactly where the compiler allows it to be absent (a missing `y` means the
 * mark counts rows, a missing `agg` defaults to sum/count). No field here is
 * nullable, because the compiler treats null as an invalid spec, not as a default.
 */
const CHART_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    type: Object.freeze({
      type: 'string', enum: CHART_MARKS,
      description: 'Mark to draw: bar, line or area. scatter, histogram, pie and heatmap are refused rather than faked.',
    }),
    x: Object.freeze({ type: 'string', description: 'Column to group by. It must already exist in the table or query.' }),
    y: Object.freeze({ type: 'string', description: 'Column to aggregate. Omit it and the mark counts rows.' }),
    color: Object.freeze({ type: 'string', description: 'Optional column that splits the marks into series.' }),
    agg: Object.freeze({
      type: 'string', enum: CHART_AGGS,
      description: 'Aggregation applied to y: count, sum, avg, min or max. Default: sum when y is set, otherwise count. median is refused.',
    }),
    sort: Object.freeze({ type: 'string', enum: CHART_SORTS, description: 'Order of the marks: x, -x, y or -y. Default x ascending.' }),
    timeUnit: Object.freeze({
      type: 'string', enum: CHART_TIME_UNITS,
      description: 'Bucket x as time: year, quarter, month, week, day or hour.',
    }),
    limit: Object.freeze({
      type: 'integer',
      description: 'Marks kept for the card. The compiler clamps it to at least 1 and at most 1000. Default 20.',
    }),
    stack: Object.freeze({ type: 'boolean', description: 'Stack the series of one mark. Default false.' }),
  }),
  required: Object.freeze(['type', 'x']),
  additionalProperties: false,
})

/** One dsh-tools parameter spec projected to a real JSON Schema property. */
const jsonSchemaProperty = spec => {
  if (spec.type === 'json') throw new TypeError(`a data tool parameter must not offer the SDK json node to MCP: ${spec.description}`)
  const schema = { type: spec.type }
  if (spec.enum) schema.enum = spec.enum
  schema.description = spec.description
  return Object.freeze(schema)
}

/**
 * The MCP input schema for one tool: the same properties, the same enums, the
 * same required set as the SDK map, with `additionalProperties: false` so a
 * native client is told the truth — there is no `botId`, no path and no
 * authority key to pass.
 */
const inputSchemaFor = parameters => {
  const properties = {}
  for (const [key, spec] of Object.entries(parameters)) {
    // data_show.chart is the one place the SDK map is a `json` node; MCP gets
    // the real nested object the compiler accepts.
    properties[key] = key === 'chart' && spec.type === 'json' ? CHART_INPUT_SCHEMA : jsonSchemaProperty(spec)
  }
  const required = Object.entries(parameters).filter(([, spec]) => spec.required === true).map(([key]) => key)
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    required: Object.freeze(required),
    additionalProperties: false,
  })
}

const defineEntry = ({ name, description, parameters, method, project }) => Object.freeze({
  name,
  description,
  parameters: Object.freeze(parameters),
  inputSchema: inputSchemaFor(parameters),
  capability: 'tool/data',
  method,
  project,
})

const ENTRIES = Object.freeze([
  defineEntry({
    name: 'data_load',
    description: [
      'Load a dataset into a named table in YOUR OWN Bot database, then query it with data_sql and show or export it.',
      'Data comes only from your private library (from:"library", a relative path) or bounded inline text (from:"content");',
      'there are no OS paths, URLs or database connections. Replaces a same-named table unless replace:false (then a suffix is added).',
      'Returns each table\'s columns, types and row count.',
    ].join(' '),
    method: 'load',
    parameters: {
      from: { type: 'string', enum: ['library', 'content'], required: true, description: 'Where the data comes from.' },
      path: { type: 'string', description: 'Library-relative path (from:"library").' },
      content: { type: 'string', description: 'Inline CSV/TSV/JSON text (from:"content"), bounded.' },
      format: { type: 'string', enum: ['csv', 'tsv', 'json'], description: 'Default: from the path, else csv.' },
      name: { type: 'string', description: 'Table name. Default: from the path or "dataset".' },
      replace: { type: 'boolean', description: 'Default true.' },
      delimiter: { type: 'string', description: 'CSV delimiter. Default ",".' },
      header: { type: 'boolean', description: 'Treat the first row as column names. Default true.' },
    },
    project: args => ({
      from: args.from, path: args.path, content: args.content, format: args.format,
      name: args.name, replace: args.replace, delimiter: args.delimiter, header: args.header,
    }),
  }),
  defineEntry({
    name: 'data_describe',
    description: [
      'Inspect before you write SQL. With no argument it lists your loaded tables and saved cards (metadata only).',
      'With a table name it returns columns, types, null-free samples and the exact row count.',
      'With a SELECT it returns the query\'s columns. Use this to learn column names before data_sql or data_show.',
    ].join(' '),
    method: 'describe',
    parameters: {
      target: { type: 'string', description: 'A table name or a SELECT. Omit to list tables and cards.' },
    },
    // The existing service takes the target itself, not a wrapper object.
    project: args => args.target,
  }),
  defineEntry({
    name: 'data_sql',
    description: [
      'Run one SQLite statement against your own database. SELECT-like statements return bounded rows and a truncated flag;',
      'CREATE [OR REPLACE] TABLE|VIEW … AS … is allowed to build a derived table. Everything else (INSERT/UPDATE/DELETE/DROP/',
      'ATTACH/PRAGMA/…) is refused, and so are multiple statements. Pass name to keep a SELECT as a reusable result table.',
    ].join(' '),
    method: 'sql',
    parameters: {
      sql: { type: 'string', required: true, description: 'One statement.' },
      limit: { type: 'integer', description: 'Rows to return. Default 100, max 1000.' },
      name: { type: 'string', description: 'Keep this SELECT as a named result table for later show/export.' },
    },
    project: args => ({ sql: args.sql, limit: args.limit, name: args.name }),
  }),
  defineEntry({
    name: 'data_show',
    description: [
      'Render a table or a chart from your own data. Give a table name or a SELECT, and kind "table" or "chart".',
      'Give cardId instead to re-open a card you already saved: the chart is re-rendered from its saved spec and the table',
      'from its saved result, so nothing is invented. A chart needs chart:{type:"bar"|"line"|"area", x, y?, agg?, color?, sort?,',
      'limit?, timeUnit?}; the server compiles it to SQL and the panel draws only the declared data. Returns a declarative',
      'result the panel renders — never executable HTML/JS.',
    ].join(' '),
    method: 'show',
    parameters: {
      table: { type: 'string', description: 'A loaded or result table name.' },
      sql: { type: 'string', description: 'A SELECT. Use table or sql, not both.' },
      kind: { type: 'string', enum: ['table', 'chart'], required: true, description: 'Table or chart.' },
      title: { type: 'string', description: 'Card title.' },
      chart: { type: 'json', description: 'Chart spec for kind:"chart".' },
      limit: { type: 'integer', description: 'Table rows kept for the card.' },
      cardId: { type: 'string', description: 'Re-open a saved card by its id (from data_show or data_describe).' },
    },
    project: args => ({ table: args.table, sql: args.sql, kind: args.kind, title: args.title, chart: args.chart, limit: args.limit, cardId: args.cardId }),
  }),
  defineEntry({
    name: 'data_export',
    description: [
      'Export a table, a saved card (cardId) or a SELECT to CSV in your own library under exports/.',
      'The CSV is neutralised against spreadsheet formula injection; unknown values are never invented.',
      'Returns the library path, byte count, rowCount (the rows actually written) and sourceRowCount (the source total),',
      'plus a truncated flag. If the library write fails the export FAILS with output_too_large or write_refused and no path.',
    ].join(' '),
    method: 'exportCsv',
    parameters: {
      table: { type: 'string', description: 'A table name.' },
      cardId: { type: 'string', description: 'A saved card id from data_show.' },
      sql: { type: 'string', description: 'A SELECT.' },
      filename: { type: 'string', description: 'Export file stem. Default "export".' },
    },
    project: args => ({ table: args.table, cardId: args.cardId, sql: args.sql, filename: args.filename }),
  }),
])

// The data surface names the five tools; a contract that stops matching it is a
// bug, not a new tool, so it fails here instead of silently diverging.
if (ENTRIES.length !== DATA_TOOL_NAMES.length || ENTRIES.some((entry, index) => entry.name !== DATA_TOOL_NAMES[index])) {
  throw new Error('DATA_TOOL_ENTRIES_DIVERGED_FROM_DATA_SURFACE')
}

/** The five data tools, frozen, in the surface's own order. */
export const DATA_TOOL_ENTRIES = ENTRIES

/** One entry by tool name, or null when this Host does not know that name. */
export const dataToolEntry = name => ENTRIES.find(entry => entry.name === name) ?? null

const invalid = key => { throw Object.assign(new Error(`INVALID_DATA_TOOL_ARGS:${key}`), { code: 'INVALID_DATA_TOOL_ARGS' }) }

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype

const typeOf = (type, value) => type === 'string' ? typeof value === 'string'
  : type === 'boolean' ? typeof value === 'boolean'
    // A safe integer only: a float, a numeric string, a boolean or an unsafe
    // integer is a type error, not something to coerce.
    : type === 'integer' ? Number.isSafeInteger(value)
      : false

const checkEnum = (schema, value, key) => { if (schema.enum && !schema.enum.includes(value)) invalid(key) }

/** The nested chart spec is validated as a nested object, not as opaque JSON. */
const validateChart = chart => {
  if (!isPlainObject(chart)) invalid('chart')
  const { properties, required } = CHART_INPUT_SCHEMA
  if (Object.keys(chart).some(key => !Object.hasOwn(properties, key))) invalid('chart')
  for (const key of required) if (!Object.hasOwn(chart, key)) invalid(`chart.${key}`)
  for (const [key, value] of Object.entries(chart)) {
    const schema = properties[key]
    if (!typeOf(schema.type, value)) invalid(`chart.${key}`)
    checkEnum(schema, value, `chart.${key}`)
  }
}

/**
 * Strictly validate one data tool call's arguments against the shared contract
 * and return the SAME parsed object. Nothing is coerced, nothing is defaulted
 * here and no business value is invented: defaults belong to the service, which
 * is the only place that knows them.
 *
 * Refused: a non-plain object (array, null, prototype), any key the entry does
 * not declare (an authority key such as botId, or any other business key), a
 * missing required key, a wrong type, a value outside an enum, an unsafe
 * integer, and a JSON payload larger than MAX_ARGS_BYTES UTF-8 bytes.
 */
export function parseDataToolArgs(name, args) {
  const entry = dataToolEntry(name)
  if (!entry) throw new TypeError(`unknown data tool: ${String(name)}`)
  if (!isPlainObject(args)) invalid('args')
  let bytes
  try { bytes = Buffer.byteLength(JSON.stringify(args), 'utf8') } catch { invalid('args') }
  if (bytes > MAX_ARGS_BYTES) invalid('args')
  const { parameters } = entry
  // Root additionalProperties:false — there is no authority key to pass.
  if (Object.keys(args).some(key => !Object.hasOwn(parameters, key))) invalid('args')
  for (const [key, spec] of Object.entries(parameters)) if (spec.required === true && !Object.hasOwn(args, key)) invalid(key)
  for (const [key, value] of Object.entries(args)) {
    if (key === 'chart') { validateChart(value); continue }
    const schema = parameters[key]
    if (!typeOf(schema.type, value)) invalid(key)
    checkEnum(schema, value, key)
  }
  return args
}

/**
 * Project the business keys of one validated call onto the existing Bot data
 * service and call it exactly once. No retry, no fallback service, no second
 * attempt after a failure, a timeout or a cancellation: an unknown outcome is
 * reconciled by the Host, never replayed from here.
 */
export function invokeDataTool(bot, name, args) {
  const entry = dataToolEntry(name)
  if (!entry) throw new TypeError(`unknown data tool: ${String(name)}`)
  if (!bot || typeof bot[entry.method] !== 'function') throw new TypeError('DATA_TOOL_REQUIRE_ENGINE')
  return bot[entry.method](entry.project(args ?? {}))
}
