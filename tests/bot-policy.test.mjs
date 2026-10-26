import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotPolicy } from '../packages/orchestration/src/bot-policy.mjs'

const route = { provider: 'fixture', model: 'gpt-bound' }
const agent = id => ({ id, session: { id } })
function fixture() {
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  const a = agent('a-chat'), group = agent('a-group'), b = agent('b-chat')
  directory.register('bot-a', { tools: ['tool/model_router_routes','command/router','command/tools','tool/model_router_execute'], modelRoutes: [route] })
  directory.register('bot-b', { tools: ['tool/model_router_routes'], modelRoutes: [{ ...route, model: 'gpt-other' }] })
  const detach = directory.bind('bot-a', a)
  directory.bind('bot-a', group)
  directory.bind('bot-b', b)
  const policy = createBotPolicy({ authority, directory, machineId: 'test-machine', workspaceId: 'test-workspace',
    ownerGrant: { tools: ['remote/boundaries','remote/startRun'], modelRoutes: [route] } })
  return { authority, directory, policy, a, group, b, detach }
}

test('Bot principal: multiple live Sessions share authority; copied Agents and duplicate Sessions fail', () => {
  const { directory, a, group } = fixture()
  assert.equal(directory.forAgent(a), directory.forAgent(group))
  assert.equal(directory.forAgent(a), directory.forSession('a-chat'))
  assert.throws(() => directory.forAgent({ ...a }), /UNKNOWN_SUBJECT/)
  assert.throws(() => directory.bind('bot-b', agent('a-chat')), /SESSION_ALREADY_BOUND/)
})

test('Bot principal: detach is local, retirement removes every live Session and cannot resurrect identity', () => {
  const { directory, a, group, b, detach } = fixture()
  detach(); detach()
  assert.throws(() => directory.forAgent(a), /UNKNOWN_SUBJECT/)
  directory.forAgent(group)
  directory.retire('bot-a')
  assert.throws(() => directory.forAgent(group), /UNKNOWN_SUBJECT/)
  assert.throws(() => directory.forSession('a-group'), /UNKNOWN_SUBJECT/)
  assert.throws(() => directory.bind('bot-a', agent('another')), /UNKNOWN_BOT/)
  assert.throws(() => directory.register('bot-a', {}), /DUPLICATE_SUBJECT/)
  directory.forAgent(b)
})

test('Bot policy: changing a Bot grant cancels active work in its other Session without touching its sibling', async () => {
  const { directory, policy, group, b } = fixture()
  let entered
  const opened = new Promise(resolve => { entered = resolve })
  const pending = policy.run({ kind: 'tool', name: 'model_router_routes', agent: group }, signal => new Promise((_, reject) => {
    entered(); signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  await opened
  directory.replaceGrant('bot-a', { tools: [], modelRoutes: [] })
  await assert.rejects(pending, /GRANT_CHANGED/)
  assert.equal(await policy.run({ kind: 'tool', name: 'model_router_routes', agent: b }, () => 'sibling'), 'sibling')
})

test('Bot policy: concurrent calls filter each route list without sharing asynchronous actor state', async () => {
  const { policy, a, b } = fixture()
  const routes = [route, { ...route, model: 'gpt-other' }]
  const run = who => policy.run({ kind: 'tool', name: 'model_router_routes', agent: who }, async () => {
    await new Promise(resolve => setImmediate(resolve))
    return policy.filterRoutes(routes)
  })
  assert.deepEqual(await Promise.all([run(a),run(b)]), [[route],[routes[1]]])
  assert.throws(() => policy.filterRoutes(routes), /CALL_CONTEXT_REQUIRED/)
})

test('Bot policy: bound auxiliary and nested model calls reject route and subject substitutions before dispatch', async () => {
  const { policy, a } = fixture()
  let dispatches = 0
  const next = () => (async function* () { dispatches++; yield 'fixture' })()
  const consume = async value => { for await (const _ of value) { /* drain */ } }
  const options = { ...route, sessionId: 'a-chat', signal: new AbortController().signal }
  await consume(policy.modelStream(options, next))
  assert.throws(() => policy.modelStream({ ...options, model: 'gpt-other' }, next), /MODEL_DENIED/)
  assert.throws(() => policy.modelStream({ ...options, sessionId: 'unknown' }, next), /UNKNOWN_SUBJECT/)
  await policy.run({ kind: 'tool', name: 'model_router_routes', agent: a }, async () => {
    const { sessionId, ...nested } = options
    await consume(policy.modelStream(nested, next))
    assert.throws(() => policy.modelStream({ ...options, sessionId: 'b-chat' }, next), /SUBJECT_MISMATCH/)
  })
  assert.equal(dispatches, 2)
})

test('Bot policy: a tool grant cannot open native execution or install through a slash command', async () => {
  const { policy, a } = fixture()
  let calls = 0
  await assert.rejects(policy.run({ kind: 'tool', name: 'model_router_execute', agent: a }, () => { calls++ }), /EXECUTION_FACADE_REQUIRED/)
  await assert.rejects(policy.run({ kind: 'command', name: 'tools', agent: a, rawInput: 'install codex' }, () => { calls++ }), /EXECUTION_FACADE_REQUIRED/)
  assert.equal(calls, 0)
})

test('Bot policy: revocation between stream construction and first pull prevents adapter dispatch', async () => {
  const { policy, directory } = fixture()
  let dispatches = 0
  const stream = policy.modelStream({ ...route, sessionId:'a-chat', signal:new AbortController().signal }, () => {
    dispatches++
    return (async function* () { yield 'must not run' })()
  })
  directory.replaceGrant('bot-a', { tools:[],modelRoutes:[] })
  await assert.rejects(stream.next(), /MODEL_DENIED/)
  assert.equal(dispatches,0)
})

test('Bot policy: RPC uses authenticated host peer identity; unknown peers and owner background launches fail closed', async () => {
  const { policy } = fixture()
  let calls = 0
  const operation = () => ++calls
  for (const invocation of [undefined, { peer: { principal: { kind: 'bot', botId: 'bot-a' } } }]) {
    await assert.rejects(policy.run({ kind: 'remote', name: 'boundaries', invocation }, operation), /REMOTE_OWNER_REQUIRED/)
  }
  const invocation = { peer: { principal: { kind: 'owner' } } }
  assert.equal(await policy.run({ kind: 'remote', name: 'boundaries', invocation }, operation), 1)
  await assert.rejects(policy.run({ kind: 'remote', name: 'startRun', invocation }, operation), /BACKGROUND_TASK_FACADE_REQUIRED/)
  assert.equal(calls, 1)
})
