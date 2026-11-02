import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const home = process.env.CODEX_HOME
const cwd = process.cwd()
const version = '1.2.3'
const marker = (name, value) => writeFileSync(join(home, name), JSON.stringify({ ...value, cwd, home, pid: process.pid }), { mode: 0o600 })
if (process.argv.includes('--version')) {
  marker('fixture-version.json', { version })
  process.stdout.write(`codex-cli ${version}\n`)
  process.exit(0)
}

marker('fixture-start.json', { argv: process.argv })
const configText = readFileSync(join(home, 'config.toml'), 'utf8')
const setting = name => {
  const line = configText.split(/\r?\n/).find(row => row.startsWith(`${name} = `))
  return line ? JSON.parse(line.slice(name.length + 3)) : undefined
}
let threadId = null
let turnId = null
let sequence = 0
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const notification = (method, params) => send({ method, params })
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  input += chunk
  let end
  while ((end = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, end); input = input.slice(end + 1)
    if (line.trim()) handle(JSON.parse(line))
  }
})
process.stdin.resume()

function handle(message) {
  if (message.id === undefined) return
  const reply = result => send({ id: message.id, result })
  if (message.method === 'initialize') return reply({ serverInfo: { name: 'remote-codex-fixture', version } })
  if (message.method === 'config/read') return reply({ config: {
    model: setting('model'), model_provider: 'openai', approval_policy: 'never', sandbox_mode: 'read-only',
    mcp_servers: { dsh_task: { command: setting('command'), args: setting('args'), cwd: setting('cwd'), required: true, enabled_tools: setting('enabled_tools') } },
  } })
  if (message.method === 'thread/start') {
    threadId = `thread-${++sequence}`
    let mode = ''
    try { mode = readFileSync(join(cwd, 'fixture-mode.txt'), 'utf8').trim() } catch {}
    const model = mode === 'model-mismatch' ? 'gpt-other' : message.params.model
    return reply({ thread: { id: threadId }, model, modelProvider: 'openai' })
  }
  if (message.method === 'mcpServerStatus/list') return reply({ servers: [{ name: 'dsh_task', tools: [], auth: 'not-applicable' }] })
  if (message.method !== 'turn/start') return send({ id: message.id, error: { code: -32601, message: 'unsupported fixture method' } })
  const prompt = message.params.input?.[0]?.text ?? ''
  turnId = `turn-${++sequence}`
  reply({ turn: { id: turnId } })
  notification('turn/started', { threadId, turnId, turn: { id: turnId } })
  let descendantPid = null
  if (/fixture:(long|tree)/.test(prompt)) {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd, env: process.env, windowsHide: true, stdio: 'ignore' })
    descendantPid = child.pid
  }
  marker('fixture-task.json', { threadId, turnId, prompt, descendantPid })
  if (prompt.includes('fixture:long')) return
  if (!prompt.includes('fixture:no-usage')) notification('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 4, cacheWriteInputTokens: 0, reasoningOutputTokens: 1, totalTokens: 25 } } })
  notification('item/completed', { threadId, turnId, item: { type: 'agentMessage', text: `remote-cli ok cwd=${cwd} home=${home}` } })
  const failed = prompt.includes('fixture:exit7')
  notification('turn/completed', { threadId, turnId, turn: { id: turnId, status: failed ? 'failed' : 'completed' } })
  setTimeout(() => process.exit(failed ? 7 : 0), 25)
}
