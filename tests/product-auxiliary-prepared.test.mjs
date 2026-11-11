import test from 'node:test'
import assert from 'node:assert/strict'
import { withAuxiliaryGeneration, GENERATION_A, GENERATION_WIDER } from './helpers/auxiliary-generation.mjs'

// The prepared auxiliary chain: one preparation, one waterfall traversal, one dispatch, one
// receipt — and a refusal that leaves no provider call, no reservation and no money behind.
// The installed Cordis/LlmRuntime, the real prepared dispatcher, the real shared frame store
// and the real accounting over a real SQLite router state are all the product's own code.

test('one auxiliary call traverses the waterfall once, dispatches once and leaves one receipt', async () => {
  await withAuxiliaryGeneration(async h => {
    await h.aux(h.request())
    // One traversal: no listener re-prepared, no second waterfall, no takeover.
    assert.equal(h.traversals.count, 1)
    assert.equal(h.admissions(), 1)
    assert.equal(h.upstream.length, 1)
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].state, 'settled')
    assert.equal(receipts[0].source, 'aux')
    assert.equal(receipts[0].provider, 'alpha')
    assert.equal(receipts[0].model, 'one')
    assert.equal(h.runs().length, 1)
  })
})

test('a note retry and a checkpoint are two separate generations, each with its own receipt', async () => {
  await withAuxiliaryGeneration(async h => {
    // The Bot's own retry loop makes one call per attempt; the seam is per call.
    await h.aux(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: 'attempt one' }] }] }))
    await h.aux(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: 'attempt two' }] }] }))
    await h.aux(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: 'the checkpoint' }] }],
      toolHistory: [{ id: 'call-1', name: 'read_own_chat' }], tools: [{ name: 'read_own_chat' }] }))
    assert.equal(h.traversals.count, 3)
    assert.equal(h.upstream.length, 3)
    assert.deepEqual(h.upstream.map(call => call.toolHistoryCount), [0, 0, 1])
    assert.deepEqual(h.upstream.map(call => call.toolCount), [0, 0, 1])
    assert.equal((await h.receipts()).length, 3)
    assert.ok((await h.receipts()).every(receipt => receipt.outcome === 'succeeded'))
    assert.equal(h.runs().length, 3)
  })
})

test('admission uses the captured metadata, so a wider registration swapped in before dispatch is refused for a bare call but not for the prepared one', async () => {
  await withAuxiliaryGeneration(async h => {
    h.gate.afterPrepare = () => h.useSwap()
    await h.aux(h.request())
    // The prepared frame admitted generation A's window; the dispatch streamed A.
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].generation, 'A')
    assert.equal((await h.receipts()).length, 1)
  }, { b: GENERATION_WIDER })
  await withAuxiliaryGeneration(async h => {
    // Control: the same wider registration reached by the ordinary stream is refused, because
    // a point read of the current registration prices a window the grant does not cover.
    h.useSwap()
    await assert.rejects(() => h.raw(h.request()), error => error.code === 'MODEL_INPUT_BOUNDARY_REQUIRED')
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
  }, { b: GENERATION_WIDER })
})

test('a secret committed after preparation refuses the rewritten request before provider or money, then a fresh note works', async () => {
  await withAuxiliaryGeneration(async h => {
    const value = 'late-offline-secret-never-a-real-credential'
    h.gate.afterPrepare = () => h.commitSecret(value)
    await assert.rejects(() => h.aux(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: `Please protect ${value}.` }] }] })),
      error => error.code === 'MODEL_PREPARED_REQUEST_REWRITTEN')
    // Zero provider calls, zero receipts, zero runs: the refusal precedes every one of them.
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
    // A fresh explicit intent works, and the saved secret is still redacted before preparation.
    h.gate.afterPrepare = null
    const seen = await h.aux(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: `Please protect ${value}.` }] }] }))
    assert.ok(seen.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 1)
    assert.equal(JSON.stringify(h.upstream[0].messages).includes(value), false)
    assert.equal((await h.receipts()).length, 1)
  }, {
    secretsRewrite: ({ ctx, llm, redact }) => {
      const rewritten = new WeakSet()
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

test('a cancellation mid-stream ends the call, the receipt records it cancelled, and the dispatched signal is its own', async () => {
  let controller
  await withAuxiliaryGeneration(async h => {
    controller = new AbortController()
    const caller = controller.signal
    const seen = await h.aux(h.request({ signal: caller }))
    assert.ok(seen.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'aborted'))
    // A per-call signal, linked to the caller's: a different object, aborted by the same cause.
    assert.notEqual(h.upstream[0].signal, caller)
    assert.equal(h.upstream[0].signal.aborted, true)
    assert.equal(caller.aborted, true)
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].outcome, 'cancelled')
  }, { beforeChunk: async index => { if (index === 1 && controller) controller.abort() } })
})

test('a grant revoked between prepare and admission refuses the dispatch with zero provider calls and zero receipts', async () => {
  await withAuxiliaryGeneration(async h => {
    h.gate.afterPrepare = () => h.revoke('a')
    // The Host's own identity read refuses the revoked subject before the admission runs.
    await assert.rejects(() => h.aux(h.request()), error => error.code === 'SUBJECT_REVOKED')
    assert.equal(h.traversals.count, 1)
    assert.equal(h.admissions(), 0)
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
  })
})

test('funding the Host does not have refuses with zero provider calls, zero receipts and zero reservations', async () => {
  await withAuxiliaryGeneration(async h => {
    await assert.rejects(() => h.aux(h.request()), error => error.code === 'MODEL_FUNDING_REQUIRED')
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
  }, { funding: { a: null } })
})

test('a request above the priced allowance is lowered for the dispatched generation only', async () => {
  await withAuxiliaryGeneration(async h => {
    // The note asks for more than the allowance; the clamp lands before the config freezes,
    // so the dispatched request, the receipt and the estimate all describe one generation.
    await h.aux(h.request({ maxTokens: 5000 }))
    assert.equal(h.upstream[0].maxTokens, 100)
    assert.equal(h.upstream[0].generation, 'A')
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].outcome, 'succeeded')
  }, { maxOutputTokens: 100 })
})

test('subscription funding keeps its zero money and the adapter default bound', async () => {
  await withAuxiliaryGeneration(async h => {
    await h.aux(h.request())
    assert.equal(h.upstream[0].maxTokens, GENERATION_A.defaultMaxTokens)
    const receipts = await h.receipts()
    assert.equal(receipts[0].funding, 'subscription')
    assert.equal(h.runs()[0].packages[0].costUsd, 0)
  }, { funding: { a: { funding: 'subscription' } } })
})

test('two Bots admitted concurrently each keep their own signal, frame, funding and receipt', async () => {
  await withAuxiliaryGeneration(async h => {
    h.bindSession('sb', 'b')
    const [first, second] = await Promise.all([
      h.aux(h.request({ sessionId: 'sa' })),
      h.aux(h.request({ sessionId: 'sb', messages: [{ role: 'user', content: [{ type: 'text', text: 'the other note' }] }] })),
    ])
    assert.ok(first.some(chunk => chunk.type === 'finish'))
    assert.ok(second.some(chunk => chunk.type === 'finish'))
    // Two independent generations: two traversals, two dispatches, two distinct signals, and
    // no frame from one call ever keyed the other's admission.
    assert.equal(h.traversals.count, 2)
    assert.equal(h.admissions(), 2)
    assert.equal(h.upstream.length, 2)
    assert.notEqual(h.upstream[0].signal, h.upstream[1].signal)
    const receipts = await h.receipts()
    assert.equal(receipts.length, 2)
    assert.deepEqual(receipts.map(receipt => receipt.botId).sort(), ['a', 'b'])
    assert.ok(receipts.every(receipt => receipt.outcome === 'succeeded'))
    assert.equal(h.runs().length, 2)
  }, { funding: { b: { funding: 'subscription' } } })
})

test('a second dispatch of one prepared generation is refused by the SDK, not silently replayed', async () => {
  await withAuxiliaryGeneration(async h => {
    const captured = []
    h.gate.afterPrepare = ({ prepared }) => { if (captured.length === 0) captured.push(prepared) }
    await h.aux(h.request())
    assert.equal(captured.length, 1)
    // The one-shot fence is the SDK's own: the same handle cannot dispatch twice.
    assert.throws(() => captured[0].stream({ provider: 'alpha', model: 'one', messages: [] }),
      error => error.code === 'INVALID_PREPARED_CALL')
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
  })
})
