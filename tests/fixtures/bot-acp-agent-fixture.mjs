#!/usr/bin/env node
// Offline ACP agent fixture for the bot-acp test suite.
//
// This is a REAL child process (plain Node, no network, no agent CLI) that
// speaks the ACP wire the adapter expects: JSON-RPC 2.0 over stdio, one object
// per line, with server-to-client requests (session/request_permission,
// fs/read_text_file, terminal/create) and session/update notifications.
//
// It is launched through the trusted native supervisor exactly like a real
// pinned CLI would be, so the tests exercise the same transport, framing and
// stop evidence as production.
//
// The Host-constructed argv selects the agent's posture, exactly as a pinned
// CLI's flags would (the adapter never invents these; the test passes them):
//   --fixture-mode=MODE    default | no-load | load-refuse | model-option |
//                          no-auth | auth-fail | exit-early | cancel-ignore |
//                          no-session-id | wrong-protocol | modes |
//                          slow-init | late-response
//   --fixture-fragment     writes each line in several chunks (UTF-8 splits)
//   --fixture-unicode      answers with multi-byte text
// Environment variables remain as a fallback for direct manual runs.
//
// The prompt text selects the turn scenario:
//   (default)      two agent_message_chunk updates, then stopReason end_turn
//   usage-known    the result carries usage/context figures
//   slow           one chunk, then silence until session/cancel or a kill
//   cancel-ignore  ignores session/cancel and keeps the turn open
//   unknown-stop   answers stopReason max_turn_requests
//   empty          answers end_turn with no output at all
//   permission     asks session/request_permission and waits for the answer
//   fs-read        asks fs/read_text_file
//   terminal       asks terminal/create
//   dup-response   answers the prompt twice with the same id
//   unknown-id     sends a response for an id it never received
//   not-rpc        sends a valid JSON object that is not a JSON-RPC message
//   garbage        sends a line that is not JSON at all
//   oversize       streams one ~300 KB chunk (over the transport frame cap)
//
// Evidence (argv, initialize params, sessions, turns, asks) is written to
// fixture-evidence.json in the process cwd so tests assert on the real wire.

import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const evidence = {
  pid: process.pid,
  argv: process.argv.slice(2),
  env: { mode: process.env.FIXTURE_ACP_MODE ?? 'default' },
  initialize: null,
  sessions: [],
  turns: [],
  asks: [],
  cancels: 0,
  exited: null,
}
const writeEvidence = () => {
  try { writeFileSync(join(process.cwd(), 'fixture-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`) } catch {}
}

const argvMode = evidence.argv.find(arg => arg.startsWith('--fixture-mode='))?.slice('--fixture-mode='.length)
const MODE = argvMode ?? process.env.FIXTURE_ACP_MODE ?? 'default'
const FRAGMENT = evidence.argv.includes('--fixture-fragment') || process.env.FIXTURE_ACP_FRAGMENT === '1'
const UNICODE = evidence.argv.includes('--fixture-unicode') || process.env.FIXTURE_ACP_UNICODE === '1'
if (evidence.argv.length === 1 && evidence.argv[0] === '--version') {
  process.stdout.write(`dsh-acp-agent-fixture 1.0.0 (node ${process.versions.node}) fixture-only\n`)
  process.exit(0)
}

let buffer = ''
let queue = Promise.resolve()
/** One line on the wire, optionally split into several writes. Writes are queued
 *  so two frames can never interleave their fragments. */
const writeLine = wire => new Promise(resolve => {
  if (!FRAGMENT) { process.stdout.write(`${wire}\n`, () => resolve()); return }
  const bytes = Buffer.from(`${wire}\n`, 'utf8')
  const parts = [bytes.subarray(0, 7), bytes.subarray(7, 23), bytes.subarray(23)]
  let index = 0
  const push = () => {
    if (index >= parts.length) { resolve(); return }
    process.stdout.write(parts[index++], () => setTimeout(push, 2))
  }
  push()
})
const flush = () => {
  if (!buffer) return
  const wire = buffer
  buffer = ''
  queue = queue.then(() => writeLine(wire))
}
const send = value => { buffer += JSON.stringify(value); flush() }
const notify = (method, params) => send({ jsonrpc: '2.0', method, params })
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value })
const fail = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } })

const pendingAsks = new Map()
let askSeq = 0
let nextSession = 0
let openPrompt = null // { id, sessionId, answered }

const agentCapabilities = () => {
  if (MODE === 'no-load') return undefined
  return { loadSession: true, sessionCapabilities: { close: {} } }
}

const initializeResult = () => ({
  protocolVersion: MODE === 'wrong-protocol' ? 999 : 1,
  authMethods: MODE === 'no-auth' ? [] : [{ id: 'fixture-token' }],
  agentInfo: { name: 'acp-agent-fixture', version: '1.0.0' },
  agentCapabilities: agentCapabilities(),
})

const sessionNewResult = () => {
  const sessionId = `fixture-session-${++nextSession}`
  const base = { sessionId }
  if (MODE === 'model-option') {
    base.configOptions = [
      { id: 'model', type: 'select', currentValue: 'fixture-model-a', options: [{ value: 'fixture-model-a', name: 'Model A' }, { value: 'fixture-model-b', name: 'Model B' }] },
      { id: 'effort', type: 'select', currentValue: 'medium', options: [{ value: 'low', name: 'Low' }, { value: 'medium', name: 'Medium' }] },
    ]
  } else {
    base.models = { availableModels: [{ modelId: 'fixture-model-a', name: 'Model A' }, { modelId: 'fixture-model-b', name: 'Model B' }], currentModelId: 'fixture-model-a' }
  }
  if (MODE === 'modes') base.modes = [{ id: 'default', name: 'Default' }, { id: 'auto-edit', name: 'Auto edit' }]
  return base
}

const textOf = prompt => {
  const block = Array.isArray(prompt) ? prompt.find(entry => entry?.type === 'text') : null
  return typeof block?.text === 'string' ? block.text : ''
}

const update = (sessionId, value) => notify('session/update', { sessionId, update: value })
const chunk = (sessionId, text, messageId = 'm1') => update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text } })

/** Send one server-to-client request and wait for the client's answer. */
const ask = (method, params) => new Promise(resolve => {
  const askId = 900000 + ++askSeq
  pendingAsks.set(askId, resolve)
  evidence.asks.push({ method, params, askId })
  writeEvidence()
  send({ jsonrpc: '2.0', id: askId, method, params })
})

const finishPrompt = (id, stopReason) => {
  if (!openPrompt || openPrompt.id !== id || openPrompt.answered) return
  openPrompt.answered = true
  result(id, { stopReason })
}

const runTurn = async (id, params) => {
  const text = textOf(params?.prompt)
  const sessionId = params?.sessionId ?? null
  evidence.turns.push({ sessionId, text })
  writeEvidence()
  openPrompt = { id, sessionId, answered: false }

  if (text.includes('oversize')) {
    update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'big', content: { type: 'text', text: 'x'.repeat(300 * 1024) } })
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('not-rpc')) {
    chunk(sessionId, 'before the odd frame. ')
    send({ foo: 'not a jsonrpc message' })
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('garbage')) {
    chunk(sessionId, 'before the odd frame. ')
    try { process.stdout.write('this line is not json at all\n') } catch {}
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('unknown-id')) {
    chunk(sessionId, 'before the odd frame. ')
    send({ jsonrpc: '2.0', id: 424242, result: { stopReason: 'end_turn' } })
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('dup-response')) {
    chunk(sessionId, 'before the odd frame. ')
    result(id, { stopReason: 'end_turn' })
    result(id, { stopReason: 'end_turn' })
    return
  }  if (text.includes('permission')) {
    chunk(sessionId, 'asking for permission… ')
    const answer = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'tool-1', title: 'run a command', kind: 'execute', rawInput: { command: 'echo hi' }, status: 'pending' },
      options: [
        { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' },
      ],
    })
    const selected = answer?.result?.outcome?.outcome === 'selected'
    chunk(sessionId, selected ? 'allowed.' : 'denied.')
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('fs-read')) {
    await ask('fs/read_text_file', { path: join(process.cwd(), 'outside.txt'), line: 1, limit: 5 })
    chunk(sessionId, 'read attempted.')
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('terminal')) {
    await ask('terminal/create', { command: 'cmd.exe', args: ['/c', 'echo'] })
    chunk(sessionId, 'terminal attempted.')
    finishPrompt(id, 'end_turn')
    return
  }
  if (text.includes('slow') || text.includes('cancel-ignore')) {
    chunk(sessionId, 'thinking slowly…')
    // No result: only a real stop ends this turn.
    return
  }
  chunk(sessionId, UNICODE ? '你好，世界 🌍 ' : 'fixture reply part 1. ')
  update(sessionId, { sessionUpdate: 'usage_update', used: 1200, size: 200000 })
  if (text.includes('usage-known')) update(sessionId, { sessionUpdate: 'usage_update', used: 2400, size: 200000 })
  chunk(sessionId, 'fixture reply part 2.')
  if (text.includes('unknown-stop')) { finishPrompt(id, 'max_turn_requests'); return }
  if (text.includes('usage-known')) result(id, { stopReason: 'end_turn', usage: { inputTokens: 31, outputTokens: 12 } })
  else finishPrompt(id, 'end_turn')
  if (MODE === 'late-response') {
    // After the turn is settled: a duplicate answer for an id the client already
    // settled, plus an update naming a session that no longer exists.
    setTimeout(() => {
      result(id, { stopReason: 'end_turn', usage: { inputTokens: 99, outputTokens: 99 } })
      update('stale-session', { sessionUpdate: 'agent_message_chunk', messageId: 'late', content: { type: 'text', text: 'late injected text. ' } })
    }, 400)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === undefined && msg.id !== undefined) {
    // A response to an ask this fixture sent.
    const resolveAsk = pendingAsks.get(msg.id)
    if (resolveAsk) { pendingAsks.delete(msg.id); resolveAsk(msg) }
    return
  }
  switch (msg.method) {
    case 'initialize':
      evidence.initialize = { protocolVersion: msg.params?.protocolVersion, clientInfo: msg.params?.clientInfo, clientCapabilities: msg.params?.clientCapabilities }
      writeEvidence()
      // A slow handshake: a Host stop can land while the launch is still in
      // flight, which is the only honest way to prove no late spawn survives.
      if (MODE === 'slow-init') { setTimeout(() => result(msg.id, initializeResult()), 2000); return }
      result(msg.id, initializeResult())
      return
    case 'authenticate':
      if (MODE === 'auth-fail') { fail(msg.id, -32000, 'Login expired'); return }
      result(msg.id, {})
      return
    case 'session/new':
      evidence.sessions.push({ kind: 'new', cwd: msg.params?.cwd, mcpServers: msg.params?.mcpServers ?? null })
      writeEvidence()
      if (MODE === 'no-session-id') { result(msg.id, {}); return }
      result(msg.id, sessionNewResult())
      return
    case 'session/load': {
      evidence.sessions.push({ kind: 'load', sessionId: msg.params?.sessionId, cwd: msg.params?.cwd })
      writeEvidence()
      if (MODE === 'load-refuse') { fail(msg.id, -32602, 'session not found', { sessionId: msg.params?.sessionId }); return }
      result(msg.id, { sessionId: msg.params?.sessionId, models: { availableModels: [{ modelId: 'fixture-model-a', name: 'Model A' }], currentModelId: 'fixture-model-a' } })
      return
    }
    case 'session/prompt':
      if (MODE === 'exit-early') {
        // Die before answering: the client must settle the turn from the exit.
        try { process.stderr.write('fixture: simulated crash before result\n') } catch {}
        setTimeout(() => exit(3), 10)
        return
      }
      void runTurn(msg.id, msg.params)
      return
    case 'session/cancel':
      evidence.cancels++
      writeEvidence()
      if (MODE === 'cancel-ignore') return
      // Answer any blocked ask as cancelled, then end the open turn.
      for (const [askId, resolveAsk] of [...pendingAsks]) {
        pendingAsks.delete(askId)
        send({ jsonrpc: '2.0', id: askId, result: { outcome: { outcome: 'cancelled' } } })
        resolveAsk({ id: askId, result: { outcome: { outcome: 'cancelled' } } })
      }
      if (openPrompt) finishPrompt(openPrompt.id, 'cancelled')
      return
    case 'session/set_model':
      if (MODE === 'model-option') { result(msg.id, { configOptions: [{ id: 'model', type: 'select', currentValue: msg.params?.modelId }] }); return }
      result(msg.id, { models: { availableModels: [{ modelId: 'fixture-model-a' }, { modelId: 'fixture-model-b' }], currentModelId: msg.params?.modelId } })
      return
    case 'session/set_config_option':
      if (MODE === 'model-option' && msg.params?.configId === 'model') {
        result(msg.id, { configOptions: [{ id: 'model', type: 'select', currentValue: msg.params?.value }] })
        return
      }
      fail(msg.id, -32602, 'unknown config option')
      return
    case 'session/set_mode':
      if (MODE === 'modes') { result(msg.id, {}); return }
      fail(msg.id, -32601, 'method not found')
      return
    case 'session/close':
      result(msg.id, {})
      return
    default:
      fail(msg.id, -32601, 'method not found')
  }
})

const exit = code => {
  evidence.exited = { code }
  writeEvidence()
  process.exit(code)
}
rl.on('close', () => exit(0))
process.on('SIGTERM', () => exit(143))
process.on('SIGINT', () => exit(130))
