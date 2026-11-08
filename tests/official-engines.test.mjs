import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { toolForProvider } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {
  OFFICIAL_ENGINES, createOfficialEngineAdapter, defaultEngineExecutor, engineFailureText, engineFor, enginePrompt,
  isEngineProvider, registerOfficialEngines,
} from '../packages/orchestration/src/official-engines.mjs'

const collect = async iterable => { const out = []; for await (const chunk of iterable) out.push(chunk); return out }
const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
const assistant = text => ({ role: 'assistant', content: [{ type: 'text', text }] })
const caseDir = name => { const parent = resolve('tmp/integration/official-engines'); mkdirSync(parent, { recursive: true }); return mkdtempSync(join(parent, `${name}-`)) }

test('engines: every engine provider resolves to its own fixed registry tool', () => {
  for (const engine of OFFICIAL_ENGINES) {
    assert.equal(toolForProvider(engine.provider)?.id, engine.toolId, engine.provider)
    assert.ok(engine.models.some(model => model.id === 'default' && model.cliModel === null), `${engine.provider} offers the CLI default`)
    assert.equal(isEngineProvider(engine.provider), true)
  }
  assert.equal(isEngineProvider('anthropic'), false)
  assert.equal(engineFor('engine-unknown'), null)
})

test('engines: the prompt keeps the system text and the newest turns within the CLI limit', () => {
  const prompt = enginePrompt({ system: 'You are 小助手.', messages: [user('第一问'), assistant('第一答'), user('最后的问题')] })
  assert.match(prompt, /<system>\nYou are 小助手\.\n<\/system>/)
  assert.ok(prompt.indexOf('第一问') < prompt.indexOf('最后的问题'))
  assert.match(prompt, /【助手】\n第一答/)

  const long = 'x'.repeat(3_000)
  const many = Array.from({ length: 40 }, (_, index) => user(`${index}:${long}`))
  const bounded = enginePrompt({ messages: [...many, user('最新一条')] }, { maxBytes: 20_000 })
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= 20_000)
  assert.match(bounded, /最新一条/)
  assert.match(bounded, /较早的 \d+ 条消息因长度限制未包含/)
  assert.doesNotMatch(bounded, /\b0:x/)

  const huge = enginePrompt({ messages: [user('y'.repeat(50_000))] }, { maxBytes: 8_000 })
  assert.ok(Buffer.byteLength(huge, 'utf8') <= 8_000, 'a single oversized message is truncated, not dropped')
  assert.match(huge, /【用户】\ny+/)
})

test('engines: a successful CLI answer streams as one text block with usage and a stop', async () => {
  const calls = []
  const adapter = createOfficialEngineAdapter({ execute: async request => {
    calls.push(request)
    return { ok: true, answer: '你好，我在。', usage: { inputTokens: 12, outputTokens: 5 } }
  } })
  assert.deepEqual((await adapter.listModels('engine-claude-code')).map(model => model.id), ['default', 'sonnet', 'opus', 'haiku'])
  assert.equal((await adapter.resolveModel('engine-codex', 'default')).context.contextWindow > 0, true)
  const chunks = await collect(adapter.stream({ provider: 'engine-claude-code', model: 'sonnet', messages: [user('在吗')] }))
  assert.deepEqual(chunks.map(chunk => chunk.type), ['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
  assert.equal(chunks[1].text, '你好，我在。')
  assert.deepEqual(chunks[3].usage, { inputTokens: 12, outputTokens: 5 })
  assert.equal(chunks[4].reason.kind, 'stop')
  assert.equal(calls[0].engine.toolId, 'claude-code')
  assert.equal(calls[0].model.cliModel, 'sonnet')
  assert.match(calls[0].prompt, /在吗/)
})

test('engines: failures finish with a clear engine error instead of an API fallback', async () => {
  const adapter = createOfficialEngineAdapter({ execute: async () => ({
    ok: false, error: 'Codex CLI 执行失败，已回退模型目录 API。', fallback: { reason: 'x', error: 'Not logged in', loginRequired: true },
  }) })
  const [finish] = await collect(adapter.stream({ provider: 'engine-codex', model: 'default', messages: [user('hi')] }))
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'ENGINE_LOGIN_REQUIRED')
  assert.match(finish.reason.failure.message, /codex login/)
  assert.doesNotMatch(finish.reason.failure.message, /API/)

  assert.equal(engineFailureText(engineFor('engine-codex'), { error: 'Codex CLI 执行超时，已回退模型目录 API。' }), 'Codex CLI 执行超时。')
  const unknown = await collect(adapter.stream({ provider: 'engine-codex', model: 'gpt-made-up', messages: [] }))
  assert.equal(unknown[0].reason.failure.code, 'ENGINE_MODEL_UNKNOWN')
  const thrown = createOfficialEngineAdapter({ execute: async () => { throw new Error('boom') } })
  const [error] = await collect(thrown.stream({ provider: 'engine-gemini', model: 'default', messages: [user('hi')] }))
  assert.equal(error.reason.failure.code, 'ENGINE_FAILED')
})

test('engines: cancellation is reported as aborted and queued calls respect the concurrency cap', async () => {
  const controller = new AbortController(); controller.abort()
  const idle = createOfficialEngineAdapter({ execute: async () => assert.fail('must not run') })
  const [aborted] = await collect(idle.stream({ provider: 'engine-codex', model: 'default', messages: [], signal: controller.signal }))
  assert.equal(aborted.reason.kind, 'aborted')

  let active = 0, peak = 0
  const gates = []
  const adapter = createOfficialEngineAdapter({ maxConcurrent: 1, execute: () => new Promise(resolve => {
    active += 1; peak = Math.max(peak, active)
    gates.push(() => { active -= 1; resolve({ ok: true, answer: 'ok' }) })
  }) })
  const first = collect(adapter.stream({ provider: 'engine-codex', model: 'default', messages: [user('1')] }))
  const second = collect(adapter.stream({ provider: 'engine-codex', model: 'default', messages: [user('2')] }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(gates.length, 1, 'the second call waits for the first')
  gates.shift()()
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  gates.shift()()
  await Promise.all([first, second])
  assert.equal(peak, 1)
})

test('engines: registration offers every fixed provider to the Host model service', () => {
  const registered = []
  const ctx = { llm: { registerAdapter: (providers, adapter) => { registered.push({ providers, adapter }); return () => {} } } }
  const dispose = registerOfficialEngines(ctx, { stateDir: caseDir('register'), execute: async () => ({ ok: true, answer: 'x' }) })
  assert.equal(typeof dispose, 'function')
  assert.deepEqual(registered[0].providers, OFFICIAL_ENGINES.map(engine => engine.provider))
  assert.equal(registered[0].adapter.providerInfo('engine-codex').name, 'Codex（官方工具）')
  assert.equal(typeof registerOfficialEngines({}, { stateDir: caseDir('none') }), 'function', 'no model service registers nothing')
})

test('engines: the default executor runs the CLI with its session login in the Host-owned workspace', async () => {
  const spawned = []
  const spawnImpl = (file, args, options) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    child.kill = () => true
    child.stdin = { on() {}, end(input) {
      spawned.push({ file, args, options, input })
      setImmediate(() => {
        const text = args.includes('--version') ? '2.1.0 (Claude Code)'
          : JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '来自 Claude Code 的回答', usage: { input_tokens: 30, output_tokens: 7 } })
        child.stdout.emit('data', Buffer.from(text))
        child.emit('exit', 0); child.emit('close', 0)
      })
    } }
    return child
  }
  const workspace = join(caseDir('executor'), 'engine-workspace')
  const previous = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-must-not-reach-the-engine'
  try {
    const adapter = createOfficialEngineAdapter({ execute: defaultEngineExecutor({ ctx: {}, workspace, spawnImpl }) })
    const chunks = await collect(adapter.stream({ provider: 'engine-claude-code', model: 'sonnet', system: '你是测试 Bot。', messages: [user('今天做什么？')] }))
    const text = chunks.find(chunk => chunk.type === 'text-delta')
    assert.equal(text?.text, '来自 Claude Code 的回答', JSON.stringify(chunks.at(-1)))
    const run = spawned.find(call => !call.args.includes('--version'))
    assert.equal(run.file, 'claude')
    assert.ok(run.args.includes('--model') && run.args[run.args.indexOf('--model') + 1] === 'sonnet')
    assert.equal(run.options.cwd.endsWith('engine-workspace'), true)
    assert.equal(run.options.env.ANTHROPIC_API_KEY, undefined, 'API keys are stripped: the engine uses the subscription login')
    assert.match(run.input, /今天做什么？/)
    assert.match(run.input, /你是测试 Bot。/)
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previous
  }
})
