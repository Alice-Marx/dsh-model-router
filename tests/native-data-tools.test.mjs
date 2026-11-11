import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createProductDataAccess } from '../packages/orchestration/src/data-product-access.mjs'
import { createNativeDataTools } from '../packages/orchestration/src/native-data-tools.mjs'
import { registerDataTools } from '../packages/orchestration/src/bot-data-tools.mjs'
import { DATA_TOOL_ENTRIES, dataToolEntry, invokeDataTool, parseDataToolArgs } from '../packages/orchestration/src/data-tool-contract.mjs'
import { DataFailure, dataError } from '../packages/orchestration/src/bot-data-surface.mjs'

// Pure in-process doubles only: no forked data worker, no SQLite child and no
// native CLI fixture is launched anywhere in this file. The engine double speaks
// the same business API the real one does (load/describe/sql/show/exportCsv), so
// the assertions are about authority, projection and outcome handling rather
// than about SQLite itself.

const BINDING = {
  taskId: 'chat-data-tools', attemptId: 'attempt-1', machineId: 'machine-1', workspaceId: 'workspace-1', location: 'local',
}

/** An engine double that records every call, with per-method overrides. */
const createEngine = (overrides = {}) => {
  const calls = []
  const defaults = {
    load: async input => ({ tables: [{ name: input.name ?? 'dataset', rowCount: 2, columns: [{ name: 'a', type: 'INTEGER' }], source: 'inline' }], warnings: [], elapsedMs: 1 }),
    describe: async target => (target === undefined
      ? { rowCount: 0, columns: [], tables: [{ name: 'sales', columns: 2 }], cards: [], elapsedMs: 1 }
      : { name: target, rowCount: 2, columns: [{ name: 'a', type: 'INTEGER', sample: [1] }], elapsedMs: 1 }),
    sql: async () => ({ table: null, columns: [{ name: 'a', type: 'INTEGER' }], rowCount: 1, rows: [[7]], truncated: false, elapsedMs: 1 }),
    show: async input => ({ id: 'c_1', kind: input.kind, title: input.title ?? 'Query', rowCount: 1, columns: [], rows: [[7]], truncated: false, elapsedMs: 1 }),
    exportCsv: async () => ({ format: 'csv', sourceRowCount: 1, rowCount: 1, bytes: 12, truncated: false, path: 'exports/export.csv', written: { bytes: 12 }, elapsedMs: 1 }),
  }
  const methods = { ...defaults, ...overrides }
  const forBot = botId => {
    calls.push({ op: 'forBot', botId })
    const bot = { botId }
    for (const [method, run] of Object.entries(methods)) {
      bot[method] = async input => { calls.push({ op: method, botId, input }); return run(input, calls) }
    }
    return bot
  }
  return { calls, forBot }
}

/** Host authority, principal directory and one committed, granted Bot. */
const fixture = ({ grants = ['tool/data'], committed = true, botId = 'bot-a' } = {}) => {
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  const live = new Set(committed ? [botId] : [])
  const agent = { id: 'runtime-agent', session: { id: 'session-a' } }
  directory.register(botId, { tools: grants, modelRoutes: [] })
  directory.bind(botId, agent)
  const engine = createEngine()
  const access = createProductDataAccess({ engine, authority, directory, lifecycle: { committedBot: id => live.has(id) ? { id } : null } })
  return { authority, directory, engine, access, live, botId, subject: directory.forBot(botId), agent }
}

const nativeFor = (f, { botId = f.botId, validate = async () => {}, redact = text => text } = {}) =>
  createNativeDataTools({ access: f.access, subject: f.subject, botId, validate, redact })

const handlerFor = (f, name, options = {}) => nativeFor(f, options).handlers.find(handler => handler.definition.name === name)

/** The native bridge hands a handler ({ signal, binding, context }). */
const callContext = (signal, extra = {}) => ({ signal, binding: BINDING, context: { turnId: 'turn-1', callId: 'call-1', signal, ...extra } })

/** Wait until the engine double really reached an operation, or fail loudly. */
const waitFor = async predicate => {
  for (let index = 0; index < 2000 && !predicate(); index++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(predicate(), 'the awaited engine call never started')
}

test('contract: the five data tools keep one name, description, schema and projection for both doors', async () => {
  assert.deepEqual(DATA_TOOL_ENTRIES.map(entry => entry.name), ['data_load', 'data_describe', 'data_sql', 'data_show', 'data_export'])
  assert.equal(Object.isFrozen(DATA_TOOL_ENTRIES), true)
  assert.equal(dataToolEntry('data_export').capability, 'tool/data')
  assert.equal(dataToolEntry('data_nope'), null)

  const f = fixture(), registered = new Map()
  const release = registerDataTools({ tools: { register: tool => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } } },
    { engine: f.engine, botIdFor: f.access.botIdFor })
  const native = nativeFor(f)
  try {
    assert.equal(native.tools.length, 5)
    assert.deepEqual(native.tools, DATA_TOOL_ENTRIES.map(entry => entry.name))
    for (const entry of DATA_TOOL_ENTRIES) {
      const handler = native.handlers.find(item => item.definition.name === entry.name)
      // The native door cannot restate a description or a schema the SDK door
      // does not use: both are the same frozen objects.
      assert.equal(handler.definition.description, entry.description)
      assert.equal(handler.definition.inputSchema, entry.inputSchema)
      assert.equal(handler.capability, 'tool/data')
      const tool = registered.get(entry.name)
      assert.equal(tool.name, entry.name)
      assert.equal(tool.description, entry.description)
      assert.deepEqual(Object.keys(tool.parameters.properties), Object.keys(entry.parameters))
      assert.equal(entry.inputSchema.type, 'object')
      assert.equal(entry.inputSchema.additionalProperties, false)
      assert.deepEqual([...entry.inputSchema.required], Object.entries(entry.parameters).filter(([, spec]) => spec.required === true).map(([key]) => key))
    }
    // MCP gets a genuinely nested chart object; the SDK keeps its own json node.
    const chart = dataToolEntry('data_show').inputSchema.properties.chart
    assert.equal(chart.type, 'object')
    assert.equal(chart.additionalProperties, false)
    assert.deepEqual([...chart.required], ['type', 'x'])
    assert.deepEqual([...chart.properties.type.enum], ['bar', 'line', 'area'])
    assert.deepEqual([...chart.properties.agg.enum], ['count', 'sum', 'avg', 'min', 'max'])
    assert.equal(registered.get('data_show').parameters.properties.chart.type, undefined, 'the SDK parameter map is unchanged')
  } finally { release(); assert.equal(registered.size, 0) }
})

test('contract: invokeDataTool projects only business keys and calls the service exactly once', async () => {
  const calls = []
  const bot = {
    load: async input => { calls.push(['load', input]) }, describe: async target => { calls.push(['describe', target]) },
    sql: async input => { calls.push(['sql', input]) }, show: async input => { calls.push(['show', input]) }, exportCsv: async input => { calls.push(['exportCsv', input]) },
  }
  const chart = { type: 'bar', x: 'region', y: 'sales' }
  await invokeDataTool(bot, 'data_load', { from: 'content', content: 'a\n1', name: 't', botId: 'other-bot', path: 'C:/secret/x.csv' })
  await invokeDataTool(bot, 'data_describe', { target: 'sales', botId: 'other-bot' })
  await invokeDataTool(bot, 'data_sql', { sql: 'SELECT 1', limit: 10, name: 'kept', botId: 'other-bot' })
  await invokeDataTool(bot, 'data_show', { table: 't', kind: 'chart', chart, cardId: 'c_1', botId: 'other-bot' })
  await invokeDataTool(bot, 'data_export', { table: 't', filename: 'out', botId: 'other-bot' })

  assert.deepEqual(calls.map(([method]) => method), ['load', 'describe', 'sql', 'show', 'exportCsv'])
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ['content', 'delimiter', 'format', 'from', 'header', 'name', 'path', 'replace'])
  assert.equal(Object.hasOwn(calls[0][1], 'botId'), false, 'a model-supplied botId is projected away, never authority')
  assert.equal(calls[1][1], 'sales', 'the existing describe service keeps taking the target itself')
  assert.deepEqual(Object.keys(calls[2][1]).sort(), ['limit', 'name', 'sql'])
  assert.deepEqual(Object.keys(calls[3][1]).sort(), ['cardId', 'chart', 'kind', 'limit', 'sql', 'table', 'title'])
  assert.equal(calls[3][1].chart, chart, 'the chart spec reaches the compiler as the same nested object')
  assert.deepEqual(Object.keys(calls[4][1]).sort(), ['cardId', 'filename', 'sql', 'table'])
  assert.throws(() => invokeDataTool(bot, 'data_nope', {}), TypeError)
  assert.throws(() => invokeDataTool({}, 'data_sql', { sql: 'SELECT 1' }), TypeError)
})

test('contract: a real chart spec parses; authority keys, bad types, enums and oversize are refused', () => {
  const args = { table: 'sales', kind: 'chart', title: 'By region', limit: 25, chart: { type: 'area', x: 'day', y: 'sales', agg: 'sum', color: 'region', sort: '-y', timeUnit: 'month', limit: 40, stack: true } }
  assert.equal(parseDataToolArgs('data_show', args), args, 'the original parsed object is returned')
  assert.deepEqual(parseDataToolArgs('data_describe', {}), {})
  const refused = [
    ['data_load', { sql: 'SELECT 1' }, 'missing required sql'],
    ['data_sql', { sql: 'SELECT 1', botId: 'bot-b' }, 'an authority key'],
    ['data_sql', { sql: 'SELECT 1', table: 'sales' }, 'a foreign business key'],
    ['data_sql', { sql: 'SELECT 1', limit: '10' }, 'a numeric string'],
    ['data_sql', { sql: 'SELECT 1', limit: 1.5 }, 'a float'],
    ['data_sql', { sql: 'SELECT 1', limit: Number.MAX_SAFE_INTEGER + 2 }, 'an unsafe integer'],
    ['data_sql', { sql: 'SELECT 1', limit: true }, 'a boolean'],
    ['data_load', { from: 'url', content: 'x' }, 'a value outside the enum'],
    ['data_show', { kind: 'chart', chart: { type: 'pie', x: 'a' } }, 'an unsupported mark'],
    ['data_show', { kind: 'chart', chart: { type: 'bar' } }, 'a chart without x'],
    ['data_show', { kind: 'chart', chart: { type: 'bar', x: 'a', agg: 'median' } }, 'a refused aggregation'],
    ['data_show', { kind: 'chart', chart: { type: 'bar', x: 'a', sort: 'z' } }, 'an unknown sort'],
    ['data_show', { kind: 'chart', chart: { type: 'bar', x: 'a', timeUnit: 'decade' } }, 'an unknown time bucket'],
    ['data_show', { kind: 'chart', chart: { type: 'bar', x: 'a', limit: '5' } }, 'a nested wrong type'],
    ['data_show', { kind: 'chart', chart: { type: 'bar', x: 'a', extra: true } }, 'a nested extra key'],
    ['data_show', { kind: 'chart', chart: null }, 'a null chart'],
    ['data_show', { kind: 'chart', chart: ['bar', 'a'] }, 'an array chart'],
    ['data_load', { from: 'content', content: 'x'.repeat(128_001) }, 'more than 128000 JSON bytes'],
  ]
  for (const [name, value, label] of refused) {
    assert.throws(() => parseDataToolArgs(name, value), error => {
      assert.equal(error.code, 'INVALID_DATA_TOOL_ARGS', label)
      return true
    }, label)
  }
  for (const value of [null, [], 'x', 7]) assert.throws(() => parseDataToolArgs('data_sql', value), { code: 'INVALID_DATA_TOOL_ARGS' })
  assert.throws(() => parseDataToolArgs('data_nope', {}), TypeError)
})

test('native: a Bot without the grant, the commit or the matching id is offered no tools and no engine', () => {
  for (const options of [{ grants: [] }, { committed: false }]) {
    const f = fixture(options)
    const result = nativeFor(f)
    assert.deepEqual(result.tools, [])
    assert.equal(result.handlers.length, 0)
    assert.equal(f.engine.calls.length, 0, 'no engine is opened to discover an absent authority')
  }
  // A subject whose Bot is not the expected one is offered nothing either.
  const other = fixture()
  assert.deepEqual(nativeFor(other, { botId: 'bot-b' }).tools, [])
  assert.equal(other.engine.calls.length, 0)
  // A subject that belongs to another Bot cannot borrow this Bot's id either.
  const f = fixture()
  f.directory.register('bot-b', { tools: ['tool/data'], modelRoutes: [] })
  const foreign = createNativeDataTools({ access: f.access, subject: f.directory.forBot('bot-b'), botId: 'bot-a', validate: async () => {} })
  assert.deepEqual(foreign.tools, [])
  assert.equal(f.engine.calls.length, 0)
})

test('native: a retained handler refuses a revoked or deleted Bot before any engine is opened', async () => {
  const revoked = fixture(), handler = handlerFor(revoked, 'data_sql')
  assert.equal(typeof handler, 'object')
  revoked.directory.retire('bot-a')
  await assert.rejects(handler.execute(handler.parse({ sql: 'SELECT 1' }), callContext(new AbortController().signal)), error => {
    assert.equal(error.code, 'SUBJECT_REVOKED')
    return true
  })
  assert.equal(revoked.engine.calls.length, 0)

  const deleted = fixture(), describe = handlerFor(deleted, 'data_describe')
  deleted.live.delete('bot-a')
  await assert.rejects(describe.execute(describe.parse({}), callContext(new AbortController().signal)), error => {
    assert.equal(error.code, 'INVALID_DATA_OWNER')
    return true
  })
  assert.equal(deleted.engine.calls.length, 0)
})

test('native: a call without a live Host turn reaches no engine', async () => {
  const f = fixture(), handler = handlerFor(f, 'data_sql')
  const controller = new AbortController()
  for (const context of [{ ...callContext(controller.signal), context: { callId: 'call-1', signal: controller.signal } },
    { ...callContext(controller.signal), context: { turnId: 'turn-1', signal: controller.signal } },
    undefined]) {
    await assert.rejects(handler.execute({ sql: 'SELECT 1' }, context), { message: 'NATIVE_TOOL_TURN_REQUIRED' })
  }
  assert.equal(f.engine.calls.length, 0)

  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(handler.execute({ sql: 'SELECT 1' }, callContext(cancelled.signal)))
  assert.equal(f.engine.calls.length, 0, 'a call cancelled before it starts opens no engine')
})

test('native: the parent validate runs before and after the awaited work, around the engine', async () => {
  const f = fixture(), sequence = []
  const handler = handlerFor(f, 'data_sql', { validate: async () => { sequence.push('validate') } })
  f.engine.forBot = botId => { sequence.push('forBot'); return createEngine().forBot(botId) }
  await handler.execute(handler.parse({ sql: 'SELECT 1' }), callContext(new AbortController().signal))
  assert.deepEqual(sequence, ['validate', 'forBot', 'validate'])
})

test('native: a real data result is rendered as MCP text JSON with its JSON types and redaction intact', async () => {
  const f = fixture(), handler = handlerFor(f, 'data_show', { redact: text => text.replace(/secret/g, '***') })
  f.engine.forBot = () => createEngine({
    show: async () => ({ id: 'c_1', kind: 'chart', title: 'secret sales', rowCount: 3, ratio: 0.5, ok: true, nothing: null, truncated: false }),
  }).forBot('bot-a')
  const value = await handler.execute(handler.parse({ table: 'secret', kind: 'chart', chart: { type: 'bar', x: 'region' } }), callContext(new AbortController().signal))
  assert.deepEqual(value, { id: 'c_1', kind: 'chart', title: '*** sales', rowCount: 3, ratio: 0.5, ok: true, nothing: null, truncated: false })
  const rendered = handler.render(value)
  assert.equal(rendered.isError, undefined, 'a real result is never reported as an error')
  const parsed = JSON.parse(rendered.content[0].text)
  assert.equal(parsed.ratio, 0.5)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.nothing, null)
  assert.equal(parsed.title, '*** sales')
  assert.deepEqual(Object.keys(rendered), ['content'])
  assert.deepEqual(Object.keys(rendered.content[0]), ['type', 'text'])
})

test('native: a structured engine failure is an MCP error, sanitized, and never retried', async () => {
  const f = fixture(), handler = handlerFor(f, 'data_sql')
  let attempts = 0
  f.engine.forBot = () => createEngine({
    sql: async () => { attempts++; throw new DataFailure(dataError('sql_error', 'no such column: nope in F:/everyAI/dsh-model-router-all/state/bot-a.sqlite')) },
  }).forBot('bot-a')
  const value = await handler.execute(handler.parse({ sql: 'SELECT nope' }), callContext(new AbortController().signal))
  assert.equal(attempts, 1, 'a failed engine call is never automatically retried')
  assert.equal(value.error.code, 'sql_error')
  assert.match(value.error.message, /no such column: nope/)
  assert.doesNotMatch(value.error.message, /F:|bot-a\.sqlite/, 'no absolute Host path reaches the model')
  const rendered = handler.render(value)
  assert.equal(rendered.isError, true)
  assert.equal(JSON.parse(rendered.content[0].text).error.code, 'sql_error')

  const timed = fixture()
  const failing = createEngine({ sql: async () => { throw new DataFailure(dataError('timeout', 'The statement was cancelled after 30000 ms.', { retryable: true })) } })
  timed.engine.forBot = failing.forBot
  const timeoutValue = await handlerFor(timed, 'data_sql').execute({ sql: 'SELECT 1' }, callContext(new AbortController().signal))
  assert.equal(timeoutValue.error.code, 'timeout')
  assert.equal(failing.calls.filter(call => call.op === 'sql').length, 1, 'a timed-out statement is not replayed')

  const unexpected = fixture()
  const broken = createEngine({ sql: async () => { throw new Error('worker died at F:/everyAI/dsh-model-router-all/state') } })
  unexpected.engine.forBot = broken.forBot
  const unknown = await handlerFor(unexpected, 'data_sql').execute({ sql: 'SELECT 1' }, callContext(new AbortController().signal))
  assert.equal(unknown.error.code, 'engine_unavailable')
  assert.doesNotMatch(unknown.error.message, /F:/, 'an unexpected error message is sanitized too')
})

test('native: an authority change during the awaited work withholds the result', async () => {
  const f = fixture()
  let release
  const pending = new Promise(resolve => { release = resolve })
  const engine = createEngine({ sql: async () => { await pending; return { rows: [[1]] } } })
  f.engine.forBot = engine.forBot
  const handler = handlerFor(f, 'data_sql')
  const running = handler.execute(handler.parse({ sql: 'SELECT 1' }), callContext(new AbortController().signal))
  await waitFor(() => engine.calls.some(call => call.op === 'sql'))
  f.directory.replaceGrant('bot-a', { tools: [], modelRoutes: [] })
  release()
  await assert.rejects(running, error => {
    assert.equal(error.code, 'TOOL_DENIED', 'the post-await gate refuses with the Host reason')
    return true
  })
  assert.equal(engine.calls.filter(call => call.op === 'sql').length, 1, 'the withheld call is not repeated')
})

test('native: a cancellation after the work withholds the result without claiming the write never ran', async () => {
  const f = fixture()
  let release
  const pending = new Promise(resolve => { release = resolve })
  const engine = createEngine({ exportCsv: async () => { await pending; return { path: 'exports/export.csv', rowCount: 1 } } })
  f.engine.forBot = engine.forBot
  const handler = handlerFor(f, 'data_export')
  const controller = new AbortController()
  const running = handler.execute(handler.parse({ table: 'sales' }), callContext(controller.signal))
  await waitFor(() => engine.calls.some(call => call.op === 'exportCsv'))
  controller.abort()
  release()
  await assert.rejects(running)
  assert.equal(engine.calls.filter(call => call.op === 'exportCsv').length, 1)
})

test('native: the SDK door and the native door run the same business service for the same Bot', async () => {
  const f = fixture(), registered = new Map()
  const release = registerDataTools({ tools: { register: tool => { registered.set(tool.name, tool); return () => registered.delete(tool.name) } } },
    { engine: f.engine, botIdFor: f.access.botIdFor })
  const native = handlerFor(f, 'data_sql')
  try {
    const sdk = await registered.get('data_sql').execute({ sql: 'SELECT 1', botId: 'bot-b' }, { agent: f.agent })
    assert.deepEqual(sdk.rows, [[7]])
    assert.equal(f.engine.calls[0].op, 'forBot')
    assert.equal(f.engine.calls[0].botId, 'bot-a')
    const sqlCall = f.engine.calls.find(call => call.op === 'sql')
    assert.equal(sqlCall.botId, 'bot-a')
    assert.equal(Object.hasOwn(sqlCall.input, 'botId'), false)
    const nativeValue = await native.execute(native.parse({ sql: 'SELECT 1' }), callContext(new AbortController().signal))
    assert.deepEqual(nativeValue.rows, [[7]])
    assert.equal(f.engine.calls.at(-1).botId, 'bot-a')
    // The shared access object is the only engine door for both.
    assert.equal(f.access.forSubject(f.subject).botId, 'bot-a')
    assert.equal(f.access.botIdFor({ agent: f.agent }), 'bot-a')
    assert.throws(() => f.access.botIdForSubject({ nope: true }), { code: 'UNKNOWN_SUBJECT' })
  } finally { release() }
})
