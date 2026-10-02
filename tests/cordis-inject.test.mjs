// 0.13.1 regression: Cordis throws `cannot get property "<name>" without inject`
// for any ctx.<name> read of a service missing from the plugin's inject list,
// even through optional chaining. 0.13.0 read ctx?.credentials in the executor,
// so every workbench run (and model_router_execute) failed in the Harness while
// plain-object test mocks passed. These tests use the real Cordis runtime.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HOST_INJECT, strictCtx } from './helpers/strict-ctx.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-cordis-inject-'))
const host = await import('../.dsh-plugin/index.mjs')

const PLUGIN_DIR = new URL('../.dsh-plugin/', import.meta.url)

function fakeLlm(calls) {
  return {
    listProviders: () => [{ id: 'acme' }],
    listModels: async () => [{ id: 'acme-chat' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model }),
    stream(options) {
      calls.push(options.model)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: '完成。' }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

/**
 * A real Cordis plugin context with exactly the Host plugin's inject list.
 * As in the Harness, every service, including `credentials`, comes from a
 * sibling provider plugin (a service on an ancestor fiber would be readable
 * without inject and would hide the bug).
 */
async function harnessLikeContext({ withCredentials = true } = {}) {
  const calls = []
  const root = new Context()
  const services = {
    commands: { register() {} },
    llm: fakeLlm(calls),
    tools: { register() {} },
    typert: { register() { return () => {} } },
    sandboxPolicy: { resolve: () => null },
    sandbox: {},
    ...(withCredentials ? { credentials: { describe: async () => ({ configured: false }) } } : {}),
  }
  for (const [name, value] of Object.entries(services)) {
    await root.plugin({ name: `provider-${name}`, apply: ctx => { ctx.provide(name, value) } })
  }
  let pluginCtx
  await root.plugin({ name: 'model-router-probe', inject: host.inject, apply: ctx => { pluginCtx = ctx } })
  assert.ok(pluginCtx, 'probe plugin loaded with the Host inject list')
  return { ctx: pluginCtx, calls }
}

const planOptions = { skipToolProbe: true, installedToolIds: [], runnableToolIds: [], loggedOutToolIds: [] }

test('cordis: the test context really enforces inject for sibling-provided services', async t => {
  const { ctx } = await harnessLikeContext()
  assert.throws(() => ctx.credentials, /cannot get property "credentials" without inject/)
  assert.throws(() => ctx?.credentials?.getApiKey, /without inject/, 'optional chaining does not help')
  assert.equal(typeof ctx.get('credentials')?.describe, 'function', 'ctx.get() reads it without inject')
  assert.equal(host.optionalService(ctx, 'credentials'), ctx.get('credentials'))
  assert.equal(host.optionalService(ctx, 'no-such-service'), undefined)
})

for (const withCredentials of [true, false]) {
  test(`cordis: workbench preview and run succeed with a real plugin context (credentials service ${withCredentials ? 'present' : 'absent'})`, async t => {
    const { ctx, calls } = await harnessLikeContext({ withCredentials })
    const workspace = await mkdtemp(join(tmpdir(), 'model-router-cordis-ws-'))
    t.after(() => rm(workspace, { recursive: true, force: true }))
    const request = { task: '用一句话总结这个项目。', planMode: 'single', preset: 'balanced', workspace }
    const preview = await host.previewWorkbenchRun(ctx, {}, request, { planOptions })
    assert.equal(preview.selected.provider, 'acme')
    assert.equal(preview.readOnly, true)
    const confirmedReasons = preview.reasons.map(item => item.code)
    const started = await host.startWorkbenchRun(ctx, {}, { ...request, confirmedReasons }, { planOptions })
    assert.notEqual(started.status, 'needs-confirmation')
    assert.ok(started.runId, 'the run was recorded')
    const run = (await host.ledgerSummary({})).runs.find(item => item.id === started.runId)
    assert.equal(run?.error ?? null, null, `run error: ${run?.error}`)
    assert.equal(started.status, 'completed')
    assert.deepEqual(calls, ['acme-chat'], 'the step ran through the Harness LLM')
    // The remote (typert) handlers used by the client wrap the same calls.
    const remote = host.routerRemoteServices(ctx, {})
    assert.equal(typeof remote.previewRun, 'function')
    assert.equal(typeof remote.startRun, 'function')
  })
}

test('cordis: model_router_execute path (executeConfiguredAssignment) and step rerun do not touch non-injected services', async t => {
  const { ctx } = await harnessLikeContext()
  const workspace = await mkdtemp(join(tmpdir(), 'model-router-cordis-ws-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const result = await host.executeConfiguredAssignment(ctx, '把“你好”翻译成英文。', {}, { ...planOptions, workspace })
  assert.equal(result.execution.status, 'completed')
  const pkg = result.run.packages[0]
  await host.rateRecordedResult({ runId: result.runId, packageId: pkg.id, rating: 'down' })
  const rerun = await host.rerunRecordedStep(ctx, {}, { runId: result.runId, packageId: pkg.id, provider: 'acme', model: 'acme-chat', skipOfficial: () => null })
  assert.equal(rerun.run.packages[0].ok, true)
  assert.equal(rerun.run.error ?? null, null)
})

test('strictCtx mirrors the Host inject list and Cordis semantics', () => {
  assert.deepEqual([...HOST_INJECT], [...host.inject])
  const ctx = strictCtx({ llm: {} }, { provided: { credentials: { ok: true } } })
  assert.throws(() => ctx.credentials, /cannot get property "credentials" without inject/)
  assert.deepEqual(ctx.get('credentials'), { ok: true })
  assert.deepEqual(ctx.llm, {})
})

// Every ctx.<name> read in Host code must be an injected service or a Cordis
// built-in. Optional services go through ctx.get(name) (see optionalService).
const CORDIS_BUILTINS = new Set(['root', 'events', 'registry', 'reflect', 'logger', 'fiber', 'name', 'extend', 'isolate', 'intercept',
  'get', 'set', 'provide', 'accessor', 'mixin', 'runtime', 'effect', 'inject', 'plugin',
  'on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])
// Reviewed exceptions: read inside try/catch after ctx.get(), for lightweight callers.
const GUARDED = new Map([['shared/watcher.mjs', new Set(['sessionProjections'])]])

async function hostSources() {
  const files = []
  for (const name of await readdir(PLUGIN_DIR)) if (name.endsWith('.mjs')) files.push(name)
  for (const name of await readdir(new URL('shared/', PLUGIN_DIR))) if (name.endsWith('.mjs')) files.push(`shared/${name}`)
  return files
}

test('static scan: Host code reads only injected services or Cordis built-ins from ctx', async () => {
  const allowed = new Set([...host.inject, ...CORDIS_BUILTINS])
  const offenders = []
  for (const file of await hostSources()) {
    const source = await readFile(new URL(file, PLUGIN_DIR), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const match of code.matchAll(/\bctx\??\.([A-Za-z_$][\w$]*)/g)) {
      const name = match[1]
      if (allowed.has(name) || GUARDED.get(file)?.has(name)) continue
      offenders.push(`${file}: ctx.${name}`)
    }
  }
  assert.deepEqual([...new Set(offenders)], [])
})
