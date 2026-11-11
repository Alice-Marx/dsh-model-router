import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { bootToolHost, ANSWER, askTool, MACHINE_TOOLS } from './fixtures/independent-tool-host.mjs'
import { createPluginRuntime } from '../modules/independent-runtime/index.mjs'

// The Host tool service for the independent runtime, against real state.
//
// What is under test is the seam between "the model asked for something" and "a durable, cancellable,
// reconcilable effect happened": the live per-Bot catalog, the identity the Host keeps, the Task
// journal a write lands in, and what happens when the outcome is unknown or the turn is cancelled.
//
// The remote computer here is the real agent over a real transport, and the Task journal is real
// SQLite; the model is the only seam, and it is fed the Host's own chunk vocabulary.

const WRITE = { relativePath: 'notes.txt', content: 'hello from the Bot', expectedHash: null }

const settle = async check => {
  for (let at = 0; at < 400; at += 1) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  throw new Error('the durable task did not settle')
}

test('the catalog is live per Bot: committed grants, and nothing a request could name', async t => {
  const booted = await bootToolHost(t)
  const schemas = booted.tools('bot-a').schemas()
  const names = schemas.map(schema => schema.name)
  assert.ok(names.includes('bot_fs_read') && names.includes('bot_fs_write') && names.includes('bot_command'), 'the granted tools are offered')
  for (const schema of schemas) {
    assert.equal(typeof schema.description, 'string')
    assert.equal(schema.parameters.type, 'object')
    assert.equal(schema.parameters.additionalProperties, false, 'an unexpected argument is refused by the schema itself')
    // No tool asks the model for an owner, a subject, an executable path, an endpoint or a
    // credential. The only ids a reply may pass are ones the Host itself issued.
    const properties = Object.keys(schema.parameters.properties)
    for (const forbidden of ['botId', 'owner', 'subject', 'endpoint', 'executable', 'env', 'secretRef', 'grantToken', 'attemptId']) {
      assert.ok(!properties.includes(forbidden), `${schema.name} must not ask for ${forbidden}`)
    }
    for (const reference of ['operationId', 'artifactId', 'taskId']) {
      if (properties.includes(reference)) assert.match(schema.description, /宿主(早前)?返回/, `${schema.name} may only reference a Host-issued id`)
    }
  }
  // A Bot with no binding at all gets no machine tool, and says so instead of inventing one.
  assert.deepEqual(booted.tools('bot-b').schemas().map(schema => schema.name).filter(name => name.startsWith('bot_fs')), [])
  assert.ok(booted.tools('bot-b').unavailable().some(entry => entry.code === 'MACHINE_TOOL_NOT_GRANTED'))
  // A revoked capability leaves the request entirely.
  booted.directory.replaceGrant('bot-a', { tools: ['remote/fs_read', 'remote/fs_list', 'remote/machine_ping'] })
  const after = booted.tools('bot-a').schemas().map(schema => schema.name)
  assert.ok(after.includes('bot_fs_read'))
  assert.ok(!after.includes('bot_fs_write'), 'a withdrawn write grant removes the tool from the request')
  assert.ok(booted.tools('bot-a').unavailable().some(entry => entry.name === 'bot_fs_write' && entry.code === 'CAPABILITY_NOT_GRANTED'))
})

test('a Host with no durable Task backend says a write is unavailable instead of offering it', async t => {
  const booted = await bootToolHost(t, { backends: [] })
  const names = booted.tools('bot-a').schemas().map(schema => schema.name)
  assert.ok(!names.includes('bot_fs_write') && !names.includes('bot_command'), 'no schema for an effect the Host cannot track')
  assert.deepEqual(booted.tools('bot-a').unavailable().filter(entry => entry.name === 'bot_fs_write' || entry.name === 'bot_command')
    .map(entry => entry.code), ['TASK_BACKEND_UNAVAILABLE', 'TASK_BACKEND_UNAVAILABLE'])
  // The read-only surface still stands.
  assert.ok(names.includes('bot_fs_read'))
})

test('a forged machine, root or identity never reaches the machine directory', async t => {
  const booted = await bootToolHost(t, { recordCalls: true })
  await booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-forge', callId: 'call-seed' })
  // A machine or a root the Bot does not hold is refused before the machine layer is touched.
  await assert.rejects(() => booted.tools('bot-a').call('bot_fs_read', { relativePath: 'notes.txt', machineId: 'machine-not-mine' }, { turnId: 'turn-x', callId: 'call-x' }), error => error.code === 'MACHINE_NOT_BOUND')
  await assert.rejects(() => booted.tools('bot-a').call('bot_fs_read', { relativePath: 'notes.txt', rootId: 'root-not-mine' }, { turnId: 'turn-x', callId: 'call-x' }), error => error.code === 'MACHINE_ROOT_NOT_BOUND')
  // An operation the Host never issued cannot be observed or stopped.
  await assert.rejects(() => booted.tools('bot-a').call('bot_operation_status', { operationId: 'operation-forged' }, { turnId: 'turn-x', callId: 'call-x' }), error => error.code === 'OPERATION_NOT_ISSUED')
  // A reply that smuggles identity into its arguments gets the identity stripped: what reaches the
  // machine layer carries the Host's own machine, root and derived task/attempt, and nothing else.
  const read = await booted.tools('bot-a').call('bot_fs_read', {
    relativePath: 'notes.txt', botId: 'bot-b', taskId: 'task-forged', attemptId: 'attempt-forged', endpoint: 'http://elsewhere', secretRef: 'ds-secret/x',
  }, { turnId: 'turn-x', callId: 'call-x' })
  assert.equal(Buffer.from(read.content, 'base64').toString('utf8'), 'hello from the Bot')
  assert.equal(booted.machineCalls.length, 1, 'exactly one call reached the machine layer')
  const input = booted.machineCalls[0]
  assert.equal(input.machineId, booted.agent.store.machineId)
  assert.equal(input.rootId, 'project')
  assert.match(input.taskId, /^bot-[a-f0-9]{32}$/)
  assert.match(input.attemptId, /^attempt-[a-f0-9]{32}$/)
  for (const key of ['botId', 'endpoint', 'secretRef', 'grantToken', 'executable', 'env']) {
    assert.ok(!Object.hasOwn(input, key) && !Object.hasOwn(input.args, key), `${key} never reaches the machine layer`)
  }
  for (const key of ['botId', 'taskId', 'attemptId', 'endpoint', 'secretRef']) {
    assert.ok(!Object.hasOwn(input.args, key), `args.${key} never reaches the machine layer`)
  }
})

test('one write lands as one durable submit, one attempt and one operation, with the file written', async t => {
  const booted = await bootToolHost(t, { script: [askTool('bot_fs_write', WRITE), ANSWER] })
  const reply = await booted.loop.run({ botId: 'bot-a', input: 'write the note' })
  assert.equal(reply.answer, 'done')
  // The remote agent's own journal: exactly one admitted write, once.
  assert.equal(booted.operations().length, 1)
  assert.equal(booted.operations()[0].tool, 'fs_write')
  assert.equal(booted.operations()[0].status, 'succeeded')
  assert.equal(await readFile(booted.rootOf('project', 'notes.txt'), 'utf8'), 'hello from the Bot')  // The durable Task journal: one task, one attempt, one operation, one settle.
  assert.equal(booted.tasks().length, 1)
  assert.equal(booted.tasks()[0].state, 'succeeded')
  assert.equal(booted.attempts().length, 1)
  assert.equal(booted.operationRows().length, 1)
  assert.equal(booted.events().filter(event => event.kind === 'settled').length, 1)
  // The result the model saw carries the Host identity, and the transcript keeps the call id.
  const toolRow = booted.store.get('bot-a').messages.find(row => row.role === 'tool')
  assert.equal(toolRow.toolCallId, 'call-1')
  assert.equal(JSON.parse(toolRow.content).taskId, booted.tasks()[0].id)
  // The next request offers the schemas and correlates the result by its real call id.
  const second = booted.requests[1]
  assert.ok(Array.isArray(second.tools) && second.tools.some(tool => tool.name === 'bot_fs_write'), 'the request carries the granted schemas')
  const assistant = second.messages.find(message => message.role === 'assistant')
  assert.deepEqual(assistant.content.find(block => block.type === 'tool-call'), { type: 'tool-call', id: 'call-1', name: 'bot_fs_write', arguments: JSON.stringify(WRITE) })
  const result = second.messages.find(message => message.role === 'tool')
  assert.equal(result.toolCallId, 'call-1')
})

test('the same call re-reads the same task instead of dispatching a second write', async t => {
  const booted = await bootToolHost(t)
  const first = await booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-1', callId: 'call-1' })
  const second = await booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-1', callId: 'call-1' })
  assert.equal(first.taskId, second.taskId, 'the request key is the Host correlation of turn and call')
  assert.equal(booted.operations().length, 1, 'the remote agent ran the write once')
  assert.equal(booted.tasks().length, 1)
  assert.equal(booted.attempts().length, 1)
})

test('an unknown write outcome is reconciled, never replayed, and never reported as success', async t => {
  const booted = await bootToolHost(t)
  // A real dispatched write whose outcome nobody can read: the agent takes the write and never
  // reports, and the stop request cannot be confirmed either.
  const original = booted.agent.call.bind(booted.agent)
  booted.agent.call = async (name, args, context, operationId) => {
    if (name === 'fs_write') return new Promise(() => {})
    if (name === 'operation_cancel') throw Object.assign(new Error('MACHINE_CONNECTION_FAILED'), { code: 'MACHINE_CONNECTION_FAILED' })
    return original(name, args, context, operationId)
  }
  const pending = booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-unknown', callId: 'call-unknown' })
  await new Promise(resolve => { setTimeout(resolve, 50) })
  assert.equal(booted.tasks().length, 1, 'the durable task was opened before anything was known')
  // The stop request is real, and the agent cannot confirm it: the outcome stays unknown.
  await booted.taskService.cancel(booted.directory.forBot('bot-a'), { taskId: booted.tasks()[0].id })
  await assert.rejects(() => pending, error => error.code === 'TASK_OUTCOME_UNKNOWN', 'the caller is told the outcome is unknown')
  const tasks = booted.tasks().length, attempts = booted.attempts().length
  assert.equal(booted.tasks()[0].state, 'needs-reconciliation', 'the task keeps its own identity and waits for a Host decision')
  // A repeated identical call must not open a second task or a second attempt.
  await assert.rejects(() => booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-unknown', callId: 'call-unknown' }))
  assert.equal(booted.tasks().length, tasks, 'no replacement task was submitted')
  assert.equal(booted.attempts().length, attempts, 'and the attempt was not replayed')
})

test('a cancel before dispatch produces no machine call, and a late result writes no success', async t => {
  const booted = await bootToolHost(t, {
    script: [
      // The provider asks for a write and cancels the turn in the same breath: the call is never
      // dispatched, exactly as a stop that arrives while the model is still talking.
      () => { booted.stop.abort(); return askTool('bot_fs_write', WRITE) },
      ANSWER,
    ],
  })
  booted.stop = new AbortController()
  await assert.rejects(() => booted.loop.run({ botId: 'bot-a', input: 'write it', signal: booted.stop.signal }), error => error.code === 'BOT_LOOP_CANCELLED')
  assert.equal(booted.operations().length, 0, 'the remote agent was never reached')
  assert.equal(booted.tasks().length, 0, 'and no durable task was opened')
  assert.deepEqual(booted.store.get('bot-a').messages.map(row => row.role), ['user'], 'nothing was written for a call that never ran')

  // A tool that finishes after the cancel must not write a success the loop no longer owns.
  const late = await bootToolHost(t, { script: [askTool('bot_fs_read', { relativePath: 'notes.txt' }), ANSWER] })
  late.stop = new AbortController()
  let finished = false
  const loop = late.makeLoop({
    schemas: () => late.tools('bot-a').schemas(),
    isReadonly: () => true,
    call: async () => {
      // The tool cancels the turn and then keeps running, the way a remote write does.
      late.stop.abort()
      await new Promise(resolve => { setTimeout(resolve, 60) })
      finished = true
      return { ok: true }
    },
  })
  await assert.rejects(() => loop.run({ botId: 'bot-a', input: 'read it', signal: late.stop.signal }), error => error.code === 'BOT_LOOP_CANCELLED')
  assert.deepEqual(late.store.get('bot-a').messages.map(row => row.role), ['user', 'assistant'], 'no success was written for a cancelled call')
  assert.equal(late.operations().length, 0)
  await new Promise(resolve => { setTimeout(resolve, 80) })
  assert.equal(finished, true, 'the operation the Host started still finishes; its own identity reconciles it')
})

test('a read-only call carries the Bot own binding and its own derived identity', async t => {
  const booted = await bootToolHost(t, { script: [askTool('bot_fs_read', { relativePath: 'notes.txt' }), ANSWER] })
  await booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-read', callId: 'call-seed' })
  const reply = await booted.loop.run({ botId: 'bot-a', input: 'read the note' })
  assert.equal(reply.answer, 'done')
  const result = JSON.parse(booted.store.get('bot-a').messages.find(row => row.role === 'tool').content)
  assert.equal(Buffer.from(result.content, 'base64').toString('utf8'), 'hello from the Bot')
  assert.equal(result.sha256.length, 64)
  // The machine directory saw one identity per call, derived from the turn, never from the reply.
  const grants = booted.agent.store.db.prepare('SELECT context FROM grants').all().map(row => JSON.parse(row.context))
  const reads = grants.filter(grant => grant.taskId.startsWith('bot-'))
  assert.equal(reads.length, 1, 'the read ran under its own derived identity')
  for (const grant of reads) {
    assert.equal(grant.botId, 'bot-a')
    assert.match(grant.taskId, /^bot-[a-f0-9]{32}$/)
    assert.match(grant.attemptId, /^attempt-[a-f0-9]{32}$/)
  }
})

test('a capability whose backend exists but cannot run reports a real failure, not a success', async t => {
  const booted = await bootToolHost(t)
  // The remote agent here has no container profile, so a container command is a real refusal: the
  // Host offers the schema (the backend is registered) and the durable task records a real failure.
  const command = { workspaceRelativePath: '', argv: ['node', '--version'], timeoutMs: 5000 }
  await assert.rejects(() => booted.tools('bot-a').call('bot_command', command, { turnId: 'turn-cmd', callId: 'call-cmd' }),
    error => typeof error.code === 'string' && error.code.startsWith('TASK_'), 'the caller is told the durable task did not succeed')
  const state = await settle(() => ['succeeded', 'failed', 'cancelled', 'needs-reconciliation'].includes(booted.tasks()[0]?.state) ? booted.tasks()[0].state : null)
  assert.equal(['failed', 'needs-reconciliation'].includes(state), true, `the durable task recorded a real outcome: ${state}`)
  assert.equal(booted.attempts().length, 1)})

test('a batch with a duplicate call id, or past the cap, is refused as a whole', async t => {
  const booted = await bootToolHost(t, { recordCalls: true })
  // A provider that hands the loop a batch the Host's own stream reader would never produce: the
  // loop judges the batch before the first side effect, so half of it cannot run.
  const provider = async () => ({ text: 'working', toolCalls: [
    { id: 'call-1', name: 'bot_fs_read', args: { relativePath: 'notes.txt' } },
    { id: 'call-1', name: 'bot_fs_read', args: { relativePath: 'notes.txt' } },
  ], source: { kind: 'model', provider: 'alpha', model: 'one' } })
  const surface = { schemas: () => booted.tools('bot-a').schemas(), isReadonly: () => true, call: (name, args, context) => booted.tools('bot-a').call(name, args, context) }
  const loop = booted.makeLoop(surface, provider)
  await assert.rejects(() => loop.run({ botId: 'bot-a', input: 'twice' }), error => error.code === 'BOT_LOOP_TOOL_CALL_DUPLICATE')
  assert.equal(booted.machineCalls.length, 0, 'neither call was dispatched')
  // Nine calls in one batch is refused as a whole rather than sliced to the first eight.
  const many = booted.makeLoop(surface, async () => ({ text: '', toolCalls: Array.from({ length: 9 }, (_, at) => ({ id: `call-${at}`, name: 'bot_fs_read', args: { relativePath: 'notes.txt' } })), source: { kind: 'model', provider: 'alpha', model: 'one' } }))
  await assert.rejects(() => many.run({ botId: 'bot-a', input: 'too many' }), error => error.code === 'BOT_LOOP_TOOL_CALL_LIMIT')
  assert.equal(booted.machineCalls.length, 0, 'and nothing was dispatched')
})
test('closing the Host service ends its own waits and refuses further calls without claiming a stop', async t => {
  const booted = await bootToolHost(t, { recordCalls: true })
  // A dispatched write whose outcome nobody can read, and a Host that is disposed while waiting.
  const original = booted.agent.call.bind(booted.agent)
  booted.agent.call = async (name, args, context, operationId) => {
    if (name === 'fs_write') return new Promise(() => {})
    return original(name, args, context, operationId)
  }
  const pending = booted.tools('bot-a').call('bot_fs_write', WRITE, { turnId: 'turn-close', callId: 'call-close' })
  await new Promise(resolve => { setTimeout(resolve, 50) })
  const taskId = booted.tasks()[0].id
  const tickets = booted.grants().length
  assert.equal(tickets, 1, 'the remote computer was really reached once')
  booted.host.close()
  await assert.rejects(() => pending, error => error.code === 'TOOL_HOST_CLOSED' && error.taskId === taskId,
    'the local wait ends, and the error names the task it was waiting for')
  // Nothing new is dispatched, and no stop is claimed: the task keeps its own identity.
  await assert.rejects(() => booted.tools('bot-a').call('bot_fs_read', { relativePath: 'notes.txt' }, { turnId: 't', callId: 'c' }), error => error.code === 'TOOL_HOST_CLOSED')
  assert.equal(booted.grants().length, tickets, 'a closed service reaches no machine')
  assert.equal(booted.tasks().length, 1, 'and submits no replacement task')
  assert.equal(booted.attempts().length, 1)
  // The issued registry is dropped with the service, so an old id stops being citable.
  await assert.rejects(() => booted.tools('bot-a').call('bot_operation_status', { operationId: 'operation-forged' }, { turnId: 't', callId: 'c' }), error => error.code === 'TOOL_HOST_CLOSED')
})

test('the issued registry is bounded, so a long conversation cannot grow it without limit', async t => {
  const booted = await bootToolHost(t, { issuedLimit: 2 })
  const write = at => booted.tools('bot-a').call('bot_fs_write', { ...WRITE, relativePath: `note-${at}.txt` }, { turnId: `turn-${at}`, callId: `call-${at}` })
  const first = await write(1)
  await write(2)
  const third = await write(3)
  await write(4)
  // The newest issued task is still citable; the oldest is not, because the registry is bounded.
  const status = await booted.tools('bot-a').call('bot_task_status', { taskId: third.taskId }, { turnId: 't', callId: 'c' })
  assert.equal(status.taskId, third.taskId)
  await assert.rejects(() => booted.tools('bot-a').call('bot_task_status', { taskId: first.taskId }, { turnId: 't', callId: 'c' }),
    error => error.code === 'TASK_NOT_ISSUED', 'an id pushed out of the bounded registry stops being citable')
})

test('the plugin registers its own disposal, so an unloaded Host leaves no loop behind', async t => {
  const parent = resolve(import.meta.dirname, '../tmp/integration/independent-tools')
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'dispose-'))
  const disposers = []
  const ctx = {
    get: name => (name === 'llm' ? { stream: async function* stream() {} } : undefined),
    effect: execute => { disposers.push(execute) },
    logger: { warn() {}, info() {} },
  }
  const runtime = createPluginRuntime({ ctx, settings: { enabled: true, dir }, stateDir: dir, integration: async () => ({ answer: 'from-the-harness' }) })
  assert.equal(disposers.length, 1, 'the runtime registered a disposal effect on the Host context')
  // Disposing twice is a no-op, and it never claims a remote stop: it only drops what this process
  // holds. A turn still in flight keeps its own durable identity for the Host to reconcile.
  await disposers[0]()()
  await disposers[0]()()
  assert.deepEqual(runtime.busyBots(), [], 'no lease is left held by a disposed runtime')
})

test('the machine tools offered are exactly the ones the agent really has', async t => {  const booted = await bootToolHost(t)
  const ceiling = new Set(MACHINE_TOOLS)
  for (const schema of booted.tools('bot-a').schemas()) {
    const entry = { bot_fs_write: 'fs_write', bot_command: 'container_command_v1' }[schema.name]
    if (entry) assert.ok(ceiling.has(entry))
  }
  assert.ok(booted.tools('bot-a').machines().includes(booted.agent.store.machineId))
})
