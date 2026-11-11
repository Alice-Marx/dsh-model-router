import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withIndependentChatNative } from '../tests/fixtures/independent-chat-native.mjs'
import { serveIndependentChatFixture } from './verify-independent-chat-browser.mjs'

const output = resolve('tmp/integration/independent-chat-ui'); await mkdir(output, { recursive: true })
await withIndependentChatNative(async f => {
  const checks = [], calls = [], errors = [], images = []
  let nativeStreams = 0, releaseStream, lastNativeMessages
  const fixture = await serveIndependentChatFixture({ native: true, handleApi: async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString(); calls.push(JSON.parse(body))
    const request = new Request(`http://127.0.0.1${incoming.url}`, { method: incoming.method, headers: incoming.headers, body })
    const response = await f.route.fetch(request)
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text())
  } })
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(fixture.url); await page.getByLabel('发消息给 Chief').waitFor()
    await page.waitForFunction(() => document.querySelector('.ic-composer textarea')?.disabled === false)
    const initial = await page.request.post(`${fixture.url}api/bot-product`, { data: { action: 'independentChat.view', payload: { botId: 'a' } } })
    assert.equal(initial.status(), 200); assert.equal((await initial.json()).value.available, true)
    await page.getByLabel('发消息给 Chief').fill('从实际 React 页面经拥有者通道发一条消息。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.locator('.ic-bubble').filter({ hasText: 'model answer' }).waitFor()
    assert.equal(f.ctx.upstream.length, 1); assert.equal(f.readRows('router_model_calls').length, 1)
    assert.equal(calls.filter(call => call.action === 'independentChat.send').length, 1)
    assert.ok(calls.some(call => call.action === 'independentChat.inspect'))
    assert.ok(calls.some(call => call.action === 'independentChat.messages'))
    checks.push('actual React → createProductApi fetch → registered product HTTP route → installed nativeweb owner admission → SQLite request journal → real Cordis/LlmRuntime SDK → exact Bot model → receipt → transcript page')
    const screenshot = join(output, 'chat-native-owner-sdk-wide.png'); await page.screenshot({ path: screenshot }); images.push(screenshot)
    await page.reload(); await page.locator('.ic-bubble').filter({ hasText: 'model answer' }).waitFor()
    assert.equal(calls.filter(call => call.action === 'independentChat.send').length, 1)
    assert.equal(f.ctx.upstream.length, 1)
    checks.push('reload restores the actual Bot transcript and never invokes another send or model call')
    const streamGate = new Promise(resolve => { releaseStream = resolve })
    class StreamingAdapter extends LlmAdapter {
      async listModels(provider) { return [{ provider, id: provider === 'alpha' ? 'one' : 'vendor/two', name: 'Offline streaming fixture' }] }
      async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 4096 }, defaultMaxTokens: 64 } }
      async *stream(options) {
        nativeStreams++
        lastNativeMessages = options.messages
        yield { type: 'text-delta', index: 0, text: '正在整理这项工作的依据。' }
        await streamGate
        options.signal.throwIfAborted()
        yield { type: 'text-delta', index: 0, text: '已经完成核对。' }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    f.ctx.replaceOfflineLlmAdapter(new StreamingAdapter())
    await page.getByLabel('发消息给 Chief').fill('通过实际 SDK 逐段显示这一次回复。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByRole('article', { name: '正在生成的回复' }).waitFor()
    assert.equal(await page.locator('.ic-streaming-text').textContent(), '正在整理这项工作的依据。')
    assert.equal(await page.locator('.ic-bubble').filter({ hasText: '正在整理这项工作的依据。' }).count(), 0)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForFunction(() => {
      const preview = document.querySelector('.ic-streaming-text')?.getBoundingClientRect(), log = document.querySelector('.ic-transcript')?.getBoundingClientRect()
      return preview && log && preview.top >= log.top && preview.bottom <= log.bottom
    })
    const streamingScreenshot = join(output, 'chat-native-owner-sdk-streaming-phone.png'); await page.screenshot({ path: streamingScreenshot }); images.push(streamingScreenshot)
    await page.reload(); await page.getByRole('article', { name: '正在生成的回复' }).waitFor()
    assert.equal(calls.filter(call => call.action === 'independentChat.send').length, 2)
    assert.equal(nativeStreams, 1)
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => (localStorage.getItem(key) ?? '').includes('正在整理这项工作的依据。'))), false)
    releaseStream()
    await page.locator('.ic-bubble').filter({ hasText: '正在整理这项工作的依据。已经完成核对。' }).waitFor()
    assert.equal(await page.locator('.ic-streaming').count(), 0)
    assert.equal(f.readRows('router_model_calls').length, 2)
    assert.equal(nativeStreams, 1)
    checks.push('actual SDK text arrives in a visibly unfinished React preview before transcript commit; browser reload inspects the live request without resend, then exactly one complete answer replaces the preview')
    const nextDraft = '保留给新对话的下一条消息。'
    await page.getByLabel('发消息给 Chief').fill(nextDraft)
    await page.getByRole('button', { name: '开启新对话', exact: true }).click()
    await page.getByRole('separator', { name: '新对话，旧聊天记录保留', exact: true }).waitFor()
    assert.equal(await page.getByLabel('发消息给 Chief').inputValue(), nextDraft)
    assert.equal(f.readRows('router_model_calls').length, 2)
    assert.equal(nativeStreams, 1)
    assert.equal(calls.filter(call => call.action === 'independentChat.newConversation').length, 1)
    await page.reload(); await page.getByRole('separator', { name: '新对话，旧聊天记录保留', exact: true }).waitFor()
    assert.equal(await page.getByLabel('发消息给 Chief').inputValue(), nextDraft)
    assert.equal(calls.filter(call => call.action === 'independentChat.newConversation').length, 1)
    const contextScreenshot = join(output, 'chat-native-new-context-phone.png'); await page.screenshot({ path: contextScreenshot }); images.push(contextScreenshot)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ic-message-assistant').length === 3)
    assert.deepEqual(lastNativeMessages.filter(row => row.role === 'user').map(row => row.content.map(part => part.text).join('')), [nextDraft])
    assert.equal(f.readRows('router_model_calls').length, 3)
    checks.push('an explicit new conversation persists once, keeps old messages and the unsent draft across reload, makes no model call, and sends only the fresh context on the next explicit submit')
    await f.runtime.move('a', 'integration')
    await page.getByRole('button', { name: '回到原生会话', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '发送消息' }).isDisabled(), true)
    await page.getByRole('button', { name: '回到原生会话', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.__independentChatFixture.nativeSessions), ['a'])
    checks.push('an actual committed runtime move disables independent sending and navigates to the Host-reported original Session')
    assert.deepEqual(errors, [])
    const report = { status: 'passed', checks, images, pageErrors: errors, requestCount: calls.length, sends: 3, sdkCalls: f.ctx.upstream.length + nativeStreams, receipts: f.readRows('router_model_calls').length,
      limitation: 'Installed nativeweb owner and real SQLite/SDK, isolated browser auth cookie and offline provider. No user profile, real credentials, live model or remote desktop.' }
    await writeFile(join(output, 'native-browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
  } finally { releaseStream?.(); await browser.close(); await fixture.close() }
})
