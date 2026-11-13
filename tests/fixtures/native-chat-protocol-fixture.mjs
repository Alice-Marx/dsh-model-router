import { readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

if (process.argv.includes('--version')) { process.stdout.write('native-chat-fixture 1.0.0\n'); process.exit(0) }
const codex = process.argv.includes('app-server'), pi = process.argv.includes('rpc')
if (!codex && !pi) throw new Error('Unexpected fixture transport')
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
let model = codex ? 'gpt-fixture' : 'fixture/model', turns = 0, active = null, hold
const session = 'fixture-session'
const config = codex ? await readFile(join(process.env.CODEX_HOME, 'config.toml'), 'utf8') : ''
await appendFile(join(process.cwd(), 'native-fixture-evidence.jsonl'), JSON.stringify({ kind: 'launch', argv: process.argv.slice(2), home: process.env.HOME, ambientSecret: process.env.NATIVE_CHAT_TEST_AMBIENT ?? null }) + '\n')
const response = (frame, value) => emit(codex ? { id: frame.id, result: value } : { id: frame.id, type: 'response', command: frame.type, success: true, data: value })
const notification = (method, params) => emit({ method, params })
async function handle(frame) {
  await appendFile(join(process.cwd(), 'native-fixture-evidence.jsonl'), JSON.stringify({ kind: 'in', frame }) + '\n')
  const method = codex ? frame.method : frame.type
  if (frame.error) return
  if (method === 'initialize') { response(frame, {}); return }
  if (method === 'initialized') return
  if (method === 'config/read') {
    const parsedModel = /^model = (.+)$/m.exec(config)?.[1]; model = parsedModel ? JSON.parse(parsedModel) : model
    response(frame, { config: { model, model_provider: 'openai', approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
      features: { shell_tool: false, multi_agent: false, memories: false }, mcp_servers: {} } }); return
  }
  if (method === 'thread/start') { response(frame, { thread: { id: session }, model, modelProvider: 'openai' }); return }
  if (method === 'new_session') { response(frame, { sessionId: session }); return }
  if (method === 'set_model') { model = `${frame.provider}/${frame.modelId}`; response(frame, { provider: frame.provider, id: frame.modelId }); return }
  if (method === 'get_state') { const slash = model.indexOf('/'); response(frame, { sessionId: session, model: { provider: model.slice(0, slash), id: model.slice(slash + 1) }, isStreaming: false }); return }
  if (!['turn/start', 'prompt'].includes(method)) { emit(codex ? { id: frame.id, error: { code: -32601 } } : { id: frame.id, type: 'response', command: method, success: false }); return }
  const text = codex ? frame.params.input[0].text : frame.message, id = 'native-turn-' + (++turns)
  active = id
  response(frame, codex ? { turn: { id } } : { disposition: 'started' })
  if (codex) notification('turn/started', { threadId: session, turn: { id } })
  else emit({ type: 'agent_start' })
  if (text.includes('exit')) { process.exit(7); return }
  if (text.includes('ask')) emit(codex ? { id: 'ask-1', method: 'item/commandExecution/requestApproval', params: { threadId: session, turnId: id } }
    : { type: 'extension_ui_request', id: 'ask-1', method: 'confirm', title: 'fixture request' })
  if (text.includes('reroute') && codex) { notification('model/rerouted', { threadId: session, toModel: 'ungranted-model' }); return }
  const answer = `turn-${turns}: ${text}`
  if (codex) notification('item/agentMessage/delta', { threadId: session, turnId: id, itemId: 'item-' + id, delta: answer })
  else emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: answer } })
  if (text.includes('slow')) { hold = setInterval(() => {}, 1000); return }
  if (codex) {
    if (!text.includes('no-usage')) notification('thread/tokenUsage/updated', { threadId: session, turnId: id, tokenUsage: { total: { inputTokens: turns * 12, outputTokens: turns * 3, cachedInputTokens: turns * 2 } } })
    notification('turn/completed', { threadId: session, turn: { id, status: 'completed' } })
    // Late old-turn output must not contaminate the next turn.
    setTimeout(() => notification('item/agentMessage/delta', { threadId: session, turnId: id, delta: 'STALE' }), 30)
  } else {
    const usage = text.includes('no-usage') ? undefined : { input: 10, output: 3, cacheRead: 2, cacheWrite: 0 }
    emit({ type: 'message_end', message: { role: 'assistant', provider: model.split('/')[0], model: model.split('/').slice(1).join('/'), stopReason: 'stop', usage } })
    emit({ type: 'turn_end', message: { stopReason: 'stop' } }); emit({ type: 'agent_end' })
    if (!text.includes('unsettled')) emit({ type: 'agent_settled' })
  }
  active = null
}
const decoder = new StringDecoder('utf8'); let buffer = ''
process.stdin.on('data', chunk => {
  buffer += decoder.write(chunk); let end
  while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) void handle(JSON.parse(line)) }
})
process.stdin.on('end', () => { clearInterval(hold); process.exit(0) })
