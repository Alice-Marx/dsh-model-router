#!/usr/bin/env node
// MCP stdio permission proxy for the Claude conversation engine.
//
// Claude Code is launched with --permission-prompt-tool mcp__dsh__approve and an
// --mcp-config that runs this script. It implements the minimum MCP surface Claude needs
// (initialize / notifications/initialized / tools/list / tools/call) and forwards each
// approve call to the engine's permission broker pipe as newline-delimited JSON:
//   -> {t:'ask', id, kind, tool, input}
//   <- {t:'answer', id, behavior, message, source, always?}
//
// Adapted from the OpenMausBot permission-proxy concept (server/drivers/claude.ts,
// --permission-prompt-tool mcp__ogb__approve) at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
//
// Usage: node claude-permission-proxy.mjs <brokerPipePath>

import { connect } from 'node:net'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

const APPROVE_TOOL = 'approve'
const ASK_TIMEOUT_MS = Number(process.env.DSH_APPROVE_TIMEOUT_MS ?? 15 * 60_000)

const pipePath = process.argv[2]
if (!pipePath || pipePath.startsWith('-')) {
  process.stderr.write('claude-permission-proxy: broker pipe path argument required\n')
  process.exit(2)
}

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const rpcResult = (id, result) => send({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

function askBroker({ kind, tool, input }) {
  return new Promise(resolve => {
    const id = randomBytes(12).toString('hex')
    let socket
    const finish = value => {
      clearTimeout(timer)
      try { socket?.destroy() } catch {}
      resolve(value)
    }
    const timer = setTimeout(() => finish({ behavior: 'deny', message: 'Host: permission broker timed out.', source: 'timeout' }), ASK_TIMEOUT_MS)
    try { socket = connect(pipePath) } catch (error) { finish({ behavior: 'deny', message: `Host: broker unreachable (${error.message}).`, source: 'system' }); return }
    socket.on('error', error => finish({ behavior: 'deny', message: `Host: broker unreachable (${error.message}).`, source: 'system' }))
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ t: 'ask', id, kind, tool, input })}\n`)
      const lines = createInterface({ input: socket })
      lines.on('line', line => {
        try {
          const message = JSON.parse(line)
          if (message.t === 'answer' && message.id === id) finish(message)
        } catch { /* not for us */ }
      })
    })
  })
}

const input = createInterface({ input: process.stdin })
input.on('line', line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.method === 'initialize') {
    rpcResult(request.id, { protocolVersion: '2024-11-05', serverInfo: { name: 'dsh-permission-proxy', version: '1.0.0' }, capabilities: { tools: {} } })
    return
  }
  if (request.method === 'notifications/initialized') return
  if (request.method === 'tools/list') {
    rpcResult(request.id, { tools: [{ name: APPROVE_TOOL, description: 'Ask the DSH host whether a tool use is allowed.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['permission', 'question'] }, tool: { type: 'string' }, input: { type: 'object' } }, required: ['kind', 'tool'] } }] })
    return
  }
  if (request.method === 'tools/call') {
    if (request.params?.name !== APPROVE_TOOL) { rpcError(request.id, -32602, `Unknown tool ${request.params?.name}`); return }
    const args = request.params.arguments ?? {}
    void askBroker({ kind: args.kind === 'question' ? 'question' : 'permission', tool: typeof args.tool === 'string' ? args.tool : 'tool', input: args.input && typeof args.input === 'object' ? args.input : {} })
      .then(answer => {
        // The tool result is what Claude turns into its allow/deny decision; a refused
        // ask must read as a denial, never as an error Claude might retry.
        rpcResult(request.id, { content: [{ type: 'text', text: JSON.stringify({ behavior: answer.behavior, message: typeof answer.message === 'string' ? answer.message : '', source: answer.source, always: answer.always === true }) }], isError: false })
      })
    return
  }
  if (request.id !== undefined) rpcError(request.id, -32601, `Method not found: ${request.method}`)
})

process.stdin.on('close', () => process.exit(0))
process.stdin.on('end', () => process.exit(0))
