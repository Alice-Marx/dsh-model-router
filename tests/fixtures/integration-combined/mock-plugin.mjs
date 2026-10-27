import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import {setTimeout as sleep} from 'node:timers/promises'

export const name = 'integration-offline-model'
export const inject = ['llm', 'connection', 'tools']
export const PROVIDER = 'integration-gpt-fixture'
export const MODEL = 'gpt-fixture'

export function apply(ctx) {
  const calls = []
  let taskFailures=0
  const taskWaits={entered:0,cleaned:0}
  ctx.provide('integrationOfflineDiagnostics',Object.freeze({taskWaits}))
  const toolResults = []
  class OfflineAdapter extends LlmAdapter {
    providerInfo(id) { return { id, name: 'Offline integration fixture' } }
    async listModels(provider) { return [{ provider, id: MODEL, name: MODEL, inputModalities: ['text'] }] }
    async resolveModel(provider, id) {
      if (provider !== PROVIDER || id !== MODEL) throw new Error('Unknown offline fixture model')
      return { provider, id, name: id, contextWindow: 100_000, maxTokens: 8000, inputModalities: ['text'] }
    }
    async *stream(options) {
      options.signal.throwIfAborted()
      const latest = options.messages.at(-1)
      const userText = latest?.role === 'user' ? (typeof latest.content === 'string' ? latest.content : latest.content.filter(block => block.type === 'text').map(block => block.text).join('\n')) : ''
      calls.push({ sessionId: options.sessionId ?? null, provider: options.provider, model: options.model,
        agentLoop: isAgentLoopRequest(options), tools: options.tools?.map(tool => tool.name) ?? [],
        marker: /integration:[a-z-]+/.exec(userText)?.[0] ?? null })
      if(!isAgentLoopRequest(options)&&userText.includes('integration:task-failure')&&taskFailures++===0)throw new Error('Offline task fixture first-attempt failure')
      if(!isAgentLoopRequest(options)&&userText.includes('integration:task-wait')){
        taskWaits.entered++
        yield {type:'usage',usage:{inputTokens:11,outputTokens:0}}
        await new Promise(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',resolve,{once:true})})
        await sleep(120)
        taskWaits.cleaned++
        options.signal.throwIfAborted()
      }
      let name, args
      if (userText.trim() === 'integration:create-worker') {
        name = 'create_bot'
        args = { name: 'IntegrationWorker', role: 'Test', instructions: 'Offline integration worker.', model: `${PROVIDER}/${MODEL}` }
      } else if (userText.trim() === 'integration:delegate') {
        name = 'message_bot'
        args = { to: 'IntegrationWorker', message: 'integration:worker-answer', request_id: 'integration-delegation-1' }
      } else if (userText.trim() === 'integration:router-routes') {
        name = 'model_router_routes'
        args = {}
      }
      const block = name
        ? { type: 'tool-call', id: `integration-call-${calls.length}`, name, arguments: JSON.stringify(args) }
        : { type: 'text', text: isAgentLoopRequest(options) ? 'integration:fixture-reply' : '{"changes":[]}' }
      yield { type: 'block-start', index: 0, blockType: block.type }
      if (name) yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments }
      else yield { type: 'text-delta', index: 0, text: block.text }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: name ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter([PROVIDER], new OfflineAdapter())
  ctx.on('llm/stream', (options, next) => {
    if (options.provider !== PROVIDER || options.model !== MODEL) throw new Error('Only the offline integration model is permitted')
    return next()
  })
  ctx.on('tools/result', (execution, result) => {
    if (['create_bot', 'message_bot', 'model_router_routes'].includes(execution.name)) {
      toolResults.push({ name: execution.name, agentId: execution.agent?.id ?? null, result })
    }
  })
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/integration-probe', methods: ['POST'], requestBody: 'buffered',
    fetch: () => Response.json({ calls, toolResults, providers: ctx.llm.listProviders(), registeredTools: ctx.tools.schemas().map(tool => tool.name) }),
  }), 'integration: diagnostics')
}
