import { createInterface } from 'node:readline'
if (process.argv.includes('--version')) { process.stdout.write('Muse offline fixture 1.0.0\n'); process.exit(0) }
let model, turns = 0
const send = frame => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n')
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue
  const frame = JSON.parse(line), params = frame.params ?? {}
  if (frame.id === undefined) continue
  if (frame.method === 'initialize') send({ id: frame.id, result: { capabilities: {} } })
  else if (frame.method === 'session/start') { model = params.modelId; send({ id: frame.id, result: { commandId: params.commandId, session: { sessionId: 'muse-fixture-session', modelId: model } } }) }
  else if (frame.method === 'turn/start') {
    send({ id: frame.id, result: { commandId: params.commandId } }); turns++
    const turnId = params.commandId, itemId = 'item-' + turns, text = `muse-${turns}: ${params.input[0].text}`
    send({ method: 'item/started', params: { sessionId: 'muse-fixture-session', turnId, item: { itemId, turnId, kind: 'agentMessage', status: 'inProgress' } } })
    send({ method: 'item/delta', params: { sessionId: 'muse-fixture-session', turnId, itemId, field: 'text', delta: text } })
    send({ method: 'item/completed', params: { sessionId: 'muse-fixture-session', turnId, item: { itemId, turnId, kind: 'agentMessage', status: 'completed', text } } })
    send({ method: 'turn/completed', params: { sessionId: 'muse-fixture-session', turnId, terminal: 'completed', usage: { inputTokens: 12, outputTokens: 3, cachedTokens: 0 } } })
  } else send({ id: frame.id, error: { code: -32601, message: 'No such fixture method' } })
}
