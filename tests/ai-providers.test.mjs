import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { openAiProviders } from '../packages/orchestration/src/ai-providers.mjs'
import { aiRequestContext } from '../packages/orchestration/src/ai-provider-adapter.mjs'
import { attachNativeLlm } from './helpers/product-native-llm.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const owner = { kind: 'owner' }, key = 'fixture-only-independent-key'
const model = { id: 'fixture-chat', name: 'Fixture chat', contextWindow: 4096, maxTokens: 64, reasoning: false }
const input = patch => ({ expectedRevision: 0, preset: 'custom', name: '独立测试', protocol: 'openai-completions', baseUrl: 'http://127.0.0.1:9999/v1', auth: 'key', enabled: true, apiKey: key, models: [model], ...patch })
export function memoryCredentials() {
  const values = new Map()
  return { values, async describe(ref) { return { configured: values.has(ref), writable: true } }, async set(ref, value) { values.set(ref, value) }, async resolve(ref) { return values.has(ref) ? { value: values.get(ref) } : undefined }, async unset(ref) { values.delete(ref) } }
}
const streamed = content => new Response(`data: ${JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', model: 'fixture-chat', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', model: 'fixture-chat', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
async function setup(work, { fetcher, usedBy } = {}) {
  const root = resolve('tmp/integration/ai-providers'); await mkdir(root, { recursive: true }); const home = await mkdtemp(join(root, 'case-'))
  const host = { state: {}, upstream: [] }, release = await attachNativeLlm(host), credentials = memoryCredentials(), file = join(home, 'orchestration.sqlite')
  const service = openAiProviders({ Database, file, llm: host.llm, credentials, fetcher, usedBy })
  try { await work({ service, host, credentials, file, home }) } finally { service.close(); await release() }
}

test('plugin connections persist separately, never disclose keys, and keep two accounts on unique routes', async () => {
  await setup(async ({ service, host, credentials, file }) => {
    await assert.rejects(service.save(input(), { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
    const first = await service.save(input(), owner), second = await service.save(input({ name: '另一个账号' }), owner)
    assert.notEqual(first.route, second.route)
    assert.ok(first.route.startsWith('bot-ai-'))
    assert.equal(credentials.values.size, 2)
    assert.deepEqual((await host.llm.listModels(first.route)).map(row => row.id), ['fixture-chat'])
    assert.equal((await host.llm.resolveModelInfo(first.route, model.id)).defaultMaxTokens, 64)
    const view = await service.list(owner)
    assert.equal(view.providers[0].keyConfigured, true)
    assert.doesNotMatch(JSON.stringify(view), new RegExp(key + '|secretRef|DSH_BOT_AI_'))
    const db = new Database(file, { readonly: true }); try { assert.equal(db.prepare('SELECT payload FROM bot_ai_providers').all().some(row => row.payload.includes(key)), false) } finally { db.close() }
    const before = (await service.list(owner)).providers[0]
    await assert.rejects(service.save(input({ ...before, keyConfigured: true }), owner), { code: 'AI_PROVIDER_INVALID' })
    await assert.rejects(service.save(input({ id: first.id, expectedRevision: 0 }), owner), { code: 'AI_PROVIDER_CONFLICT' })
    assert.equal(credentials.values.size, 2)
  })
})

test('API keys go to the independent endpoint, SDK sends the admitted cap, usage and text survive real SDK preparation', async () => {
  const sent = []
  await setup(async ({ service, host }) => {
    const saved = await service.save(input(), owner)
    const prepared = await host.llm.prepareCall({ provider: saved.route, model: model.id })
    assert.equal(prepared.config.maxTokens, 64)
    const output = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'offline chat' }] }] })) output.push(chunk)
    assert.ok(output.some(chunk => chunk.type === 'text-delta' && chunk.text === 'INDEPENDENT-OK'))
    assert.ok(output.some(chunk => chunk.type === 'usage' && chunk.usage.inputTokens === 12))
    assert.equal(output.at(-1).reason.kind, 'stop')
    assert.equal(sent[0].body.max_tokens ?? sent[0].body.max_completion_tokens, 64)
    assert.equal(new Headers(sent[0].init.headers).get('authorization'), 'Bearer ' + key)
    assert.equal(sent[0].init.redirect, 'error')
    assert.equal((await service.list(owner)).providers[0].state, 'ready')
  }, { fetcher: async (url, init) => { sent.push({ url: String(url), init, body: JSON.parse(init.body) }); return streamed('INDEPENDENT-OK') } })
})

test('a saved replacement refuses a captured prepared generation before HTTP and clears only its own key', async () => {
  let sent = 0
  await setup(async ({ service, host, credentials }) => {
    credentials.values.set('UNRELATED_HOST_KEY', 'unrelated-fixture')
    const first = await service.save(input(), owner)
    const prepared = await host.llm.prepareCall({ provider: first.route, model: model.id })
    await service.save(input({ id: first.id, expectedRevision: first.revision, apiKey: 'second-fixture-only-key' }), owner)
    const chunks = []
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, 'AI_PROVIDER_CHANGED')
    assert.equal(sent, 0); assert.equal(credentials.values.get('UNRELATED_HOST_KEY'), 'unrelated-fixture')
    const current = (await service.list(owner)).providers[0]
    await service.remove({ id: current.id, expectedRevision: current.revision }, owner)
    assert.deepEqual([...credentials.values.keys()], ['UNRELATED_HOST_KEY'])
    assert.equal(host.llm.listProviders().some(provider => provider.id === first.route), false)
  }, { fetcher: async () => { sent++; return streamed('must not be called') } })
})

test('public model listing is catalog access, not proof of authenticated inference; 401 and stale probes stay scoped', async () => {
  let reply = () => Response.json({ data: [{ id: model.id }] })
  await setup(async ({ service }) => {
    const first = await service.save(input(), owner)
    const probe = await service.probe({ id: first.id }, owner)
    assert.equal(probe.health.kind, 'catalog'); assert.equal(probe.state, 'configured')
    reply = () => new Response('provider echoed ' + key, { status: 401 })
    const failed = await service.probe({ id: first.id }, owner)
    assert.equal(failed.health.code, 'AUTH'); assert.equal(failed.health.status, 401)
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(key))
    let release
    reply = () => new Promise(resolve => { release = resolve })
    const pending = service.probe({ id: first.id }, owner)
    while (!release) await new Promise(resolve => setImmediate(resolve))
    await service.save(input({ id: first.id, expectedRevision: first.revision, name: '新连接名称', apiKey: undefined }), owner)
    release(Response.json({ data: [{ id: 'old-model' }] }))
    await assert.rejects(pending, { code: 'AI_PROVIDER_CHANGED' })
    assert.equal((await service.list(owner)).providers[0].health, null)
  }, { fetcher: (...args) => reply(...args) })
})

test('owner input cannot put credentials in URLs, bypass capacity, or delete an in-use provider', async () => {
  await setup(async ({ service }) => {
    for (const patch of [{ baseUrl: 'http://example.com/v1' }, { baseUrl: 'https://user:secret@example.com/v1' }, { baseUrl: 'https://example.com/v1?key=fixture' }, { models: [{ ...model, maxTokens: 4096 }] }]) await assert.rejects(service.save(input(patch), owner))
    const first = await service.save(input(), owner)
    await assert.rejects(service.remove({ id: first.id, expectedRevision: first.revision }, owner), { code: 'AI_PROVIDER_IN_USE' })
  }, { usedBy: () => [{ id: 'a', name: 'Chief' }] })
})

test('Gemini catalog checks accept a root or an already versioned service URL without duplicating the API version', async () => {
  const requests = []
  await setup(async ({ service }) => {
    for (const suffix of ['', '/v1', '/v1beta']) {
      const saved = await service.save(input({ protocol: 'google-generative-ai', baseUrl: 'http://127.0.0.1:9999' + suffix }), owner)
      const checked = await service.probe({ id: saved.id }, owner)
      assert.equal(checked.health.kind, 'catalog')
      assert.equal(checked.state, 'configured')
    }
    assert.deepEqual(requests, Array(3).fill('http://127.0.0.1:9999/v1beta/models'))
  }, { fetcher: async (url, init) => {
    requests.push(String(url))
    assert.equal(init.headers['x-goog-api-key'], key)
    return Response.json({ models: [{ name: 'models/fixture-chat' }] })
  } })
})

test('a cancelled transport which ignores abort cannot hold the provider check open', async () => {
  await setup(async ({ service }) => {
    const first = await service.save(input(), owner), controller = new AbortController()
    const pending = service.probe({ id: first.id }, { ...owner, signal: controller.signal })
    await new Promise(resolve => setImmediate(resolve)); controller.abort()
    await assert.rejects(Promise.race([pending, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('hung')), 300))]), error => error.name === 'AbortError')
  }, { fetcher: () => new Promise(() => {}) })
})

test('changing a connection cancels an active model call even when its transport ignores abort', async () => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  await setup(async ({ service, host }) => {
    const first = await service.save(input(), owner)
    const prepared = await host.llm.prepareCall({ provider: first.route, model: model.id })
    const pending = (async () => { const chunks = []; for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) chunks.push(chunk); return chunks })()
    await ready
    await service.save(input({ id: first.id, expectedRevision: first.revision, apiKey: 'updated-fixture-key' }), owner)
    const chunks = await Promise.race([pending, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('hung model call')), 500))])
    assert.equal(chunks.at(-1).reason.kind, 'aborted')
  }, { fetcher: () => { started(); return new Promise(() => {}) } })
})

test('replay cannot replace edited or redacted canonical content and tool errors retain their call identity', () => {
  const context = aiRequestContext({ model: 'one', messages: [
    { role: 'assistant', source: { provider: 'bot-ai-fixture', model: 'one', replayState: { meta: { kind: 'dsh-bot-ai-v1', contentHash: 'outdated' }, content: [{ type: 'text', text: key }] } }, content: [{ type: 'text', text: '[redacted]' }, { type: 'tool-call', id: 'call-a', name: 'read_notes', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'call-a', source: { kind: 'tool', callId: 'call-a' }, isError: true, content: [{ type: 'text', text: 'refused' }] },
  ] }, { route: 'bot-ai-fixture', protocol: 'openai-completions' })
  assert.doesNotMatch(JSON.stringify(context), new RegExp(key))
  assert.equal(context.messages[1].toolCallId, 'call-a'); assert.equal(context.messages[1].toolName, 'read_notes'); assert.equal(context.messages[1].isError, true)
})

test('saved plugin connections and credential references survive a clean runtime restart', async () => {
  await setup(async ({ service, host, credentials, file }) => {
    const saved = await service.save(input(), owner); service.close()
    const reopened = openAiProviders({ Database, file, llm: host.llm, credentials })
    try { assert.equal((await reopened.list(owner)).providers[0].route, saved.route); assert.equal((await host.llm.resolveModelInfo(saved.route, model.id)).context.contextWindow, 4096) }
    finally { reopened.close() }
  })
})

test('two owners racing on the same revision cannot replace the winning key or leave a usable losing generation', async () => {
  await setup(async ({ service, credentials, file }) => {
    const saved = await service.save(input(), owner)
    const second = openAiProviders({ Database, file, llm: { registerAdapter: () => () => {} }, credentials })
    const original = credentials.set.bind(credentials)
    let writes = 0, resolveGate
    const gate = new Promise(resolve => { resolveGate = resolve })
    credentials.set = async (ref, value) => { await original(ref, value); writes++; if (writes === 2) resolveGate(); await gate }
    try {
      const results = await Promise.allSettled([
        service.save(input({ id: saved.id, expectedRevision: saved.revision, name: 'owner-A', apiKey: 'fixture-owner-A-key' }), owner),
        second.save(input({ id: saved.id, expectedRevision: saved.revision, name: 'owner-B', apiKey: 'fixture-owner-B-key' }), owner),
      ])
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'AI_PROVIDER_CONFLICT')
      const winner = results.find(result => result.status === 'fulfilled').value
      assert.equal(winner.revision, 2); assert.deepEqual([...credentials.values.values()], [`fixture-${winner.name}-key`])
    } finally { second.close() }
  })
})

const protocols = {
  'anthropic-messages': [
    ['message_start', { type: 'message_start', message: { id: 'msg-fixture', type: 'message', role: 'assistant', model: 'fixture-chat', content: [], usage: { input_tokens: 12, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PROTOCOL-OK' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }],
    ['message_stop', { type: 'message_stop' }],
  ],
  'google-generative-ai': [['', { candidates: [{ content: { parts: [{ text: 'PROTOCOL-OK' }], role: 'model' }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 } }]],
  'openai-responses': [
    ['response.created', { type: 'response.created', response: { id: 'resp-fixture', model: 'fixture-chat', status: 'in_progress', output: [] } }],
    ['response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-fixture', role: 'assistant', status: 'in_progress', content: [] } }],
    ['response.content_part.added', { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: 'msg-fixture', part: { type: 'output_text', text: '', annotations: [] } }],
    ['response.output_text.delta', { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg-fixture', delta: 'PROTOCOL-OK' }],
    ['response.output_item.done', { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg-fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PROTOCOL-OK', annotations: [] }] } }],
    ['response.completed', { type: 'response.completed', response: { id: 'resp-fixture', model: 'fixture-chat', status: 'completed', output: [], usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } }],
  ],
}
for (const [protocol, frames] of Object.entries(protocols)) test(`independent ${protocol} streams through its real provider SDK with the explicit stored key and cap`, async () => {
  const requests = []
  await setup(async ({ service, host }) => {
    const saved = await service.save(input({ protocol }), owner)
    const prepared = await host.llm.prepareCall({ provider: saved.route, model: model.id })
    const chunks = []; for await (const chunk of prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'offline protocol' }] }] })) chunks.push(chunk)
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'PROTOCOL-OK'), JSON.stringify(chunks))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    const body = requests[0].body
    assert.equal(body.max_tokens ?? body.max_output_tokens ?? body.generationConfig?.maxOutputTokens, 64)
    const headers = new Headers(requests[0].headers)
    assert.equal(headers.get('x-api-key') ?? headers.get('x-goog-api-key') ?? headers.get('authorization'), protocol === 'openai-responses' ? 'Bearer ' + key : key)
    assert.equal(new URL(requests[0].url).pathname, protocol === 'anthropic-messages' ? '/v1/messages' : protocol === 'google-generative-ai' ? '/v1beta/models/fixture-chat:streamGenerateContent' : '/v1/responses')
  }, { fetcher: async (url, init) => { requests.push({ url: typeof url === 'string' ? url : url.url, headers: init?.headers ?? url.headers, body: JSON.parse(init?.body ?? await url.clone().text()) }); return new Response(frames.map(([event, data]) => `${event ? 'event: ' + event + '\n' : ''}data: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }) } })
})

for (const protocol of ['openai-completions', 'google-generative-ai']) test(`independent ${protocol} preserves a structured tool call, reply and replay signature across two real SDK calls`, async () => {
  let calls = 0; const sent = []
  const signature = Buffer.from('fixture-thought-signature').toString('base64')
  await setup(async ({ service, host }) => {
    const saved = await service.save(input({ protocol }), owner)
    const tools = [{ name: 'fixture_echo', description: 'Return the fixture value', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }]
    const user = { role: 'user', content: [{ type: 'text', text: 'Use the fixture tool.' }] }
    const first = await host.llm.prepareCall({ provider: saved.route, model: model.id }), chunks = []
    for await (const chunk of first.stream({ ...first.config, messages: [user], tools })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.kind, 'tool-calls', JSON.stringify(chunks))
    const content = chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block)
    const call = content.find(block => block.type === 'tool-call')
    assert.equal(call.name, 'fixture_echo'); assert.deepEqual(JSON.parse(call.arguments), { value: 'ok' })
    const messages = [user, { id: 'assistant-fixture', role: 'assistant', source: { kind: 'model', provider: saved.route, model: model.id, replayState: chunks.at(-1).replayState }, content },
      { id: 'tool-fixture', role: 'tool', source: { kind: 'tool', callId: call.id }, toolCallId: call.id, content: [{ type: 'text', text: 'tool-result-ok' }] }]
    const next = await host.llm.prepareCall({ provider: saved.route, model: model.id }), final = []
    for await (const chunk of next.stream({ ...next.config, messages, tools })) final.push(chunk)
    assert.equal(final.at(-1).reason.kind, 'stop')
    assert.match(JSON.stringify(sent[1]), /tool-result-ok/)
    if (protocol === 'openai-completions') assert.equal(sent[1].messages.find(message => message.role === 'tool').tool_call_id, call.id)
    else assert.ok(JSON.stringify(sent[1]).includes(signature))
  }, { fetcher: async (_url, init) => {
    sent.push(JSON.parse(init.body)); calls++
    if (calls > 1) return protocol === 'google-generative-ai' ? new Response(protocols['google-generative-ai'].map(([_event, data]) => `data: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }) : streamed('TOOL-DONE')
    const frames = protocol === 'google-generative-ai' ? [{ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'fixture_echo', args: { value: 'ok' } }, thoughtSignature: signature }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 } }]
      : [{ id: 'tool-fixture', model: model.id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-fixture', type: 'function', function: { name: 'fixture_echo', arguments: '{"value":"ok"}' } }] }, finish_reason: null }] }, { id: 'tool-fixture', model: model.id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }]
    return new Response(frames.map(data => `data: ${JSON.stringify(data)}\n\n`).join('') + (protocol === 'openai-completions' ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } })
  } })
})

test('a damaged record cannot redirect an independent connection to an unrelated Host credential', async () => {
  await setup(async ({ service, credentials, file }) => {
    const saved = await service.save(input(), owner)
    credentials.values.set('UNRELATED_HOST_KEY', 'must-not-be-resolved')
    const db = new Database(file)
    try { const row = db.prepare('SELECT payload FROM bot_ai_providers WHERE id=?').get(saved.id); const value = JSON.parse(row.payload); value.secretRef = 'UNRELATED_HOST_KEY'; db.prepare('UPDATE bot_ai_providers SET payload=? WHERE id=?').run(JSON.stringify(value), saved.id) } finally { db.close() }
    await assert.rejects(service.list(owner), { code: 'AI_PROVIDER_STORE_INVALID' })
  })
})
