import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

// Offline control-plane responses and a real HTTP/SSE inference endpoint.
export async function subscriptionFixture() {
  const accounts = [], requests = [], operations = [], sessions = new Map()
  const key = 'fixture-subscription-client-key', managementKey = 'fixture-subscription-management-key'
  let generation = 1, phase = 'ready', failAuth = false, answer = 'SUBSCRIPTION-OK'
  const model = { id: 'fixture-codex', display_name: 'Fixture Codex', context_length: 4096, max_completion_tokens: 64, thinking: { levels: ['low', 'high', 'xhigh'] } }
  const server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk
    const body = JSON.parse(text || '{}'); requests.push({ url: request.url, authorization: request.headers.authorization, body })
    if (request.url !== '/v1/chat/completions' || request.headers.authorization !== 'Bearer ' + key || failAuth) { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'offline fixture auth failure' } })); return }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (delta, finish_reason = null, usage) => response.write('data: ' + JSON.stringify({ id: 'subscription-fixture', object: 'chat.completion.chunk', model: body.model,
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) }) + '\n\n')
    if (body.tools?.length && body.messages.at(-1)?.role !== 'tool') {
      event({ role: 'assistant', tool_calls: [{ index: 0, id: 'sub-call', type: 'function', function: { name: body.tools[0].function.name, arguments: '{"text":"fixture"}' } }] })
      event({}, 'tool_calls', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 })
    } else { event({ role: 'assistant', content: answer }); event({}, 'stop', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }) }
    response.end('data: [DONE]\n\n')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const runtime = {
    status: () => ({ phase, installed: true, enabled: phase === 'ready', version: 'fixture' }),
    connection: () => { if (phase !== 'ready') throw Object.assign(new Error('fixture offline'), { code: 'SUBSCRIPTION_PROXY_NOT_READY' }); return { endpoint: `http://127.0.0.1:${server.address().port}`, apiKey: key, managementKey, generation } },
    async initialize() {},
    enable() { phase = 'ready'; return runtime.status() },
    async ensureReady(options) { return runtime.enable(options) },
    async stop() { phase = 'disabled'; return runtime.status() },
    async close() { phase = 'disabled' },
    async request(path, options = {}) {
      options.signal?.throwIfAborted(); operations.push({ path, ...options }); runtime.connection()
      const url = new URL(path, 'http://fixture.invalid')
      if (url.pathname === '/v8/management/credentials' && options.method === 'DELETE') { const index = accounts.findIndex(a => a.name === url.searchParams.get('name')); if (index >= 0) accounts.splice(index, 1); return { status: 'ok' } }
      if (url.pathname === '/v8/management/credentials') return { files: structuredClone(accounts) }
      if (url.pathname === '/v8/management/credentials/fields') { const row = accounts.find(a => a.name === options.body.name); row.prefix = options.body.prefix; return { status: 'ok' } }
      if (url.pathname === '/v1/models') return { data: [{ id: 'unprefixed-api-model', context_length: 4096, max_completion_tokens: 64 }, ...accounts.filter(a => a.prefix && !a.disabled).flatMap(a => [{ id: a.prefix + '/' + model.id }, { id: a.prefix + '/missing-spec' }])] }
      if (url.pathname.startsWith('/v8/management/routing/model-definitions/')) return { models: [model] }
      if (url.pathname === '/v8/management/oauth/auth-url') { const state = randomUUID().replaceAll('-', ''); sessions.set(state, { status: 'wait', provider: options.body.provider }); return { status: 'ok', url: 'https://auth.openai.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=' + state, state } }
      if (url.pathname === '/v8/management/oauth/callback') { if (!sessions.has(options.body.state)) throw Error('unknown fixture state'); return { status: 'ok' } }
      if (url.pathname === '/v8/management/oauth/status') return { status: sessions.get(url.searchParams.get('state'))?.status ?? 'error' }
      if (url.pathname === '/v8/management/oauth/session') { sessions.delete(url.searchParams.get('state')); return { status: 'ok', cancelled: true } }
      throw Error('Unexpected fixture operation: ' + path)
    },
  }
  return { runtime, accounts, requests, operations, sessions, key, managementKey, model,
    addAccount(name = 'fixture-codex-account.json', patch = {}) { const account = { id: name, name, provider: 'codex', email: 'owner@example.test', status: 'active', disabled: false, runtime_only: false, source: 'memory', access_token: 'fixture-private-oauth-token', ...patch }; accounts.push(account); return account },
    completeLogin() { for (const value of sessions.values()) value.status = 'ok' },
    restart() { generation++ },
    rejectAuth() { failAuth = true },
    setAnswer(value) { answer = value },
    async close() { server.closeAllConnections(); await new Promise(done => server.close(done)) },
  }
}
