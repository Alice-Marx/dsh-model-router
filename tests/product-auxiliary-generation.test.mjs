import test from 'node:test'
import assert from 'node:assert/strict'
import { withAuxiliaryGeneration, GENERATION_A, GENERATION_B } from './helpers/auxiliary-generation.mjs'
import { createAuxiliaryModelStream } from '../packages/orchestration/src/model-auxiliary-dispatch.mjs'

// The auxiliary seam: whose call it is, what the Host redacts before binding, and which
// generation's capability decides the steward's effort. Every case runs the installed
// Cordis/LlmRuntime with an offline transport and the real accounting over real SQLite.

test('the auxiliary stream prepares once, records one frame and streams the prepared generation', async () => {
  await withAuxiliaryGeneration(async h => {
    const seen = await h.aux(h.request())
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].generation, 'A')
    assert.equal(h.upstream[0].purpose, 'compaction')
    assert.equal(h.upstream[0].sessionId, 'sa')
    assert.ok(seen.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'stop'))
    // The frame lived exactly as long as the one dispatch that set it.
    assert.equal(h.frames.read(h.upstream[0].signal), null)
    assert.equal(h.admissions(), 1)
    assert.equal((await h.receipts()).length, 1)
    assert.equal((await h.receipts())[0].outcome, 'succeeded')
  })
})

test('a registration swapped after prepare does not reach the dispatched generation', async () => {
  await withAuxiliaryGeneration(async h => {
    h.gate.afterPrepare = () => h.useSwap()
    await h.aux(h.request())
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].generation, 'A')
    assert.equal(h.upstream[0].maxTokens, GENERATION_A.defaultMaxTokens)
    assert.equal(h.admissions(), 1)
    assert.equal((await h.receipts()).length, 1)
    // Control: the ordinary stream re-resolves at dispatch, so the same swap reaches it.
    const control = await h.raw(h.request())
    assert.equal(h.upstream[1].generation, 'B')
    assert.equal(h.upstream[1].maxTokens, GENERATION_B.defaultMaxTokens)
    assert.ok(control.some(chunk => chunk.type === 'finish'))
  })
})

test("the steward's off effort is decided by the generation being prepared, not by the current registration", async () => {
  await withAuxiliaryGeneration(async h => {
    // Prepare under A, replace the route with B before dispatch: A answers and A's own
    // capability is what allowed the off effort.
    h.gate.afterPrepare = () => h.useSwap()
    await h.aux(h.request(), { controls: h.auxService.reasoningOff })
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].generation, 'A')
    assert.equal(h.upstream[0].reasoningEffort, 'off')
  })
  await withAuxiliaryGeneration(async h => {
    // The mirror image: prepare under B, which declares no reasoning at all, while A owns
    // the route at dispatch. No effort is sent, so B is not forced into one it cannot take.
    h.useSwap()
    h.gate.afterPrepare = () => h.usePrimary()
    await h.aux(h.request(), { controls: h.auxService.reasoningOff })
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].generation, 'B')
    assert.equal(h.upstream[0].reasoningEffort, undefined)
  })
})

test('a current-registration read that forces off onto a generation without it fails, which is what the seam replaces', async () => {
  await withAuxiliaryGeneration(async h => {
    // B owns the route. Reading the current registration would say nothing about off; reading
    // A's would send an effort B refuses. The bare stream proves the refusal is real.
    h.useSwap()
    const control = await h.raw(h.request({ reasoningEffort: 'off' }))
    assert.ok(control.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'error'))
    // The prepared seam instead asks B itself and sends nothing.
    await h.aux(h.request(), { controls: h.auxService.reasoningOff })
    assert.equal(h.upstream.at(-1).generation, 'B')
    assert.equal(h.upstream.at(-1).reasoningEffort, undefined)
  })
})

test('the Host redactor runs before preparation, so the frozen secret listener does not rebuild the request', async () => {
  await withAuxiliaryGeneration(async h => {
    h.commitSecret('SECRETVALUE')
    const messages = h.tagUsage([{ role: 'user', content: [{ type: 'text', text: 'use SECRETVALUE now' }] }], { sessionId: 'sa', kind: 'compaction' })
    await h.aux(h.request({ messages }), { controls: h.auxService.reasoningOff })
    // One traversal: the redaction already happened, so the vendor-style listener had
    // nothing to rebuild and never re-entered llm.stream.
    assert.equal(h.traversals.count, 1)
    assert.equal(h.upstream.length, 1)
    assert.equal(JSON.stringify(h.upstream[0].messages).includes('SECRETVALUE'), false)
    // The usage provenance the redaction rebuild would otherwise drop is carried over.
    assert.deepEqual(h.usageTagOf(h.upstream[0].messages), { sessionId: 'sa', kind: 'compaction' })
    assert.equal((await h.receipts()).length, 1)
  }, {
    secretsRewrite: ({ ctx, llm, redact }) => {
      const rewritten = new WeakSet()
      // The frozen listener's own shape: a walk that keeps object identity when nothing
      // changed, so only a request that still carries a value is rebuilt and re-entered.
      const walk = value => {
        if (typeof value === 'string') return redact(value)
        if (Array.isArray(value)) {
          const next = value.map(walk)
          return next.some((item, index) => item !== value[index]) ? next : value
        }
        if (value && Object.getPrototypeOf(value) === Object.prototype) {
          const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]))
          return Object.keys(next).some(key => next[key] !== value[key]) ? next : value
        }
        return value
      }
      ctx.on('llm/stream', (options, next) => {
        if (rewritten.has(options.messages)) return next()
        const messages = walk(options.messages), system = walk(options.system)
        if (messages === options.messages && system === options.system) return next()
        const fresh = [...(messages ?? [])]
        rewritten.add(fresh)
        return llm.stream({ ...options, messages: fresh, ...(system !== undefined ? { system } : {}) })
      })
    },
  })
})

test('a caller that names its own Bot, subject, grant or funding is refused before anything is prepared', async () => {
  await withAuxiliaryGeneration(async h => {
    for (const claim of [{ botId: 'b' }, { subject: h.directory.forSession('sa') }, { grant: { tools: ['model/infer'] } },
      { authority: 'host' }, { funding: 'api' }, { allowance: 100 }, { maxOutputTokens: 9999 }, { pricing: { input: 1, output: 2 } }]) {
      await assert.rejects(() => h.aux(h.request(claim)), error => error.code === 'MODEL_AUXILIARY_IDENTITY_UNTRUSTED', JSON.stringify(claim))
    }
    assert.equal(h.upstream.length, 0)
    assert.equal(h.admissions(), 0)
    assert.equal((await h.receipts()).length, 0)
  })
})

test("an auxiliary call for another Bot's Session is admitted as that Bot, never as the caller's", async () => {
  await withAuxiliaryGeneration(async h => {
    h.bindSession('sb', 'b')
    await h.aux(h.request({ sessionId: 'sb' }))
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
    assert.equal((await h.receipts())[0].botId, 'b')
    // A Bot whose grant no longer stands is refused by the authority, not re-attributed.
    h.revoke('b')
    await assert.rejects(() => h.aux(h.request({ sessionId: 'sb' })))
    assert.equal(h.upstream.length, 1)
  })
})

test('a Session the Host does not know refuses the call with zero provider calls and zero receipts', async () => {
  await withAuxiliaryGeneration(async h => {
    await assert.rejects(() => h.aux(h.request({ sessionId: 'sz' })), error => error.code === 'MODEL_AUXILIARY_IDENTITY_REQUIRED')
    assert.equal(h.upstream.length, 0)
    assert.equal(h.admissions(), 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
  })
})

test('a Host whose runtime exposes no prepareCall refuses instead of downgrading to the racy bare stream', async () => {
  await withAuxiliaryGeneration(async h => {
    await assert.rejects(() => h.aux(h.request()), error => error.code === 'MODEL_PREPARED_UNAVAILABLE')
    assert.equal(h.upstream.length, 0)
    assert.equal(h.admissions(), 0)
    assert.equal((await h.receipts()).length, 0)
  }, { auxiliary: { llm: () => ({ stream: () => (async function* () {})() }) } })
})

test('an explicit invalid output bound is refused before a model is prepared', async () => {
  await withAuxiliaryGeneration(async h => {
    for (const bound of [null, -5, 0, 1.5]) {
      await assert.rejects(() => h.aux(h.request({ maxTokens: bound })), error => error.code === 'MODEL_OUTPUT_BOUNDARY_REQUIRED')
    }
    assert.equal(h.upstream.length, 0)
    assert.equal(h.admissions(), 0)
    assert.equal((await h.receipts()).length, 0)
  })
})

test('the auxiliary service refuses a Host that wired no identity, no redaction or no frame store', async () => {
  const frames = { set() {}, read() { return null }, delete() {} }
  for (const options of [{ llm: {}, frames }, { llm: {}, frames, redact: () => '' }, { llm: {}, frames, identityFor: () => ({ botId: 'a' }) },
    { llm: {}, identityFor: () => ({ botId: 'a' }), redact: () => '' }]) {
    assert.throws(() => createAuxiliaryModelStream(options))
  }
  const service = createAuxiliaryModelStream({ llm: {}, frames, identityFor: () => ({ botId: 'a' }), redact: text => text })
  assert.equal(typeof service, 'function')
  assert.equal(typeof service.stream, 'function')
  assert.equal(typeof service.reasoningOff, 'function')
  assert.deepEqual(service.reasoningOff(GENERATION_A.reasoning ? { reasoning: GENERATION_A.reasoning } : {}), { reasoningEffort: 'off' })
  assert.equal(service.reasoningOff({}), undefined)
  assert.equal(service.reasoningOff({ reasoning: { efforts: [{ id: 'high', name: 'High' }] } }), undefined)
})
