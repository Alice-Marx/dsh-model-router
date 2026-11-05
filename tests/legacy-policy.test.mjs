import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../.dsh-plugin/index.mjs'
import { OfficialToolsRemoteService } from '../.dsh-plugin/official-tools-remote-service.mjs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createBotPolicy } from '../packages/orchestration/src/bot-policy.mjs'
import { guardLegacyTools } from '../.dsh-plugin/shared/legacy-policy.mjs'
import { TASK_TOOL_CAPABILITIES } from '../packages/orchestration/src/task-tools.mjs'

function registrations({ policy, required = false } = {}) {
  const tools = new Map(), commands = new Map()
  let guard
  const ctx = { get: () => policy, on() {},
    tools: { register(value) { tools.set(value.name,value) }, guard(value) { guard = value } },
    commands: { register(value) { commands.set(value.name,value) } } }
  apply(ctx, { requireBotPolicy: required })
  return { ctx, tools, commands, guard }
}

test('legacy policy: every registered tool and both commands refuse before the body when strict policy is unavailable', async () => {
  const { tools, commands, guard } = registrations({ required: true })
  // 13 router tools plus the Bot's own library tools, which mount with the same product.
  assert.equal(tools.size, 17)
  assert.equal(commands.size, 2)
  for (const tool of tools.values()) {
    assert.match(guard({ name: tool.name }), /unavailable/)
    await assert.rejects(Promise.resolve().then(() => tool.execute({}, {})), /unavailable/)
  }
  for (const command of commands.values()) assert.equal((await command.handler({})).kind, 'error')
})

test('legacy policy: unknown Agent objects cannot enter any old tool, including retry/install, or either command', async () => {
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  const policy = createBotPolicy({ authority, directory, machineId:'m', workspaceId:'w' })
  const { tools, commands } = registrations({ policy })
  for (const tool of tools.values()) await assert.rejects(tool.execute({ botId:'forged' }, { agent:{ id:'copied' } }), /UNKNOWN_SUBJECT/)
  for (const command of commands.values()) assert.match((await command.handler({ agent:{}, rawInput:'install codex' })).text, /UNKNOWN_SUBJECT/)
})

test('legacy policy: every exported RPC receiver, including terminals, refuses absent authenticated invocation', async () => {
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  const policy = createBotPolicy({ authority, directory, machineId:'m', workspaceId:'w' })
  const receiver = { ctx:{ get:()=>policy }, services:{} }
  // 23 original receivers plus the Bot runtime and Bot routing ones added since.
  assert.equal(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.length, 30)
  for (const method of ['botRuntimeHistory', 'botRuntimeMessage', 'botRoutingInspect', 'botRoutingDecide']) {
    assert.ok(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.some(item => item.method === method), `${method} is registered`)
  }
  for (const { method } of OFFICIAL_TOOLS_REMOTE_DESCRIPTORS) {
    await assert.rejects(OfficialToolsRemoteService.prototype[method].call(receiver, { botId:'owner', runId:'other' }), /REMOTE_OWNER_REQUIRED/)
  }
})

test('legacy policy: owner RPC keeps the old result shape and ignores a payload actor claim', async () => {
  const authority = createAuthority()
  const policy = createBotPolicy({ authority, directory:createPrincipalDirectory(authority), machineId:'m', workspaceId:'w', ownerGrant:{ tools:['remote/boundaries'] } })
  let calls = 0
  const receiver = { ctx:{ get:()=>policy, invocation:{ peer:{ principal:{ kind:'owner' } } } }, services:{ boundaries:()=>{calls++;return { fixture:true }} } }
  assert.deepEqual(await OfficialToolsRemoteService.prototype.boundaries.call(receiver, { botId:'other' }), { ok:true,value:{ fixture:true } })
  assert.equal(calls,1)
})

test('legacy policy: managed Task tools use their exact task authority without adding tool aliases', () => {
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const agent = { session: { id: 'task-session' } }, stranger = { session: { id: 'task-session' } }
  const policy = createBotPolicy({ authority, directory, machineId: 'm', workspaceId: 'w' })
  const capabilities = [...new Set(Object.values(TASK_TOOL_CAPABILITIES))]
  directory.register('worker', { tools: capabilities, modelRoutes: [] }); directory.bind('worker', agent)
  let guard
  guardLegacyTools({ get: () => policy, tools: { guard: value => { guard = value } } }, { requireBotPolicy: true })
  for (const name of Object.keys(TASK_TOOL_CAPABILITIES)) {
    assert.equal(guard({ name, agent }), undefined, name)
    assert.match(guard({ name, agent: stranger }), /UNKNOWN_SUBJECT/u)
    assert.throws(() => policy.check({ kind: 'tool', name, agent }), /TOOL_DENIED/u, 'no new tool alias was granted')
  }
  directory.replaceGrant('worker', { tools: ['task/read'], modelRoutes: [] })
  assert.match(guard({ name: 'bot_task_start', agent }), /TOOL_DENIED/u)
  assert.equal(guard({ name: 'bot_task_status', agent }), undefined)
  assert.match(guard({ name: 'bot_library_write', agent }), /TOOL_DENIED/u)
  assert.match(guard({ name: 'bot_unknown_action', agent }), /TOOL_DENIED/u)
  authority.dispose()
})
