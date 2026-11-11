import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withIndependentChatNative } from './fixtures/independent-chat-native.mjs'
import { createBotLoop } from '../packages/orchestration/src/bot-loop.mjs'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: () => resolve() } }
const request = suffix => ({ botId: 'a', requestKey: 'native-streaming-request-' + suffix, input: 'Show a live preview for ' + suffix })
function streamingAdapter({ observed, release, previewed, first = '正在整理', fail = false }) {
  return new class extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'Offline streaming fixture' }] }
    async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 4096 }, defaultMaxTokens: 64 } }
    async *stream(options) {
      observed.push({ provider: options.provider, model: options.model })
      yield { type: 'text-delta', index: 0, text: first }
      previewed.resolve()
      await new Promise((resolve, reject) => {
        const abort = () => reject(options.signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (options.signal.aborted) return abort()
        options.signal.addEventListener('abort', abort, { once: true })
        release.promise.then(() => { options.signal.removeEventListener('abort', abort); resolve() })
      })
      if (!fail) yield { type: 'text-delta', index: 0, text: '，这是完整回答。' }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } }
      yield { type: 'finish', reason: { kind: fail ? 'error' : 'stop' } }
    }
  }()
}

test('a tool-batch preface leaves the transient preview before the recorded tool begins', async () => {
  const parent = resolve('tmp/integration/independent-streaming-loop')
  await mkdir(parent, { recursive: true })
  const store = openBotSessionStore({ dir: await mkdtemp(join(parent, 'case-')) })
  const entered = gate(), release = gate(), previews = []
  let calls = 0
  const loop = createBotLoop({ store,
    provider: async ({ onText }) => {
      calls++
      await onText(calls === 1 ? 'I will inspect the file.' : 'The inspection is complete.')
      return calls === 1 ? { text: 'I will inspect the file.', toolCalls: [{ id: 'read-1', name: 'read_file', args: {} }] }
        : { text: 'The inspection is complete.', toolCalls: [] }
    },
    tools: { call: async () => { entered.resolve(); await release.promise; return 'contents' } },
  })
  const pending = loop.run({ botId: 'a', input: 'inspect', onProgress: value => previews.push({ ...value }) })
  try {
    await entered.promise
    assert.equal(previews.at(-1).text, '')
    assert.equal(previews.at(-1).step, 1)
    assert.equal(store.get('a').messages.filter(row => row.content === 'I will inspect the file.').length, 1)
  } finally { release.resolve(); await pending }
  assert.equal(previews.at(-1).step, 2)
  assert.equal(previews.at(-1).text, 'The inspection is complete.')
  assert.equal(store.get('a').messages.at(-1).content, 'The inspection is complete.')
})

test('the authenticated native route exposes real SDK text before completion without committing a partial assistant', async () => {
  await withIndependentChatNative(async f => {
    const observed = [], release = gate(), previewed = gate(), input = request('success')
    f.ctx.replaceOfflineLlmAdapter(streamingAdapter({ observed, release, previewed }))
    try {
      const accepted = await f.action('independentChat.send', input)
      assert.equal(accepted.response.status, 200)
      await previewed.promise
      const partial = (await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value
      assert.equal(partial.state, 'running')
      assert.equal(partial.progress.text, '正在整理')
      assert.equal(partial.progress.step, 1)
      const sequence = partial.progress.sequence
      partial.progress.text = 'caller mutation'
      assert.equal((await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value.progress.text, '正在整理')
      const page = (await f.action('independentChat.messages', { botId: 'a' })).value.value
      assert.equal(page.items.filter(row => row.role === 'assistant').length, 0)
      assert.equal(page.items.filter(row => row.role === 'user').length, 1)
      await f.action('independentChat.send', input)
      assert.equal(observed.length, 1, 'transport retry cannot dispatch a second streaming call')
      assert.equal((await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value.progress.sequence, sequence)
    } finally { release.resolve(); await f.ctx.get('botIndependentChat').whenIdle() }
    const final = (await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value
    assert.equal(final.state, 'succeeded')
    assert.equal(final.progress, null)
    const page = (await f.action('independentChat.messages', { botId: 'a' })).value.value
    assert.deepEqual(page.items.filter(row => row.role === 'assistant').map(row => row.content), ['正在整理，这是完整回答。'])
    assert.equal(f.readRows('router_model_calls').length, 1)
    assert.equal(f.readRows('router_runs').length, 1)
  })
})

test('a failed stream removes its live preview and never promotes partial output to an answer', async () => {
  await withIndependentChatNative(async f => {
    const observed = [], release = gate(), previewed = gate(), input = request('failed')
    f.ctx.replaceOfflineLlmAdapter(streamingAdapter({ observed, release, previewed, fail: true }))
    try {
      await f.action('independentChat.send', input); await previewed.promise
      assert.equal((await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value.progress.text, '正在整理')
    } finally { release.resolve(); await f.ctx.get('botIndependentChat').whenIdle() }
    const status = (await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value
    assert.equal(status.state, 'unknown')
    assert.equal(status.progress, null)
    assert.equal(status.recoveryInput, input.input)
    assert.equal((await f.action('independentChat.messages', { botId: 'a' })).value.value.items.some(row => row.role === 'assistant'), false)
    await f.action('independentChat.send', input)
    assert.equal(observed.length, 1)
    assert.equal(f.readRows('router_model_calls').length, 1)
  })
})

test('cancellation reaches the streaming SDK and removes preview without claiming a stopped tool', async () => {
  await withIndependentChatNative(async f => {
    const observed = [], release = gate(), previewed = gate(), input = request('cancel')
    f.ctx.replaceOfflineLlmAdapter(streamingAdapter({ observed, release, previewed }))
    try {
      await f.action('independentChat.send', input); await previewed.promise
      const cancelled = (await f.action('independentChat.cancel', { botId: 'a', requestKey: input.requestKey })).value.value
      assert.equal(cancelled.cancelRequested, true)
      assert.equal(cancelled.stopConfirmed, false)
      await f.ctx.get('botIndependentChat').whenIdle()
      const status = (await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value
      assert.equal(status.state, 'cancelled')
      assert.equal(status.progress, null)
      assert.equal((await f.action('independentChat.messages', { botId: 'a' })).value.value.items.some(row => row.role === 'assistant'), false)
      assert.equal(observed.length, 1)
    } finally { release.resolve() }
  })
})

test('a live preview is bounded while the completed transcript retains the full response', async () => {
  await withIndependentChatNative(async f => {
    const observed = [], release = gate(), previewed = gate(), input = request('bounded'), first = 'a'.repeat(63999) + '😀' + 'b'.repeat(4000)
    f.ctx.replaceOfflineLlmAdapter(streamingAdapter({ observed, release, previewed, first }))
    try {
      await f.action('independentChat.send', input); await previewed.promise
      const preview = (await f.action('independentChat.inspect', { botId: 'a', requestKey: input.requestKey })).value.value.progress
      assert.equal(preview.truncated, true)
      assert.equal(preview.text.length, 63999, 'a truncated surrogate pair cannot leave malformed preview text')
    } finally { release.resolve(); await f.ctx.get('botIndependentChat').whenIdle() }
    const page = (await f.action('independentChat.messages', { botId: 'a' })).value.value
    assert.equal(page.items.find(row => row.role === 'assistant').content, first + '，这是完整回答。')
    assert.equal(f.readRows('router_model_calls').length, 1)
  })
})

