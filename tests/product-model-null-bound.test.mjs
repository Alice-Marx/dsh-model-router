import test from 'node:test'
import assert from 'node:assert/strict'
import { withModelBounds } from './helpers/model-request-bounds.mjs'

test('explicit null output is refused before the SDK can dispatch an unbounded request priced as its default', async t => {
  await withModelBounds(async harness => {
    const request = Object.freeze(harness.request({ maxTokens: null }))
    const call = harness.call(request).then(async value => {
      t.diagnostic(JSON.stringify({ unexpectedDispatch: harness.upstream.map(row => ({ model: row.model, maxTokens: row.maxTokens })),
        receiptCount: (await harness.receipts()).length, runCount: harness.runs().length }))
      return value
    })
    await assert.rejects(call, { code: 'MODEL_OUTPUT_BOUNDARY_REQUIRED' })
    assert.equal(harness.upstream.length, 0)
    assert.equal((await harness.receipts()).length, 0)
    assert.equal(harness.runs().length, 0)
  })
})
