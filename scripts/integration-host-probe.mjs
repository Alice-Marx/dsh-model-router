import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'

/** Actual SDK registry/guards, with no credentials, model adapter, files or shell tools. */
export async function probeToolBoundaries() {
  const root = new Context()
  let owner
  const scopes = []
  try {
    await root.plugin({ name: 'integration-m0-system-prompt', apply(ctx) {
      ctx.provide('systemPrompt', { tools() {}, section() {} })
    } })
    await root.plugin(ToolRuntime, { mode: 'native' })
    await root.plugin({ name: 'integration-m0-probe', inject: ['tools'], apply(ctx) { owner = ctx } })
    assert.ok(owner, 'real Cordis context resolved tools')
    const invocations = []
    for (const name of ['integration_read', 'integration_write']) {
      owner.tools.register(defineTool({
        name, description: 'Offline integration probe', parameters: {},
        output: { schema: { type: 'string' }, render: text => [{ type: 'text', text }] },
        execute() { invocations.push(name); return name },
      }))
    }
    const a = { id: 'probe-a' }
    const b = { id: 'probe-b' }
    const aScope = createScope(owner, a)
    const bScope = createScope(owner, b)
    scopes.push(aScope, bScope)
    const signal = new AbortController().signal
    const call = (agent, name, extra = {}) => owner.tools.execute({ callId: 'integration-probe', agent, name, arguments: {}, signal, ...extra })
    const liftRestriction = aScope.ctx.tools.restrict({ deny: ['integration_write'] })
    assert.equal(owner.tools.schemas(a).some(item => item.name === 'integration_write'), false)
    assert.equal(owner.tools.schemas(b).some(item => item.name === 'integration_write'), true)
    const hidden = await call(a, 'integration_write')
    assert.equal(hidden.isError, true)
    assert.equal(invocations.length, 0, 'hidden direct call did not enter tool body')
    const sibling = await call(b, 'integration_write')
    assert.notEqual(sibling.isError, true)
    assert.deepEqual(invocations, ['integration_write'])
    liftRestriction()

    const liftGuard = aScope.ctx.tools.guard(exec => exec.name === 'integration_write' ? 'denied by Bot policy' : undefined)
    const liftAllow = owner.on('tools/pre-execute', async () => ({ kind: 'allow' }))
    const denied = await call(a, 'integration_write')
    assert.equal(denied.isError, true)
    assert.match(JSON.stringify(denied), /denied by Bot policy/)
    assert.equal(invocations.length, 1, 'permissive waterfall cannot override monotonic guard')
    // A PTC child dispatch still traverses the same guard. This does not run a Python VM.
    const nested = await call(a, 'integration_write', { parent: {} })
    assert.equal(nested.isError, true)
    assert.equal(invocations.length, 1, 'nested dispatch did not bypass guard')
    const allowedRead = await call(a, 'integration_read')
    assert.notEqual(allowedRead.isError, true)
    const allowedSibling = await call(b, 'integration_write')
    assert.notEqual(allowedSibling.isError, true)
    liftAllow()
    liftGuard()
    const restored = await call(a, 'integration_write')
    assert.notEqual(restored.isError, true)
    return {
      status: 'passed', scope: 'real Cordis + DSH tools registry; offline tool bodies',
      checks: ['per-agent visibility', 'direct invocation denied', 'sibling unaffected', 'guard after allow waterfall', 'nested dispatch denied', 'read still usable', 'guard disposal restores access'],
      limitations: ['No live DSH Desktop/Web session', 'No actual PTC VM', 'No OS sandbox or machine tested', 'No product Bot policy installed'],
    }
  } finally {
    for (const scope of scopes.reverse()) await scope.dispose()
    const dispose = root.registry?.dispose
    if (typeof dispose === 'function') await dispose.call(root.registry)
  }
}

/** Confirm that a host admission listener can refuse before a mock adapter dispatch. */
export async function probeLlmAdmission() {
  const root = new Context()
  let owner
  let calls = 0
  let blocked = true
  const receipts = []
  class OfflineGptAdapter extends LlmAdapter {
    async *stream() {
      calls++
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  try {
    await root.plugin(LlmRuntime)
    await root.plugin({ name: 'integration-llm-probe', inject: ['llm'], apply(ctx) { owner = ctx } })
    owner.llm.registerAdapter(['integration-gpt-fixture'], new OfflineGptAdapter())
    owner.on('llm/stream', (options, next) => (async function* () {
      if (blocked) throw new Error('M0 admission blocked')
      receipts.push({ stage: 'admitted', sessionId: options.sessionId })
      for await (const chunk of next()) {
        if (chunk.type === 'usage') receipts.push({ stage: 'usage', ...chunk.usage })
        yield chunk
      }
    })())
    const consume = async () => {
      const chunks = []
      for await (const chunk of owner.llm.stream({ provider: 'integration-gpt-fixture', model: 'gpt-fixture',
        sessionId: 'integration-private-session', messages: [], signal: new AbortController().signal })) chunks.push(chunk)
      return chunks
    }
    await assert.rejects(consume(), /M0 admission blocked/)
    assert.equal(calls, 0)
    blocked = false
    const chunks = await consume()
    assert.equal(calls, 1)
    assert.equal(chunks.at(-1).type, 'finish')
    assert.deepEqual(receipts.map(item => item.stage), ['admitted', 'usage'])
    assert.equal(receipts[0].sessionId, 'integration-private-session')
    return { status: 'passed', scope: 'real LlmRuntime + offline GPT-named fixture, no network',
      checks: ['middleware refuses before dispatch', 'admission precedes adapter', 'session attribution and usage visible'],
      actualModelCalls: 0, mockAdapterDispatches: calls,
      limitations: ['No product budget implementation', 'No live Session/Agent loop', 'No proof against arbitrary privileged host plugins'] }
  } finally {
    const dispose = root.registry?.dispose
    if (typeof dispose === 'function') await dispose.call(root.registry)
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/integration-host-probe.mjs')) {
  (process.argv.includes('--llm') ? probeLlmAdmission() : probeToolBoundaries()).then(result => process.stdout.write(JSON.stringify(result, null, 2)+'\n'))
    .catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
}
