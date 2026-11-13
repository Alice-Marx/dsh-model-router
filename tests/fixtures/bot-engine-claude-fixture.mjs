#!/usr/bin/env node
// Offline Claude Code CLI fixture for the bot-engine test suite.
//
// This is a REAL child process (plain Node, no network, no claude CLI) that speaks the
// same wire the engine expects from Claude Code in `-p --output-format stream-json
// --input-format stream-json` mode:
//   stdin  <- one JSON line per user turn {type:'user',message:{role:'user',content}}
//   stdout -> system/init, stream_event deltas, assistant frames, user tool_result
//             frames, and one `result` frame settling the turn.
// It answers the `--version` probe, validates the --mcp-config the engine wrote, and
// plays the permission-proxy role by asking the engine's broker pipe directly
// (env.DSH_CLAUDE_BROKER_PIPE) exactly like the mounted mcp__dsh__approve proxy would.
//
// Turn scenarios are selected by keywords in the user text:
//   (default)          echo turn: deltas + assistant + result with usage and cost
//   ask-granted:<tool> permission ask for a granted bridge tool, then tool_result
//   ask-unknown        permission ask for Bash (never bridged) -> engine auto-denies
//   question:<text>    kind:'question' ask answered by the host callback
//   no-usage           result without usage/cost fields
//   utf8-multiline     multi-byte, multi-line assistant text, one frame written in
//                      split stdout chunks
//   oversize-legal     one ~200 KB assistant text line (under the 256 KB frame limit)
//   stray              a second result frame after the settling one (must be ignored)
//   slow               init + one delta, then no result (revocation/stop tests)
//   exit-after-result  exit(0) right after the result frame (relaunch/--resume tests)
//   resume-refuse      resumed process: error result before init, exit(1)
//   resume-vanish      resumed process: exit(3) before emitting any frame
//
// Evidence (argv, mcp validation, asks/answers, turns) is appended to
// fixture-evidence.json in the process cwd so tests can assert on the real wire.

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'

const evidence = { pid: process.pid, argv: {}, turns: [], asks: [], mcp: null, exited: null }
let hostMcpConfig = null, hostMcpClient = null
const writeEvidence = () => {
  const target = join(process.cwd(), 'fixture-evidence.json'), temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`)
  renameSync(temporary, target)
}
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16)

// ---- argv ------------------------------------------------------------------
const rawArgs = process.argv.slice(2)
const flags = {}
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i]
  if (arg === '-p' || arg === '--verbose' || arg === '--include-partial-messages' || arg === '--strict-mcp-config' || arg === '--disable-slash-commands') { flags[arg] = true; continue }
  const inline = /^--([A-Za-z0-9-]+)=(.*)$/.exec(arg)
  if (inline) { flags[`--${inline[1]}`] = inline[2]; continue }
  if (arg.startsWith('--')) { flags[arg] = rawArgs[i + 1]; i++; continue }
  flags._extra = [...(flags._extra ?? []), arg]
}
evidence.argv = {
  version: process.versions.node,
  print: flags['-p'] === true,
  outputFormat: flags['--output-format'] ?? null,
  inputFormat: flags['--input-format'] ?? null,
  verbose: flags['--verbose'] === true,
  partial: flags['--include-partial-messages'] === true,
  permissionMode: flags['--permission-mode'] ?? null,
  permissionPromptTool: flags['--permission-prompt-tool'] ?? null,
  mcpConfig: flags['--mcp-config'] ?? null,
  strictMcp: flags['--strict-mcp-config'] === true,
  builtinTools: flags['--tools'] ?? null,
  settingSources: flags['--setting-sources'] ?? null,
  settings: flags['--settings'] ? JSON.parse(flags['--settings']) : null,
  slashCommandsDisabled: flags['--disable-slash-commands'] === true,
  model: flags['--model'] ?? null,
  systemPromptFile: flags['--append-system-prompt-file'] ?? null,
  systemPrompt: flags['--append-system-prompt-file'] ? readFileSync(flags['--append-system-prompt-file'], 'utf8') : null,
  resume: flags['--resume'] ?? null,
  allowedTools: typeof flags['--allowedTools'] === 'string' ? flags['--allowedTools'].split(',') : [],
  disallowedTools: typeof flags['--disallowedTools'] === 'string' ? flags['--disallowedTools'].split(',') : [],
}

if (rawArgs[0] === '--version' && rawArgs.length === 1) {
  await new Promise(resolve => process.stdout.write(`dsh-claude-fixture 1.0.0 (node ${process.versions.node}) fixture-only\n`, resolve))
  process.exit(0)
}

const out = value => {
  const wire = `${JSON.stringify(value)}\n`
  if (pendingSplit) { pendingSplit.queue.push(wire); return }
  process.stdout.write(wire)
}
let pendingSplit = null
/** One frame written as two stdout chunks with the newline last. While the tail is
 * in flight every later frame queues behind it, so chunks never interleave with
 * another frame's bytes (that would corrupt the line framing on purpose). */
const outSplit = value => {
  const wire = JSON.stringify(value)
  const half = Math.floor(wire.length / 2)
  const state = { queue: [] }
  pendingSplit = state
  process.stdout.write(wire.slice(0, half))
  setImmediate(() => {
    process.stdout.write(`${wire.slice(half)}\n`)
    pendingSplit = null
    for (const queued of state.queue) process.stdout.write(queued)
  })
}
const brokerPipe = process.env.DSH_CLAUDE_BROKER_PIPE ?? null
if (!brokerPipe) { process.stderr.write('fixture: missing DSH_CLAUDE_BROKER_PIPE\n'); process.exit(2) }

// ---- mcp-config validation (the real CLI would mount these servers) ----------
try {
  const config = JSON.parse(readFileSync(flags['--mcp-config'], 'utf8'))
  const servers = config.mcpServers ?? {}
  const dsh = servers.dsh ?? null
  const task = servers.dsh_task ?? null
  hostMcpConfig = task
  const taskTools = evidence.argv.allowedTools.filter(name => name.startsWith('mcp__dsh_task__'))
  evidence.mcp = {
    proxyMounted: Boolean(dsh && dsh.type === 'stdio' && dsh.args?.[0]?.endsWith('claude-permission-proxy.mjs') && dsh.args?.[1] === brokerPipe),
    bridgeMounted: Boolean(task && task.type === 'stdio' && task.args?.length >= 1 && task.args[0].endsWith('cli-stdio-bridge.mjs')),
    bridgeExpected: taskTools.length > 0,
    permissionPromptToolIsProxy: evidence.argv.permissionPromptTool === 'mcp__dsh__approve',
    disallowedBash: evidence.argv.disallowedTools.includes('Bash'),
  }
} catch (error) { evidence.mcp = { error: String(error.message) } }
writeEvidence()

// A requested model slug starting with fixture-mismatch- makes init report a
// different model than requested (identity-verification test).
const requestedModel = evidence.argv.model ?? 'unknown'
const reportedModel = requestedModel.startsWith('fixture-mismatch-') ? 'fixture-actual-model' : requestedModel
const resumed = evidence.argv.resume !== null && evidence.argv.resume !== undefined
const sessionId = resumed ? evidence.argv.resume : `fx-${randomBytes(8).toString('hex')}`
let runningTotal = 0
const addCost = amount => { runningTotal = Number((runningTotal + amount).toFixed(6)) }

function ask({ kind, tool, input }) {
  return new Promise(resolve => {
    const id = `fxa-${randomBytes(9).toString('hex')}`
    let buffer = ''
    let socket
    const finish = answer => {
      try { socket?.destroy() } catch {}
      evidence.asks.push({ id, kind, tool, behavior: answer.behavior, message: answer.message ?? '', source: answer.source ?? '' })
      writeEvidence()
      resolve(answer)
    }
    try { socket = connect(brokerPipe) } catch (error) { finish({ behavior: 'deny', message: String(error.message), source: 'system' }); return }
    socket.on('error', error => finish({ behavior: 'deny', message: `broker-unreachable: ${error.message}`, source: 'system' }))
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ t: 'ask', id, kind, tool, input: input ?? {} })}\n`)
      socket.on('data', chunk => {
        buffer += chunk.toString('utf8')
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          try {
            const message = JSON.parse(line)
            if (message.t === 'answer' && message.id === id) finish(message)
          } catch { /* line not for us */ }
        }
      })
    })
  })
}

const emitInit = () => {
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: reportedModel, permissionMode: evidence.argv.permissionMode ?? 'default', tools: evidence.argv.allowedTools })
}

function assistantDeltas(text, { splitOnce = false } = {}) {
  const half = Math.max(1, Math.floor(text.length / 2))
  const first = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(0, half) } } }
  const second = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(half) } } }
  out(first)
  // The split frame exercises the supervisor's base64 line assembler below us; any
  // later frames queue behind it until both chunks are on the wire.
  splitOnce ? outSplit(second) : out(second)
}

const toolResultFrame = (toolUseId, ok, text) => out({
  type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: !ok }] },
})

function resultFrame({ isError = false, usage = true, cost = true, stopReason = null, errors = [], subtype = 'success', resultText = 'fixture turn complete' } = {}) {
  const frame = { type: 'result', subtype, is_error: isError, duration_ms: 12, num_turns: 1, result: resultText, session_id: sessionId, model: reportedModel }
  if (stopReason) frame.stop_reason = stopReason
  if (errors.length) frame.errors = errors
  if (usage) frame.usage = { input_tokens: 120, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, output_tokens: 45 }
  if (cost) frame.total_cost_usd = runningTotal
  out(frame)
}

async function runTurn(text) {
  evidence.turns.push({ text, hash: hash(text), resumed, model: requestedModel })
  writeEvidence()
  if (text.startsWith('host-wire:')) {
    const specification = JSON.parse(text.split('\n')[0].slice('host-wire:'.length))
    const { nativeProcess } = await import('../../packages/cli-runtime/src/native-process.mjs')
    const path = hostMcpConfig.args[1]
    const spec = JSON.parse(JSON.parse(readFileSync(path, 'utf8')).payload)
    const relay = nativeProcess(spec.helper, 'client', {
      endpoint: spec.endpoint, serverPid: spec.serverPid, serverStart: spec.serverStart, ttlMs: spec.sessionExpiresAt - Date.now(),
    }, { home: dirname(path) })
    const request = wire => new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); relay.events.off('message', receive); relay.events.off('failure', failed) }
      const receive = value => { if (value.id === wire.id) { clean(); resolve(value) } }
      const failed = error => { clean(); reject(error) }
      const timer = setTimeout(() => failed(new Error('WIRE_RESPONSE_TIMEOUT')), 15000)
      relay.events.on('message', receive)
      relay.events.on('failure', failed)
      void relay.send(wire).catch(failed)
    })
    const write = { type: 'request', id: 2, op: 'call', name: 'bot_fs_write', args: specification.calls[0].arguments }
    const listed = await request({ type: 'request', id: 1, op: 'list' })
    const first = await request(write)
    const repeated = await request(write)
    const lateId = await request({ ...write, id: 1 })
    const sameTick = await new Promise((resolve, reject) => {
      const frames = []
      const receive = value => {
        if (value.id !== 3) return
        frames.push(value)
        if (frames.length === 2) { clearTimeout(timer); relay.events.off('message', receive); resolve(frames) }
      }
      const timer = setTimeout(() => { relay.events.off('message', receive); reject(new Error('SAME_TICK_RESPONSE_TIMEOUT')) }, 15000)
      relay.events.on('message', receive)
      const frame = { ...write, id: 3, args: { ...write.args, relativePath: 'same-tick.txt' } }
      void Promise.all([relay.send(frame), relay.send(frame)]).catch(reject)
    })
    evidence.wireResults = { listed, first, repeated, lateId, sameTick }
    writeEvidence()
    assistantDeltas('wire tool test finished')
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'wire tool test finished' }] } })
    resultFrame()
    setTimeout(async () => {
      evidence.idleWireResult = await request({ type: 'request', id: 4, op: 'list' })
      writeEvidence()
      relay.end()
    }, 100)
    return
  }
  if (text.startsWith('host-tools:')) {
    const specification = JSON.parse(text.split('\n')[0].slice('host-tools:'.length))
    if (!hostMcpConfig) throw new Error('HOST_MCP_BRIDGE_MISSING')
    if (!hostMcpClient) {
      const { Client } = await import('@modelcontextprotocol/client')
      const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio')
      const transport = new StdioClientTransport({ command: hostMcpConfig.command, args: hostMcpConfig.args, env: hostMcpConfig.env, stderr: 'pipe' })
      transport.stderr?.on('data', chunk => { process.stderr.write(chunk) })
      hostMcpClient = new Client({ name: 'offline-native-host-tool-fixture', version: '1.0.0' })
      await hostMcpClient.connect(transport)
      evidence.mcpPid = transport.pid
    }
    const listed = await hostMcpClient.listTools({})
    evidence.hostToolNames = listed.tools.map(tool => tool.name)
    const results = []
    for (const [index, call] of specification.calls.entries()) {
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `host-${evidence.turns.length}-${index}`, name: `mcp__dsh_task__${call.name}`, input: call.arguments ?? {} }] } })
      const response = await hostMcpClient.callTool({ name: call.name, arguments: call.arguments ?? {} })
      results.push({ name: call.name, ...response })
      evidence.hostToolResults = results
      writeEvidence()
      const content = response.content.map(block => block.type === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } } : block)
      toolResultFrame(`host-${evidence.turns.length}-${index}`, response.isError !== true, content)
    }
    const summary = results.map(result => ({ ...result, content: result.content.map(block => block.type === 'image'
      ? { type: 'image', mimeType: block.mimeType, base64Length: block.data.length } : block) }))
    const responseText = `host tool results: ${JSON.stringify(summary)}`
    assistantDeltas(responseText)
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: responseText }] } })
    addCost(0.01)
    resultFrame({ resultText: responseText })
    if (specification.idleCall) setTimeout(async () => {
      evidence.idleToolResult = await hostMcpClient.callTool(specification.idleCall)
      writeEvidence()
    }, 100)
    return
  }
  if (resumed && text.includes('resume-refuse')) {
    // A terminal frame authorizes the Host to retire this process immediately.
    // Record the scenario before sending it; a later diagnostic write may be
    // pre-empted by a correct native-tree stop and is not stop evidence.
    evidence.terminalScenario = 'resume-refused'
    writeEvidence()
    resultFrame({ isError: true, subtype: 'error_during_execution', usage: false, cost: false, errors: ['No conversation found to resume.'], resultText: 'resume failed' })
    evidence.exited = 'resume-refused'
    writeEvidence()
    await new Promise(resolve => process.stdout.write('', resolve))
    process.exit(1)
  }
  if (resumed && text.includes('resume-vanish')) {
    evidence.exited = 'resume-vanished'
    writeEvidence()
    process.exit(3)
  }
  if (text.includes('ask-granted:')) {
    const tool = /ask-granted:([A-Za-z0-9_-]+)/.exec(text)[1]
    emitAssistantWithTool(tool)
    const answer = await ask({ kind: 'permission', tool: `mcp__dsh_task__${tool}`, input: { note: 'fixture bridge call' } })
    toolResultFrame(`tu-${hash(tool)}`, answer.behavior === 'allow', `bridge said: ${answer.behavior}`)
    addCost(0.02)
    resultFrame()
    return
  }
  if (text.includes('ask-unknown')) {
    const answer = await ask({ kind: 'permission', tool: 'Bash', input: { command: 'echo never' } })
    toolResultFrame('tu-unknown', false, `denied: ${answer.behavior}`)
    resultFrame({ resultText: 'unknown tool denied' })
    return
  }
  if (text.includes('question:')) {
    const question = /question:(.*)$/.exec(text)[1]
    const answer = await ask({ kind: 'question', tool: 'question', input: { question } })
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `answered: ${answer.message ?? ''}` }] } })
    resultFrame({ resultText: 'question answered' })
    return
  }
  if (text.includes('no-usage')) {
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'no usage will be reported' }] } })
    resultFrame({ usage: false, cost: false, resultText: 'usage omitted' })
    return
  }
  if (text.includes('utf8-multiline')) {
    const text1 = '第一行 🚀 ünïcödé\nsecond line\nthird line — émoji 🛰️'
    assistantDeltas(text1, { splitOnce: true })
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: text1 }] } })
    addCost(0.005)
    resultFrame({ resultText: text1 })
    return
  }
  if (text.includes('oversize-legal')) {
    const big = `x`.repeat(200_000)
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: big }] } })
    addCost(0.006)
    resultFrame({ resultText: 'oversize payload delivered' })
    return
  }
  if (text.includes('stray')) {
    addCost(0.007)
    resultFrame({ resultText: 'settling result' })
    resultFrame({ resultText: 'stray result that must be ignored' })
    return
  }
  if (text.includes('slow')) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'working slowly…' } } })
    const timer = setTimeout(() => { addCost(0.001); resultFrame() }, 120_000)
    timer.unref()
    return
  }
  // default echo turn
  const echoed = `echo: ${text.slice(0, 64)}`
  assistantDeltas(echoed)
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: echoed }] } })
  addCost(0.01)
  resultFrame()
  if (text.includes('exit-after-result')) {
    evidence.exited = 'after-result'
    writeEvidence()
    // Windows pipe writes are asynchronous: exit only after the terminal frame
    // reached the OS pipe. The Host can still observe process death immediately.
    await new Promise(resolve => process.stdout.write('', resolve))
    process.exit(0)
  }
}

function emitAssistantWithTool(tool) {
  out({
    type: 'assistant',
    message: { role: 'assistant', content: [
      { type: 'text', text: `calling bridged tool ${tool}` },
      { type: 'tool_use', id: `tu-${hash(tool)}`, name: `mcp__dsh_task__${tool}`, input: { op: 'list' } },
    ] },
  })
}

if (!resumed) emitInit()
const stdin = createInterface({ input: process.stdin })
stdin.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { process.stderr.write('fixture: non-JSON stdin line\n'); return }
  if (message?.type !== 'user') return
  const content = message.message?.content
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(block => block?.type === 'text').map(block => block.text).join('')
    : ''
  if (!text) return
  void runTurn(text).catch(error => {
    process.stderr.write(`fixture turn failed: ${error?.stack ?? error}\n`)
    process.exit(4)
  })
})
stdin.on('close', () => { evidence.exited = evidence.exited ?? 'stdin-end'; writeEvidence(); process.exit(0) })
const safety = setTimeout(() => { evidence.exited = 'safety-timeout'; writeEvidence(); process.exit(70) }, 180_000)
safety.unref()
