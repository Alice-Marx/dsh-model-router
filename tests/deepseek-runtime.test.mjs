import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deepseekWireModel, provisionDeepSeekRuntime, prepareDeepSeekTurn, readDeepSeekUsage } from '../packages/bot-engines/src/deepseek-runtime.mjs'

async function setup() {
  const parent = resolve('tmp/integration/deepseek-runtime-test'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'case-')), sdk = join(root, 'node_modules/@deepseek-ai/dsh-llm-deepseek')
  await mkdir(sdk, { recursive: true })
  await writeFile(join(root, 'entry.mjs'), '')
  await writeFile(join(sdk, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-deepseek', version: '0.2.2-rc.2', type: 'module', exports: { '.': './index.mjs', './package.json': './package.json' } }))
  await writeFile(join(sdk, 'index.mjs'), `export const resolveAdapterOptions = o => o; export const resolveDeepSeekApiKey = () => 'offline-key'; export const registerDeepSeekProvider = (ctx,p,deps) => { ctx.deps=deps; ctx.provider=p }`)
  const profile = { driver: 'deepseekAgent', model: 'deepseek-official/deepseek-flash', entry: { script: join(root, 'entry.mjs') } }
  await provisionDeepSeekRuntime(root, profile)
  const mod = await import(pathToFileURL(join(root, '.dsh/deepseek-meter.mjs')).href)
  const ctx = { on(event, listener) { assert.equal(event, 'llm/stream'); this.stream = listener } }
  mod.apply(ctx)
  return { root, ctx }
}
const collect = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }

test('DeepSeek ACP uses a fixed official route, one lease, each turn output bound and real disjoint usage', async () => {
  const { root, ctx } = await setup()
  assert.equal(ctx.provider, 'deepseek-official')
  assert.equal(ctx.deps.options().baseURL, 'https://api.deepseek.com/anthropic')
  assert.equal(ctx.deps.options().retryPolicy.maxRetries, 0)
  assert.equal(ctx.deps.options().thinking, 'disabled')
  assert.equal(deepseekWireModel('deepseek-official/deepseek-flash'), '["deepseek-official","deepseek-flash"]')
  const request = { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 64, reasoningEffort: 'off', tools: [], toolHistory: { tools: [], updates: [] } }
  let dispatched = 0
  const next = async function* () { dispatched++; yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 8 } }; yield { type: 'finish', reason: { kind: 'stop' } } }
  await assert.rejects(collect(ctx.stream(request, next)), { code: 'DEEPSEEK_TURN_LEASE_REQUIRED' })
  await prepareDeepSeekTurn(root, { maxTokens: 64 })
  assert.equal(ctx.deps.options().maxTokens, 64)
  await assert.rejects(prepareDeepSeekTurn(root), { code: 'DEEPSEEK_TURN_BUSY' })
  await collect(ctx.stream(request, next))
  await assert.rejects(collect(ctx.stream(request, next)), { code: 'DEEPSEEK_TURN_LEASE_REQUIRED' })
  assert.equal(dispatched, 1)
  assert.deepEqual(await readDeepSeekUsage(root), { input: 10, output: 2, cachedInput: 8 })
  assert.equal(await readDeepSeekUsage(root), null)
  await prepareDeepSeekTurn(root, { maxTokens: 32 })
  assert.equal(ctx.deps.options().maxTokens, 32)
  await assert.rejects(collect(ctx.stream({ ...request, maxTokens: 64 }, next)), { code: 'DEEPSEEK_TURN_BOUNDS_REFUSED' })
  assert.equal(await readDeepSeekUsage(root), null)
  assert.equal(dispatched, 1)
})

test('DeepSeek profile disables native tools, extra model calls and uploads; malformed or missing usage stays unknown', async () => {
  const { root, ctx } = await setup(), patch = JSON.parse(await readFile(join(root, '.dsh/cordis.patch.yml'), 'utf8'))
  for (const id of ['tool-bash', 'tool-fs', 'tool-web', 'compaction-basic', 'session-title-llm', 'session-log-deepseek', 'session-telemetry-otel']) assert.equal(patch.find(row => row.id === id).disabled, true)
  const request = { provider: 'deepseek-official', model: 'deepseek-flash', maxTokens: 16 }
  let dispatched = 0
  const next = async function* () { dispatched++; yield { type: 'finish', reason: { kind: 'stop' } } }
  await prepareDeepSeekTurn(root, { maxTokens: 16 })
  await assert.rejects(collect(ctx.stream({ ...request, tools: [{ name: 'shell' }] }, next)), { code: 'DEEPSEEK_TURN_BOUNDS_REFUSED' })
  await assert.rejects(collect(ctx.stream({ ...request, purpose: 'compaction' }, next)), { code: 'DEEPSEEK_TURN_BOUNDS_REFUSED' })
  await collect(ctx.stream(request, next))
  assert.equal(await readDeepSeekUsage(root), null)
  assert.equal(dispatched, 1)
  await assert.rejects(prepareDeepSeekTurn(root, { maxTokens: 4097 }), { code: 'DEEPSEEK_OUTPUT_BOUND_INVALID' })
  assert.throws(() => deepseekWireModel('gateway/deepseek-flash'), { code: 'DEEPSEEK_MODEL_INVALID' })
})
