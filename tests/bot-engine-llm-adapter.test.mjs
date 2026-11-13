// Offline (no child process) tests for the Claude retained-session LLM bridge.
//
// The bridge's own logic is exercised here against an in-memory engine factory that
// reproduces the parts of `createClaudeEngine` the bridge depends on: one turn slot, a
// settlement that runs the Host `onSettle` hook before the turn promise resolves, delta /
// assistant / tool events, and a `stop()` that settles an in-flight turn as cancelled.
// No process, no network, no credentials. The real Cordis + LlmRuntime + real engine +
// real native supervisor evidence lives in tests/bot-engine-llm-adapter.native.mjs.

import { EventEmitter } from 'node:events'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createClaudeLlmAdapter } from '../packages/bot-engines/src/claude-llm-adapter.mjs'

const PROVIDER = 'claude-session'
const MODEL = 'fixture-model-a'
const PERSONA = 'You are Fixture Bot.'
const ISOLATED = fileURLToPath(new URL('../tmp/integration/bot-engine-llm/', import.meta.url))
const coded = (code, message) => Object.assign(new Error(message ?? code), { code })

const userMessage = (text, id = null) => (id === null
  ? { role: 'user', content: [{ type: 'text', text }] }
  : { id, role: 'user', content: [{ type: 'text', text }] })
const ownAssistant = (text, id) => ({ id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: PROVIDER, model: MODEL } })
const foreignAssistant = (text, id) => ({ id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'alpha', model: 'one' } })
const systemMessage = (text = PERSONA) => ({ id: `system-${text.length}`, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text }] })

/** The in-memory retained engine. `script` decides what one turn does. */
function fakeEngineFactory({ script = async (input, emit) => { emit.delta(`reply ${input.text}`) }, result = {}, onCreate = () => {}, gated = false } = {}) {
  const created = []
  let openGate = null, started = 0
  const factory = async config => {
    started++
    if (gated) await new Promise(resolve => { openGate = resolve })
    const events = new EventEmitter()
    let closed = false, current = null, count = 0, announced = false
    const stopWaiters = []
    const stopEvidence = { status: 'confirmed', treeStopped: true, reason: 'fake', pid: 4242, exitCode: 0, nativeStopReason: 'fake-tree-accounting', containment: 'fake-job-object', forcedKill: false, stopRequestedIsNotConfirmation: true }
    const engine = {
      driver: 'claude', events, config,
      submitted: [],
      get closed() { return closed },
      get sessionId() { return 'fx-session-1' },
      submitTurn(input, controls) {
        if (closed) return Promise.reject(coded('ENGINE_STOPPED'))
        if (current) return Promise.reject(coded('ENGINE_TURN_IN_PROGRESS'))
        count++
        const turn = { turnId: `t-${count}`, dispatched: true }
        current = turn
        engine.submitted.push(input.text)
        engine.lastControls = controls
        const emit = {
          delta: text => events.emit('delta', { streamKind: 'assistant_text', delta: text }),
          reasoning: text => events.emit('delta', { streamKind: 'reasoning_text', delta: text }),
          assistant: text => events.emit('assistant', { text }),
          tool: name => events.emit('tool', { phase: 'started', id: `tu-${name}`, name }),
          activity: value => events.emit('activity', value),
          session: () => events.emit('session', { sessionId: 'fx-session-1', requestedModel: config.model.catalogModel, reportedModel: config.model.catalogModel, verification: 'init-confirmed' }),
        }
        return (async () => {
          if (!announced) { announced = true; emit.session() }
          const control = {
            turnId: turn.turnId, ok: true, outcome: 'succeeded', stopReason: null, dispatched: true, errorText: null,
            usage: { input: 12, output: 5, cachedInput: 3 }, usageStatus: 'reported', ...result,
            untilStopped: () => new Promise(resolve => { if (closed) resolve(); else stopWaiters.push(resolve) }),
          }
          try { await script(input, emit, control) } catch (error) {
            control.ok = false; control.outcome = 'failed'; control.stopReason = 'script-failed'; control.errorText = String(error?.message ?? error)
          }
          if (closed) {
            control.ok = false
            control.outcome = control.dispatched ? 'unknown' : 'cancelled'
            control.stopReason ??= 'engine-stopped'
          }
          const turnResult = {
            schemaVersion: 1, turnId: turn.turnId, operationId: config.operationId, driver: 'claude',
            ok: control.ok, outcome: control.outcome, stopReason: control.stopReason, sessionId: 'fx-session-1',
            usage: control.usage, usageStatus: control.usageStatus, costUsd: null, costStatus: 'unknown',
            billing: config.billing, turnsDispatched: count, dispatched: control.dispatched, errorText: control.errorText,
          }
          await config.hooks?.onSettle?.(turnResult)
          current = null
          return turnResult
        })()
      },
      stop(reason = 'host-stop') {
        if (!closed) {
          closed = true
          for (const waiter of stopWaiters.splice(0)) waiter()
          events.emit('tree-stopped', { ...stopEvidence, reason })
        }
        return Promise.resolve(stopEvidence)
      },
      snapshot() { return Object.freeze({ closed, sessionId: 'fx-session-1', turn: current ? { turnId: current.turnId } : null }) },
    }
    created.push(engine)
    onCreate(config, engine)
    return engine
  }
  return { factory, created, open: () => openGate?.(), started: () => started }
}

const ENTRY = Object.freeze({ executable: 'C:/pinned/claude.exe', sha256: 'a'.repeat(64), version: '1.2.3' })

/** One trusted Host per test: a real authority, a committed subject, isolated absolute dirs. */
async function makeHost({ botId = 'bot-a', persona = PERSONA } = {}) {
  await mkdir(ISOLATED, { recursive: true })
  const root = await mkdtemp(join(ISOLATED, 'pure-'))
  await mkdir(join(root, 'ws'), { recursive: true })
  const workspace = await realpath(join(root, 'ws'))
  const authority = createAuthority()
  const subject = {}
  authority.register(subject, { botId, tools: ['read_notes'], modelRoutes: [{ provider: PROVIDER, model: MODEL }] })
  const identity = {
    subject, botId, authority,
    binding: { taskId: 'task-a', attemptId: 'att-a', machineId: 'mach-local', workspaceId: 'wsid-a', location: 'local' },
    ...(persona === null ? {} : { persona }),
  }
  const holder = { identity }
  return {
    root, workspace, runtimeRoot: join(root, 'runtime'), authority, subject, identity,
    /** The adapter holds this one indirection, so a test can change the committed identity. */
    identityFor: () => holder.identity,
    setIdentity: next => { holder.identity = next },
  }
}

/** Build one adapter over one Host; the engine factory seam is the test's own. */
async function makeAdapter(host, { engine, ...overrides } = {}) {
  const seam = engine ?? fakeEngineFactory()
  const adapter = createClaudeLlmAdapter({
    provider: PROVIDER, model: MODEL, funding: 'subscription',
    ...(overrides.entryFor ? {} : { entry: ENTRY }),
    runtimeRoot: host.runtimeRoot, workspace: host.workspace,
    identityFor: host.identityFor, engineFactory: seam.factory, ...overrides,
  })
  return { adapter, seam }
}

const drain = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks }
const streamOf = async (adapter, options) => drain((await adapter.prepareCall(PROVIDER, MODEL)).stream(options))
const preparedStream = async (adapter, options) => (await adapter.prepareCall(PROVIDER, MODEL)).stream(options)
const finishOf = chunks => { const last = chunks.at(-1); assert.equal(last?.type, 'finish', 'a turn always ends with exactly one finish chunk'); return last }
const failureOf = chunks => finishOf(chunks).reason.failure
const textOf = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')

test('Host metered native route exposes its bound, forwards the exact cap and refuses funding changes', async () => {
  const host = await makeHost(), { adapter, seam } = await makeAdapter(host, { funding: 'api', nativeSession: true, metered: { contextWindow: 1048576, maxOutputTokens: 4096 } })
  try {
    const model = await adapter.resolveModel(PROVIDER, MODEL)
    assert.equal(model.context.contextWindow, 1048576); assert.equal(model.defaultMaxTokens, 4096)
    const options = { provider: PROVIDER, model: MODEL, messages: [userMessage('paid fixture', 'metered-1')], maxTokens: 32 }
    assert.equal(finishOf(await streamOf(adapter, options)).reason.kind, 'stop')
    assert.deepEqual(seam.created[0].lastControls, { maxTokens: 32 })
    const invalid = await streamOf(adapter, { ...options, maxTokens: 4097 })
    assert.equal(failureOf(invalid).code, 'CLI_METERED_OUTPUT_LIMIT'); assert.equal(seam.created[0].submitted.length, 1)
    assert.throws(() => adapter.replaceRoute({ funding: 'subscription' }), { code: 'CLAUDE_ROUTE_FUNDING_REFUSED' })
  } finally { await adapter.close() }
})

describe('native activity is a Host display observation', () => {
  test('observations retain Host scope and never emit executable tool chunks or raw payloads', async () => {
    const host = await makeHost(), observations = []
    const seam = fakeEngineFactory({ script: async (_input, emit, control) => {
      const identity = { turnId: control.turnId, processGeneration: 'native-fixture-generation' }
      emit.activity({ ...identity, kind: 'turn-open', botId: 'forged' })
      emit.activity({ ...identity, kind: 'tool', tool: { phase: 'started', id: 'call-1', name: 'read_notes', input: { secret: 'raw-secret' } } })
      emit.activity({ ...identity, kind: 'tool', tool: { phase: 'completed', id: 'call-1', ok: true, result: 'raw-secret' } })
      emit.activity({ ...identity, kind: 'turn-close', outcome: 'succeeded' })
      emit.delta('observed answer')
    } })
    const { adapter } = await makeAdapter(host, { engine: seam,
      identityFor: () => ({ ...host.identity, independent: true, conversationId: 'ctx-observed' }),
      onActivity: event => observations.push(event) })
    try {
      const chunks = await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [systemMessage(), userMessage('observe', 'm-observe')] })
      assert.equal(finishOf(chunks).reason.kind, 'stop')
      assert.equal(textOf(chunks), 'observed answer')
      assert.equal(chunks.some(chunk => chunk.type.startsWith('tool-')), false)
      assert.equal(observations.length, 4)
      assert.ok(observations.every(event => event.identity.botId === 'bot-a' && event.identity.conversationId === 'ctx-observed' && event.identity.mode === 'independent'))
      assert.equal(JSON.stringify(observations).includes('raw-secret'), false)
      assert.equal(JSON.stringify(observations).includes('forged'), false)
      assert.deepEqual(seam.created[0].submitted, ['observe'])
    } finally { await adapter.close() }
  })

  test('a failed display sink is observable and changes neither answer nor unique settlement', async () => {
    const host = await makeHost()
    let settlements = 0
    const seam = fakeEngineFactory({ script: async (_input, emit, control) => {
      emit.activity({ kind: 'turn-open', turnId: control.turnId, processGeneration: 'native-failed-sink' })
      emit.delta('answer still belongs to the model')
      emit.activity({ kind: 'turn-close', turnId: control.turnId, processGeneration: 'native-failed-sink', outcome: 'succeeded' })
    } })
    const { adapter } = await makeAdapter(host, { engine: seam,
      identityFor: () => ({ ...host.identity, conversationId: 'host-observed' }),
      hooks: { onSettle: () => { settlements++ } }, onActivity: () => { throw new Error('display failed') } })
    try {
      const chunks = await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [systemMessage(), userMessage('observe failure', 'm-failure')] })
      assert.equal(finishOf(chunks).reason.kind, 'stop')
      assert.equal(textOf(chunks), 'answer still belongs to the model')
      assert.equal(settlements, 1)
      assert.equal(seam.created[0].submitted.length, 1)
      assert.equal(adapter.snapshot().activityObserverFailures, 2)
    } finally { await adapter.close() }
  })

  test('a live request cancellation is recorded before separate stop evidence', async () => {
    const host = await makeHost(), observations = [], controller = new AbortController()
    let started
    const ready = new Promise(resolve => { started = resolve })
    const seam = fakeEngineFactory({ onCreate: (_config, engine) => {
      engine.events.on('tree-stopped', () => engine.events.emit('activity', { kind: 'stop-confirmed', turnId: 't-1', processGeneration: 'native-cancel-generation' }))
    }, script: async (_input, emit, control) => {
      emit.activity({ kind: 'turn-open', turnId: control.turnId, processGeneration: 'native-cancel-generation' })
      started()
      await control.untilStopped()
      emit.activity({ kind: 'turn-close', turnId: control.turnId, processGeneration: 'native-cancel-generation', outcome: 'unknown' })
    } })
    const { adapter } = await makeAdapter(host, { engine: seam,
      identityFor: () => ({ ...host.identity, conversationId: 'host-cancelled' }), onActivity: event => observations.push(event) })
    try {
      const pending = streamOf(adapter, { provider: PROVIDER, model: MODEL, signal: controller.signal, messages: [systemMessage(), userMessage('hold for cancel', 'm-cancel')] })
      await ready
      controller.abort()
      const chunks = await pending
      assert.equal(finishOf(chunks).reason.kind, 'aborted')
      const kinds = observations.map(row => row.kind)
      assert.ok(kinds.indexOf('cancel-requested') > kinds.indexOf('turn-open'))
      assert.ok(kinds.indexOf('stop-confirmed') > kinds.indexOf('cancel-requested'))
      assert.deepEqual(seam.created[0].submitted, ['hold for cancel'])
    } finally { await adapter.close() }
  })
})

describe('claude llm bridge: route declaration', () => {
  test('the route advertises exactly the committed model and no invented capacities', async () => {
    const { adapter } = await makeAdapter(await makeHost())
    assert.deepEqual(await adapter.listModels(PROVIDER), [{
      provider: PROVIDER, id: MODEL, name: MODEL,
      description: 'Claude 订阅会话路由：一次一条新的用户文本，保留一个原生 CLI 会话。',
      inputModalities: ['text'],
    }])
    const info = await adapter.resolveModel(PROVIDER, MODEL)
    assert.deepEqual(info.inputModalities, ['text'])
    assert.equal(info.context, undefined, 'no context window is invented for a subscription CLI session')
    assert.equal(info.defaultMaxTokens, undefined, 'no output cap is invented')
    assert.equal(info.reasoning, undefined, 'no selectable reasoning efforts are claimed')
    const native = (await makeAdapter(await makeHost(), { nativeSession: true })).adapter
    assert.match((await native.listModels(PROVIDER))[0].description, /^原生订阅/)
    assert.match((await native.resolveModel(PROVIDER, MODEL)).description, /^原生订阅/)
    await assert.rejects(() => adapter.resolveModel(PROVIDER, 'other-model'), { code: 'CLAUDE_MODEL_NOT_CONFIGURED' })
  })

  test('only an explicitly configured subscription route may be constructed', async () => {
    const host = await makeHost()
    assert.throws(() => createClaudeLlmAdapter({
      provider: PROVIDER, model: MODEL, funding: 'api', entry: ENTRY, runtimeRoot: host.runtimeRoot,
      workspace: host.workspace, identityFor: host.identityFor,
    }), { code: 'CLAUDE_ROUTE_FUNDING_REFUSED' })
    assert.throws(() => createClaudeLlmAdapter({
      provider: PROVIDER, model: MODEL, funding: 'subscription', entry: ENTRY, runtimeRoot: host.runtimeRoot,
      workspace: 'relative/ws', identityFor: host.identityFor,
    }), { code: 'CLAUDE_ROUTE_WORKSPACE_REQUIRED_ABSOLUTE' })
    assert.throws(() => createClaudeLlmAdapter({
      provider: PROVIDER, model: MODEL, funding: 'subscription', entry: ENTRY, runtimeRoot: host.runtimeRoot,
      workspace: host.workspace,
    }), { code: 'CLAUDE_ROUTE_IDENTITY_RESOLVER_REQUIRED' })
    assert.throws(() => createClaudeLlmAdapter({
      provider: PROVIDER, model: MODEL, funding: 'subscription', entry: { ...ENTRY, sha256: 'short' },
      runtimeRoot: host.runtimeRoot, workspace: host.workspace, identityFor: host.identityFor,
    }), { code: 'CLAUDE_ROUTE_ENTRY_INVALID' })
  })

  test('a committed funding read that is not a subscription refuses the prepared call before any engine exists', async () => {
    const host = await makeHost()
    const { adapter, seam } = await makeAdapter(host, { engine: fakeEngineFactory(), fundingFor: async () => 'api' })
    await assert.rejects(() => adapter.prepareCall(PROVIDER, MODEL), { code: 'CLAUDE_ROUTE_FUNDING_REFUSED' })
    assert.deepEqual(seam.created, [], 'an API-funded CLI route is refused before anything is created')
  })
})

describe('claude llm bridge: request capability gate', () => {
  const cases = {
    tools: [{ name: 'x', description: 'x', parameters: {} }],
    toolHistory: { tools: [], updates: [] },
    maxTokens: 128,
    reasoningEffort: 'high',
    temperature: 0.5,
    stop: ['END'],
    purpose: 'compaction',
  }
  for (const [field, value] of Object.entries(cases)) {
    test(`a request carrying ${field} is refused by name, not ignored`, async () => {
      const { adapter, seam } = await makeAdapter(await makeHost())
      const failure = failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [userMessage('hi')], [field]: value }))
      assert.equal(failure.code, 'CLAUDE_ROUTE_CAPABILITY_REFUSED')
      assert.match(failure.message, new RegExp(field))
      assert.deepEqual(seam.created, [], 'a refused request creates no engine')
    })
  }

  test('a request carrying identity, path or credential fields is refused at the trust boundary', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    const failure = failureOf(await streamOf(adapter, {
      provider: PROVIDER, model: MODEL, messages: [userMessage('hi')], botId: 'bot-b', executable: 'C:/evil.exe', apiKey: 'x',
    }))
    assert.equal(failure.code, 'CLAUDE_ROUTE_UNKNOWN_REQUEST_FIELD')
    assert.match(failure.message, /botId, executable, apiKey/)
    assert.deepEqual(seam.created, [])
  })

  test('non-text content is refused by naming the block types it saw', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    for (const block of [{ type: 'image', attachment: {} }, { type: 'file', attachment: {} }, { type: 'tool-call', id: 'c1', name: 'x', arguments: '{}' }]) {
      const failure = failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, block] }] }))
      assert.equal(failure.code, 'CLAUDE_TURN_INPUT_UNSUPPORTED')
      assert.match(failure.message, new RegExp(block.type))
    }
    assert.deepEqual(seam.created, [])
  })

  test('the persona seam compares the request system message with Host state and never invents one', async () => {
    const mismatch = await makeAdapter(await makeHost())
    assert.equal(failureOf(await streamOf(mismatch.adapter, { provider: PROVIDER, model: MODEL, messages: [systemMessage('You are someone else.'), userMessage('hi')] })).code, 'CLAUDE_PERSONA_MISMATCH')
    const unconfirmed = await makeAdapter(await makeHost({ persona: null }))
    assert.equal(failureOf(await streamOf(unconfirmed.adapter, { provider: PROVIDER, model: MODEL, messages: [systemMessage(), userMessage('hi')] })).code, 'CLAUDE_PERSONA_UNCONFIRMED')
    const confirmed = await makeAdapter(await makeHost())
    const chunks = await streamOf(confirmed.adapter, { provider: PROVIDER, model: MODEL, messages: [systemMessage(), userMessage('hi')] })
    assert.equal(finishOf(chunks).reason.kind, 'stop')
    assert.equal(confirmed.seam.created[0].config.systemPrompt, PERSONA)
  })

  test('an unresolvable or malformed Host identity refuses before any engine exists', async () => {
    const host = await makeHost({ persona: null })
    const { adapter, seam } = await makeAdapter(host)
    host.setIdentity(() => { throw coded('BOT_NOT_COMMITTED') })
    assert.equal(failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [userMessage('hi')] })).code, 'CLAUDE_IDENTITY_UNRESOLVED')
    host.setIdentity({ subject: {}, botId: 'bot-a' })
    assert.equal(failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [userMessage('hi')] })).code, 'CLAUDE_IDENTITY_AUTHORITY_REQUIRED')
    host.setIdentity({ subject: host.subject, botId: 'bot-a', authority: host.authority, binding: { taskId: 't', attemptId: 'a', machineId: 'm', workspaceId: 'w', location: 'elsewhere' } })
    assert.equal(failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, messages: [userMessage('hi')] })).code, 'CLAUDE_IDENTITY_BINDING_REQUIRED')
    assert.deepEqual(seam.created, [])
  })
})

describe('claude llm bridge: retained session turns', () => {
  test('two turns share one engine; only the new user text is dispatched and the own reply is not re-sent', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    const first = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.equal(finishOf(first).reason.kind, 'stop')
    assert.equal(textOf(first), 'reply one')
    assert.equal(seam.created.length, 1)

    const second = await streamOf(adapter, {
      provider: PROVIDER, model: MODEL, sessionId: 's-1',
      messages: [systemMessage(), userMessage('one', 'm1'), ownAssistant('reply one', 'a1'), userMessage('two', 'm2')],
    })
    assert.equal(finishOf(second).reason.kind, 'stop')
    assert.equal(textOf(second), 'reply two')
    assert.equal(seam.created.length, 1, 'the same retained engine serves the second turn')
    assert.deepEqual(seam.created[0].submitted, ['one', 'two'], 'only the new user input is dispatched, never the whole history')
    assert.equal(seam.created[0].config.systemPrompt, PERSONA, 'the Host-confirmed persona travels to the engine seam')
    assert.equal(seam.created[0].config.model.catalogModel, MODEL)
    assert.equal(seam.created[0].config.billing, 'subscription')
    assert.equal(seam.created[0].config.entry.sha256, ENTRY.sha256, 'the entry is the Host pinned reference')
  })

  test('a repeated identical request is not dispatched again', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    const request = { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] }
    assert.equal(finishOf(await streamOf(adapter, request)).reason.kind, 'stop')
    const repeat = await streamOf(adapter, request)
    assert.equal(failureOf(repeat).code, 'CLAUDE_TURN_ALREADY_DISPATCHED')
    assert.deepEqual(seam.created[0].submitted, ['one'])
  })

  test('a rewritten history retires the session and refuses instead of replaying', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    const edited = await streamOf(adapter, {
      provider: PROVIDER, model: MODEL, sessionId: 's-1',
      messages: [systemMessage(), userMessage('one edited', 'm1'), userMessage('two', 'm2')],
    })
    assert.equal(failureOf(edited).code, 'CLAUDE_SESSION_HISTORY_CHANGED')
    assert.deepEqual(seam.created[0].submitted, ['one'], 'nothing new was dispatched')
    assert.equal(seam.created[0].closed, true, 'the old native session was retired')
    const after = await streamOf(adapter, {
      provider: PROVIDER, model: MODEL, sessionId: 's-1',
      messages: [systemMessage(), userMessage('one', 'm1'), userMessage('two', 'm2')],
    })
    assert.equal(failureOf(after).code, 'CLAUDE_SESSION_RETIRED')
  })

  test('history this route never produced is refused, and no engine is created for it', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    const failure = failureOf(await streamOf(adapter, {
      provider: PROVIDER, model: MODEL, sessionId: 's-1',
      messages: [systemMessage(), userMessage('one', 'm1'), foreignAssistant('other', 'a0'), userMessage('two', 'm2')],
    }))
    assert.equal(failure.code, 'CLAUDE_SESSION_HISTORY_UNSEEN')
    assert.deepEqual(seam.created, [], 'a fresh session with unusable history creates nothing and is not retired away')
  })

  test('a concurrent duplicate dispatch meets the engine turn fence and is surfaced, not queued', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost(), {
      engine: fakeEngineFactory({ script: async (input, emit, control) => { emit.delta(`reply ${input.text}`); await control.untilStopped() } }),
    })
    const prepared = await adapter.prepareCall(PROVIDER, MODEL)
    const request = { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] }
    const iterator = prepared.stream(request)[Symbol.asyncIterator]()
    const opened = await iterator.next()
    assert.equal(opened.value.type, 'block-start')
    const busy = await streamOf(adapter, request)
    assert.equal(failureOf(busy).code, 'ENGINE_TURN_IN_PROGRESS')
    assert.deepEqual(seam.created[0].submitted, ['one'], 'the busy turn dispatched nothing')
    await iterator.return()
    await adapter.close()
  })

  test('cancelling a turn stops the native tree, observes the settlement and retires the session', async () => {
    const settled = []
    const { adapter, seam } = await makeAdapter(await makeHost(), {
      engine: fakeEngineFactory({
        script: async (input, emit, control) => { emit.delta('partial'); await control.untilStopped() },
        onCreate: config => { config.hooks.onSettle = value => { settled.push(value) } },
      }),
    })
    const controller = new AbortController()
    const chunks = []
    const iterator = (await preparedStream(adapter, {
      provider: PROVIDER, model: MODEL, sessionId: 's-1', signal: controller.signal, messages: [systemMessage(), userMessage('one', 'm1')],
    }))[Symbol.asyncIterator]()
    // block-start and the first text delta arrive; the turn itself is still running.
    for (let index = 0; index < 2; index++) chunks.push(await iterator.next())
    controller.abort()
    let next = await iterator.next()
    while (!next.done) { chunks.push(next.value); next = await iterator.next() }
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'aborted')
    assert.equal(finish.reason.failure.code, 'CLAUDE_TURN_CANCELLED')
    assert.equal(seam.created[0].closed, true, 'the native tree really stopped')
    assert.equal(settled.length, 1, 'the engine settlement ran before the stream finished')
    assert.equal(settled[0].outcome, 'unknown')
    const after = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1'), userMessage('two', 'm2')] })
    assert.equal(failureOf(after).code, 'CLAUDE_SESSION_RETIRED')
    assert.deepEqual(seam.created[0].submitted, ['one'], 'a cancelled turn is never replayed')
  })

  test('the engine internal tools are observed but never re-emitted as loop tool calls', async () => {
    const { adapter } = await makeAdapter(await makeHost(), {
      engine: fakeEngineFactory({ script: async (input, emit) => { emit.tool('read_notes'); emit.delta('done') } }),
    })
    const chunks = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.equal(chunks.some(chunk => chunk.type === 'tool-call-delta'), false)
    assert.equal(finishOf(chunks).reason.kind, 'stop')
    assert.equal(finishOf(chunks).replayState.response.toolCallsObserved, 1)
  })

  test('reasoning deltas are surfaced as reasoning chunks, not dropped', async () => {
    const { adapter } = await makeAdapter(await makeHost(), {
      engine: fakeEngineFactory({ script: async (input, emit) => { emit.reasoning('thinking'); emit.delta('answer') } }),
    })
    const chunks = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.deepEqual(chunks.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.text), ['thinking'])
    assert.deepEqual(chunks.filter(chunk => chunk.type === 'block-end').at(-1).block, { type: 'text', text: 'answer' })
  })
})

describe('claude llm bridge: native outcome mapping', () => {
  test('usage the CLI reports becomes one usage chunk; missing usage emits none', async () => {
    const reported = await makeAdapter(await makeHost())
    const withUsage = await streamOf(reported.adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.deepEqual(withUsage.find(chunk => chunk.type === 'usage')?.usage, { inputTokens: 12, outputTokens: 5, cacheReadTokens: 3 })
    const silent = await makeAdapter(await makeHost(), { engine: fakeEngineFactory({ result: { usage: null, usageStatus: 'unknown' } }) })
    const without = await streamOf(silent.adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.equal(without.some(chunk => chunk.type === 'usage'), false, 'unknown usage stays unknown instead of being invented')
    assert.equal(finishOf(without).reason.kind, 'stop')
  })

  test('a turn with no output at all is not a success', async () => {
    const { adapter } = await makeAdapter(await makeHost(), { engine: fakeEngineFactory({ script: async () => {} }) })
    const failure = failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] }))
    assert.equal(failure.code, 'CLAUDE_TURN_NO_OUTPUT')
  })

  test('an unknown native outcome is an error finish that names the native stop reason', async () => {
    for (const stopReason of ['exit-before-result', 'resume-refused']) {
      const { adapter } = await makeAdapter(await makeHost(), { engine: fakeEngineFactory({ result: { ok: false, outcome: 'unknown', stopReason } }) })
      const failure = failureOf(await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] }))
      assert.equal(failure.code, 'CLAUDE_TURN_OUTCOME_UNKNOWN')
      assert.match(failure.message, new RegExp(stopReason))
    }
  })

  test('a CLI that emits no partial messages still delivers its whole assistant message', async () => {
    const { adapter } = await makeAdapter(await makeHost(), {
      engine: fakeEngineFactory({ script: async (input, emit) => { emit.assistant('whole message only') } }),
    })
    const chunks = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.equal(textOf(chunks), 'whole message only')
    assert.equal(finishOf(chunks).reason.kind, 'stop')
    assert.deepEqual(chunks.filter(chunk => chunk.type === 'block-end').at(-1).block, { type: 'text', text: 'whole message only' })
  })

  test('a turn the engine proves it never dispatched is offered again by the next call', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost(), { engine: fakeEngineFactory({ result: { ok: false, outcome: 'not-run', stopReason: 'launch-failed', dispatched: false } }) })
    await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    const retry = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.equal(failureOf(retry).code, 'CLAUDE_LAUNCH_FAILED')
    assert.deepEqual(seam.created[0].submitted, ['one', 'one'], 'a provably undelivered turn is dispatched again, not deduplicated away')
  })
})

describe('claude llm bridge: route generation and disposal', () => {
  test('a call prepared before a Host re-registration is refused, and the next generation dispatches', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    const prepared = await adapter.prepareCall(PROVIDER, MODEL)
    const replaced = adapter.replaceRoute({ model: MODEL })
    assert.equal(replaced.generation, 2)
    const stale = await drain(prepared.stream({ provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] }))
    assert.equal(failureOf(stale).code, 'CLAUDE_ROUTE_GENERATION_CHANGED')
    assert.deepEqual(seam.created, [], 'a stale generation creates no engine')
    const fresh = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    assert.equal(finishOf(fresh).reason.kind, 'stop')
    assert.equal(seam.created.length, 1)
  })

  test('a changed grant revision on one conversation key retires the old session and refuses', async () => {
    const host = await makeHost()
    const { adapter, seam } = await makeAdapter(host)
    await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    host.authority.replaceGrant(host.subject, { tools: ['read_notes'], modelRoutes: [{ provider: PROVIDER, model: MODEL }] })
    const refused = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1'), ownAssistant('reply one', 'a1'), userMessage('two', 'm2')] })
    assert.equal(failureOf(refused).code, 'CLAUDE_SESSION_BINDING_CHANGED')
    assert.deepEqual(seam.created[0].submitted, ['one'], 'the changed grant dispatched nothing new')
    assert.equal(seam.created[0].closed, true, 'the old native session was retired')
  })

  test('the same sessionId under a different committed Bot never touches the first session', async () => {
    const host = await makeHost()
    const other = await makeHost({ botId: 'bot-b' })
    const { adapter, seam } = await makeAdapter(host)
    await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    host.setIdentity(other.identity)
    const refused = await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1'), ownAssistant('reply one', 'a1'), userMessage('two', 'm2')] })
    assert.equal(failureOf(refused).code, 'CLAUDE_SESSION_HISTORY_UNSEEN')
    assert.deepEqual(seam.created[0].submitted, ['one'], 'the other Bot reached no engine at all')
    assert.equal(seam.created[0].closed, false, 'the first Bot conversation is untouched')
    assert.equal(seam.created.length, 1)
  })

  test('disposal stops the live tree, refuses later calls and creates nothing', async () => {
    const { adapter, seam } = await makeAdapter(await makeHost())
    await streamOf(adapter, { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })
    const closed = await adapter.close()
    assert.equal(closed.closed, true)
    assert.equal(closed.sessions, 1)
    assert.equal(seam.created[0].closed, true, 'the native tree was stopped by disposal')
    // A released registration refuses preparation outright, exactly like the SDK's own
    // disposed-registration contract; nothing is created afterwards.
    await assert.rejects(() => adapter.prepareCall(PROVIDER, MODEL), { code: 'REGISTRATION_DISPOSED' })
    assert.equal(seam.created.length, 1, 'disposal created no engine')
  })

  test('disposal waits for an engine that is still being created and stops it', async () => {
    const seam = fakeEngineFactory({ gated: true })
    const { adapter } = await makeAdapter(await makeHost(), { engine: seam })
    const iterator = (await adapter.prepareCall(PROVIDER, MODEL))
      .stream({ provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] })[Symbol.asyncIterator]()
    const pending = iterator.next()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(seam.started(), 1, 'the engine creation is in flight')
    assert.deepEqual(seam.created, [], 'the engine object does not exist yet')
    seam.open()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(seam.created.length, 1)
    await adapter.close()
    assert.equal(seam.created[0].closed, true, 'a tree created during disposal is stopped, not orphaned')
    await pending.catch(() => {})
    await iterator.return()
  })

  test('a pinned entry that changes between preparation and creation refuses the call', async () => {
    let entry = ENTRY
    const { adapter, seam } = await makeAdapter(await makeHost(), { entryFor: () => entry })
    const prepared = await adapter.prepareCall(PROVIDER, MODEL)
    entry = Object.freeze({ ...ENTRY, sha256: 'b'.repeat(64) })
    const refused = await drain(prepared.stream({ provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(), userMessage('one', 'm1')] }))
    assert.equal(failureOf(refused).code, 'CLAUDE_ROUTE_ENTRY_CHANGED')
    assert.deepEqual(seam.created, [])
  })
})
