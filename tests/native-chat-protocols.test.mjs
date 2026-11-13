import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createCodexEngine } from '../packages/bot-engines/src/codex-engine.mjs'
import { createPiEngine } from '../packages/bot-engines/src/pi-engine.mjs'
import { createStepEngine } from '../packages/bot-engines/src/step-engine.mjs'
import { createFixtureNativeLauncher, nativeRpcFixtureEntry } from './helpers/native-rpc-fixture-launcher.mjs'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { createClaudeLlmAdapter } from '../packages/bot-engines/src/claude-llm-adapter.mjs'

const fixture = resolve('tests/fixtures/native-chat-protocol-fixture.mjs')
const waitFor = async condition => { const end = Date.now() + 5000; while (!condition()) { if (Date.now() > end) throw new Error('Fixture condition timed out'); await new Promise(resolve => setTimeout(resolve, 5)) } }
async function setup(driver, work, patch = {}) {
  const root = resolve('tmp/integration/native-chat-protocols'); await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, driver + '-')), workspace = join(home, 'workspace'); await mkdir(workspace)
  let revision = 1, launches = 0
  const settlements = [], admissions = [], deltas = []
  const expectedModel=driver==='stepAgent'?'step/model':driver === 'codex' ? 'gpt-fixture' : 'fixture/model'
  const authority = { describe: () => ({ botId: 'fixture-bot', revision }), assertModel(_subject, provider, model) { assert.equal(provider, 'fixture'); assert.equal(model, expectedModel) } }
  const options = { authority, subject: {}, binding: { taskId: 'task', attemptId: 'attempt', machineId: 'machine', workspaceId: 'workspace', location: 'local' },
    operationId: 'fixture-op', entry: await nativeRpcFixtureEntry(fixture), runtimeRoot: home, workspace,
    model: { catalogProvider: 'fixture', catalogModel: expectedModel }, deadlineMs: 15_000,
    launcher: createFixtureNativeLauncher({ onLaunch() { launches++ } }),
    hooks: { onBeforeRequest: async value => { admissions.push(value) }, onSettle: async value => { settlements.push(value) } },
    ...patch }
  const engine = await (driver==='stepAgent'?createStepEngine:driver === 'codex' ? createCodexEngine : createPiEngine)(options)
  engine.events.on('delta', event => deltas.push(event))
  try { await work({ engine, settlements, admissions, deltas, workspace, launches: () => launches, revoke: () => revision++ }) }
  finally { await engine.stop() }
}

for (const driver of ['codex', 'pi', 'stepAgent']) test(`${driver}: two real native RPC turns retain one process and session with exact model and honest usage`, async () => {
  const original = process.env.NATIVE_CHAT_TEST_AMBIENT; process.env.NATIVE_CHAT_TEST_AMBIENT = 'must-not-be-inherited'
  try {
    await setup(driver, async ({ engine, settlements, deltas, launches, workspace }) => {
      const first = await engine.submitTurn({ text: 'first' }), second = await engine.submitTurn({ text: 'second' })
      assert.equal(first.ok, true); assert.equal(second.ok, true)
      assert.equal(first.outcome, 'succeeded'); assert.equal(first.sessionId, second.sessionId)
      assert.equal(first.text, 'turn-1: first'); assert.equal(second.text, 'turn-2: second')
      assert.deepEqual(first.usage, { input: 12, output: 3, cachedInput: 2 }); assert.deepEqual(second.usage, first.usage)
      assert.equal(first.costUsd, null); assert.equal(first.costStatus, 'unknown')
      assert.equal(launches(), 1); assert.equal(settlements.length, 2)
      const records = (await readFile(join(workspace, 'native-fixture-evidence.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
      assert.equal(records[0].ambientSecret, null)
      assert.ok(records[0].home.startsWith(resolve('tmp/integration/native-chat-protocols')))
      assert.ok(deltas.some(delta => delta.delta === 'turn-1: first'))
      assert.equal(engine.snapshot().turnsDispatched, 2)
    })
  } finally { if (original === undefined) delete process.env.NATIVE_CHAT_TEST_AMBIENT; else process.env.NATIVE_CHAT_TEST_AMBIENT = original }
})

for (const driver of ['codex', 'pi']) test(`${driver}: duplicate submit does not admit or dispatch twice; cancelling waits for real child exit without inventing tree proof`, async () => {
  await setup(driver, async ({ engine, admissions, settlements, launches }) => {
    const pending = engine.submitTurn({ text: 'slow' })
    await assert.rejects(engine.submitTurn({ text: 'second' }), { code: 'NATIVE_CHAT_TURN_IN_PROGRESS' })
    await waitFor(() => engine.snapshot().turn?.dispatched)
    const proof = await engine.stop('cancelled'), result = await pending
    assert.equal(proof.treeStopped, false); assert.equal(proof.status, 'unknown')
    assert.equal(result.ok, false); assert.equal(result.cancelled, true); assert.equal(result.outcome, 'unknown')
    assert.equal(admissions.length, 1); assert.equal(settlements.length, 1); assert.equal(launches(), 1)
    assert.equal(engine.snapshot().process, null)
  })
})

test('Step Code settled failure cannot be reported as a completed answer',async()=>{
 await setup('stepAgent',async({engine,workspace})=>{
  const result=await engine.submitTurn({text:'settled-failure'})
  assert.equal(result.ok,false);assert.notEqual(result.outcome,'succeeded')
  const launch=JSON.parse((await readFile(join(workspace,'native-fixture-evidence.jsonl'),'utf8')).split('\n')[0])
  for(const flag of ['--no-tools','--no-extensions','--no-context-files','--no-approve','--include-live-events'])assert.ok(launch.argv.includes(flag))
  assert.ok(launch.argv.includes('deny'))
 })
})

test('native chat rejects extra authority, unsupported Host tools and unsafe credential environment before launch', async () => {
  await setup('pi', async ({ engine, admissions, launches }) => {
    await assert.rejects(engine.submitTurn({ text: 'hello', executable: 'other' }), { code: 'NATIVE_CHAT_TEXT_ONLY' })
    assert.equal(admissions.length, 0); assert.equal(launches(), 0)
  })
  await assert.rejects(setup('pi', async () => {}, { tools: ['unadapted'] }), { code: 'NATIVE_CHAT_HOST_TOOLS_UNSUPPORTED' })
  await setup('pi', async ({ engine, launches }) => {
    const result = await engine.submitTurn({ text: 'hello' })
    assert.equal(result.ok, false); assert.equal(result.dispatched, false); assert.equal(launches(), 0)
    assert.equal(result.errorText, 'NATIVE_CHAT_CREDENTIAL_ENV_INVALID')
  }, { provisionCredentials: async () => ({ env: { NODE_OPTIONS: '--import evil' } }) })
})

test('Codex stale native turn output cannot pollute the next turn and unknown native callbacks are rejected', async () => {
  await setup('codex', async ({ engine, workspace }) => {
    await engine.submitTurn({ text: 'ask first' })
    const next = engine.submitTurn({ text: 'slow second' })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.doesNotMatch(engine.snapshot().turn?.text ?? '', /STALE/)
    await engine.stop('cancelled'); const result = await next
    assert.doesNotMatch(result.text, /STALE/)
    const lines = (await readFile(join(workspace, 'native-fixture-evidence.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.ok(lines.some(line => line.frame?.id === 'ask-1' && line.frame.error?.code === -32601))
  })
})

test('Pi denies extension interaction and agent_end never stands in for agent_settled', async () => {
  await setup('pi', async ({ engine, settlements, workspace }) => {
    const pending = engine.submitTurn({ text: 'ask unsettled' })
    await waitFor(() => engine.snapshot().turn?.dispatched)
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(engine.busy, true); assert.equal(settlements.length, 0)
    const lines = (await readFile(join(workspace, 'native-fixture-evidence.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.ok(lines.some(line => line.frame?.type === 'extension_ui_response' && line.frame.cancelled === true && line.frame.confirmed === false))
    await engine.stop('cancelled'); assert.equal((await pending).ok, false)
  })
})

test('Codex model rerouting retires the process, and missing cumulative usage never gets reassigned to a later turn', async () => {
  await setup('codex', async ({ engine }) => {
    const first = await engine.submitTurn({ text: 'no-usage' }), second = await engine.submitTurn({ text: 'second' }), third = await engine.submitTurn({ text: 'third' })
    assert.equal(first.usage, null); assert.equal(second.usage, null); assert.deepEqual(third.usage, { input: 12, output: 3, cachedInput: 2 })
    const result = await engine.submitTurn({ text: 'reroute' })
    assert.equal(result.ok, false); assert.equal(result.errorText, 'NATIVE_CHAT_MODEL_IDENTITY_MISMATCH')
    assert.equal(engine.closed, true)
  })
})

test('Host settlement remains the turn boundary and a refused settlement retires the native session', async () => {
  let release, observed = false
  await setup('pi', async ({ engine }) => {
    const pending = engine.submitTurn({ text: 'first' })
    await waitFor(() => observed)
    assert.equal(engine.busy, true)
    await assert.rejects(engine.submitTurn({ text: 'second' }), { code: 'NATIVE_CHAT_TURN_IN_PROGRESS' })
    release(); assert.equal((await pending).ok, true)
  }, { hooks: { onSettle: async () => { observed = true; await new Promise(resolve => { release = resolve }) } } })
  await setup('pi', async ({ engine }) => {
    await assert.rejects(engine.submitTurn({ text: 'first' }), { code: 'NATIVE_CHAT_SETTLEMENT_FAILED' })
    assert.equal(engine.closed, true)
  }, { hooks: { onSettle: async () => { throw new Error('fixture ledger rejection') } } })
})

for (const driver of ['codex', 'pi']) test(`${driver}: public Host SDK bridge carries two native turns without replay or fabricated capacity`, async () => {
  const root = resolve('tmp/integration/native-chat-protocols'); await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'sdk-' + driver + '-')), workspace = join(home, 'workspace'); await mkdir(workspace)
  const provider = 'native-' + driver, model = driver === 'codex' ? 'gpt-fixture' : 'fixture/model', subject = {}
  const authority = { describe: () => ({ botId: 'fixture-bot', revision: 1 }), assertModel(_subject, selectedProvider, selectedModel) { assert.equal(selectedProvider, provider); assert.equal(selectedModel, model) } }
  const bridge = createClaudeLlmAdapter({ provider, model, runtimeRoot: home, workspace,
    entry: await nativeRpcFixtureEntry(fixture), launcher: createFixtureNativeLauncher(), deadlineMs: 15_000,
    identityFor: () => ({ botId: 'fixture-bot', subject, authority, binding: { taskId: 'task', attemptId: 'attempt', machineId: 'machine', workspaceId: 'workspace', location: 'local' } }),
    engineFactory: driver === 'codex' ? createCodexEngine : createPiEngine })
  const context = new Context(); let llm, release
  const fork = await context.plugin(ctx => { llm = new LlmRuntime(ctx); release = llm.registerAdapter([provider], bridge) })
  const user = (id, text) => ({ id, role: 'user', content: [{ type: 'text', text }] })
  const assistant = (id, text) => ({ id, role: 'assistant', source: { kind: 'model', provider, model }, content: [{ type: 'text', text }] })
  const run = async messages => {
    const call = await llm.prepareCall({ provider, model }), chunks = []
    const info = await llm.resolveModelInfo(provider, model)
    assert.equal(info.context, undefined); assert.equal(info.defaultMaxTokens, undefined); assert.equal(call.config.maxTokens, undefined)
    for await (const chunk of call.stream({ ...call.config, sessionId: 'sdk-thread', messages })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.kind, 'stop', JSON.stringify(chunks))
    assert.ok(chunks.some(chunk => chunk.type === 'usage' && chunk.usage.inputTokens === 12))
    return chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  }
  try {
    assert.equal(await run([user('u1', 'first')]), 'turn-1: first')
    assert.equal(await run([user('u1', 'first'), assistant('a1', 'turn-1: first'), user('u2', 'second')]), 'turn-2: second')
    assert.equal(bridge.snapshot().sessions.length, 1); assert.equal(bridge.snapshot().sessions[0].turns, 2)
    const lines = (await readFile(join(workspace, 'native-fixture-evidence.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    const prompts = lines.filter(line => line.frame?.method === 'turn/start' || line.frame?.type === 'prompt').map(line => line.frame.params?.input[0]?.text ?? line.frame.message)
    assert.deepEqual(prompts, ['first', 'second'])
  } finally { await bridge.close(); release(); await fork.dispose() }
})
