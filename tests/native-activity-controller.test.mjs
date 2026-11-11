import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NATIVE_ACTIVITY_ACTION, NATIVE_ACTIVITY_LABELS,
  createNativeActivityController, formatActivityAt, nativeActivityLatest, nativeActivityOutcomeWord,
  nativeActivityScope, nativeActivityScopeKey, nativeActivityState, nativeActivitySummary, nativeActivityTool,
  readNativeActivityPage,
} from '../apps/integration-client/native-activity.mjs'

const botId = 'bot-a'
const integration = { botId, mode: 'integration', sessionId: 'bot-a:part-7' }
const independent = { botId, mode: 'independent', contextId: 'ctx-9f2' }
const conversation = 'host-0123456789abcdef'
const flush = async () => { for (let n = 0; n < 30; n++) await new Promise(resolve => setImmediate(resolve)) }
const until = async predicate => {
  const deadline = Date.now() + 1000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2))
  assert.equal(Boolean(predicate()), true, 'expected the observable state before the deadline')
}
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: value => resolve(value) } }
const record = (patch = {}) => {
  const { phase, outcome, ok, ...fields } = patch
  const state = fields.state ?? (phase !== 'completed' && !Number.isSafeInteger(fields.endedAt) ? 'running'
    : ['unknown', 'host-closed', 'host-lost', 'cancelled', 'refused'].includes(outcome) ? 'turn-unconfirmed'
    : outcome === 'succeeded' || ok === true ? 'cli-ok' : outcome === 'failed' || ok === false ? 'cli-error' : 'turn-unconfirmed')
  const startedAt = fields.startedAt ?? 1_700_000_000_000
  return { schemaVersion: 1, callKey: 'call-1', callId: fields.callKey ?? 'call-1', botId,
    mode: 'integration', conversationId: conversation, contextId: null, processGeneration: 'native-fixture', turnId: 't-1',
    toolName: 'Read', toolNameRecorded: true, callIdRecorded: true, toolNameTruncated: false, redacted: false,
    cliOk: state === 'cli-ok' ? true : state === 'cli-error' ? false : null,
    turnOutcome: outcome ?? null, turnSettled: outcome != null,
    startedAt, endedAt: state === 'running' ? null : startedAt + 1, updatedAt: state === 'running' ? startedAt : startedAt + 1,
    cancelRequested: false, stopConfirmed: false, lateCliReturn: false, lateCliOk: null,
    duplicateStarts: 0, duplicateCompletions: 0, ...fields, state }
}
const rescope = (items, scope) => items.map(row => ({ ...row, botId: scope.botId, mode: scope.mode,
  conversationId: scope.conversationId, contextId: scope.contextId }))
const page = (items, patch = {}) => {
  const scope = { botId, mode: 'integration', conversationId: conversation, contextId: null, sessionId: integration.sessionId }
  return { schemaVersion: 1, scope, items: rescope(items, scope), nextCursor: null,
    nativeRoute: true, recording: { status: 'ready', failures: 0 }, ...patch }
}
const independentPage = (items, patch = {}) => {
  const scope = { botId, mode: 'independent', conversationId: independent.contextId, contextId: independent.contextId, sessionId: null }
  return { schemaVersion: 1, scope, items: rescope(items, scope), nextCursor: null,
    nativeRoute: true, recording: { status: 'ready', failures: 0 }, ...patch }
}

function fixture(t, overrides = {}) {
  const scope = overrides.scope ?? integration
  const calls = [], handlers = { list: () => page([]), ...overrides.handlers }
  const api = { dispatch: async (action, payload, signal) => { calls.push({ action, payload, signal }); return handlers.list(payload, signal) } }
  const controller = createNativeActivityController({ api, ...scope, pollMs: 100_000, timeoutMs: 1000, ...overrides.options })
  t.after(() => controller.dispose())
  controller.start()
  return { controller, calls, handlers, api, scope }
}

test('the integrated read asks for exactly one Bot and one Session, with no context', async t => {
  const f = fixture(t, { handlers: { list: payload => { assert.deepEqual(payload, { botId, mode: 'integration', sessionId: integration.sessionId, limit: 20 }); return page([]) } } })
  await flush()
  assert.deepEqual(f.calls.map(row => row.action), [NATIVE_ACTIVITY_ACTION])
  assert.equal('contextId' in f.calls[0].payload, false)
  assert.equal('cursor' in f.calls[0].payload, false)
  assert.deepEqual(f.controller.getSnapshot().scope, { botId, mode: 'integration', sessionId: integration.sessionId, contextId: null })
})

test('the independent read asks for exactly one Bot and one context, with no session', async t => {
  const f = fixture(t, { scope: independent, handlers: { list: payload => { assert.deepEqual(payload, { botId, mode: 'independent', contextId: independent.contextId, limit: 20 }); return independentPage([]) } } })
  await flush()
  assert.equal('sessionId' in f.calls[0].payload, false)
  assert.equal(f.controller.getSnapshot().conversationId, independent.contextId)
})

test('a scope that cannot name its own conversation is refused before any read', () => {
  for (const scope of [{ ...integration, contextId: 'ctx-1' }, { ...independent, sessionId: 's' }, { botId, mode: 'other', sessionId: 's' }, { botId: '', mode: 'integration', sessionId: 's' }]) {
    assert.throws(() => createNativeActivityController({ api: { dispatch: () => {} }, ...scope }), { code: 'NATIVE_ACTIVITY_SCOPE_INVALID' })
  }
  assert.equal(nativeActivityScopeKey(integration), 'integration:bot-a:bot-a:part-7:')
  assert.equal(nativeActivityScopeKey(independent), 'independent:bot-a::ctx-9f2')
  assert.throws(() => nativeActivityScope({ botId, mode: 'integration' }), { code: 'NATIVE_ACTIVITY_SCOPE_INVALID' })
})

test('a Host that answers for another context is discarded, and its scope stops the read', async t => {
  const f = fixture(t, { scope: independent, handlers: { list: () => independentPage([record({ callKey: 'call-foreign' })], { scope: { botId, mode: 'independent', conversationId: 'ctx-other', contextId: 'ctx-other' } }) } })
  await flush()
  assert.equal(f.controller.getSnapshot().items.length, 0)
  assert.equal(f.controller.getSnapshot().error, '宿主切换了这一会话的工具记录范围，已停止显示之前的内容。')
  assert.equal(f.controller.getSnapshot().code, 'NATIVE_ACTIVITY_SCOPE_MISMATCH')
  const reads = f.calls.length
  f.controller.inspect(); await flush()
  assert.equal(f.calls.length, reads, 'a mismatched scope is fenced instead of polled again')
})

test('a reply that changes the conversation of the same session is never appended', async t => {
  let turn = 0
  const f = fixture(t, { handlers: { list: () => page([record({ callKey: `call-${++turn}` })], turn === 1 ? {} : { scope: { botId, mode: 'integration', conversationId: 'host-other', contextId: null, sessionId: integration.sessionId } }) } })
  await flush()
  f.controller.inspect(); await flush()
  assert.deepEqual(f.controller.getSnapshot().items.map(row => row.callKey), [])
  assert.equal(f.controller.getSnapshot().error, '宿主切换了这一会话的工具记录范围，已停止显示之前的内容。')
})

test('a late answer after dispose is dropped and never reaches the store', async t => {
  const answer = gate(), seen = []
  const f = fixture(t, { handlers: { list: () => answer.promise } })
  f.controller.subscribe(() => seen.push(f.controller.getSnapshot().items.length))
  await flush()
  f.controller.dispose()
  answer.resolve(page([record({ callKey: 'call-late', phase: 'completed', outcome: 'succeeded' })]))
  await flush()
  assert.equal(f.controller.getSnapshot().items.length, 0)
  assert.deepEqual(seen, [])
})

test('a slow answer for the live scope is displayed when it finally arrives', async t => {
  const answer = gate()
  const f = fixture(t, { handlers: { list: () => answer.promise } })
  await flush()
  assert.equal(f.controller.getSnapshot().loading, true)
  assert.equal(f.controller.getSnapshot().items.length, 0)
  answer.resolve(page([record({ callKey: 'call-slow', phase: 'completed', outcome: 'succeeded' })]))
  await flush()
  assert.deepEqual(f.controller.getSnapshot().items.map(row => row.callKey), ['call-slow'])
  assert.equal(f.controller.getSnapshot().loading, false)
  assert.equal(f.controller.getSnapshot().error, '')
})

test('a read that missed its deadline is retired, so its late answer cannot rewrite the list', async t => {
  const late = gate()
  let turn = 0
  const f = fixture(t, { options: { timeoutMs: 5 }, handlers: { list: () => (++turn === 1 ? late.promise : page([record({ callKey: 'call-fresh' })])) } })
  await until(() => f.controller.getSnapshot().code === 'NATIVE_ACTIVITY_ABORTED')
  assert.equal(f.controller.getSnapshot().items.length, 0)
  assert.equal(f.controller.getSnapshot().error, '宿主没有在约定时间内回答，已保留上一次读到的记录。')
  f.controller.inspect(); await flush()
  assert.deepEqual(f.controller.getSnapshot().items.map(row => row.callKey), ['call-fresh'])
  late.resolve(page([record({ callKey: 'call-stale' })]))
  await flush()
  assert.deepEqual(f.controller.getSnapshot().items.map(row => row.callKey), ['call-fresh'])
  assert.equal(f.controller.getSnapshot().error, '')
})

test('dispose aborts the in-flight read and clears the poll timer', async t => {
  const f = fixture(t, { handlers: { list: (payload, signal) => new Promise(() => { signal.addEventListener('abort', () => {}) }) } })
  await flush()
  assert.equal(f.calls[0].signal.aborted, false)
  f.controller.dispose()
  assert.equal(f.calls[0].signal.aborted, true)
})

test('polling runs only while mounted and stops the moment the controller is retired', async t => {
  const f = fixture(t, { options: { pollMs: 5 } })
  await new Promise(resolve => setTimeout(resolve, 60))
  const mounted = f.calls.length
  assert.ok(mounted > 1, `expected repeated reads, saw ${mounted}`)
  f.controller.dispose()
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(f.calls.length, mounted)
})

test('a cursor read keeps the original records, the Host order and merges only what is new', async t => {
  const f = fixture(t, { handlers: { list: payload => payload.cursor === 'cursor-2'
    ? page([record({ callKey: 'call-3', startedAt: 1 }), record({ callKey: 'call-4', startedAt: 1 })], { nextCursor: 'cursor-3' })
    : page([record({ callKey: 'call-1', startedAt: 3 }), record({ callKey: 'call-2', startedAt: 2 })], { nextCursor: 'cursor-2' }) } })
  await flush()
  await f.controller.older()
  // Equal start times keep the committed order: newest call key first.
  assert.deepEqual(f.controller.getSnapshot().items.map(row => row.callKey), ['call-1', 'call-2', 'call-4', 'call-3'])
  assert.equal(f.controller.getSnapshot().nextCursor, 'cursor-3')
  assert.equal(f.controller.getSnapshot().loadingOlder, false)
  const cursors = f.calls.filter(row => row.payload.cursor).map(row => row.payload.cursor)
  assert.deepEqual(cursors, ['cursor-2'], 'the cursor the Host gave is the one that is read')
  await f.controller.older()
  assert.equal(f.calls.filter(row => row.payload.cursor === 'cursor-2').length, 1, 'one cursor is never read twice while a read is running')
})

test('a later page completes a running row but can never rewind or repaint a finished one', async t => {
  let turn = 0
  const f = fixture(t, { handlers: { list: () => {
    turn += 1
    if (turn === 1) return page([record({ callKey: 'call-a', startedAt: 5 }), record({ callKey: 'call-b', startedAt: 4, phase: 'completed', outcome: 'unknown', lateCliReturn: true })])
    return page([record({ callKey: 'call-a', startedAt: 5, phase: 'completed', outcome: 'succeeded' }), record({ callKey: 'call-b', startedAt: 4, phase: 'completed', outcome: 'succeeded' })])
  } } })
  await flush()
  f.controller.inspect(); await flush()
  const rows = new Map(f.controller.getSnapshot().items.map(row => [row.callKey, row]))
  assert.equal(rows.get('call-a').state, 'cli-ok')
  assert.equal(rows.get('call-b').state, 'turn-unconfirmed', 'a late CLI return must not turn an unknown row green')
  assert.equal(rows.get('call-b').lateCliReturn, true)
  assert.equal(f.controller.getSnapshot().items.length, 2, 'merging is by call key, never by position')
})

test('the four states are read from the observation alone, without inventing one', () => {
  assert.equal(nativeActivityState(record()), 'running')
  assert.equal(nativeActivityState(record({ phase: 'completed', outcome: 'succeeded' })), 'cli-ok')
  assert.equal(nativeActivityState(record({ phase: 'completed', ok: true })), 'cli-ok')
  assert.equal(nativeActivityState(record({ phase: 'completed', outcome: 'failed' })), 'cli-error')
  assert.equal(nativeActivityState(record({ phase: 'completed', outcome: 'cancelled' })), 'turn-unconfirmed')
  assert.equal(nativeActivityState(record({ phase: 'completed', outcome: 'refused' })), 'turn-unconfirmed')
  assert.equal(nativeActivityState(record({ phase: 'completed', outcome: 'unknown' })), 'turn-unconfirmed')
  assert.equal(nativeActivityState(record({ phase: 'completed', outcome: 'host-lost', lateCliReturn: true })), 'turn-unconfirmed')
  assert.equal(nativeActivityState(record({ phase: 'completed' })), 'turn-unconfirmed')
  assert.equal(nativeActivityState(record({ endedAt: 12, ok: false })), 'cli-error')
  assert.equal(nativeActivityState(null), 'turn-unconfirmed')
  assert.deepEqual(NATIVE_ACTIVITY_LABELS['turn-unconfirmed'], '待核对')
  assert.equal(nativeActivityOutcomeWord('host-lost'), '宿主未保留结果')
  assert.equal(nativeActivityOutcomeWord(undefined), '宿主未记录结果')
})

test('friendly tool words never invent a name the Host did not report', () => {
  assert.deepEqual(nativeActivityTool({ toolName: 'Read' }), { label: '读取文件', icon: 'file', reported: 'Read' })
  assert.equal(nativeActivityTool({ toolName: 'Bash' }).label, '运行命令')
  assert.equal(nativeActivityTool({ toolName: 'Grep' }).icon, 'search')
  assert.equal(nativeActivityTool({ toolName: 'Task' }).label, '安排子任务')
  assert.equal(nativeActivityTool({}).label, '工具调用')
  assert.equal(nativeActivityTool({ toolName: '' }).reported, '')
  assert.equal(nativeActivityTool({ toolName: 'TotallyMadeUpTool' }).label, 'TotallyMadeUpTool')
})

test('a page that cannot be read completely is refused instead of shown partially', async t => {
  for (const broken of [
    page([record()], { schemaVersion: 2 }),
    page([record(), record()]),
    page([{ toolName: 'Read', startedAt: 1 }]),
    page([record()], { nativeRoute: 'yes' }),
    page([record()], { recording: { status: 'ready' } }),
    page([record()], { nextCursor: 42 }),
    page([record()], { items: new Array(51).fill(record()) }),
    { ...page([record()]), scope: null },
  ]) {
    const f = fixture(t, { handlers: { list: () => broken } })
    await flush()
    assert.equal(f.controller.getSnapshot().items.length, 0)
    assert.equal(f.controller.getSnapshot().loaded, false)
    assert.match(f.controller.getSnapshot().error, /工具记录/)
  }
})

test('a read failure keeps the last good records and never pretends there was no work', async t => {
  let turn = 0
  const f = fixture(t, { handlers: { list: () => { turn += 1; return turn === 1 ? page([record()]) : Promise.reject(Object.assign(new Error('socket detail'), { code: 'TRANSPORT' })) } } })
  await flush()
  f.controller.inspect(); await flush()
  assert.equal(f.controller.getSnapshot().items.length, 1)
  assert.equal(f.controller.getSnapshot().error, '读取工具记录失败，已保留上一次读到的记录。')
  assert.doesNotMatch(f.controller.getSnapshot().error, /socket detail/)
})

test('a Host deadline keeps the previous records and says so', async t => {
  const f = fixture(t, { handlers: { list: () => new Promise(() => {}) }, options: { timeoutMs: 5 } })
  await until(() => f.controller.getSnapshot().code === 'NATIVE_ACTIVITY_ABORTED')
  assert.equal(f.controller.getSnapshot().error, '宿主没有在约定时间内回答，已保留上一次读到的记录。')
})

test('degraded recording and an unrecorded route are reported, not hidden', async t => {
  const f = fixture(t, { handlers: { list: () => page([], { nativeRoute: false, recording: { status: 'degraded', failures: 3, code: 'STORE_WRITE_FAILED' } }) } })
  await flush()
  const state = f.controller.getSnapshot()
  assert.equal(state.nativeRoute, false)
  assert.equal(state.recording.status, 'degraded')
  assert.equal(state.recording.failures, 3)
  assert.equal(state.recording.code, 'STORE_WRITE_FAILED')
})

test('the view crop is a crop: counts describe the loaded scope only', async t => {
  const items = Array.from({ length: 7 }, (_unused, index) => record({ callKey: `call-${index}`, startedAt: 100 - index, phase: 'completed', outcome: 'succeeded' }))
  const rows = readNativeActivityPage(page(items), integration)
  assert.equal(rows.items.length, 7)
  assert.deepEqual(nativeActivityLatest(rows.items).map(row => row.callKey), ['call-0', 'call-1', 'call-2', 'call-3'])
  assert.equal(nativeActivityLatest(rows.items, 2).length, 2)
  assert.equal(nativeActivitySummary(rows.items).text, '最近：读取文件 · 已返回')
  assert.equal(nativeActivitySummary([]), null)
  const running = readNativeActivityPage(page([record({ callKey: 'call-x', toolName: 'Bash' })]), integration)
  assert.equal(nativeActivitySummary(running.items).text, '正在进行：运行命令')
})

test('a record without a start time still reads, and its time says so', () => {
  const rows = readNativeActivityPage(page([record({ callKey: 'call-no-time', startedAt: 0 })]), integration)
  assert.equal(rows.items[0].startedAt, 0)
  const now = 1_700_000_000_000
  assert.equal(formatActivityAt(null, now), '时间未记录')
  assert.match(formatActivityAt(now, now), /^\d{2}:\d{2}$/)
  assert.equal(formatActivityAt(0, now), '时间未记录')
})

test('canonical tool return and turn result are separate; a successful turn cannot invent a tool return', () => {
  const row = record({ state: 'turn-unconfirmed', cliOk: null, turnOutcome: 'succeeded', turnSettled: true, endedAt: 1_700_000_000_001 })
  const result = readNativeActivityPage(page([row]), integration).items[0]
  assert.equal(result.state, 'turn-unconfirmed')
  assert.equal(result.cliOk, null)
  assert.equal(result.turnOutcome, 'succeeded')
  assert.equal(result.processGeneration, 'native-fixture')
  assert.equal(result.callId, 'call-1')
})

test('a same-Bot different Session echo and any foreign row are refused', () => {
  assert.throws(() => readNativeActivityPage(page([], { scope: { ...page([]).scope, sessionId: 'other-session' } }), integration), { code: 'NATIVE_ACTIVITY_SCOPE_MISMATCH' })
  for (const patch of [{ botId: 'bot-other' }, { mode: 'independent' }, { conversationId: 'host-other' }, { contextId: 'ctx-other' }]) {
    const value = page([record()]); Object.assign(value.items[0], patch)
    assert.throws(() => readNativeActivityPage(value, integration), { code: 'NATIVE_ACTIVITY_SCOPE_MISMATCH' })
  }
  assert.throws(() => readNativeActivityPage(independentPage([], { scope: { ...independentPage([]).scope, conversationId: 'other' } }), independent), { code: 'NATIVE_ACTIVITY_SCOPE_MISMATCH' })
})

test('a terminal unknown accepts later stop and late-return facts without becoming green', async t => {
  let round = 0
  const f = fixture(t, { handlers: { list: () => page([record(++round === 1
    ? { state: 'turn-unconfirmed', cliOk: null, turnOutcome: 'unknown', turnSettled: true, endedAt: 1_700_000_000_001, cancelRequested: true, updatedAt: 1_700_000_000_010 }
    : { state: 'turn-unconfirmed', cliOk: null, turnOutcome: 'unknown', turnSettled: true, endedAt: 1_700_000_000_001, cancelRequested: true, stopConfirmed: true, lateCliReturn: true, lateCliOk: true, duplicateCompletions: 1, updatedAt: 1_700_000_000_020 })]) } })
  await flush(); f.controller.inspect(); await flush()
  const row = f.controller.getSnapshot().items[0]
  assert.equal(row.state, 'turn-unconfirmed')
  assert.equal(row.stopConfirmed, true)
  assert.equal(row.lateCliReturn, true)
  assert.equal(row.duplicateCompletions, 1)
  assert.equal(row.turnOutcome, 'unknown')
})

test('the Host cursor is opaque up to4096 characters, never shortened', async t => {
  const cursor = 'c'.repeat(2048)
  const f = fixture(t, { handlers: { list: payload => payload.cursor ? page([]) : page([record()], { nextCursor: cursor }) } })
  await flush(); await f.controller.older()
  assert.equal(f.calls.at(-1).payload.cursor, cursor)
  assert.throws(() => readNativeActivityPage(page([], { nextCursor: 'c'.repeat(4097) }), integration), { code: 'NATIVE_ACTIVITY_INVALID' })
})

test('a poll during a pending older read cannot reset its cursor or stop polling', async t => {
  const held = gate()
  const f = fixture(t, { options: { pollMs: 5 }, handlers: { list: payload => payload.cursor ? held.promise : page([record()], { nextCursor: 'first-cursor' }) } })
  await flush()
  const reading = f.controller.older()
  await new Promise(resolve => setTimeout(resolve, 20))
  held.resolve(page([record({ callKey: 'older', startedAt: 1 })], { nextCursor: 'next-original-cursor' }))
  await reading
  const calls = f.calls.length
  await until(() => f.calls.length > calls)
  assert.equal(f.controller.getSnapshot().nextCursor, 'next-original-cursor')
  assert.deepEqual(f.calls.filter(row => row.payload.cursor).map(row => row.payload.cursor), ['first-cursor'])
})
