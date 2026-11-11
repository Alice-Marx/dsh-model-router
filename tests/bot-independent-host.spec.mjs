import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { bootIndependentHost, seed, textChunks } from './fixtures/bot-independent-boot.mjs'
import { openRuntimeSwitch } from '../packages/orchestration/src/bot-runtime-switch.mjs'
import { createPluginRuntime } from '../modules/independent-runtime/index.mjs'

// Identity, authority, money and cancel for the independent runtime, at the entry a real Host uses.
//
// Every case runs the real product: `createBotProduct` installs the `llm/stream` handler, the real
// principal directory and Bot policy decide, the committed switch decides which runtime answers,
// and the one money authority is the real `createModelAccounting` over a real SQLite router state.
// `upstream` is what reached the base stream, so "zero upstream" is an observation, not a claim.

const BOTH = { a: {}, b: {} }
const TOOL_CALL = { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'noop', argumentsDelta: '{}' }
const switchFileOf = home => join(home, 'independent-runtime', 'runtime-switch.json')

test('each Bot answers on its own committed model, and one model call is one receipt', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  await booted.move('b', 'independent')
  const first = await booted.turn('a', 'hello a')
  assert.equal(first.answer, 'one two')
  assert.equal(first.runtime, 'independent')
  const second = await booted.turn('b', 'hello b')
  assert.equal(second.answer, 'one two')
  // Each Bot asked for the model it has committed to, and nothing else reached the provider.
  assert.deepEqual(booted.upstream.map(call => `${call.provider}/${call.model}`), ['alpha/one', 'beta/two'])
  const rows = await booted.money.receipts()
  assert.equal(rows.length, 2, 'one receipt per model call, not one per turn or per chunk')
  assert.deepEqual(rows.map(row => [row.botId, row.provider, row.model, row.source]), [['a', 'alpha', 'one', 'bot'], ['b', 'beta', 'two', 'bot']])
  for (const row of rows) {
    assert.equal(row.funding, 'api')
    assert.equal(row.state, 'settled')
    assert.equal(row.outcome, 'succeeded')
    assert.equal(row.usageComplete, true)
    assert.equal(row.sessionId, null, 'an independent turn owns its transcript, not a Host Session')
  }
  // The durable run carries the priced package once: no second ledger, no token-estimated bill.
  // (The store was seeded with one older run, so the two model calls are the last two.)
  const state = await booted.money.store.read()
  const calls = state.runs.slice(-2)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(run => run.packages.length), [1, 1])
  assert.ok(calls.every(run => run.packages[0].costUsd > 0), 'a complete usage is priced from the binding')
})

test('a Bot that was not moved is served by the integration path, not by this one', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  // Nobody moved anything: the committed mode is integration, so the dispatch hands the turn to
  // the other runtime instead of answering it here.
  const routed = await booted.turn('a', 'hello')
  assert.equal(routed.runtime, 'integration')
  assert.equal(routed.answer, 'from-the-harness')
  assert.deepEqual(booted.upstream, [], 'no upstream call was made here')
  assert.deepEqual(await booted.money.receipts(), [], 'and nothing was admitted here')
  // A stale caller that pins the other runtime is refused rather than quietly served.
  await booted.move('b', 'independent')
  await assert.rejects(() => booted.runtime.turn({ botId: 'b', input: 'x', runtime: 'integration' }), error => error.code === 'RUNTIME_MODE_MISMATCH')
  await assert.rejects(() => booted.runtime.turn({ botId: 'a', input: 'x', runtime: 'independent' }), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.deepEqual(booted.upstream, [])
})

test('an ungranted model, a revoked grant and a deleted Bot all refuse before the upstream call', async t => {
  const denied = await bootIndependentHost(t, { seed: seed(), funding: BOTH, denyModel: true })
  await denied.move('a', 'independent')
  // The Bot's saved model is not in its compiled grant: the policy refuses, the provider is untouched.
  await assert.rejects(() => denied.turn('a', 'hello'), error => error.code === 'MODEL_DENIED')
  assert.deepEqual(denied.upstream, [], 'zero upstream')
  assert.deepEqual(await denied.money.receipts(), [], 'and no receipt was admitted')

  const revoked = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await revoked.move('a', 'independent')
  // A suspension empties the grant, so the model route is no longer authorized.
  revoked.directory.replaceGrant('a', { tools: [], modelRoutes: [] })
  await assert.rejects(() => revoked.turn('a', 'hello'), error => error.code === 'MODEL_DENIED')
  assert.deepEqual(revoked.upstream, [], 'zero upstream')
  assert.deepEqual(await revoked.money.receipts(), [], 'and no receipt was admitted')

  const deleted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await deleted.move('b', 'independent')
  await deleted.rt.deleteBot('b')
  await deleted.lifecycle.refreshGrants()
  await assert.rejects(() => deleted.turn('b', 'hello'), error => error.code === 'BOT_NOT_COMMITTED')
  assert.deepEqual(deleted.upstream, [], 'zero upstream')
  assert.deepEqual(await deleted.money.receipts(), [])
})

test('a Bot with no funding binding is refused by the one money authority, not answered for free', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: {} })
  await booted.move('a', 'independent')
  await assert.rejects(() => booted.turn('a', 'hello'), error => error.code === 'MODEL_FUNDING_REQUIRED')
  assert.deepEqual(booted.upstream, [], 'zero upstream')
  assert.deepEqual(await booted.money.receipts(), [], 'no receipt, and therefore no silent zero-cost call')
})

test('a caller cannot borrow another Bot route, and an owner frame is never an independent turn', async t => {
  const booted = await bootIndependentHost(t, {
    seed: seed(), funding: { ...BOTH, 'host-owner': {} },
    ownerRoutes: [{ provider: 'alpha', model: 'one' }],
  })
  await booted.move('a', 'independent')
  const execution = booted.ctx.get('botIndependentExecution')
  // A request that names a route the Bot has not saved is refused: the saved identity of one
  // request is never swapped for another Bot's.
  await assert.rejects(() => execution.complete({ botId: 'a', provider: 'beta', model: 'two', messages: [] }), error => error.code === 'BOT_MODEL_MISMATCH')
  // And a Bot that was not moved cannot be served by this path at all.
  await assert.rejects(() => execution.complete({ botId: 'b', provider: 'beta', model: 'two', messages: [] }), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.deepEqual(booted.upstream, [], 'zero upstream')
  // An owner frame is a person's own call: it is policed and accounted, it takes no Bot lease, and
  // it is never answered by the runtime a Bot was moved to.
  const seen = []
  await booted.policy.run({ kind: 'remote', name: 'product.list', invocation: { peer: { principal: { kind: 'owner' } } } }, async () => {
    for await (const chunk of booted.rawStream({ provider: 'alpha', model: 'one', messages: [{ role: 'user', content: 'hi' }] })) seen.push(chunk)
  })
  assert.equal(seen.length, 3, 'the owner call is answered through the same handler')
  const rows = await booted.money.receipts()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].botId, 'host-owner', 'the receipt names the owner, not the moved Bot')
  assert.equal(rows[0].source, 'aux')
  assert.deepEqual(booted.serving.busyBots(), [], 'an owner call takes no Bot lease')
  // And the independent turn for the moved Bot still works afterwards.
  assert.equal((await booted.turn('a', 'hello')).answer, 'one two')
})

test('a Bot moved by another writer while a turn is open stops at its next step', async t => {
  const booted = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH,
    chunks: [
      { type: 'text-delta', index: 0, text: 'working' },
      TOOL_CALL,
      { type: 'text-delta', index: 0, text: 'done' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
    // A tool the Host offers performs another writer's move while the turn is open. The lease stops
    // this Host's own move; a second writer on the same file is what a race actually looks like.
    runtimeSettings: {
      toolsFor: () => ({
        call: async () => {
          const other = openRuntimeSwitch({ file: switchFileOf(booted.home), now: () => 1 })
          await other.move('a', 'integration')
          return { ok: true }
        },
      }),
    },
  })
  await booted.move('a', 'independent')
  await assert.rejects(() => booted.turn('a', 'go'), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.equal(booted.runtime.describe('a').runtime, 'integration', 'the other writer committed the move')
  assert.deepEqual(booted.serving.busyBots(), [], 'the refused turn released its lease')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'assistant'], 'the complete ask batch is kept, the result is not invented')
  // A turn asked for afterwards is served by the runtime that now owns the Bot.
  const after = await booted.runtime.turn({ botId: 'a', input: 'go' })
  assert.equal(after.runtime, 'integration')
})

test('a Bot revoked mid-stream stops at the next chunk and writes no answer', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  booted.state.beforeChunk = index => { if (index === 1) booted.directory.retire('a') }
  // The authority answers first: the retired subject can no longer be asserted for a model. Either
  // answer is a refusal at the next chunk; neither lets the turn finish.
  await assert.rejects(() => booted.turn('a', 'hello'), error => ['SUBJECT_REVOKED', 'UNKNOWN_BOT'].includes(error.code))
  assert.equal(booted.upstream.length, 1, 'the provider was reached once, before the revocation')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user'], 'no assistant message was written for a turn that no longer stands')
  assert.deepEqual(booted.serving.busyBots(), [], 'the lease is released')
  // A retired Bot stays retired: the next turn is refused, not answered from a stale transcript.
  await assert.rejects(() => booted.turn('a', 'hello again'), error => ['SUBJECT_REVOKED', 'UNKNOWN_BOT', 'BOT_NOT_COMMITTED'].includes(error.code))
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user'], 'and nothing new was written')
})

test('a grant suspended mid-stream stops the turn, and a restored grant lets the next turn through', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  const grant = { tools: ['tool/model_router', 'model/infer'], modelRoutes: [{ provider: 'alpha', model: 'one' }] }
  booted.state.beforeChunk = index => { if (index === 1) booted.directory.replaceGrant('a', { tools: [], modelRoutes: [] }) }
  await assert.rejects(() => booted.turn('a', 'hello'), error => error.code === 'MODEL_DENIED')
  assert.equal(booted.upstream.length, 1, 'the provider was reached once, before the suspension')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user'], 'no answer was written')
  assert.deepEqual(booted.serving.busyBots(), [], 'the lease is released')
  // The suspension is lifted the way the product lifts one, and the next turn runs. The transcript
  // keeps the unanswered user message: nothing was replayed and nothing was dropped.
  booted.state.beforeChunk = null
  booted.directory.replaceGrant('a', grant)
  const after = await booted.turn('a', 'again')
  assert.equal(after.answer, 'one two')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'user', 'assistant'])
})

test('a cancel in the middle of the stream stops the turn, releases the lease and replays nothing', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  const controller = new AbortController()
  booted.state.beforeChunk = index => { if (index === 1) controller.abort() }
  await assert.rejects(() => booted.turn('a', 'hello', controller.signal), error => error.code === 'BOT_LOOP_CANCELLED')
  assert.equal(booted.upstream.length, 1, 'the cancel is seen at the next chunk, not after the stream')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user'], 'the partial transcript keeps its honest state')
  assert.deepEqual(booted.serving.busyBots(), [], 'the lease is released on cancel')
  // The user input is not resent on its own: the next turn is a new turn.
  booted.state.beforeChunk = null
  assert.equal((await booted.turn('a', 'next')).answer, 'one two')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'user', 'assistant'])
})

test('a stream the provider never finished is not an answer, and an unknown cost stays unknown', async t => {
  const unfinished = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: [{ type: 'text-delta', index: 0, text: 'half' }] })
  await unfinished.move('a', 'independent')
  await assert.rejects(() => unfinished.turn('a', 'hello'), error => error.code === 'MODEL_STREAM_UNFINISHED')
  assert.deepEqual(unfinished.transcript('a').map(row => row.role), ['user'], 'no answer was written')
  // The call was admitted and its outcome is unknown: recorded as unknown, never as a success and
  // never as a zero-cost success.
  const admitted = await unfinished.money.receipts()
  assert.equal(admitted.length, 1)
  assert.equal(admitted[0].state, 'unknown')
  assert.equal(admitted[0].outcome, 'unknown')
  assert.equal(admitted[0].usage, null)

  const failed = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH,
    chunks: [{ type: 'text-delta', index: 0, text: 'half' }, { type: 'finish', reason: { kind: 'error', error: 'upstream exploded' } }],
  })
  await failed.move('a', 'independent')
  await assert.rejects(() => failed.turn('a', 'hello'), error => error.code === 'MODEL_STREAM_ERROR')
  assert.deepEqual(failed.transcript('a').map(row => row.role), ['user'])
  const rows = await failed.money.receipts()
  assert.equal(rows.length, 1, 'the failed call is still admitted, as a failed call')
  assert.equal(rows[0].outcome, 'failed')
  assert.equal(rows[0].usage, null, 'an unknown usage is not invented as zero')
  assert.equal(rows[0].usageComplete, false)

  const unknownCost = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: textChunks('answer', null) })
  await unknownCost.move('a', 'independent')
  assert.equal((await unknownCost.turn('a', 'hello')).answer, 'answer')
  const quiet = await unknownCost.money.receipts()
  assert.equal(quiet.length, 1)
  assert.equal(quiet[0].usage, null, 'no usage reported means no usage recorded')
  assert.equal(quiet[0].usageComplete, false)
  const run = (await unknownCost.money.store.read()).runs.at(-1)
  assert.equal(run.packages[0].costUsd, null, 'the cost is unknown, not zero')
  assert.equal(run.packages[0].costSource, 'usage-missing')
})

test('the second turn carries the first answer model provenance, the way the Host replays it', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  assert.equal((await booted.turn('a', 'first')).answer, 'one two')
  assert.equal((await booted.turn('a', 'second')).answer, 'one two')
  // The Host's own model service reads an assistant message's source to replay it; a transcript
  // without provenance is not a conversation it can continue.
  const carried = booted.upstream[1].messages.find(message => message.role === 'assistant')
  assert.ok(carried, 'the second request carries the first answer')
  assert.deepEqual(carried.source, { kind: 'model', provider: 'alpha', model: 'one' })
  assert.deepEqual(booted.upstream[0].messages.map(message => message.role), ['system', 'user'])
})

test('a truncated, aborted or unreadable finish is not written as an answer', async t => {
  // The Host finish vocabulary is closed enough to be decided on: 'stop' and 'tool-calls' answer,
  // 'max-tokens' is a truncated answer, 'aborted' and 'error' fail, and a kind this module was not
  // taught is a refusal rather than a guess.
  const truncated = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH,
    chunks: [{ type: 'text-delta', index: 0, text: 'half a answer' }, { type: 'finish', reason: { kind: 'max-tokens' } }],
  })
  await truncated.move('a', 'independent')
  await assert.rejects(() => truncated.turn('a', 'hello'), error => error.code === 'MODEL_STREAM_TRUNCATED')
  assert.deepEqual(truncated.transcript('a').map(row => row.role), ['user'], 'a truncated answer is not written as a complete one')
  const truncatedRows = await truncated.money.receipts('a')
  assert.equal(truncatedRows.length, 1, 'the call is still admitted and recorded')
  assert.equal(truncatedRows[0].finishKind, 'max-tokens')

  const unknown = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH,
    chunks: [{ type: 'text-delta', index: 0, text: 'half' }, { type: 'finish', reason: { kind: 'provider-said-so' } }],
  })
  await unknown.move('a', 'independent')
  await assert.rejects(() => unknown.turn('a', 'hello'), error => error.code === 'MODEL_STREAM_REASON_UNKNOWN')
  assert.deepEqual(unknown.transcript('a').map(row => row.role), ['user'])
  assert.deepEqual(unknown.upstream.length, 1)

  const aborted = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH,
    chunks: [{ type: 'text-delta', index: 0, text: 'half' }, { type: 'finish', reason: { kind: 'aborted', failure: { message: 'stopped' } } }],
  })
  await aborted.move('a', 'independent')
  await assert.rejects(() => aborted.turn('a', 'hello'), error => error.code === 'MODEL_STREAM_ABORTED')
  assert.deepEqual(aborted.transcript('a').map(row => row.role), ['user'])
})

test('the route is re-read per step from committed state, and each step is its own receipt', async t => {  const booted = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH,
    chunks: [
      { type: 'text-delta', index: 0, text: 'step one' },
      TOOL_CALL,
      { type: 'finish', reason: { kind: 'stop' } },
    ],
    // The Host's own tool changes the Bot's saved model between steps, the way the owner's model
    // picker does; the next step must ask for the model the Bot has committed to by then.
    runtimeSettings: {
      toolsFor: () => ({
        call: async () => {
          await booted.rt.updateBot('a', { model: 'alpha/three' })
          await booted.lifecycle.refreshGrants()
          // And the provider answers the second step with an answer instead of another ask.
          booted.state.chunks = [{ type: 'text-delta', index: 0, text: 'step two' }, { type: 'finish', reason: { kind: 'stop' } }]
          return { ok: true }
        },
      }),
    },
  })
  await booted.move('a', 'independent')
  const reply = await booted.turn('a', 'go')
  assert.equal(reply.answer, 'step two')
  assert.equal(reply.steps, 2)
  assert.equal(reply.toolCalls.length, 1)
  assert.deepEqual(booted.upstream.map(call => `${call.provider}/${call.model}`), ['alpha/one', 'alpha/three'])
  const rows = await booted.money.receipts('a')
  assert.equal(rows.length, 2, 'one receipt per model call: re-entering the product handler does not double it')
  assert.deepEqual([...new Set(rows.map(row => row.runId))].length, 2)
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'assistant', 'tool', 'assistant'])
})

test('ordinary Harness calls and Bots on the integration path are untouched', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('b', 'independent')
  // An unclaimed Session is still an ordinary Harness session: it passes straight through.
  const plain = await booted.stream({ sessionId: 'plain', provider: 'alpha', model: 'one', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(plain.length, 3)
  assert.deepEqual(booted.upstream.map(call => call.sessionId), ['plain'])
  // So is a call with no Session at all and no frame — the vendor's own auxiliary shape.
  await booted.stream({ provider: 'alpha', model: 'one', messages: [] })
  assert.deepEqual(booted.upstream.map(call => call.sessionId), ['plain', null])
  // Bot 'a' is still on the integration path, so its own chat is served there as before: the
  // runtime has resolved an agent for that Session, which is what binds it to the Bot.
  booted.ctx.emit('agent/created', { agent: booted.agentOf('a') })
  const chat = await booted.stream({ sessionId: 'a', provider: 'alpha', model: 'one', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(chat.length, 3)
  assert.deepEqual(booted.upstream.map(call => call.sessionId), ['plain', null, 'a'])
  // A thread of a Bot that is still on the integration path is served there, exactly as before.
  const thread = booted.threads.service.create({ botId: 'a', name: '一线程' }).thread
  const bound = await booted.threads.service.ensureSession({ botId: 'a', threadId: thread.threadId })
  assert.ok((await booted.stream({ sessionId: bound.sessionId, provider: 'alpha', model: 'one', messages: [] })).length === 3)
  assert.deepEqual(booted.upstream.map(call => call.sessionId), ['plain', null, 'a', bound.sessionId])
  // The moved Bot's own chat is refused on the integration path: the independent runtime owns it.
  await assert.rejects(() => booted.stream({ sessionId: 'b', provider: 'beta', model: 'two', messages: [] }),
    error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.equal((await booted.turn('b', 'hello')).answer, 'one two', 'and it answers on the runtime it was moved to')
})

test('the plugin mounts before the product publishes its frame, and refuses until it does', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  // The production order: `product.start` runs synchronously and `connect` builds this runtime
  // before the asynchronous composition has published the frame. Construction must not fail on a
  // null capture, and a turn that starts before readiness is refused rather than answered.
  const llm = booted.ctx.llm
  const services = new Map([['llm', llm]])
  const early = { get: name => services.get(name), llm }
  const runtime = createPluginRuntime({
    ctx: early,
    settings: { enabled: true, dir: join(booted.home, 'independent-runtime'), maxSteps: 4 },
    stateDir: booted.home,
    serving: booted.serving,
    integration: async () => ({ answer: 'from-the-harness' }),
  })
  assert.ok(runtime, 'the runtime mounts before the frame exists')
  await assert.rejects(() => runtime.turn({ botId: 'a', input: 'hello' }),
    error => error.code === 'INDEPENDENT_EXECUTION_UNAVAILABLE' && error.outcome === 'refused')
  assert.deepEqual(booted.upstream, [], 'zero upstream while the Host is not ready')
  // Once the product publishes the frame, the same mounted runtime serves the turn.
  services.set('botIndependentExecution', booted.ctx.get('botIndependentExecution'))
  assert.equal((await runtime.turn({ botId: 'a', input: 'hello' })).answer, 'one two')
  assert.deepEqual(booted.upstream.map(call => `${call.provider}/${call.model}`), ['alpha/one'])
  runtime.close()
})

test('an emptied grant refuses before anything is written, and a namespaced model keeps its remainder', async t => {
  const emptied = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await emptied.move('a', 'independent')
  // The grant is stripped before the turn starts: the checkpoint in front of the first transcript
  // write refuses, so not even the user message lands.
  emptied.directory.replaceGrant('a', { tools: [], modelRoutes: [] })
  await assert.rejects(() => emptied.turn('a', 'hello'), error => error.code === 'MODEL_DENIED')
  assert.deepEqual(emptied.transcript('a'), [], 'nothing was written')
  assert.deepEqual(emptied.upstream, [], 'zero upstream')
  assert.deepEqual(await emptied.money.receipts(), [], 'and nothing was admitted')

  // A route whose model remainder carries a namespace of its own stays exact.
  const namespaced = seed()
  namespaced.bots.a.model = 'openrouter/anthropic/claude-3'
  const deep = await bootIndependentHost(t, { seed: namespaced, funding: BOTH })
  await deep.move('a', 'independent')
  assert.equal((await deep.turn('a', 'hello')).answer, 'one two')
  assert.deepEqual(deep.upstream.map(call => `${call.provider}/${call.model}`), ['openrouter/anthropic/claude-3'])
  const rows = await deep.money.receipts('a')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].provider, 'openrouter')
  assert.equal(rows[0].model, 'anthropic/claude-3')
})

test('the trusted facade keeps its request shape closed', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  await booted.move('a', 'independent')
  const execution = booted.ctx.get('botIndependentExecution')
  // A caller cannot open a new path to a session, a runtime or an identity through this facade.
  await assert.rejects(() => execution.complete({ botId: 'a', provider: 'alpha', model: 'one', messages: [], sessionId: 'a' }),
    error => error.code === 'INDEPENDENT_REQUEST_UNKNOWN_FIELD')
  await assert.rejects(() => execution.complete({ botId: 'a', provider: 'alpha', model: 'one', messages: [], runtime: 'integration' }),
    error => error.code === 'INDEPENDENT_REQUEST_UNKNOWN_FIELD')
  await assert.rejects(() => execution.complete({ botId: 'a', provider: 'alpha', model: 'one', messages: [], purpose: 'auxiliary' }),
    error => error.code === 'INDEPENDENT_REQUEST_UNKNOWN_FIELD')
  assert.deepEqual(booted.upstream, [], 'zero upstream')
  // And a nested call cannot re-point a frame at another Bot.
  await assert.rejects(async () => booted.policy.modelContext(booted.directory.forBot('a'), undefined, async () => {
    await booted.policy.modelContext(booted.directory.forBot('b'), undefined, async () => 'nested', { botId: 'b' })
  }, { botId: 'a' }), error => error.code === 'SUBJECT_MISMATCH')
})

test('a Host that has not started the Bot product cannot mount the independent runtime', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH })
  // The llm service alone is not a Host: no committed Bot, no policy, no money path.
  assert.throws(() => createPluginRuntime({ ctx: { get: () => null }, settings: { enabled: true }, stateDir: booted.home }),
    error => error instanceof TypeError && error.message === 'PLUGIN_RUNTIME_REQUIRES_LLM')
  // A Bot id that is not an id is refused by the dispatch before anything is read.
  await assert.rejects(() => booted.turn('not a bot', 'hello'), error => error.code === 'INVALID_BOT_ID')
  assert.deepEqual(booted.upstream, [])
})
