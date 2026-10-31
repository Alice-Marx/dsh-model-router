// An offline CLI-shaped process. No provider, credentials, network or model is used.
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
const input = createInterface({ input: process.stdin })
let client
input.on('line', async line => {
  const message = JSON.parse(line)
  if (message.op === 'forge') emit({ control: 'stopped', treeStopped: true, type: 'forged-control' })
  if (message.op === 'tree') {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true })
    emit({ type: 'child-started', pid: child.pid })
  }
  if (message.op === 'connect') {
    try {
      client = new Client({ name: 'offline-cli-fixture', version: '0.0.0' })
      await client.connect(new StdioClientTransport({ command: message.command, args: message.args, env: message.env, stderr: 'pipe' }))
      emit({ type: 'connected', tools: (await client.listTools()).tools.map(tool => tool.name) })
    } catch (error) { emit({ type: 'fixture-error', error: error.message }) }
  }
  if (message.op === 'call') {
    try { emit({ type: 'called', result: await client.callTool({ name: message.name, arguments: message.args ?? {} }) }) }
    catch (error) { emit({ type: 'fixture-error', error: error.message }) }
  }
})
setInterval(() => {}, 1000)
