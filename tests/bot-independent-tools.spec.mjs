import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { bootIndependentHost, seed } from './fixtures/bot-independent-boot.mjs'
import { createWorkspaceTools } from '../modules/independent-runtime/workspace-tools.mjs'
import { createRemoteTools } from '../modules/independent-runtime/remote-tools.mjs'

// Tools for the independent runtime: where they come from, what they may touch, and what happens
// when the outcome is unknown.
//
// The loop owns no authority. Everything below goes through a resolver the Host passes in, which
// is the same shape the plugin uses in production: either the Bot's own committed machine binding
// (a fresh task/attempt per call), or an explicit per-Bot decision. A Host that offers neither
// offers nothing, and the loop says so.

const BOTH = { a: {}, b: {} }
const ASK = (toolName, args = '{"path":"notes.txt"}') => [
  { type: 'text-delta', index: 0, text: 'working' },
  { type: 'tool-call-delta', index: 0, id: 'call-1', name: toolName, argumentsDelta: args },
  { type: 'finish', reason: { kind: 'stop' } },
]
const ANSWER = [{ type: 'text-delta', index: 0, text: 'done' }, { type: 'finish', reason: { kind: 'stop' } }]

test('a Bot with no Host tool resolver gets no tools, and the loop says so', async t => {
  const booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: ASK('fs_read') })
  await booted.move('a', 'independent')
  // The model asked for a tool the Host cannot offer: that is an honest refusal, not a shared
  // workspace root handed to every Bot as a stand-in.
  await assert.rejects(() => booted.turn('a', 'read it'), error => error.code === 'BOT_LOOP_TOOLS_UNAVAILABLE')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'assistant'])
  assert.deepEqual(booted.serving.busyBots(), [], 'the lease is released')
  assert.equal(booted.upstream.length, 1)
  assert.deepEqual(booted.upstream[0].messages.filter(message => message.role === 'user'), [{ role: 'user', content: [{ type: 'text', text: 'read it' }] }])
  assert.equal(booted.upstream[0].messages[0].role, 'system')
})

test('each Bot gets its own committed root, and a path outside it is refused', async t => {
  const roots = await mkdtemp(join(resolve(import.meta.dirname, '..', 'tmp/integration/bot-independent'), 'roots-'))
  const rootA = join(roots, 'a')
  const rootB = join(roots, 'b')
  await mkdir(rootA, { recursive: true })
  await mkdir(rootB, { recursive: true })
  await writeFile(join(rootA, 'notes.txt'), 'a secret')
  await writeFile(join(rootB, 'notes.txt'), 'b secret')
  // The Host's per-Bot resolver: the root comes from the Bot the loop asked for, never from a
  // global setting and never from the request. After the first call the provider answers, the way
  // a model does once it has what it asked for.
  let booted
  const toolsFor = botId => {
    const inner = createWorkspaceTools({ root: botId === 'a' ? rootA : rootB })
    return {
      names: inner.names, isReadonly: inner.isReadonly, origin: inner.origin,
      call: async (name, args, context) => {
        const result = await inner.call(name, args, context)
        booted.state.chunks = ANSWER
        return result
      },
    }
  }
  booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: ASK('fs_read'), runtimeSettings: { toolsFor } })
  await booted.move('a', 'independent')
  await booted.move('b', 'independent')
  const read = await booted.turn('a', 'read it')
  assert.equal(read.answer, 'done')
  const toolResult = booted.transcript('a').find(row => row.role === 'tool')
  assert.match(toolResult.content, /a secret/)
  assert.doesNotMatch(toolResult.content, /b secret/, 'one Bot cannot read another Bot root')
  // A path that leaves the root is refused before anything is written, and the loop reports the
  // refusal instead of inventing a result.
  const escaped = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH, chunks: ASK('fs_write', '{"path":"../outside.txt","content":"x"}'), runtimeSettings: { toolsFor },
  })
  await escaped.move('a', 'independent')
  await assert.rejects(() => escaped.turn('a', 'escape'), error => error.code === 'PATH_OUTSIDE_ROOT')
  assert.equal(escaped.transcript('a').at(-1).role, 'assistant', 'no tool result was invented for a refused path')
})

test('a remote tool runs under the Bot own binding, and a forged identity never reaches it', async t => {
  const seen = []
  // The Host's remote invoker, in the shape the composition provides: the Bot's own subject, its
  // live machine binding, its root and a fresh task/attempt per call. Nothing here accepts a
  // machine, root, endpoint or operation id from the caller's arguments.
  const bindings = { a: { root: 'root-a', tools: ['fs_read', 'machine_ping'] }, b: { root: 'root-b', tools: ['fs_read'] } }
  const remoteInvoke = (botId, tool, args) => {
    seen.push({ botId, tool, args })
    const binding = bindings[botId]
    if (!binding) throw new Error('MACHINE_NOT_BOUND')
    if (!binding.tools.includes(tool)) throw new Error('MACHINE_BOT_DENIED')
    return { ok: true, botId, root: binding.root }
  }
  let booted
  // The same adapter the loop gets in production, wrapped so the provider answers the second step.
  const toolsFor = botId => {
    const inner = createRemoteTools({ invoke: (tool, args) => remoteInvoke(botId, tool, args) })
    return {
      names: inner.names, isReadonly: inner.isReadonly, origin: inner.origin,
      call: async (name, args, context) => {
        const result = await inner.call(name, args, context)
        booted.state.chunks = ANSWER
        return result
      },
    }
  }
  const settings = { remoteInvoke, remoteTools: ['fs_read', 'fs_write', 'machine_ping'] }
  booted = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: ASK('machine_ping'), runtimeSettings: { toolsFor } })
  await booted.move('a', 'independent')
  const reply = await booted.turn('a', 'ping')
  assert.equal(reply.answer, 'done')
  assert.deepEqual(seen, [{ botId: 'a', tool: 'machine_ping', args: { path: 'notes.txt' } }], 'the call carries the dispatched Bot and nothing else')
  const result = JSON.parse(booted.transcript('a').find(row => row.role === 'tool').content)
  assert.equal(result.root, 'root-a', 'the tool ran on this Bot own root')
  // A tool outside the offered set never reaches the invoker.
  const ungranted = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: ASK('shell_exec'), runtimeSettings: settings })
  await ungranted.move('a', 'independent')
  await assert.rejects(() => ungranted.turn('a', 'shell'), error => error.code === 'TOOL_NOT_GRANTED')
  assert.equal(seen.length, 1, 'the invoker was not reached')
  // A tool the Bot's own binding does not carry is refused by the Host, not by the loop.
  const denied = await bootIndependentHost(t, { seed: seed(), funding: BOTH, chunks: ASK('fs_write'), runtimeSettings: settings })
  await denied.move('a', 'independent')
  await assert.rejects(() => denied.turn('a', 'write'), error => error.message === 'MACHINE_BOT_DENIED')
  assert.equal(seen.length, 2, 'the Host reached the invoker and refused it there')
  // A reply that smuggles identity into the arguments is refused before the tool is touched.
  const forged = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH, chunks: ASK('fs_read', '{"path":"x","rootId":"root-b","taskId":"t","operationId":"o"}'), runtimeSettings: settings,
  })
  await forged.move('a', 'independent')
  await assert.rejects(() => forged.turn('a', 'forged'), error => error.code === 'TOOL_ARG_FORBIDDEN:rootId')
  assert.equal(seen.length, 2, 'nothing new reached the Host')
})

test('a tool call must arrive as a real stream chunk, and no tool schema is claimed', async t => {
  let booted
  const booted2 = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH, chunks: ASK('fs_read'),
    runtimeSettings: { toolsFor: () => ({ call: async () => { booted.state.chunks = ANSWER; return { ok: true } } }) },
  })
  booted = booted2
  await booted.move('a', 'independent')
  const reply = await booted.turn('a', 'read it')
  // The ask the loop ran came from the Host's own `tool-call-delta` chunk, not from a provider that
  // was handed a tool result by a fixture.
  const ask = booted.transcript('a').find(row => row.role === 'assistant' && row.name === 'fs_read')
  assert.ok(ask, 'the tool call is recorded in the transcript')
  assert.equal(ask.toolCall.id, 'call-1')
  assert.equal(ask.toolCall.name, 'fs_read')  // Honest about the remaining gap: the request carries no tool schema, so the model-facing tool
  // surface is not wired yet and a tool the model names by itself is what runs.
  assert.deepEqual(booted.upstream.map(call => call.tools), [null, null], 'no tool schema is sent to the provider')
  assert.deepEqual(reply.toolCalls, [{ id: 'call-1', name: 'fs_read' }], 'and the call it ran is the one the stream asked for')
  // The second request is the Host's own canonical conversation: the ask is a tool-call block, the
  // result is correlated to it by call id, and every assistant message carries its route.
  const second = booted.upstream[1].messages.filter(message => message.role !== 'system')
  assert.deepEqual(second.map(message => message.role), ['user', 'assistant', 'tool'])
  assert.deepEqual(second[1].content, [
    { type: 'text', text: 'working' },
    { type: 'tool-call', id: 'call-1', name: 'fs_read', arguments: '{"path":"notes.txt"}' },
  ])
  assert.deepEqual(second[1].source, { kind: 'model', provider: 'alpha', model: 'one' })
  assert.equal(second[2].toolCallId, 'call-1')
  assert.deepEqual(second[2].content, [{ type: 'text', text: '{"ok":true}' }])
})

test('a cancel while a tool is running stops the turn without waiting for it', async t => {
  const controller = new AbortController()
  let toolFinished = false
  const booted = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH, chunks: ASK('slow'),
    runtimeSettings: {
      toolsFor: () => ({
        call: async () => {
          // The tool cancels the turn and then keeps running, the way a remote write does.
          controller.abort()
          await new Promise(done => { setTimeout(done, 60) })
          toolFinished = true
          return { ok: true }
        },
      }),
    },
  })
  await booted.move('a', 'independent')
  await assert.rejects(() => booted.turn('a', 'go', controller.signal), error => error.code === 'BOT_LOOP_CANCELLED')
  assert.equal(toolFinished, false, 'the loop did not wait for the whole tool call')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'assistant'], 'the complete ask batch is kept, no result is invented')
  assert.deepEqual(booted.serving.busyBots(), [], 'the lease is released')
  await new Promise(done => { setTimeout(done, 90) })
  assert.equal(toolFinished, true, 'the operation the Host started still finishes; its own durable identity reconciles it')
})

test('a write whose outcome is unknown is not replayed and not invented', async t => {
  let attempts = 0
  const booted = await bootIndependentHost(t, {
    seed: seed(), funding: BOTH, chunks: ASK('fs_write'),
    runtimeSettings: {
      toolsFor: () => ({
        call: async () => { attempts += 1; throw Object.assign(new Error('写入结果未知。'), { code: 'WRITE_OUTCOME_UNKNOWN' }) },
      }),
    },
  })
  await booted.move('a', 'independent')
  await assert.rejects(() => booted.turn('a', 'write it'), error => error.code === 'WRITE_OUTCOME_UNKNOWN')
  assert.equal(attempts, 1, 'the tool ran once')
  const rows = booted.transcript('a')
  assert.deepEqual(rows.map(row => row.role), ['user', 'assistant'])
  assert.equal(rows.at(-1).toolCalls[0].id, 'call-1', 'the unconfirmed original call remains recorded')
  assert.doesNotMatch(rows.at(-1).content, /unknown/, 'no tool result claims an outcome nobody reported')
  // The next turn is a new turn: the user input is not resent and the tool is not retried for them.
  booted.state.chunks = ANSWER
  const after = await booted.turn('a', 'try again')
  assert.equal(after.answer, 'done')
  assert.equal(attempts, 1, 'the failed write was not replayed')
  assert.deepEqual(booted.transcript('a').map(row => row.role), ['user', 'assistant', 'user', 'assistant'])
})
