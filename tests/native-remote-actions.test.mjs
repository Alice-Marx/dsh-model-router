import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { NATIVE_REMOTE_TOOLS, nativeRemoteToolEntry, openNativeRemoteActions } from '../packages/orchestration/src/native-remote-actions.mjs'

// The durable Host service behind the private MCP browser and desktop tools.
//
// What is real here: real SQLite through better-sqlite3 (the same component tables, the same
// reservation transaction, the same schema guard, the same reopen), the real capability authority
// and the real principal directory, and the real Agent operation-record vocabulary. What is faked is
// the paired machine directory: a deliberately permissive stub, so every refusal, fence and identity
// decision below comes from this module and from nothing else. No native process, no browser, no
// desktop, no network, no account and no model is involved, and nothing here claims Agent-side
// acceptance of a screenshot or a click.

const MACHINE = 'machine-a'
const MACHINE_TWO = 'machine-b'
const ROOT = 'project'
const ROOT_TWO = 'sandbox'
const BROWSER_TOOLS = ['browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_close']
const DESKTOP_TOOLS = ['desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll']
const SUPPORT_TOOLS = ['artifact_stat', 'artifact_read', 'operation_status', 'operation_cancel']
const ALL_TOOLS = [...BROWSER_TOOLS, ...DESKTOP_TOOLS, ...SUPPORT_TOOLS]
const GRANTS = Object.freeze(ALL_TOOLS.map(tool => `remote/${tool}`))
const TMP = resolve(import.meta.dirname, '../tmp/integration/native-remote-actions')

/** A PNG the fake artifact store can really hand back, and bytes that are not one. */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 0)])
const NOT_PNG = Buffer.from('deadbeef', 'hex')

const boot = async (t, options = {}) => {
  await mkdir(TMP, { recursive: true })
  const dir = await mkdtemp(join(TMP, 'case-'))
  let tick = 0
  const now = () => (tick += 1)
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  for (const bot of ['bot-a', 'bot-b']) directory.register(bot, { tools: options.grants ?? GRANTS, modelRoutes: [] })
  const machines = createMachines(options.machine)
  const open = () => openNativeRemoteActions({ Database, file: join(dir, 'orchestration.sqlite'), directory, authority, machines, now })
  const opened = [open()]
  let reader = null
  t.after(() => { for (const item of opened) item.close() })
  t.after(() => reader?.close())
  t.after(() => rm(dir, { recursive: true, force: true }))
  return {
    dir, authority, directory, machines, actions: opened[0], now,
    /** The same file, reopened: the durability this service promises has to survive it. */
    reopen: () => { const next = open(); opened.push(next); return next },
    view: opened[0].forConversation('bot-a', 'conv-a'),
    otherConversation: opened[0].forConversation('bot-a', 'conv-b'),
    otherBot: opened[0].forConversation('bot-b', 'conv-a'),
    rows: table => (reader ??= new Database(join(dir, 'orchestration.sqlite'), { readonly: true })).prepare(`SELECT * FROM ${table}`).all(),
  }
}

/**
 * A paired machine directory that enforces nothing. Its scope is a live, mutable fact so a case can
 * revoke it, and its handlers are scripted per tool so a case decides what the Agent answers.
 */
function createMachines({ tools = ALL_TOOLS, roots = [ROOT], mode = 'workspace-write', scopes = null } = {}) {
  const state = { tools: new Set(tools), roots: [...roots], mode }
  const calls = []
  const downloads = []
  const handlers = new Map()
  const artifacts = new Map()
  return {
    state, calls, downloads, artifacts,
    scopes: () => scopes ?? [{ machineId: MACHINE, revision: 1, roots: state.roots, tools: [...state.tools], mode: state.mode }],
    on(tool, handler) { handlers.set(tool, handler) },
    /** An artifact the download path can really verify. */
    artifact(artifactId, content = PNG, mediaType = 'image/png') {
      const row = { artifactId, content: content.toString('base64'), sha256: createHash('sha256').update(content).digest('hex'), size: content.length, mediaType }
      artifacts.set(artifactId, row)
      return row
    },
    async call(subject, input, options = {}) {
      calls.push({ input, signal: options.signal ?? null })
      const handler = handlers.get(input.tool)
      if (!handler) throw Object.assign(new Error('TOOL_NOT_READY'), { code: 'TOOL_NOT_READY', remoteDispatchNotSent: true })
      const result = await handler(input, options)
      if (input.tool === 'browser_snapshot') return result
      const envelope = value => value?.schemaVersion === 1
        ? { ...value, machineId: input.machineId, operationId: input.operationId }
        : { schemaVersion: 1, machineId: input.machineId, operationId: input.operationId, tool: input.tool, status: 'succeeded', result: value }
      if (input.tool === 'operation_cancel') return { ...result, operation: envelope(result.operation) }
      return envelope(result)
    },
    async download(subject, input) {
      downloads.push(input)
      const artifact = artifacts.get(input.artifactId)
      if (!artifact) throw Object.assign(new Error('ARTIFACT_NOT_FOUND'), { code: 'ARTIFACT_NOT_FOUND' })
      return { ...artifact }
    },
  }
}

const operation = (tool, status, result = {}, error = null) => Object.freeze({
  schemaVersion: 1, machineId: MACHINE, operationId: 'agent-operation', tool, status,
  startedAt: '2026-11-10T00:00:00.000Z', finishedAt: null, result, ...(error ? { error: { code: error } } : {}),
})

const turn = (turnId = 'turn-1', callId = 'call-1', signal = null) => ({ turnId, callId, signal })

const refusal = async promise => {
  try { await promise } catch (error) { return error }
  assert.fail('expected a refusal')
}

test('native remote tools: the catalog is the exact offered surface', () => {
  assert.equal(Object.isFrozen(NATIVE_REMOTE_TOOLS), true)
  assert.deepEqual(NATIVE_REMOTE_TOOLS.map(entry => entry.name), [
    'bot_browser_open', 'bot_browser_snapshot', 'bot_browser_click', 'bot_browser_type', 'bot_browser_close',
    'bot_desktop_screenshot', 'bot_desktop_click', 'bot_desktop_type', 'bot_desktop_key', 'bot_desktop_scroll',
    'bot_remote_operation_status', 'bot_remote_operation_cancel',
  ])
  const expected = {
    bot_browser_open: ['browser_open', ['url']], bot_browser_snapshot: ['browser_snapshot', ['browserSessionId']],
    bot_browser_click: ['browser_click', ['browserSessionId', 'snapshotId', 'ref']],
    bot_browser_type: ['browser_type', ['browserSessionId', 'snapshotId', 'ref', 'text']],
    bot_browser_close: ['browser_close', ['browserSessionId']],
    bot_desktop_screenshot: ['desktop_screenshot', []], bot_desktop_click: ['desktop_click', ['screenshotId', 'x', 'y']],
    bot_desktop_type: ['desktop_type', ['screenshotId', 'text']], bot_desktop_key: ['desktop_key', ['screenshotId', 'key']],
    bot_desktop_scroll: ['desktop_scroll', ['screenshotId', 'delta']],
    bot_remote_operation_status: ['operation_status', ['operationId']], bot_remote_operation_cancel: ['operation_cancel', ['operationId']],
  }
  const mutating = new Set(['browser_open', 'browser_click', 'browser_type', 'browser_close', 'desktop_screenshot',
    'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll', 'operation_cancel'])
  for (const entry of NATIVE_REMOTE_TOOLS) {
    const [machineTool, required] = expected[entry.name]
    assert.equal(entry.machineTool, machineTool)
    assert.equal(entry.capability, `remote/${machineTool}`)
    assert.equal(entry.mutating, mutating.has(machineTool))
    assert.equal(Object.isFrozen(entry), true)
    assert.equal(Object.isFrozen(entry.parameters), true)
    assert.equal(entry.parameters.type, 'object')
    assert.equal(entry.parameters.additionalProperties, false)
    assert.deepEqual([...entry.parameters.required], required)
    assert.equal(Object.getPrototypeOf(entry.parameters.properties), Object.prototype)
    // A flat schema: no nesting a model could hide an identity, an endpoint or a credential inside.
    for (const schema of Object.values(entry.parameters.properties)) {
      assert.ok(!schema.properties && !schema.items?.properties, `${entry.name} must stay flat`)
      assert.ok(['string', 'integer', 'array'].includes(schema.type), `${entry.name}.${schema.type}`)
    }
    // Only the two observations are targetless; every normal action may name a granted target.
    const selectors = ['machineId', 'rootId'].filter(key => Object.hasOwn(entry.parameters.properties, key))
    assert.deepEqual(selectors, machineTool.startsWith('operation_') ? [] : ['machineId', 'rootId'])
    assert.equal(nativeRemoteToolEntry(entry.name), entry)
  }
  assert.equal(nativeRemoteToolEntry('bot_browser_script'), null)
  assert.equal(nativeRemoteToolEntry(undefined), null)
})

test('native remote actions: the services it cannot run are refused before any file is opened', async t => {
  await mkdir(TMP, { recursive: true })
  const dir = await mkdtemp(join(TMP, 'case-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  const base = { Database, file: join(dir, 'orchestration.sqlite'), directory, authority, machines: { call() {}, scopes: () => [] } }
  assert.throws(() => openNativeRemoteActions({}), TypeError)
  assert.throws(() => openNativeRemoteActions({ ...base, machines: null }), TypeError)
  assert.throws(() => openNativeRemoteActions({ ...base, directory: null }), TypeError)
  assert.throws(() => openNativeRemoteActions({ ...base, authority: null }), TypeError)
  assert.throws(() => openNativeRemoteActions({ ...base, file: 7 }), TypeError)
  // A schema this build does not know is a refusal, never a silent migration.
  const seeded = new Database(base.file)
  seeded.exec('CREATE TABLE native_remote_component(component TEXT PRIMARY KEY,version INTEGER NOT NULL)')
  seeded.prepare('INSERT INTO native_remote_component VALUES(?,?)').run('native-remote-actions', 99)
  seeded.close()
  assert.throws(() => openNativeRemoteActions(base), error => error.code === 'NATIVE_REMOTE_SCHEMA_UNSUPPORTED')
  // Reopening the file this module just wrote is accepted and writes nothing new.
  const clean = { ...base, file: join(dir, 'fresh.sqlite') }
  const first = openNativeRemoteActions(clean)
  first.close()
  const second = openNativeRemoteActions(clean)
  assert.deepEqual(second.forConversation('bot-a', 'conv-a').schemas(), [])
  second.close()
})

test('native remote actions: the offered surface is decided from live grants and live scopes', async t => {
  const { view, machines } = await boot(t)
  // Reconciliation is mounted from committed grants alone, so it is offered before the first
  // operation exists: a model cannot read an operation it was never offered the reader for.
  assert.deepEqual(view.schemas().map(schema => schema.name), NATIVE_REMOTE_TOOLS.map(entry => entry.name))
  for (const schema of view.schemas()) {
    assert.deepEqual(Object.keys(schema).sort(), ['description', 'name', 'parameters'])
    assert.equal(schema.parameters, nativeRemoteToolEntry(schema.name).parameters)
  }
  // A pairing without the operation tools can read or stop nothing, and cannot deliver a
  // screenshot either, so the whole desktop family leaves the request with them.
  machines.state.tools.delete('operation_status')
  machines.state.tools.delete('operation_cancel')
  assert.deepEqual(view.schemas().map(schema => schema.name), NATIVE_REMOTE_TOOLS
    .filter(entry => BROWSER_TOOLS.includes(entry.machineTool)).map(entry => entry.name))
})

test('native remote actions: a read-only pairing keeps the read-only entries and drops the rest', async t => {
  const { view } = await boot(t, { machine: { tools: ['browser_snapshot', 'operation_status'], mode: 'read-only' } })
  assert.deepEqual(view.schemas().map(schema => schema.name), ['bot_browser_snapshot', 'bot_remote_operation_status'])
})

test('native remote actions: a desktop entry needs its artifact and operation capabilities', async t => {
  const { view } = await boot(t, { machine: { tools: [...BROWSER_TOOLS, ...DESKTOP_TOOLS] } })
  const names = view.schemas().map(schema => schema.name)
  for (const name of ['bot_desktop_screenshot', 'bot_desktop_click', 'bot_desktop_type', 'bot_desktop_key', 'bot_desktop_scroll']) {
    assert.equal(names.includes(name), false, name)
  }
  assert.equal(names.includes('bot_browser_open'), true)
})

test('native remote actions: a withdrawn grant takes the tool out of the request', async t => {
  const { view, directory } = await boot(t, { grants: GRANTS.filter(grant => grant !== 'remote/desktop_click') })
  assert.equal(view.schemas().some(schema => schema.name === 'bot_desktop_click'), false)
  directory.retire('bot-a')
  assert.deepEqual(view.schemas(), [])
  const error = await refusal(view.call('bot_desktop_screenshot', {}, turn()))
  assert.equal(error.code, 'UNKNOWN_BOT')
})

test('native remote actions: the conversation id is Host-provided and bounded', async t => {
  const { actions, machines } = await boot(t)
  assert.equal(actions.forConversation('bot-a', 'conv-a').schemas().length, NATIVE_REMOTE_TOOLS.length)
  assert.throws(() => actions.forConversation('bot-a', ''), error => error.code === 'NATIVE_REMOTE_CONVERSATION_REQUIRED')
  assert.throws(() => actions.forConversation('', 'conv-a'), error => error.code === 'NATIVE_REMOTE_BOT_REQUIRED')
  assert.throws(() => actions.forConversation('bot-a', 'conv\nwith-control'), error => error.code === 'NATIVE_REMOTE_CONVERSATION_REQUIRED')
  assert.throws(() => actions.forConversation('bot-a', 'x'.repeat(257)), error => error.code === 'NATIVE_REMOTE_CONVERSATION_REQUIRED')
  // A conversation the Host never named is not an actor: it offers nothing and calls are refused.
  assert.deepEqual(actions.forConversation('bot-z', 'conv-a').schemas(), [])
  const error = await refusal(actions.forConversation('bot-z', 'conv-a').call('bot_browser_open', { url: 'https://example.test/' }, turn()))
  assert.equal(error.code, 'UNKNOWN_BOT')
  assert.equal(machines.calls.length, 0)
})

test('native remote actions: the Agent identity is stable across actions and across a reopen', async t => {
  const { view, machines, reopen } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  machines.on('browser_click', () => operation('browser_click', 'succeeded', { completed: true }))
  machines.on('browser_snapshot', input => ({ browserSessionId: input.args.browserSessionId, snapshotId: 'snapshot-1', text: 'hello', nodes: [] }))

  const opened = await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  assert.equal(opened.status, 'succeeded')
  assert.equal(opened.value.browserSessionId, 'browser-1')
  assert.match(opened.taskId, /^nrt-[a-f0-9]{32}$/)
  assert.match(opened.attemptId, /^nra-[a-f0-9]{32}$/)
  assert.match(opened.operationId, /^nro-[a-f0-9]{32}$/)

  const clicked = await view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '3' }, turn('turn-1', 'call-2'))
  assert.equal(clicked.taskId, opened.taskId)
  assert.equal(clicked.attemptId, opened.attemptId)
  assert.notEqual(clicked.operationId, opened.operationId)

  // A read-only snapshot carries no operation envelope, but the same Agent identity.
  const snapshot = await view.call('bot_browser_snapshot', { browserSessionId: 'browser-1' }, turn('turn-1', 'call-3'))
  assert.equal(snapshot.operationId, null)
  assert.equal(snapshot.status, 'succeeded')
  assert.equal(snapshot.value.snapshotId, 'snapshot-1')
  assert.equal(snapshot.taskId, opened.taskId)

  // A reopen keeps the same derived identity and the same issued browser session.
  const after = reopen().forConversation('bot-a', 'conv-a')
  const again = await after.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '4' }, turn('turn-2', 'call-1'))
  assert.equal(again.taskId, opened.taskId)
  assert.equal(again.attemptId, opened.attemptId)
  assert.equal(machines.calls.length, 4)
  for (const call of machines.calls) assert.equal(call.input.taskId, opened.taskId)
})

test('native remote actions: a browser session belongs to the conversation and bot that opened it', async t => {
  const { view, otherConversation, otherBot, machines, reopen } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  machines.on('browser_click', () => operation('browser_click', 'succeeded', { completed: true }))
  await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  const dispatched = machines.calls.length

  for (const stranger of [otherConversation, otherBot]) {
    const error = await refusal(stranger.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '1' }, turn('turn-9', 'call-9')))
    assert.equal(error.code, 'NATIVE_REMOTE_BROWSER_SESSION_UNKNOWN')
  }
  const reopened = reopen().forConversation('bot-a', 'conv-a')
  const unknown = await refusal(reopened.call('bot_browser_click', { browserSessionId: 'browser-404', snapshotId: 'snapshot-1', ref: '1' }, turn('turn-9', 'call-8')))
  assert.equal(unknown.code, 'NATIVE_REMOTE_BROWSER_SESSION_UNKNOWN')
  const mismatch = await refusal(view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '1', machineId: 'machine-zzz' }, turn('turn-9', 'call-7')))
  assert.equal(mismatch.code, 'MACHINE_NOT_BOUND')
  assert.equal(machines.calls.length, dispatched)
})

test('native remote actions: a closed browser session is not reused', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  machines.on('browser_close', () => operation('browser_close', 'succeeded', { closed: true, persistent: false }))
  machines.on('browser_click', () => operation('browser_click', 'succeeded', { completed: true }))
  await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  const closed = await view.call('bot_browser_close', { browserSessionId: 'browser-1' }, turn('turn-1', 'call-2'))
  assert.equal(closed.status, 'succeeded')
  const error = await refusal(view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '1' }, turn('turn-1', 'call-3')))
  assert.equal(error.code, 'NATIVE_REMOTE_BROWSER_SESSION_UNKNOWN')
  assert.equal(machines.calls.filter(call => call.input.tool === 'browser_click').length, 0)
})

test('native remote actions: an identical request is answered from its original record', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  const args = { url: 'https://example.test/' }
  const first = await view.call('bot_browser_open', args, turn())
  const second = await view.call('bot_browser_open', { ...args }, turn())
  assert.deepEqual(second, first)
  assert.equal(machines.calls.length, 1)
  // The same key with different content is a refusal, not a second effect.
  const changed = await refusal(view.call('bot_browser_open', { url: 'https://other.test/' }, turn()))
  assert.equal(changed.code, 'NATIVE_REMOTE_REQUEST_CONFLICT')
  const renamed = await refusal(view.call('bot_browser_close', { browserSessionId: 'browser-1' }, turn()))
  assert.equal(renamed.code, 'NATIVE_REMOTE_REQUEST_CONFLICT')
  assert.equal(machines.calls.length, 1)
})

test('native remote actions: a concurrent duplicate dispatches once and shares the original outcome', async t => {
  const { view, machines } = await boot(t)
  let release = () => {}
  const gate = new Promise(resolve => { release = resolve })
  machines.on('browser_open', async () => { await gate; return { browserSessionId: 'browser-1', url: 'https://example.test/' } })
  const args = { url: 'https://example.test/' }
  // Both calls are started before the first one can settle, and the second one never dispatches.
  const first = view.call('bot_browser_open', args, turn())
  const second = view.call('bot_browser_open', { ...args }, turn())
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.operationId, b.operationId)
  assert.equal(b.status, 'succeeded')
  assert.equal(machines.calls.length, 1)
})

test('native remote actions: an in-flight request is never dispatched again after a reopen', async t => {
  const { view, machines, reopen } = await boot(t)
  // A dispatch that never settles: the process goes away underneath it.
  machines.on('browser_open', () => new Promise(() => {}))
  const args = { url: 'https://example.test/' }
  view.call('bot_browser_open', args, turn()).catch(() => {})
  assert.equal(machines.calls.length, 1)

  const after = reopen().forConversation('bot-a', 'conv-a')
  const again = await after.call('bot_browser_open', { ...args }, turn())
  assert.equal(again.status, 'unknown')
  assert.equal(again.value, null)
  assert.equal(again.error, 'NATIVE_REMOTE_OUTCOME_UNKNOWN')
  assert.ok(again.nextAction)
  assert.equal(machines.calls.length, 1)
  // The unsettled row still fences a different mutation of the same context.
  const blocked = await refusal(after.call('bot_browser_open', { url: 'https://example.test/' }, turn('turn-1', 'call-9')))
  assert.equal(blocked.code, 'NATIVE_REMOTE_OPERATION_PENDING')
  assert.equal(blocked.operationId, again.operationId)
})

test('native remote actions: an unknown mutation fences the next one until the Agent settles it', async t => {
  const { view, machines } = await boot(t)
  machines.artifact('artifact-1')
  let captures = 0
  machines.on('desktop_screenshot', () => { captures += 1; return { screenshotId: `screenshot-${captures}`, artifactId: 'artifact-1' } })
  machines.on('desktop_click', () => operation('desktop_click', 'unknown', null, 'OUTCOME_UNKNOWN'))
  machines.on('desktop_type', () => operation('desktop_type', 'succeeded', { completed: true }))
  const answers = ['running', 'succeeded']
  let answered = 0
  machines.on('operation_status', () => operation('desktop_click', answers[Math.min(answered++, answers.length - 1)], { completed: true }))

  const shot = await view.call('bot_desktop_screenshot', {}, turn())
  assert.equal(shot.status, 'succeeded')
  assert.equal(shot.value.screenshotId, 'screenshot-1')

  const click = await view.call('bot_desktop_click', { screenshotId: 'screenshot-1', x: 4, y: 5 }, turn('turn-1', 'call-2'))
  assert.equal(click.status, 'unknown')
  assert.equal(click.value, null)
  assert.equal(click.error, 'OUTCOME_UNKNOWN')
  assert.ok(click.nextAction)

  // The next mutation of the same Bot, conversation, machine and root is fenced by the original.
  const blocked = await refusal(view.call('bot_desktop_type', { screenshotId: 'screenshot-1', text: 'x' }, turn('turn-1', 'call-3')))
  assert.equal(blocked.code, 'NATIVE_REMOTE_OPERATION_PENDING')
  assert.equal(blocked.operationId, click.operationId)
  assert.equal(blocked.status, 'unknown')
  assert.ok(blocked.nextAction)

  // Only an actual Agent record can unblock it: a running operation does not.
  const running = await view.call('bot_remote_operation_status', { operationId: click.operationId }, turn('turn-2', 'call-1'))
  assert.equal(running.operationId, click.operationId)
  assert.equal(running.status, 'running')
  await refusal(view.call('bot_desktop_type', { screenshotId: 'screenshot-1', text: 'x' }, turn('turn-1', 'call-4')))

  const settled = await view.call('bot_remote_operation_status', { operationId: click.operationId }, turn('turn-2', 'call-2'))
  assert.equal(settled.status, 'succeeded')
  assert.deepEqual(settled.value, { completed: true })

  const typed = await view.call('bot_desktop_type', { screenshotId: 'screenshot-1', text: 'x' }, turn('turn-1', 'call-5'))
  assert.equal(typed.status, 'succeeded')
  // The status reads used the stored private target and the original operation id, never the caller's.
  const statuses = machines.calls.filter(call => call.input.tool === 'operation_status')
  assert.equal(statuses.length, 2)
  for (const call of statuses) {
    assert.equal(call.input.args.operationId, click.operationId)
    assert.equal(call.input.operationId, click.operationId)
    assert.equal(call.input.machineId, MACHINE)
    assert.equal(call.input.rootId, ROOT)
    assert.equal(call.input.taskId, shot.taskId)
  }
})

test('native remote actions: the fence covers one target, not every target of the Bot', async t => {
  const { view, machines } = await boot(t, {
    machine: { scopes: [
      { machineId: MACHINE, revision: 1, roots: [ROOT], tools: ALL_TOOLS, mode: 'workspace-write' },
      { machineId: MACHINE_TWO, revision: 1, roots: [ROOT], tools: ALL_TOOLS, mode: 'workspace-write' },
    ] },
  })
  machines.artifact(`artifact-${MACHINE}`)
  machines.artifact(`artifact-${MACHINE_TWO}`)
  machines.on('desktop_screenshot', input => ({ screenshotId: `screenshot-${input.machineId}`, artifactId: `artifact-${input.machineId}` }))
  machines.on('desktop_click', () => operation('desktop_click', 'unknown'))
  await view.call('bot_desktop_screenshot', { machineId: MACHINE }, turn())
  // The first click of this target is dispatched and comes back unsettled.
  const unsettled = await view.call('bot_desktop_click', { screenshotId: `screenshot-${MACHINE}`, x: 1, y: 1 }, turn('turn-1', 'call-2'))
  assert.equal(unsettled.status, 'unknown')
  assert.ok(unsettled.nextAction)
  const blocked = await refusal(view.call('bot_desktop_click', { screenshotId: `screenshot-${MACHINE}`, x: 1, y: 1 }, turn('turn-1', 'call-3')))
  assert.equal(blocked.code, 'NATIVE_REMOTE_OPERATION_PENDING')
  // A second machine is a different Agent identity, so it is not fenced by the first.
  const other = await view.call('bot_desktop_screenshot', { machineId: MACHINE_TWO }, turn('turn-1', 'call-4'))
  assert.equal(other.status, 'succeeded')
  assert.equal(other.value.screenshotId, `screenshot-${MACHINE_TWO}`)
})

test('native remote actions: a cancel reconciles the original row and reports the actual outcome', async t => {
  const { view, machines } = await boot(t)
  machines.artifact('artifact-1')
  let captures = 0
  machines.on('desktop_screenshot', () => { captures += 1; return { screenshotId: `screenshot-${captures}`, artifactId: 'artifact-1' } })
  machines.on('desktop_click', () => operation('desktop_click', 'unknown'))
  machines.on('operation_cancel', () => ({ cancelRequested: true, stopConfirmed: true, operation: operation('desktop_click', 'cancelled', { stopConfirmed: true, possiblyApplied: true }) }))
  await view.call('bot_desktop_screenshot', {}, turn())
  const click = await view.call('bot_desktop_click', { screenshotId: 'screenshot-1', x: 1, y: 1 }, turn('turn-1', 'call-2'))
  assert.equal(click.status, 'unknown')
  const cancelled = await view.call('bot_remote_operation_cancel', { operationId: click.operationId }, turn('turn-2', 'call-1'))
  assert.equal(cancelled.operationId, click.operationId)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.value.cancelRequested, true)
  assert.equal(cancelled.value.stopConfirmed, true)
  // A stop request is a stop request: the row keeps the Agent's own verdict, not a Host guess.
  const cancels = machines.calls.filter(call => call.input.tool === 'operation_cancel')
  assert.equal(cancels.length, 1)
  assert.equal(cancels[0].input.args.operationId, click.operationId)
  assert.equal(cancels[0].input.operationId, click.operationId)
  assert.equal(cancels[0].input.machineId, MACHINE)
})

test('native remote actions: a desktop screenshot is delivered over its original context', async t => {
  const { view, machines, rows } = await boot(t)
  const artifact = machines.artifact('artifact-1')
  let captures = 0
  machines.on('desktop_screenshot', () => {
    captures += 1
    return { screenshotId: `screenshot-${captures}`, artifactId: 'artifact-1', sha256: artifact.sha256, size: artifact.size, mediaType: 'image/png', width: 10, height: 10 }
  })
  const shot = await view.call('bot_desktop_screenshot', {}, turn())
  assert.equal(shot.status, 'succeeded')
  assert.deepEqual(shot.image, { mimeType: 'image/png', data: PNG.toString('base64') })
  assert.deepEqual(machines.downloads, [{
    machineId: MACHINE, rootId: ROOT, taskId: shot.taskId, attemptId: shot.attemptId, operationId: shot.operationId, artifactId: 'artifact-1',
  }])
  // Metadata and receipts are durable; the pixels are not.
  const stored = rows('native_remote_desktop_captures')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].screenshot_id, 'screenshot-1')
  assert.equal(stored[0].artifact_id, 'artifact-1')
  assert.equal(stored[0].sha256, artifact.sha256)
  assert.equal(stored[0].size, artifact.size)
  assert.equal(stored[0].media_type, 'image/png')
  const serialized = JSON.stringify([...rows('native_remote_requests'), ...rows('native_remote_browser_sessions'), ...stored])
  assert.equal(serialized.includes(PNG.toString('base64')), false)
  // A duplicate downloads the original artifact again and never recaptures.
  const again = await view.call('bot_desktop_screenshot', {}, turn())
  assert.deepEqual(again.image, shot.image)
  assert.equal(again.operationId, shot.operationId)
  assert.equal(machines.calls.filter(call => call.input.tool === 'desktop_screenshot').length, 1)
  assert.equal(machines.downloads.length, 2)
})

test('native remote actions: an artifact that is not a bounded PNG is refused', async t => {
  const { view, machines } = await boot(t)
  let captures = 0
  machines.on('desktop_screenshot', () => { captures += 1; return { screenshotId: `screenshot-${captures}`, artifactId: 'artifact-1' } })
  for (const [index, artifact] of [
    machines.artifact('artifact-1', NOT_PNG, 'image/png'),
    machines.artifact('artifact-1', PNG, 'image/jpeg'),
    machines.artifact('artifact-1', Buffer.alloc(6 * 1024 * 1024 + 1, 7)),
  ].entries()) {
    assert.ok(artifact)
    const error = await refusal(view.call('bot_desktop_screenshot', {}, turn('turn-1', `call-${index}`)))
    assert.ok(['NATIVE_REMOTE_IMAGE_INVALID', 'NATIVE_REMOTE_IMAGE_LIMIT'].includes(error.code), error.code)
  }
  assert.equal(machines.calls.length, 3)
  assert.equal(machines.downloads.length, 3)
})

test('native remote actions: a desktop action needs a screenshot this context captured', async t => {
  const { view, otherConversation, machines } = await boot(t)
  machines.artifact('artifact-1')
  let captures = 0
  machines.on('desktop_screenshot', () => { captures += 1; return { screenshotId: `screenshot-${captures}`, artifactId: 'artifact-1' } })
  machines.on('desktop_click', () => operation('desktop_click', 'succeeded', { completed: true }))
  await view.call('bot_desktop_screenshot', {}, turn())
  const dispatched = machines.calls.length

  const foreign = await refusal(otherConversation.call('bot_desktop_click', { screenshotId: 'screenshot-1', x: 1, y: 1 }, turn('turn-9', 'call-1')))
  assert.equal(foreign.code, 'NATIVE_REMOTE_SCREENSHOT_UNKNOWN')
  const invented = await refusal(view.call('bot_desktop_click', { screenshotId: 'screenshot-invented', x: 1, y: 1 }, turn('turn-9', 'call-2')))
  assert.equal(invented.code, 'NATIVE_REMOTE_SCREENSHOT_UNKNOWN')
  const mismatch = await refusal(view.call('bot_desktop_click', { screenshotId: 'screenshot-1', x: 1, y: 1, machineId: 'machine-zzz' }, turn('turn-9', 'call-3')))
  assert.equal(mismatch.code, 'MACHINE_NOT_BOUND')
  assert.equal(machines.calls.length, dispatched)
})

test('native remote actions: a revoked grant or scope refuses before dispatch', async t => {
  const { view, machines, directory } = await boot(t)
  machines.artifact('artifact-1')
  machines.on('desktop_screenshot', () => ({ screenshotId: 'screenshot-1', artifactId: 'artifact-1' }))
  machines.on('desktop_click', () => operation('desktop_click', 'succeeded', { completed: true }))
  await view.call('bot_desktop_screenshot', {}, turn())
  const dispatched = machines.calls.length
  const args = { screenshotId: 'screenshot-1', x: 1, y: 1 }

  // The pairing is withdrawn: the tool is simply no longer this Bot's.
  machines.state.tools.delete('desktop_click')
  assert.equal((await refusal(view.call('bot_desktop_click', args, turn('turn-2', 'call-1')))).code, 'MACHINE_BOT_DENIED')
  // The pairing becomes read-only, so a workspace-write effect is refused.
  machines.state.tools.add('desktop_click')
  machines.state.mode = 'read-only'
  assert.equal((await refusal(view.call('bot_desktop_click', args, turn('turn-2', 'call-2')))).code, 'MACHINE_BOT_DENIED')
  machines.state.mode = 'workspace-write'
  // The authority grant is replaced: the tool leaves the request and the call.
  directory.replaceGrant('bot-a', { tools: [], modelRoutes: [] })
  assert.equal((await refusal(view.call('bot_desktop_click', args, turn('turn-2', 'call-3')))).code, 'TOOL_DENIED')
  // A subject that no longer exists is refused as such.
  directory.retire('bot-a')
  assert.equal((await refusal(view.call('bot_desktop_click', args, turn('turn-2', 'call-4')))).code, 'UNKNOWN_BOT')
  assert.equal(machines.calls.length, dispatched)
})

test('native remote actions: a grant withdrawn between dispatch and delivery is not delivered', async t => {
  const { view, machines } = await boot(t)
  const artifact = machines.artifact('artifact-1')
  machines.on('desktop_screenshot', () => {
    // The pairing changes while the capture is in flight, exactly as a revoke would.
    machines.state.tools.delete('desktop_screenshot')
    return { screenshotId: 'screenshot-1', artifactId: 'artifact-1', sha256: artifact.sha256, size: artifact.size, mediaType: 'image/png' }
  })
  const shot = await view.call('bot_desktop_screenshot', {}, turn())
  assert.equal(shot.status, 'succeeded')
  assert.equal(shot.value, null)
  assert.equal(shot.error, 'NATIVE_REMOTE_AUTHORITY_LOST')
  assert.ok(shot.nextAction)
  // The effect is durably recorded and its artifact is not fetched under a withdrawn grant.
  assert.equal(machines.downloads.length, 0)
})

test('native remote actions: a turn cancelled before dispatch never reaches the machine', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  const controller = new AbortController()
  controller.abort()
  const error = await refusal(view.call('bot_browser_open', { url: 'https://example.test/' }, turn('turn-1', 'call-1', controller.signal)))
  assert.equal(error.code, 'NATIVE_REMOTE_CANCELLED')
  assert.equal(machines.calls.length, 0)
})

test('native remote actions: a dispatch that may have happened stays unknown', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', () => { throw Object.assign(new Error('MACHINE_CONNECTION_FAILED'), { code: 'MACHINE_CONNECTION_FAILED', remoteDispatchNotSent: false }) })
  const unknown = await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.value, null)
  assert.equal(unknown.error, 'MACHINE_CONNECTION_FAILED')
  assert.ok(unknown.operationId)
  assert.ok(unknown.nextAction)
  // A refusal proven not sent is a failure, and it carries no next action. The unknown row above
  // still fences every further mutation, so it is reconciled by an actual Agent record first.
  machines.on('operation_status', () => operation('browser_open', 'failed', null, 'MACHINE_CONNECTION_FAILED'))
  const reconciled = await view.call('bot_remote_operation_status', { operationId: unknown.operationId }, turn('turn-2', 'call-1'))
  assert.equal(reconciled.status, 'failed')
  machines.on('browser_open', () => { throw Object.assign(new Error('MACHINE_CONNECTION_FAILED'), { code: 'MACHINE_CONNECTION_FAILED', remoteDispatchNotSent: true }) })
  const failed = await view.call('bot_browser_open', { url: 'https://example.test/' }, turn('turn-2', 'call-2'))
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, 'MACHINE_CONNECTION_FAILED')
  assert.equal(failed.nextAction, undefined)
  assert.equal(machines.calls.filter(call => call.input.tool === 'browser_open').length, 2)
})

test('native remote actions: an Agent refusal settles, a lost answer does not', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  machines.on('browser_click', () => operation('browser_click', 'failed', null, 'TARGET_STALE'))
  await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  // The Agent answered and its own journal holds a terminal verdict, so the next mutation of the same
  // context is not fenced behind it.
  const stale = await view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '1' }, turn('turn-1', 'call-2'))
  assert.equal(stale.status, 'failed')
  assert.equal(stale.error, 'TARGET_STALE')
  assert.equal(stale.nextAction, undefined)
  const after = await view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '2' }, turn('turn-1', 'call-3'))
  assert.equal(after.status, 'failed')
  assert.equal(after.error, 'TARGET_STALE')
  // The same error code with a lost response is the opposite: the Agent recorded nothing.
  machines.on('browser_click', () => { throw Object.assign(new Error('MACHINE_CONNECTION_FAILED'), { code: 'MACHINE_CONNECTION_FAILED', remoteDispatchNotSent: false }) })
  const lost = await view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '3' }, turn('turn-1', 'call-4'))
  assert.equal(lost.status, 'unknown')
  assert.ok(lost.nextAction)
  const blocked = await refusal(view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '4' }, turn('turn-1', 'call-5')))
  assert.equal(blocked.code, 'NATIVE_REMOTE_OPERATION_PENDING')
  assert.equal(blocked.operationId, lost.operationId)
  // An Agent code that means the Agent itself could not prove the outcome stays unknown too. The
  // lost-response fence is released first, by an actual Agent record.
  machines.on('browser_click', () => { throw Object.assign(new Error('OUTCOME_UNKNOWN'), { code: 'OUTCOME_UNKNOWN', remoteDispatchNotSent: false }) })
  machines.on('operation_status', () => operation('browser_click', 'failed', null, 'OUTCOME_UNKNOWN'))
  const settledLost = await view.call('bot_remote_operation_status', { operationId: lost.operationId }, turn('turn-2', 'call-1'))
  assert.equal(settledLost.status, 'failed')
  const unproven = await view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '5' }, turn('turn-1', 'call-6'))
  assert.equal(unproven.status, 'unknown')
  await refusal(view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '6' }, turn('turn-1', 'call-7')))
  const reconciled = await view.call('bot_remote_operation_status', { operationId: unproven.operationId }, turn('turn-2', 'call-2'))
  assert.equal(reconciled.status, 'failed')
  const released = await view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '7' }, turn('turn-1', 'call-8'))
  assert.equal(released.status, 'unknown')
})

test('native remote actions: an operation that was never issued is not readable', async t => {  const { view, otherConversation, machines } = await boot(t)
  // The reader is offered, but an operation id this Host never issued is refused before dispatch.
  assert.equal(view.schemas().some(schema => schema.name === 'bot_remote_operation_status'), true)
  machines.on('operation_status', () => operation('desktop_click', 'succeeded'))
  const error = await refusal(view.call('bot_remote_operation_status', { operationId: 'nro-not-issued' }, turn()))
  assert.equal(error.code, 'NATIVE_REMOTE_OPERATION_UNKNOWN')
  assert.equal(machines.calls.length, 0)
  // An operation id this Host did issue for another conversation is not this conversation's either.
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  const opened = await view.call('bot_browser_open', { url: 'https://example.test/' }, turn('turn-2', 'call-1'))
  const foreign = await refusal(otherConversation.call('bot_remote_operation_status', { operationId: opened.operationId }, turn('turn-3', 'call-1')))
  assert.equal(foreign.code, 'NATIVE_REMOTE_OPERATION_UNKNOWN')
  assert.equal(machines.calls.length, 1)
})

test('native remote actions: the target is the named granted one, or the first live match', async t => {
  const { view, machines } = await boot(t, {
    machine: { scopes: [
      { machineId: MACHINE, revision: 1, roots: [ROOT, ROOT_TWO], tools: ALL_TOOLS, mode: 'workspace-write' },
      { machineId: MACHINE_TWO, revision: 1, roots: [ROOT], tools: ['browser_snapshot'], mode: 'read-only' },
    ] },
  })
  machines.artifact('artifact-1')
  machines.on('desktop_screenshot', input => ({ screenshotId: `screenshot-${input.machineId}-${input.rootId}`, artifactId: 'artifact-1' }))
  const first = await view.call('bot_desktop_screenshot', {}, turn())
  assert.equal(first.value.screenshotId, `screenshot-${MACHINE}-${ROOT}`)
  const named = await view.call('bot_desktop_screenshot', { machineId: MACHINE, rootId: ROOT_TWO }, turn('turn-1', 'call-2'))
  assert.equal(named.value.screenshotId, `screenshot-${MACHINE}-${ROOT_TWO}`)
  // The second machine only holds a read-only snapshot grant, so a screenshot there is refused.
  assert.equal((await refusal(view.call('bot_desktop_screenshot', { machineId: MACHINE_TWO }, turn('turn-1', 'call-3')))).code, 'MACHINE_BOT_DENIED')
  // A root or machine this Bot was never granted is refused before dispatch.
  assert.equal((await refusal(view.call('bot_desktop_screenshot', { rootId: 'elsewhere' }, turn('turn-1', 'call-4')))).code, 'MACHINE_ROOT_NOT_BOUND')
  assert.equal((await refusal(view.call('bot_desktop_screenshot', { machineId: 'machine-zzz' }, turn('turn-1', 'call-5')))).code, 'MACHINE_NOT_BOUND')
  assert.equal(machines.calls.length, 2)
})

test('native remote actions: only business arguments cross the boundary', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', input => ({ browserSessionId: `browser-${machines.calls.length}`, url: input.args.url }))
  const ok = await view.call('bot_browser_open', { url: 'https://example.test/', machineId: MACHINE, rootId: ROOT }, turn())
  assert.equal(ok.status, 'succeeded')
  assert.deepEqual(machines.calls[0].input.args, { url: 'https://example.test/' })
  assert.equal(machines.calls[0].input.machineId, MACHINE)
  assert.equal(machines.calls[0].input.rootId, ROOT)
  const invalid = [
    {}, { url: 'https://example.test/', botId: 'bot-a' }, { url: 'https://example.test/', taskId: 'nrt-x' },
    { url: 'https://example.test/', operationId: 'nro-x' }, { url: 'https://example.test/', endpoint: 'https://x.test' },
    { url: 'https://example.test/', secretRef: 'ds-secret/X' }, { url: 'https://example.test/', profileId: 'p'.repeat(129) },
    { url: 'https://example.test/', extra: 1 }, { url: 7 }, { url: 'https://example.test/', machineId: 7 },
    { url: 'https://example.test\u0000/' },
  ]
  for (const [index, args] of invalid.entries()) {
    const error = await refusal(view.call('bot_browser_open', args, turn('turn-2', `call-${index}`)))
    assert.equal(error.code, 'INVALID_TOOL_ARGS', JSON.stringify(args))
  }
  await view.call('bot_browser_open', { url: 'https://example.test' }, turn('turn-3', 'call-1'))
  await view.call('bot_browser_open', { url: 'https://example.test/', profileId: 'profile.one' }, turn('turn-3', 'call-2'))
  assert.equal(machines.calls.length, 3)
})

test('native remote actions: the desktop argument bounds are enforced before dispatch', async t => {
  const { view, machines } = await boot(t)
  machines.artifact('artifact-1')
  machines.on('desktop_screenshot', () => ({ screenshotId: 's', artifactId: 'artifact-1' }))
  await view.call('bot_desktop_screenshot', {}, turn('turn-0', 'call-0'))
  machines.on('desktop_click', () => operation('desktop_click', 'succeeded', { completed: true }))
  machines.on('desktop_key', () => operation('desktop_key', 'succeeded', { completed: true }))
  machines.on('desktop_scroll', () => operation('desktop_scroll', 'succeeded', { completed: true }))
  const ok = await view.call('bot_desktop_click', { screenshotId: 's', x: 1, y: 2, button: 'right', clickCount: 3 }, turn())
  assert.equal(ok.status, 'succeeded')
  assert.deepEqual(machines.calls.at(-1).input.args, { screenshotId: 's', x: 1, y: 2, button: 'right', clickCount: 3 })
  for (const [index, args] of [
    { screenshotId: 's', x: 1 }, { screenshotId: 's', x: -1, y: 1 }, { screenshotId: 's', x: 1, y: 1, button: 'double' },
    { screenshotId: 's', x: 1, y: 1, clickCount: 9 }, { screenshotId: 's', x: '1', y: 1 },
  ].entries()) {
    const error = await refusal(view.call('bot_desktop_click', args, turn('turn-2', `call-${index}`)))
    assert.equal(error.code, 'INVALID_TOOL_ARGS', JSON.stringify(args))
  }
  const keys = await view.call('bot_desktop_key', { screenshotId: 's', key: 'Enter', modifiers: ['ctrl', 'shift'] }, turn('turn-3', 'call-1'))
  assert.equal(keys.status, 'succeeded')
  assert.deepEqual(machines.calls.at(-1).input.args, { screenshotId: 's', key: 'Enter', modifiers: ['ctrl', 'shift'] })
  for (const [index, args] of [
    { screenshotId: 's', key: 'F13' }, { screenshotId: 's', key: 'Enter', modifiers: ['ctrl', 'ctrl'] },
    { screenshotId: 's', key: 'Enter', modifiers: ['ctrl', 'alt', 'shift', 'win'] }, { screenshotId: 's', key: 13 },
  ].entries()) {
    const error = await refusal(view.call('bot_desktop_key', args, turn('turn-4', `call-${index}`)))
    assert.equal(error.code, 'INVALID_TOOL_ARGS', JSON.stringify(args))
  }
  const scroll = await view.call('bot_desktop_scroll', { screenshotId: 's', delta: -120, x: 3, y: 4 }, turn('turn-5', 'call-1'))
  assert.equal(scroll.status, 'succeeded')
  assert.deepEqual(machines.calls.at(-1).input.args, { screenshotId: 's', delta: -120, x: 3, y: 4 })
  for (const [index, args] of [{ screenshotId: 's', delta: 1201 }, { screenshotId: 's', delta: 0.5 }].entries()) {
    const error = await refusal(view.call('bot_desktop_scroll', args, turn('turn-6', `call-${index}`)))
    assert.equal(error.code, 'INVALID_TOOL_ARGS', JSON.stringify(args))
  }
  assert.equal(machines.calls.length, 4)
})

test('native remote actions: a read-only pairing may still snapshot the page it opened', async t => {
  const { view, machines } = await boot(t, { machine: { tools: BROWSER_TOOLS, mode: 'workspace-write' } })
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  machines.on('browser_snapshot', input => ({ browserSessionId: input.args.browserSessionId, snapshotId: 'snapshot-1', text: 'x', nodes: [] }))
  machines.on('browser_click', () => operation('browser_click', 'succeeded', { completed: true }))
  await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  machines.state.mode = 'read-only'
  const snapshot = await view.call('bot_browser_snapshot', { browserSessionId: 'browser-1' }, turn('turn-1', 'call-2'))
  assert.equal(snapshot.status, 'succeeded')
  assert.equal(snapshot.operationId, null)
  assert.equal(snapshot.taskId, machines.calls[0].input.taskId)
  // The same pairing now refuses the workspace-write effect.
  const blocked = await refusal(view.call('bot_browser_click', { browserSessionId: 'browser-1', snapshotId: 'snapshot-1', ref: '1' }, turn('turn-1', 'call-3')))
  assert.equal(blocked.code, 'MACHINE_BOT_DENIED')
  assert.equal(machines.calls.length, 2)
})

test('native remote actions: a missing turn identity is a refusal, not a generated one', async t => {
  const { view, machines } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1' }))
  for (const context of [{}, { turnId: 'turn-1' }, { callId: 'call-1' }, { turnId: '', callId: 'call-1' }, { turnId: 'turn-1', callId: 'x'.repeat(300) }]) {
    const error = await refusal(view.call('bot_browser_open', { url: 'https://example.test/' }, context))
    assert.equal(error.code, 'NATIVE_REMOTE_TURN_REQUIRED')
  }
  const unknown = await refusal(view.call('bot_browser_script', {}, turn()))
  assert.equal(unknown.code, 'TOOL_NOT_GRANTED')
  assert.equal(machines.calls.length, 0)
})

test('native remote actions: a closed service refuses further calls and keeps its rows', async t => {
  const { view, machines, actions, rows } = await boot(t)
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  actions.close()
  const error = await refusal(view.call('bot_browser_open', { url: 'https://example.test/' }, turn('turn-2', 'call-1')))
  assert.equal(error.code, 'NATIVE_REMOTE_JOURNAL_CLOSED')
  assert.equal(machines.calls.length, 1)
  assert.equal(rows('native_remote_requests').length, 1)
  assert.equal(rows('native_remote_browser_sessions').length, 1)
})

test('native remote actions: an in-memory file and a machine resolver are both accepted', async t => {
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: GRANTS, modelRoutes: [] })
  const machines = createMachines()
  machines.on('browser_open', () => ({ browserSessionId: 'browser-1', url: 'https://example.test/' }))
  // `machines` may be the directory itself or a zero-argument resolver, and the file may be `:memory:`.
  const actions = openNativeRemoteActions({ Database, file: ':memory:', directory, authority, machines: () => machines })
  t.after(() => actions.close())
  const view = actions.forConversation('bot-a', 'conv-a')
  assert.equal(view.schemas().length, NATIVE_REMOTE_TOOLS.length)
  const opened = await view.call('bot_browser_open', { url: 'https://example.test/' }, turn())
  assert.equal(opened.status, 'succeeded')
  assert.equal(machines.calls.length, 1)
})
