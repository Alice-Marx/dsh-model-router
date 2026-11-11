import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'
import { createIndependentRuntime } from '../packages/orchestration/src/bot-runtime-assembly.mjs'
import { createIndependentChatService } from '../packages/orchestration/src/independent-chat-service.mjs'
import { independentContextId, MAX_CONTEXTS } from '../packages/orchestration/src/independent-context-state.mjs'
import { createIndependentConversationReader } from '../packages/orchestration/src/independent-chat-page.mjs'

const owner = { kind: 'owner' }
const nonce = suffix => `independent-context-${suffix}-20261109`
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function directory() { const root = resolve('tmp/integration/independent-context'); mkdirSync(root, { recursive: true }); return mkdtempSync(join(root, 'case-')) }
async function fixture(t, options = {}) {
  const dir = directory(), requests = [], retirements = []
  const runtime = createIndependentRuntime({ dir, integration: async () => ({ answer: 'integrated' }),
    providerFor: botId => async request => { requests.push({ botId, messages: structuredClone(request.messages) }); return { text: 'answer' } },
    retireConversation: async (...args) => { retirements.push(args); return { treeStopped: true } }, ...options })
  await runtime.move('a', 'independent'); await runtime.move('b', 'independent')
  const adapter = { ...runtime, modeOf: botId => runtime.describe(botId).runtime, conversationPage: createIndependentConversationReader({ dir }) }
  const settings = { Database, file: join(dir, 'requests.sqlite'), lifecycle: { committedBot: id => ['a', 'b'].includes(id) ? { id } : null }, runtime: () => adapter }
  const service = createIndependentChatService(settings)
  t.after(() => { service.close(); runtime.close() })
  return { dir, runtime, requests, retirements, adapter, service, settings }
}
test('legacy transcript keeps stable ids and tool provenance; Host append owns context tags', () => {
  const dir = directory(), file = join(dir, 'a.json')
  const raw = { schemaVersion: 1, botId: 'a', createdAt: 3, updatedAt: 4, turns: 2, messages: [
    { role: 'user', content: 'legacy question', at: 3 },
    { role: 'assistant', content: 'tool preface', messageId: 'stable-batch', toolCalls: [{ id: 'call-1', name: 'read', args: {} }], modelSource: { kind: 'model', provider: 'alpha', model: 'one' } },
    { role: 'tool', content: 'result', toolCallId: 'call-1', isError: true },
  ] }
  writeFileSync(file, JSON.stringify(raw))
  const store = openBotSessionStore({ dir }), before = store.get('a')
  assert.equal(before.contextId, 'legacy')
  const contextId = independentContextId('a', nonce('store'))
  store.beginContext('a', { requestKey: nonce('store'), contextId, expectedContextId: 'legacy' })
  assert.throws(() => store.append('a', [{ role: 'user', content: 'blocked' }]), { code: 'INDEPENDENT_CONTEXT_PENDING_RECONCILIATION' })
  store.commitContext('a', { requestKey: nonce('store'), contextId })
  store.append('a', [{ role: 'user', content: 'new input', contextId: 'forged-legacy' }])
  const after = store.get('a')
  assert.deepEqual(after.messages.slice(0, 3), before.messages)
  assert.equal(after.messages[3].contextId, contextId)
  assert.equal(after.messages[1].messageId, 'stable-batch')
  assert.equal(after.messages[2].isError, true)
  assert.equal(after.turns, 2)
})
test('a Host without a retirement seam refuses reset without inventing not-started proof', async t => {
  const f = await fixture(t, { retireConversation: null })
  await assert.rejects(f.runtime.newConversation('a', { requestKey: nonce('missing-seam') }), { code: 'INDEPENDENT_CONTEXT_RETIREMENT_UNAVAILABLE', outcome: 'refused' })
  assert.equal(f.runtime.contextOf('a').resetPending, false)
  assert.deepEqual(f.runtime.busyBots(), [])
  assert.equal(f.requests.length, 0)
})
test('new context retains all history but only its current input reaches the provider; Bots stay isolated', async t => {
  const f = await fixture(t)
  await f.runtime.turn({ botId: 'a', input: 'old a' }); await f.runtime.turn({ botId: 'b', input: 'old b' })
  const aBefore = f.runtime.contextOf('a'), bBefore = f.runtime.contextOf('b')
  const next = await f.runtime.newConversation('a', { requestKey: nonce('project'), expectedContextId: aBefore.contextId })
  assert.notEqual(next.contextId, aBefore.contextId)
  assert.equal(next.messageCount, 0)
  assert.deepEqual(f.runtime.contextOf('b'), bBefore)
  assert.equal(f.requests.length, 2, 'reset does not dispatch a model')
  await f.runtime.turn({ botId: 'a', input: 'fresh a' })
  assert.deepEqual(f.requests[2].messages.map(row => row.content.map(part => part.text).join('')), ['fresh a'])
  assert.deepEqual(f.adapter.conversationPage('a').items.map(row => row.content), ['old a', 'answer', 'fresh a', 'answer'])
  assert.equal(f.runtime.history('a').length, 4)
  assert.equal(f.retirements.length, 1)
})
test('reset acquires the serving gate before await, refusing same-tick turn and move', async t => {
  const pause = gate(), retired = gate()
  const f = await fixture(t, { retireConversation: async () => { retired.resolve(); return pause.promise } })
  const reset = f.runtime.newConversation('a', { requestKey: nonce('same-tick') })
  await assert.rejects(f.runtime.turn({ botId: 'a', input: 'must not run' }), { code: 'INDEPENDENT_CONTEXT_PENDING_RECONCILIATION' })
  await assert.rejects(f.runtime.move('a', 'integration'), { code: 'INDEPENDENT_CONTEXT_PENDING_RECONCILIATION' })
  assert.deepEqual(f.runtime.busyBots(), ['a'])
  await f.runtime.turn({ botId: 'b', input: 'b remains usable' })
  await retired.promise; pause.resolve({ treeStopped: true }); await reset
  assert.deepEqual(f.runtime.busyBots(), [])
  assert.deepEqual(f.requests.map(row => row.botId), ['b'])
})
test('active preview/turn prevents reset and cancel leaves no partial assistant record', async t => {
  const pause = gate(), entered = gate(), controller = new AbortController()
  const f = await fixture(t, { providerFor: () => async request => {
    await request.onText?.('partial preview'); entered.resolve(); await pause.promise; return { text: 'late answer' }
  } })
  const preview = []
  const turn = f.runtime.turn({ botId: 'a', input: 'original input', signal: controller.signal, onProgress: value => preview.push(value.text) })
  await entered.promise
  await assert.rejects(f.runtime.newConversation('a', { requestKey: nonce('busy') }), { code: 'BOT_BUSY' })
  controller.abort(); pause.resolve()
  await assert.rejects(turn, { code: 'BOT_LOOP_CANCELLED' })
  assert.ok(preview.includes('partial preview'))
  assert.deepEqual(f.adapter.conversationPage('a').items.map(row => row.content), ['original input'])
  assert.equal(f.runtime.contextOf('a').contextId, 'legacy')
})
test('unconfirmed native stop is durably fenced and only explicit trusted evidence reconciles it', async t => {
  const f = await fixture(t, { retireConversation: async () => ({ treeStopped: false, stopRequested: true }) })
  await assert.rejects(f.runtime.newConversation('a', { requestKey: nonce('unknown') }), { code: 'INDEPENDENT_CONTEXT_RETIREMENT_UNCONFIRMED', outcome: 'unknown' })
  assert.equal(f.runtime.contextOf('a').resetPending, true)
  await assert.rejects(f.runtime.newConversation('a', { requestKey: nonce('unknown') }), { code: 'INDEPENDENT_CONTEXT_PENDING_RECONCILIATION' })
  await assert.rejects(f.runtime.reconcileConversation('a', { requestKey: nonce('unknown'), retirementEvidence: { treeStopped: true, possiblyApplied: true } }), { code: 'INDEPENDENT_CONTEXT_RETIREMENT_UNCONFIRMED' })
  const result = await f.runtime.reconcileConversation('a', { requestKey: nonce('unknown'), retirementEvidence: { treeStopped: true } })
  assert.equal(result.resetPending, false)
  assert.equal(result.contextId, independentContextId('a', nonce('unknown')))
  assert.deepEqual(f.runtime.busyBots(), [])
})
test('storage failure after retirement retains old text and intent; read-only observation cannot reset it', async t => {
  let lockPath
  const f = await fixture(t, { retireConversation: async () => { writeFileSync(lockPath, 'other-writer', { flag: 'wx' }); return { treeStopped: true } } })
  await f.runtime.turn({ botId: 'a', input: 'preserve old text' })
  lockPath = join(f.dir, 'sessions/a.json.lock')
  await assert.rejects(f.runtime.newConversation('a', { requestKey: nonce('disk') }), { code: 'BOT_SESSION_WRITE_BUSY', outcome: 'unknown' })
  const stored = JSON.parse(readFileSync(join(f.dir, 'sessions/a.json'), 'utf8'))
  assert.equal(stored.contextId, 'legacy')
  assert.equal(stored.messages[0].content, 'preserve old text')
  assert.equal(stored.contextReset.requestKey, nonce('disk'))
  renameSync(lockPath, `${lockPath}.retained-test-evidence`)
  await f.runtime.reconcileConversation('a', { requestKey: nonce('disk'), retirementEvidence: { treeStopped: true } })
  assert.equal(f.runtime.contextOf('a').resetPending, false)
})
test('bounded context metadata does not remove old records and normal message-cap markers remain', () => {
  const store = openBotSessionStore({ dir: directory(), maxMessages: 10 })
  store.append('a', [{ role: 'user', content: 'oldest retained' }])
  for (let i = 0; i < MAX_CONTEXTS + 5; i++) {
    const requestKey = nonce(`bound-${i}`), contextId = independentContextId('a', requestKey)
    store.beginContext('a', { requestKey, contextId }); store.commitContext('a', { requestKey, contextId })
  }
  assert.equal(store.contextOf('a').contexts.length, MAX_CONTEXTS)
  assert.equal(store.contextOf('a').contextsTruncated, true)
  assert.equal(store.get('a').messages[0].content, 'oldest retained')
  store.append('a', Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `bounded ${i}` })))
  assert.equal(store.get('a').messages.length, 10)
  assert.equal(store.get('a').truncated, true)
})
test('real concurrent processes serialize transcript writes and refuse a held lock without losing records', async () => {
  const dir = directory(), store = openBotSessionStore({ dir })
  store.append('a', [{ role: 'user', content: 'initial', messageId: 'initial' }])
  const child = count => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/independent-context-writer.mjs', import.meta.url)), dir, String(count)], { windowsHide: true })
    let output = '', errors = ''
    proc.stdout.on('data', chunk => { output += chunk }); proc.stderr.on('data', chunk => { errors += chunk })
    proc.on('error', reject); proc.on('exit', code => { if (code !== 0) reject(new Error(errors)); else resolve(JSON.parse(output)) })
  })
  writeFileSync(join(dir, 'a.json.lock'), 'held-by-test', { flag: 'wx' })
  const blocked = await child(1)
  assert.equal(blocked.refused.length, 1); assert.equal(blocked.accepted.length, 0)
  assert.deepEqual(store.get('a').messages.map(row => row.messageId), ['initial'])
  renameSync(join(dir, 'a.json.lock'), join(dir, 'a.json.lock.retained-test-evidence'))
  const results = await Promise.all([child(25), child(25)])
  const accepted = results.flatMap(row => row.accepted)
  assert.ok(accepted.length > 0)
  assert.equal(accepted.length + results.flatMap(row => row.refused).length, 50)
  assert.deepEqual(store.get('a').messages.map(row => row.messageId).sort(), ['initial', ...accepted].sort())
})
test('owner reset nonce shares send journal without empty input, replay or authority fields', async t => {
  const f = await fixture(t), payload = { botId: 'a', requestKey: nonce('service') }
  const accepted = f.service.newConversation(payload, owner)
  assert.equal(accepted.operationKind, 'new-conversation'); assert.equal(accepted.durableInput, false)
  assert.equal(f.service.newConversation(payload, owner).state, 'accepted')
  assert.throws(() => f.service.send({ ...payload, input: 'different operation' }, owner), { code: 'INDEPENDENT_CHAT_REQUEST_CONFLICT' })
  await f.service.whenIdle()
  assert.equal(f.service.newConversation(payload, owner).state, 'succeeded')
  assert.equal(f.retirements.length, 1); assert.equal(f.requests.length, 0)
  for (const extra of ['contextId', 'sessionId', 'identity', 'runtime', 'retirementEvidence', 'path']) {
    assert.throws(() => f.service.newConversation({ ...payload, [extra]: 'untrusted' }, owner), { code: 'INDEPENDENT_CHAT_INVALID_REQUEST' })
  }
  assert.throws(() => f.service.newConversation({ botId: 'b', requestKey: nonce('not-owner') }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  assert.throws(() => f.service.newConversation({ botId: 'b', requestKey: nonce('readonly') }, { ...owner, readOnly: true }), { code: 'PRODUCT_READ_ONLY' })
  assert.equal(f.service.view({ botId: 'a' }, owner).context.contextId, accepted.contextId)
  assert.equal('recoveryInput' in f.service.inspect(payload, owner), false)
})
test('foreign live pending send blocks reset and keeps its original cancel facts', async t => {
  const finish = gate(), f = await fixture(t, { providerFor: () => async () => finish.promise })
  const send = { botId: 'a', requestKey: nonce('foreign-send'), input: 'pending input' }
  f.service.send(send, owner); await Promise.resolve()
  const other = createIndependentChatService({ ...f.settings, isProcessAlive: () => true })
  t.after(() => other.close())
  assert.throws(() => other.newConversation({ botId: 'a', requestKey: nonce('foreign-reset') }, owner), error => ['BOT_BUSY', 'INDEPENDENT_CHAT_PENDING_RECONCILIATION'].includes(error.code))
  const identity = { botId: send.botId, requestKey: send.requestKey }
  const before = f.service.inspect(identity, owner)
  assert.equal(before.state, 'running'); assert.equal(before.stopConfirmed, false)
  finish.resolve({ text: 'old answer' }); await f.service.whenIdle()
  assert.equal(f.service.inspect(identity, owner).state, 'succeeded')
})
test('lost SQLite acknowledgement reconciles only the intended committed context and never reruns retirement', async t => {
  const f = await fixture(t), payload = { botId: 'a', requestKey: nonce('ack-loss') }
  f.service.newConversation(payload, owner); await f.service.whenIdle()
  const db = new Database(f.settings.file)
  db.prepare("UPDATE bot_independent_chat_requests SET state='unknown',error_code='SIMULATED_ACK_LOSS' WHERE request_key=?").run(payload.requestKey)
  const ro = f.service.inspect(payload, { ...owner, readOnly: true })
  assert.equal(ro.state, 'succeeded')
  assert.equal(db.prepare('SELECT state FROM bot_independent_chat_requests').get().state, 'unknown')
  assert.equal(f.service.inspect(payload, owner).state, 'succeeded')
  db.close()
  assert.equal(f.retirements.length, 1); assert.equal(f.requests.length, 0)
})
test('close and cancel during retirement fence late callbacks and restart never retries them', async t => {
  const finish = gate(), f = await fixture(t, { retireConversation: async () => finish.promise })
  const payload = { botId: 'a', requestKey: nonce('close') }
  f.service.newConversation(payload, owner); await Promise.resolve()
  const requested = f.service.cancel(payload, owner)
  assert.equal(requested.cancelRequested, true); assert.equal(requested.stopConfirmed, false)
  f.service.close(); finish.resolve({ treeStopped: true }); await f.service.whenIdle()
  assert.equal(f.runtime.contextOf('a').contextId, 'legacy')
  assert.equal(f.runtime.contextOf('a').resetPending, true)
  const other = createIndependentChatService(f.settings); t.after(() => other.close())
  assert.equal(other.newConversation(payload, owner).state, 'unknown')
  assert.throws(() => other.send({ botId: 'a', requestKey: nonce('after-close'), input: 'must not dispatch' }, owner), error => ['BOT_BUSY', 'INDEPENDENT_CONTEXT_PENDING_RECONCILIATION'].includes(error.code))
  assert.equal(f.requests.length, 0)
  await f.runtime.reconcileConversation('a', { requestKey: payload.requestKey, retirementEvidence: { treeStopped: true } })
  const final = other.inspect(payload, owner)
  assert.equal(final.state, 'succeeded'); assert.equal(final.cancelRequested, true); assert.equal(final.stopConfirmed, false)
})
