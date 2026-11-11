import test from 'node:test'
import assert from 'node:assert/strict'
import { withAuxiliaryHost } from './helpers/auxiliary-generation.mjs'
import { createAuxiliaryModelStream } from '../packages/orchestration/src/model-auxiliary-dispatch.mjs'

// The auxiliary seam on the real product: the bundled patched vendored DS Bot runtime, the real
// `createBotProduct` listener stack, the real principal directory and Bot policy, and the real
// `createModelAccounting` over a real SQLite router state. Only the provider transport and the
// committed funding are fixtures; every admission, lease and receipt is the product's code.

/** The auxiliary stream the parent composes, wired with the Host's own services. */
function auxiliaryService(harness, { frames = harness.frames } = {}) {
  return createAuxiliaryModelStream({
    llm: () => harness.llm,
    frames,
    fundingFor: async ({ botId, provider, model }) => ({ funding: 'api', route: { provider, model },
      pricing: { input: 1, output: 2 }, maxInputTokens: 4096, maxOutputTokens: 100 }),
    identityFor: request => harness.policy.modelIdentity(request),
    redact: text => harness.rt.redactSecrets(text),
    carryUsageTag: (from, to) => harness.rt.carryUsageTag(from, to),
  })
}

const noteRequest = (sessionId, extra = {}) => ({
  provider: 'alpha', model: 'one',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'write the handoff note' }] }],
  system: 'You are writing a handoff note.',
  toolHistory: [{ id: 'call-1', name: 'read_own_chat' }],
  tools: [{ name: 'read_own_chat' }],
  maxTokens: 900,
  sessionId,
  purpose: 'compaction',
  signal: new AbortController().signal,
  ...extra,
})

test('the real product chain admits an auxiliary prepared call as one aux receipt, redacted before preparation', async t => {
  await withAuxiliaryHost(t, async h => {
    h.bindChatSession('a')
    // The composition has not wired the seam yet; the parent's provide is the one thing missing.
    assert.equal(h.ctx.get('botAuxiliaryModelStream'), undefined)
    const service = auxiliaryService(h)
    h.provide(service)

    const secret = 'offline-aux-secret-never-a-real-credential'
    await h.rt.secretEndpoint('secret-set', { name: h.secretName, value: secret, scope: ['a'] })

    const seen = []
    for await (const chunk of service(noteRequest('a', {
      messages: [{ role: 'user', content: [{ type: 'text', text: `write the note, and protect ${secret}` }] }],
    }), { controls: service.reasoningOff })) seen.push(chunk)

    // The call reached the provider through the real Host stack, exactly once.
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].provider, 'alpha')
    assert.equal(h.upstream[0].model, 'one')
    assert.equal(h.upstream[0].purpose, 'compaction')
    assert.equal(h.upstream[0].sessionId, 'a')
    assert.equal(h.upstream[0].reasoningEffort, 'off', 'the prepared generation decided the off effort')
    assert.equal(h.upstream[0].maxTokens, 100, 'the clamp landed on the dispatched generation')
    assert.equal(JSON.stringify(h.upstream[0].messages).includes(secret), false, 'the Host redactor ran before preparation')
    assert.ok(seen.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'stop'))

    // The shared store held exactly one frame for this call, recorded before dispatch, with the
    // capacities of the generation that streamed; afterwards it is gone.
    assert.equal(h.framesAtSet.length, 1)
    assert.deepEqual(h.framesAtSet[0].bounds, { contextWindow: 4096, defaultMaxTokens: 64 })
    assert.equal(h.framesAtSet[0].provider, 'alpha')
    assert.equal(h.framesAtSet[0].model, 'one')
    assert.equal(h.framesAtSet[0].request.maxTokens, 100)
    assert.equal(h.frames.read(h.upstream[0].signal), null)

    // The one money authority recorded exactly one aux receipt for this Bot.
    const receipts = await h.receipts('a')
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].source, 'aux')
    assert.equal(receipts[0].provider, 'alpha')
    assert.equal(receipts[0].state, 'settled')

    // A caller that names its own Bot is refused by the seam, not re-attributed.
    await assert.rejects(() => service(noteRequest('a', { botId: 'b', messages: [] })).next(),
      error => error.code === 'MODEL_AUXILIARY_IDENTITY_UNTRUSTED')
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts('a')).length, 1)
  }, { funding: { a: {} }, bounds: { contextWindow: 4096, defaultMaxTokens: 64,
    reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } } })
})

test('an auxiliary call for a Session the Host has not bound is refused before any provider call or receipt', async t => {
  await withAuxiliaryHost(t, async h => {
    const service = auxiliaryService(h)
    h.provide(service)
    await assert.rejects(() => service(noteRequest('unknown-session')).next(),
      error => error.code === 'MODEL_AUXILIARY_IDENTITY_REQUIRED')
    assert.deepEqual(h.upstream, [])
    assert.deepEqual(await h.receipts('a'), [])
  })
})

test('a second Bot cannot borrow another Bot Session for its auxiliary call', async t => {
  await withAuxiliaryHost(t, async h => {
    h.bindChatSession('a')
    h.bindChatSession('b')
    const service = auxiliaryService(h)
    h.provide(service)
    // Bot b's own Session is admitted as Bot b, with Bot b's funding — never as Bot a.
    await h.directory.replaceGrant('b', { tools: ['model/infer'], modelRoutes: [{ provider: 'alpha', model: 'one' }] })
    const seen = []
    for await (const chunk of service(noteRequest('b'))) seen.push(chunk)
    assert.ok(seen.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 1)
    const receipts = await h.receipts('b')
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].source, 'aux')
    assert.equal((await h.receipts('a')).length, 0)
  }, { funding: { a: {}, b: {} } })
})
