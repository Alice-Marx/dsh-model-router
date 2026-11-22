import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createChatGptPlanOAuth } from '../packages/orchestration/src/chatgpt-plan-oauth.mjs'
import { createChatGptPlanCredentials } from '../packages/orchestration/src/chatgpt-plan-credentials.mjs'
import { ChatGptPlanAdapter } from '../packages/orchestration/src/chatgpt-plan-adapter.mjs'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

const grant = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const client = 'oaiapp_fixture'
const model = 'gpt-fixture'
const secretStore = () => {
  const values = new Map()
  return { values, readRecord: async key => values.get(key),
    async modifyRecord(key, mutate) {
      assert.match(key, /^model-router-galgame\/chatgpt-plan-[a-f0-9]{32}$/)
      const next = await mutate(values.get(key))
      if (next) values.set(key, next)
      return values.get(key)
    },
  }
}
const eventStream = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join(''),
  { headers: { 'content-type': 'text/event-stream' } })

test('official-style ChatGPT sign-in reaches both Bot runtimes with subscription funding and revokes on sign-out', async () => {
  let nonce, hostId, authorization, access = 'fixture-access-1', refresh = 'fixture-refresh-1', clock = Date.now(), rotated = 0
  const requests = [], vault = secretStore()
  const fetcher = async (input, init) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/oauth/token')) {
      const form = init.body
      assert.equal(form.get('client_id'), client)
      assert.equal(form.get('resource'), 'https://api.openai.com/v1')
      if (form.get('grant_type') === 'authorization_code') {
        assert.equal(form.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
        const { createHash } = await import('node:crypto')
        assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'))
      } else {
        assert.equal(form.get('grant_type'), 'refresh_token')
        assert.equal(form.get('refresh_token'), refresh)
        access = 'fixture-access-' + (++rotated + 1)
        refresh = 'fixture-refresh-' + (rotated + 1)
      }
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', id_token: 'fixture-identity', scope: grant })
    }
    if (url.pathname.endsWith('/openid-configuration')) return Response.json({
      issuer: 'https://auth.openai.com', revocation_endpoint: 'https://auth.openai.com/test-revocation',
    })
    if (url.pathname === '/test-revocation') {
      assert.equal(init.body.get('token'), refresh)
      assert.equal(init.body.get('client_id'), client)
      return new Response('')
    }
    assert.equal(init.headers.authorization, 'Bearer ' + access)
    if (url.pathname.endsWith('/models')) return Response.json({ models: [
      { slug: model, display_name: 'Fixture model', visibility: 'list' },
      { slug: 'hidden', visibility: 'hidden' },
    ] })
    assert.equal(url.href, 'https://api.openai.com/v1/responses')
    const body = JSON.parse(init.body)
    requests.push(body)
    assert.equal(body.model, model)
    assert.equal(body.store, false)
    assert.equal(body.stream, true)
    assert.ok(!body.input.some(message => message.role === 'system'))
    assert.ok(!Object.hasOwn(body, 'max_output_tokens'))
    const text = body.input.find(message => message.role === 'user' && message.content.endsWith(' fixture')).content
    return eventStream([
      { type: 'response.output_text.delta', delta: 'ChatGPT: ' + text },
      { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 5,
        input_tokens_details: { cached_tokens: 2 } } } },
    ])
  }
  const oauth = createChatGptPlanOAuth({ fetcher, verifyIdentity: async (token, id) => {
    assert.equal(token, 'fixture-identity')
    assert.equal(id, client)
    return { nonce, sub: 'fixture-subject', email: 'fixture@example.invalid' }
  }, now: () => clock })
  const plan = createChatGptPlanCredentials({ credentials: () => vault, fetcher, oauth, now: () => clock })
  let actual
  await withProductIndependent(async ({ ctx, bind, runtime, dispatch, readRows }) => {
    async function authorize(account) {
      const started = await dispatch('subscriptions.login', { provider: 'chatgpt',
        ...(account ? { id: account.id, expectedRevision: account.revision } : {}) })
      const payload = { loginId: started.loginId }
      for (let retry = 0; retry < 40; retry++) {
        const result = await dispatch('subscriptions.loginStatus', payload)
        if (result.status === 'pending') { authorization = new URL(result.login.url); break }
        assert.equal(result.status, 'preparing')
        await delay(10)
      }
      assert.equal(authorization.origin, 'https://auth.openai.com')
      const query = authorization.searchParams
      assert.equal(query.get('client_id'), account ? client : 'dynamic_agent_client')
      assert.equal(query.get('agent_name_hint'), account ? null : 'DS Bot')
      assert.equal(query.get('scope'), grant)
      assert.match(query.get('ext_agent_host_id'), /^urn:uuid:[a-f0-9-]+$/)
      hostId ??= query.get('ext_agent_host_id')
      assert.equal(query.get('ext_agent_host_id'), hostId)
      nonce = query.get('nonce')
      const callback = new URL(query.get('redirect_uri'))
      assert.equal(callback.hostname, '127.0.0.1')
      callback.searchParams.set('state', 'wrong')
      assert.equal((await fetch(callback)).status, 400)
      callback.searchParams.set('state', query.get('state'))
      callback.searchParams.set('code', 'fixture-code')
      if (!account) callback.searchParams.set('client_id', client)
      assert.equal((await fetch(callback)).status, 200)
      for (let retry = 0; retry < 40; retry++) {
        const result = await dispatch('subscriptions.loginStatus', payload)
        if (result.status === 'complete') return result.view.accounts[0]
        assert.equal(result.status, 'pending', result.message)
        await delay(10)
      }
      assert.fail('authorization did not complete')
    }

    const productView = ctx.get('botProductReadModel')
    await assert.rejects(productView.dispatch({ action: 'subscriptions.login', payload: { provider: 'chatgpt' } },
      { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
    let account = await authorize()
    const [{ provider }] = account.models
    assert.equal(account.models.length, 1)
    assert.doesNotMatch(JSON.stringify(account), /fixture-access|fixture-refresh|fixture-identity|oaiapp_fixture|fixture-subject/)
    await bind('a', provider, model)
    const handle = await actual.context.agents.create({ sessionId: 'a', agentOptions: { provider, model },
      setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
    let loopError
    handle.agent.ctx.on('agent/error', value => { loopError = value.error })
    try {
      handle.agent.send(createUserMessage({ content: [{ type: 'text', text: 'integrated fixture' }], source: { kind: 'user' } }), 'next-turn', true)
      await handle.agent.whenIdle()
      const history = handle.agent.session.deriveMessages()
      assert.ok(history.some(message => message.role === 'assistant'
        && message.content.some(block => block.text === 'ChatGPT: integrated fixture')), loopError?.stack ?? JSON.stringify({ requests: requests.length, receipts: readRows('router_model_calls') }))
    } finally { await handle.dispose() }
    await bind('b', provider, model)
    await runtime.move('b', 'independent')
    clock += 3_590_000
    const turn = await runtime.turn({ botId: 'b', input: 'independent fixture' })
    assert.equal(turn.answer, 'ChatGPT: independent fixture')
    assert.equal(rotated, 1)
    assert.equal(requests.length, 2)
    const receipts = readRows('router_model_calls').filter(item => item.outcome === 'succeeded')
    assert.equal(receipts.length, 2)
    assert.ok(receipts.every(item => item.funding === 'subscription' && item.pricing === null))
    assert.equal((await dispatch('subscriptions.list', {})).accounts[0].state, 'ready')
    assert.deepEqual(await dispatch('subscriptions.remove', { id: account.id, expectedRevision: account.revision }),
      { disconnected: true, revoked: true })
    assert.ok([...vault.values.values()].every(record => record.payload.tokens === null))
    assert.equal((await dispatch('subscriptions.list', {})).accounts[0].enabled, false)
    const accountId = account.id
    account = await authorize((await dispatch('subscriptions.list', {})).accounts[0])
    assert.equal(account.id, accountId)
    assert.equal(account.models[0].provider, provider)
  }, { chatGptPlan: plan, beforeProduct: async ({ ctx }) => {
    actual = await attachActualAgentLoop(ctx)
    return () => actual.close()
  } })
})

test('a partial ChatGPT stream followed by a limit error never completes a model turn', async () => {
  const controller = new AbortController()
  let verified = false, released = false
  const adapter = new ChatGptPlanAdapter({ provider: 'test-plan', model: { id: model, name: 'fixture' },
    acquire: async () => ({ token: 'fixture', signal: controller.signal, release: () => { released = true } }),
    markVerified: () => { verified = true },
    fetcher: async () => eventStream([{ type: 'response.output_text.delta', delta: 'partial' },
      { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]),
  })
  const chunks = []
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({ provider: 'test-plan', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] })) chunks.push(chunk)
  }, { code: 'subscription_sharing_usage_limit_exceeded' })
  assert.deepEqual(chunks.map(chunk => chunk.type), ['block-start', 'text-delta'])
  assert.equal(verified, false)
  assert.equal(released, true)
})
