import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withModelGeneration, ROUTES } from './helpers/model-generation.mjs'

// One prepared model generation, admitted and dispatched as the same generation. Every case
// runs the real money authority over a real SQLite router state, the real principal authority
// and the installed Cordis/LlmRuntime with the offline transport; only the provider's answers
// are fixtures. Each case asserts what the adapter that actually streamed received and what
// the ledger recorded — never a restatement of the helper's arithmetic.

test('a prepared dispatch streams the captured generation and records one receipt', async () => {
  await withModelGeneration(async h => {
    const seen = await h.prepared(h.request())
    assert.ok(seen.some(chunk => chunk.type === 'finish'))
    // The request declared no bound; the pinned adapter's own default is what dispatched.
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].adapter, 'A')
    assert.equal(h.upstream[0].maxTokens, ROUTES.one.defaultMaxTokens)
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].funding, 'api')
    assert.equal(receipts[0].botId, 'a')
    assert.equal(receipts[0].outcome, 'succeeded')
    assert.equal(receipts[0].usageComplete, true)
    assert.equal(h.runs().length, 1)
    assert.equal(h.runs()[0].status, 'completed')
  })
})

test('a registration swapped after prepare does not reach the dispatched generation', async () => {
  await withModelGeneration(async h => {
    // Prepare under A, then replace the route's adapter with B before the stream dispatches.
    await h.prepared(h.request(), { gate: () => h.useSwap() })
    // The one-shot stream dispatched A — the generation it was prepared with.
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].adapter, 'A')
    assert.equal(h.upstream[0].maxTokens, ROUTES.one.defaultMaxTokens)
    // Admission priced A's captured window (4096) and recorded the one receipt.
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].outcome, 'succeeded')
    // Control: the ordinary stream, dispatched now, re-resolves to B — the swap is real and
    // only the prepared path holds the captured generation.
    await h.raw(h.request())
    assert.equal(h.upstream[1].adapter, 'B')
  })
})

test('a registration swapped back after prepare still dispatches the captured one', async () => {
  await withModelGeneration(async h => {
    h.useSwap() // B owns the route now
    await h.prepared(h.request(), { gate: () => h.usePrimary() }) // prepare B, restore A, dispatch
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].adapter, 'B')
    assert.equal(h.upstream[0].maxTokens, 16) // B's own default, not A's
    assert.equal((await h.receipts())[0].outcome, 'succeeded')
  })
})

test('admission uses the captured metadata, not a re-read after the adapter config changes', async () => {
  await withModelGeneration(async h => {
    // Prepare under a 4096 window, then the adapter's own answer grows to 9999 before admission.
    await h.prepared(h.request(), { gate: () => { h.live.table.one = { contextWindow: 9999, defaultMaxTokens: 64 } } })
    // Admission admitted on the captured 4096 window (≤ the 4096 grant), so it succeeded.
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
    // Control: a non-prepared admission re-reads the grown 9999 window and is refused, with no
    // provider call and no receipt — proving the prepared path admitted the snapshot, not a read.
    await assert.rejects(() => h.raw(h.request()), error => error.code === 'MODEL_INPUT_BOUNDARY_REQUIRED')
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
  })
})

test('a window wider than the grant is refused before any provider call or receipt', async () => {
  await withModelGeneration(async h => {
    await assert.rejects(() => h.prepared(h.request()), error => error.code === 'MODEL_INPUT_BOUNDARY_REQUIRED')
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
  }, { funding: { a: { maxInputTokens: 3000 } } })
})

test('a request that declares an invalid bound is refused before prepare can bind it', async () => {
  await withModelGeneration(async h => {
    await assert.rejects(() => h.prepared(h.request({ maxTokens: -5 })), error => error.code === 'MODEL_OUTPUT_BOUNDARY_REQUIRED')
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
  })
})

test('a request above the allowance is lowered to the allowance, not refused', async () => {
  await withModelGeneration(async h => {
    // The request asks for 5000; the priced allowance is 100. The clamp lands before the
    // config freezes, so the dispatched request carries 100 — the correct recovery.
    await h.prepared(h.request({ maxTokens: 5000 }))
    assert.equal(h.upstream[0].maxTokens, 100)
    assert.equal((await h.receipts())[0].outcome, 'succeeded')
  })
})

test('a one-shot prepared stream dispatches once and refuses a second dispatch', async () => {
  await withModelGeneration(async h => {
    const controller = new AbortController()
    const prepared = await h.llm.prepareCall({ provider: 'alpha', model: 'one', maxTokens: 100 }, controller.signal, controls => controls)
    const options = { provider: 'alpha', model: 'one', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], maxTokens: 100, signal: controller.signal }
    await h.asBot('a', async () => { for await (const _ of prepared.stream(options)) { /* drain */ } })
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
    // A second dispatch of the same handle fails before any provider call or receipt.
    await assert.rejects(async () => { for await (const _ of prepared.stream(options)) { /* drain */ } }, error => error.code === 'INVALID_PREPARED_CALL')
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
  })
})

test('two bots admitted concurrently each keep their own generation and receipt', async () => {
  await withModelGeneration(async h => {
    h.registerBot('b')
    const [seenA, seenB] = await Promise.all([
      h.prepared(h.request(), { botId: 'a' }),
      h.prepared(h.request(), { botId: 'b' }),
    ])
    assert.ok(seenA.some(chunk => chunk.type === 'finish'))
    assert.ok(seenB.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 2)
    assert.ok(h.upstream.every(entry => entry.adapter === 'A'))
    const receipts = await h.receipts()
    assert.equal(receipts.length, 2)
    assert.deepEqual(receipts.map(receipt => receipt.botId).sort(), ['a', 'b'])
    assert.ok(receipts.every(receipt => receipt.outcome === 'succeeded'))
  })
})

test('a grant revoked between prepare and admission refuses the dispatch', async () => {
  await withModelGeneration(async h => {
    await assert.rejects(() => h.prepared(h.request(), { gate: () => h.revoke('a') }))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
  })
})

test('a cancellation mid-stream ends the turn and the receipt records it cancelled', async () => {
  let controller
  await withModelGeneration(async h => {
    controller = new AbortController()
    const seen = await h.prepared(h.request({ signal: controller.signal }))
    // The cancellation surfaces as an aborted terminal finish — the adapter boundary turns the
    // lease/caller signal abort into a finish chunk, not a thrown error — and the receipt
    // records the turn cancelled rather than succeeded.
    assert.ok(seen.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'aborted'))
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].outcome, 'cancelled')
  }, { beforeChunk: async index => { if (index === 1 && controller) controller.abort() } })
})

test('the secret rewrite rebuilds the request without losing the frame', async () => {
  const secretRequest = () => ({ provider: 'alpha', model: 'one', messages: [{ role: 'user', content: [{ type: 'text', text: 'use SECRETVALUE now' }] }] })
  await withModelGeneration(async h => {
    // Prepare under a 4096 window, then the adapter's own answer grows to 9999, and the secret
    // rewrite rebuilds the request and re-enters llm.stream — exactly as the frozen ds-bot
    // listener does. The frame is keyed by the signal, which the rebuild carries unchanged.
    const request = h.request({ messages: secretRequest().messages })
    await h.prepared(request, { gate: () => { h.live.table.one = { contextWindow: 9999, defaultMaxTokens: 64 } } })
    // Admission admitted the captured 4096 window, so the frame survived the rebuild: one receipt.
    assert.equal(h.upstream.length, 1)
    assert.equal((await h.receipts()).length, 1)
    assert.equal((await h.receipts())[0].outcome, 'succeeded')
    // Control: a non-prepared call re-reads the grown window and is refused.
    const control = h.request({ messages: secretRequest().messages })
    await assert.rejects(() => h.raw(control), error => error.code === 'MODEL_INPUT_BOUNDARY_REQUIRED')
    assert.equal(h.upstream.length, 1)
  }, {
    secretsRewrite: ({ ctx, llm }) => {
      const rewritten = new WeakSet()
      ctx.on('llm/stream', (options, next) => {
        if (rewritten.has(options.messages)) return next()
        const messages = options.messages.map(message => ({ ...message,
          content: (message.content ?? []).map(block => typeof block.text === 'string' ? { ...block, text: block.text.replaceAll('SECRETVALUE', '[secret:X]') } : block) }))
        if (messages.every((message, index) => message === options.messages[index])) return next()
        rewritten.add(messages)
        return llm.stream({ ...options, messages })
      })
    },
  })
})

test('two tool steps each open exactly one receipt', async () => {
  await withModelGeneration(async h => {
    await h.prepared(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: 'step one' }] }] }))
    await h.prepared(h.request({ messages: [{ role: 'user', content: [{ type: 'text', text: 'step two' }] }] }))
    assert.equal(h.upstream.length, 2)
    assert.equal((await h.receipts()).length, 2)
    assert.equal(h.runs().length, 2)
    assert.ok((await h.receipts()).every(receipt => receipt.outcome === 'succeeded'))
  })
})

test('subscription funding keeps its zero money and the adapter default bound', async () => {
  await withModelGeneration(async h => {
    await h.prepared(h.request())
    assert.equal(h.upstream[0].maxTokens, ROUTES.one.defaultMaxTokens) // no clamp, adapter default stands
    const receipts = await h.receipts()
    assert.equal(receipts[0].funding, 'subscription')
    assert.equal(h.runs()[0].packages[0].costUsd, 0)
  }, { funding: { a: { funding: 'subscription' } } })
})
