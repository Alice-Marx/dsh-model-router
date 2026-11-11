import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { createRequire } from 'node:module'
import { startFixtureAgent } from './fixtures/independent-tool-host.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const mainLocalTools = ['data_load', 'data_describe', 'data_sql', 'data_show', 'data_export',
  'coordinate_bots', 'assignment_status', 'list_bots', 'list_threads']
// Tool discovery for the independent runtime, through the installed SDK and the real composition.
//
// What is real here: the installed Cordis/LlmRuntime with only its provider transport offline, the
// real `startBotProduct` composition (its own principal directory, policy, serving admission, SQLite
// receipts and its own durable Task journal), the real machine directory, the real remote computer
// over a real transport, the Host's published `botIndependentToolHost`, and the real independent
// runtime mounted the way the plugin mounts it. The model is the only seam.
//
// `tests/independent-tool-host.native.mjs` covers the same factory against a journal built by hand;
// this file covers it inside the product composition, where every authority is the product's own.

const MACHINE_TOOLS = ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel']
const USAGE = { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 }
const ASK = (name, args) => [
  { type: 'text-delta', index: 0, text: 'working' },
  { type: 'tool-call-delta', index: 0, id: 'call-1', name, argumentsDelta: JSON.stringify(args) },
  { type: 'usage', usage: { ...USAGE } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
const ANSWER = [{ type: 'text-delta', index: 0, text: 'model answer' }, { type: 'usage', usage: { ...USAGE } }, { type: 'finish', reason: { kind: 'stop' } }]
const OWNER = { kind: 'owner', peer: { principal: { kind: 'owner' } }, clientOrigin: 'http://127.0.0.1' }
// A new file: an existing one would need its current SHA256, and the Host keeps that rule.
const WRITE = { relativePath: 'written.txt', content: 'written by the Bot', expectedHash: null }

/** The machine directory fires its change hook without awaiting it; let it land before dispose. */
const settle = async () => { for (let at = 0; at < 20; at += 1) await new Promise(resolve => { setImmediate(resolve) }) }

/**
 * Pair the real computer, grant it to Bot `a` and enable that Bot, the way the fixture does, with
 * the machine capabilities this case needs.
 */
async function grantComputer({ ctx, product, runtime, dispatch, fixture, tools, mode, capabilities }) {
  await product.rt.secretEndpoint('secret-set', { name: 'REMOTE_AGENT_FIXTURE', value: fixture.credential.token, scope: [], purpose: '远程电脑端到端连接凭据，仅供宿主使用。' })
  const machines = ctx.get('botRemoteMachines')
  await machines.pair({
    machineId: fixture.machineId, clientId: 'host-a', name: 'Fixture computer', endpoint: fixture.endpoint,
    transport: fixture.agent.store.pairing.identity(), secretRef: 'ds-secret/REMOTE_AGENT_FIXTURE',
    roots: fixture.roots, tools, probeBotId: 'a', expectedRevision: 0,
  }, OWNER)
  await machines.bind({ machineId: fixture.machineId, botId: 'a', roots: fixture.roots, tools, mode, expectedRevision: 0 }, OWNER)
  let view = await dispatch('binding.inspect', { botId: 'a' })
  const scope = view.accounts.items.find(account => account.provider === 'alpha')
  await dispatch('funding.account.save', { scopeId: scope.id, expectedRevision: scope.revision, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100 })
  view = await dispatch('binding.inspect', { botId: 'a' })
  const local = view.record.catalog.machines.find(item => item.location === 'local')
  await dispatch('binding.save', { botId: 'a', expectedRevision: view.record.revision, settings: {
    ...view.record.settings, enabled: true, model: { provider: 'alpha', model: 'one' },
    capabilities: ['model-inference', ...capabilities],
    machineGrants: [
      { machineId: local.machineId, rootId: local.roots[0].rootId, mode: 'read-only', capabilities: [] },
      { machineId: fixture.machineId, rootId: 'project', mode, capabilities: tools },
    ],
    workspaceRef: { kind: 'local', machineId: local.machineId, rootId: local.roots[0].rootId },
    funding: { mode: 'api', scopeId: scope.id, pricing: { input: 1, output: 2 },
      request: { maxInputTokens: 4096, maxOutputTokens: 100 }, dailyBudgetUsd: 1, monthlyBudgetUsd: 10, subscription: null },
  } })
  await settle()
  await runtime.move('a', 'independent')
  return { machines, host: ctx.get('botIndependentToolHost') }
}

test('the installed SDK sees the granted schemas, and a write lands as one durable Task', async t => {
  const fixture = await startFixtureAgent(t, { tools: MACHINE_TOOLS, botIds: ['a', 'b'] })
  t.after(() => fixture.close())
  await writeFile(join(fixture.rootOf('project'), 'notes.txt'), 'a note only this Bot may read')
  await withProductIndependent(async ({ ctx, product, runtime, dispatch, readRows, storageFile }) => {
    const { machines, host } = await grantComputer({ ctx, product, runtime, dispatch, fixture, tools: MACHINE_TOOLS, mode: 'workspace-write', capabilities: ['managed-tasks'] })
    assert.ok(host, 'the composition publishes the Host tool service')

    // A thin witness over the published service: it records the turn identity the loop hands the
    // Host, so a replay can be asked with the very same one. Nothing else changes.
    const witnessed = []
    ctx.provide('botIndependentToolHost', Object.freeze({ forBot: botId => {
      const view = host.forBot(botId)
      return Object.freeze({ ...view, call: (name, args, context) => { witnessed.push({ botId, name, context }); return view.call(name, args, context) } })
    } }))

    // The catalog is the Bot's own committed grants, re-decided live: reads and a tracked write.
    const names = host.forBot('a').schemas().map(tool => tool.name)
    assert.ok(names.includes('bot_fs_read') && names.includes('bot_fs_write') && names.includes('bot_task_status'))
    for (const tool of host.forBot('a').schemas()) {
      assert.equal(typeof tool.description, 'string')
      assert.equal(tool.parameters.type, 'object')
      assert.equal(tool.parameters.additionalProperties, false)
    }
    assert.ok(!names.includes('bot_command'), 'no container profile is configured, so no command is offered')
    assert.ok(host.forBot('a').unavailable().some(entry => entry.name === 'bot_command'))

    // The model asks for the write on the first request and answers on the second.
    const audited = fixture.audits('TOOL_RESULT').length
    let calls = 0
    ctx.state.beforeRequest = () => { calls += 1; ctx.state.chunks = calls === 1 ? ASK('bot_fs_write', WRITE) : ANSWER }
    const reply = await runtime.turn({ botId: 'a', input: 'write the note' })
    assert.equal(reply.answer, 'model answer')
    assert.deepEqual(reply.toolCalls, [{ id: 'call-1', name: 'bot_fs_write' }])

    // The request the adapter really saw carried those schemas — and only those.
    assert.equal(ctx.upstream.length, 2)
    assert.deepEqual(ctx.upstream[0].tools.map(tool => tool.name), names)
    const second = ctx.upstream[1].messages
    assert.deepEqual(second.map(message => message.role), ['system', 'user', 'assistant', 'tool'])
    const asked = second.find(message => message.role === 'assistant')
    const answered = second.find(message => message.role === 'tool')
    assert.deepEqual(asked.content, [
      { type: 'text', text: 'working' },
      { type: 'tool-call', id: 'call-1', name: 'bot_fs_write', arguments: JSON.stringify(WRITE) },
    ])
    assert.deepEqual(asked.source, { kind: 'model', provider: 'alpha', model: 'one' })
    assert.equal(answered.toolCallId, 'call-1')
    const result = JSON.parse(answered.content[0].text)
    assert.equal(typeof result.taskId, 'string')
    assert.equal(typeof result.attemptId, 'string')
    assert.equal(typeof result.operationId, 'string')

    // The remote computer really wrote the file, once.
    assert.equal(await readFile(join(fixture.rootOf('project'), 'written.txt'), 'utf8'), 'written by the Bot')
    assert.equal(fixture.operations().length, 1)
    assert.equal(fixture.operations()[0].tool, 'fs_write')
    assert.equal(fixture.operations()[0].status, 'succeeded')
    assert.equal(fixture.audits('TOOL_RESULT').length, audited + 1)
    // One receipt per model step, in the real SQLite ledger.
    assert.equal(readRows('router_model_calls').length, 2)

    // The durable Task journal recorded exactly one submit, one attempt and one operation.
    const journal = new Database(storageFile, { readonly: true })
    try {
      const tasks = journal.prepare('SELECT id, state FROM tasks ORDER BY rowid').all()
      const attempts = journal.prepare('SELECT id FROM attempts ORDER BY rowid').all()
      const operations = journal.prepare('SELECT id FROM operations ORDER BY rowid').all()
      assert.equal(tasks.length, 1, 'one durable task')
      assert.equal(tasks[0].state, 'succeeded')
      assert.equal(tasks[0].id, result.taskId, 'the result the model saw is the task the journal holds')
      assert.equal(attempts.length, 1, 'one attempt')
      assert.equal(operations.length, 1, 'one operation')
    } finally { journal.close() }

    // The same call re-reads the same task instead of dispatching a second write. The turn identity
    // the loop handed the Host is what correlates the two, so the replay uses the very same one.
    const first = witnessed.find(entry => entry.name === 'bot_fs_write')
    assert.ok(first, 'the Host saw the tool call with its own turn identity')
    const again = await ctx.get('botIndependentToolHost').forBot('a').call('bot_fs_write', WRITE, first.context)
    assert.equal(again.taskId, result.taskId)
    assert.equal(fixture.operations().length, 1, 'the remote computer ran the write once')

    // A Bot that was never granted this machine reaches nothing, and the agent records nothing.
    await assert.rejects(() => host.forBot('b').call('bot_fs_read', { relativePath: 'notes.txt' }, { turnId: 't', callId: 'c' }),
      error => ['TOOL_NOT_GRANTED', 'MACHINE_NOT_BOUND'].includes(error.code))
    await assert.rejects(() => host.forBot('a').call('bot_fs_read', { relativePath: 'notes.txt', rootId: 'root-not-mine' }, { turnId: 't', callId: 'c' }), error => error.code === 'MACHINE_ROOT_NOT_BOUND')
    assert.equal(fixture.audits('TOOL_RESULT').length, audited + 1, 'a forged root or another Bot produces no side effect')

    // Withdrawing the binding takes the tool out of the next request and stops the next call.
    await machines.revoke({ machineId: fixture.machineId, expectedRevision: 1 }, OWNER)
    assert.deepEqual(host.forBot('a').schemas().map(tool => tool.name), ['bot_task_status', 'bot_task_cancel'], 'withdrawing the computer keeps Main task controls available')
    await assert.rejects(() => host.forBot('a').call('bot_fs_read', { relativePath: 'notes.txt' }, { turnId: 't', callId: 'c' }),
      error => ['TOOL_NOT_GRANTED', 'MACHINE_BOT_DENIED'].includes(error.code))
    assert.equal(fixture.audits('TOOL_RESULT').length, audited + 1, 'and the agent still recorded nothing new')
    assert.equal(fixture.operations().length, 1, 'and the remote computer ran nothing new')
  }, { nativeLlm: true })
})

test('a tool ask the Host cannot read is refused before any side effect', async t => {
  const fixture = await startFixtureAgent(t, { tools: MACHINE_TOOLS, botIds: ['a', 'b'] })
  t.after(() => fixture.close())
  await writeFile(join(fixture.rootOf('project'), 'notes.txt'), 'a note only this Bot may read')
  await withProductIndependent(async ({ ctx, product, runtime, dispatch }) => {
    await grantComputer({ ctx, product, runtime, dispatch, fixture, tools: MACHINE_TOOLS, mode: 'workspace-write', capabilities: ['managed-tasks'] })
    const audited = fixture.audits('TOOL_RESULT').length
    // The same call id twice, with the arguments concatenated: the Host's own stream reader refuses
    // the ask before the loop dispatches anything.
    ctx.state.chunks = [
      { type: 'text-delta', index: 0, text: 'working' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'bot_fs_read', argumentsDelta: '{"relativePath":"notes.txt"}' },
      { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'bot_fs_read', argumentsDelta: '{"relativePath":"notes.txt"}' },
      { type: 'usage', usage: { ...USAGE } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    await assert.rejects(() => runtime.turn({ botId: 'a', input: 'read it twice' }), error => error.code === 'MODEL_TOOL_CALL_ARGS_INVALID')
    assert.equal(fixture.audits('TOOL_RESULT').length, audited, 'the remote computer was never reached by this turn')
    const rows = runtime.history('a', { limit: 10, previewChars: 0 })
    assert.deepEqual(rows.map(row => row.role), ['user'], 'no ask and no result were written for a call that cannot be read')
  }, { nativeLlm: true })
})

test('a machine ceiling the agent does not have is never offered', async t => {
  const fixture = await startFixtureAgent(t, { tools: ['machine_ping', 'fs_list'], botIds: ['a', 'b'] })
  t.after(() => fixture.close())
  await withProductIndependent(async ({ ctx, product, runtime, dispatch }) => {
    const { host } = await grantComputer({ ctx, product, runtime, dispatch, fixture, tools: ['machine_ping', 'fs_list'], mode: 'read-only', capabilities: [] })
    const names = host.forBot('a').schemas().map(tool => tool.name)
    assert.deepEqual(names, ['bot_machine_ping', 'bot_fs_list', 'bot_task_status', 'bot_task_cancel', ...mainLocalTools])
    assert.ok(host.forBot('a').unavailable().some(entry => entry.name === 'bot_fs_read'
      && ['MACHINE_TOOL_NOT_GRANTED', 'CAPABILITY_NOT_GRANTED'].includes(entry.code)), 'a tool the machine cannot run is named unavailable')
    // A read-only binding never offers a write, whatever the model would prefer.
    assert.ok(host.forBot('a').unavailable().some(entry => entry.name === 'bot_fs_write'))
  }, { nativeLlm: true })
})

test('Main retains durable task controls without a paired computer', async t => {
  await withProductIndependent(async ({ ctx, runtime, bind }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    ctx.state.chunks = ANSWER
    const reply = await runtime.turn({ botId: 'a', input: 'just answer' })
    assert.equal(reply.answer, 'model answer')
    assert.deepEqual(ctx.upstream[0].tools.map(tool => tool.name), ['bot_task_status', 'bot_task_cancel', ...mainLocalTools])
  }, { nativeLlm: true })
})

test('a worker with no tool grant receives no schemas', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind }) => {
    await bind('b', 'beta', 'vendor/two')
    await runtime.move('b', 'independent')
    ctx.state.chunks = ANSWER
    await runtime.turn({ botId: 'b', input: 'just answer without tools' })
    assert.equal(ctx.upstream[0].tools, undefined)
  }, { nativeLlm: true })
})
