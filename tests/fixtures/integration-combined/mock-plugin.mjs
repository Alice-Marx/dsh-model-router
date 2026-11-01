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
  ctx.provide('integrationOfflineDiagnostics',Object.freeze({taskWaits,calls}))
  const toolResults = []
  const workflowStages = new Map()
  const credential = { unavailable: false, failures: 0 }
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
      if (credential.unavailable) { credential.failures++; throw new Error(`FIXTURE_CREDENTIAL_UNAVAILABLE: missing key for ${options.provider}/${options.model}`) }
      calls.push({ sessionId: options.sessionId ?? null, provider: options.provider, model: options.model,
        agentLoop: isAgentLoopRequest(options), tools: options.tools?.map(tool => tool.name) ?? [],
        marker: /integration:[a-z-]+/.exec(userText)?.[0] ?? null })
      if(!isAgentLoopRequest(options)&&userText.includes('integration:task-failure')&&taskFailures++===0){
        yield {type:'usage',usage:{inputTokens:11,outputTokens:0}}
        throw new Error('Offline task fixture first-attempt failure after a reported receipt')
      }
      if(!isAgentLoopRequest(options)&&userText.includes('integration:plan-failure')){
        yield {type:'usage',usage:{inputTokens:11,outputTokens:0}}
        yield {type:'finish',reason:{kind:'error',failure:{code:'FIXTURE_PLAN_FAILED',message:'Offline dependency failure',status:400}}}
        return
      }
      if(!isAgentLoopRequest(options)&&userText.includes('integration:task-wait')){
        taskWaits.entered++
        yield {type:'usage',usage:{inputTokens:11,outputTokens:0}}
        await new Promise(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',resolve,{once:true})})
        await sleep(120)
        taskWaits.cleaned++
        options.signal.throwIfAborted()
      }
      let name, args, finalText
      const stage = workflowStages.get(options.sessionId)
      if (stage === 'analysis-written') { finalText = 'integration:analysis-complete'; workflowStages.delete(options.sessionId) }
      else if (stage === 'implementation-written') { finalText = 'integration:implementation-complete'; workflowStages.delete(options.sessionId) }
      else if (stage === 'review-read') { name = 'write'; args = { file_path: 'review.md', content: '# Review\nImplementation approved: analysis and implementation agree.\n' }; workflowStages.set(options.sessionId, 'review-written') }
      else if (stage === 'review-written') { finalText = 'integration:review-complete'; workflowStages.delete(options.sessionId) }
      else if (stage === 'summary-analysis') { name = 'read'; args = { file_path: 'implementation.js' }; workflowStages.set(options.sessionId, 'summary-implementation') }
      else if (stage === 'summary-implementation') { name = 'read'; args = { file_path: 'review.md' }; workflowStages.set(options.sessionId, 'summary-review') }
      else if (stage === 'summary-review') { finalText = 'integration:workflow-summary-complete'; workflowStages.delete(options.sessionId) }
      else if (userText.includes('integration:analysis')) { name = 'write'; args = { file_path: 'analysis.md', content: '# Analysis\nRequire a pure function returning the sum of two integers.\n' }; workflowStages.set(options.sessionId, 'analysis-written') }
      else if (userText.includes('integration:implementation')) { name = 'write'; args = { file_path: 'implementation.js', content: 'export const add = (a, b) => a + b\n' }; workflowStages.set(options.sessionId, 'implementation-written') }
      else if (userText.includes('integration:review')) { name = 'read'; args = { file_path: 'implementation.js' }; workflowStages.set(options.sessionId, 'review-read') }
      else if (userText.trim() === 'integration:workflow-summary') { name = 'read'; args = { file_path: 'analysis.md' }; workflowStages.set(options.sessionId, 'summary-analysis') }
      else if (/^integration:delegate-(analysis|implementation|review)$/.test(userText.trim())) {
        const phase = userText.trim().slice('integration:delegate-'.length)
        name = 'message_bot'; args = { to: `${phase[0].toUpperCase()}${phase.slice(1)}Worker`, message: `integration:${phase}`, request_id: `workflow-${phase}-1` }
      }
      else if (userText.trim() === 'integration:create-worker') {
        name = 'create_bot'
        args = { name: 'IntegrationWorker', role: 'Test', instructions: 'Offline integration worker.', model: `${PROVIDER}/${MODEL}` }
      } else if (userText.trim() === 'integration:delegate') {
        name = 'message_bot'
        args = { to: 'IntegrationWorker', message: 'integration:worker-answer', request_id: 'integration-delegation-1' }
      } else if (userText.trim() === 'integration:router-routes') {
        name = 'model_router_routes'
        args = {}
      } else if (userText.trim() === 'integration:consult') {
        name = 'model_router_consult'
        args = { task: 'offline consult fixture' }
      } else if (/^integration:remote-read:machine-[A-Za-z0-9-]+$/.test(userText.trim())) {
        name = 'remote_computer_read'
        args = {machineId:userText.trim().slice('integration:remote-read:'.length),rootId:'project',relativePath:'README.md'}
      } else if (/^integration:remote-write:machine-[A-Za-z0-9-]+$/.test(userText.trim())) {
        name = 'remote_computer_write'
        args = {requestKey:'fixture-remote-write',machineId:userText.trim().slice('integration:remote-write:'.length),rootId:'project',relativePath:'managed.txt',content:'owned remote product fixture write',expectedHash:null}
      } else if (/^integration:remote-command:machine-[A-Za-z0-9-]+$/.test(userText.trim())) {
        name = 'bot_task_start'
        args = {backend:'remote-command',requestKey:'fixture-remote-command',input:{machineId:userText.trim().slice('integration:remote-command:'.length),rootId:'project',workspaceRelativePath:'',argv:['node','-e','process.stdout.write("command-ok")'],timeoutMs:20000}}
      } else if (userText.trim() === 'integration:create-cli') {
        name = 'create_bot'
        args = { name: 'IntegrationCli', role: 'Test', instructions: 'Offline integration CLI worker.', model: `${PROVIDER}/${MODEL}` }
      } else if (/^integration:plan:(success|fail|cancel):[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(userText.trim())) {
        const [, , mode, main, worker] = userText.trim().split(':')
        const item=(id,targetBotId,objective,dependsOn=[])=>({id,targetBotId,objective,dependsOn,acceptance:['Offline fixture verified'],effectClass:'read'})
        const packages=mode==='success'?[item('first',worker,'integration:task-ok'),item('join',main,'integration:task-ok',['first'])]:
          mode==='fail'?[item('failure',worker,'integration:plan-failure'),item('blocked',worker,'integration:never-dispatch',['failure']),item('independent',main,'integration:task-ok')]:
          [item('left',worker,'integration:task-wait'),item('right',main,'integration:task-wait'),item('later',worker,'integration:never-dispatch',['left','right'])]
        name='bot_task_plan_start'
        args={requestKey:`fixture-plan-${mode}`,plan:{schemaVersion:1,taskId:`fixture-plan-${mode}`,origin:{kind:'private',botId:main,sessionId:options.sessionId},planRevision:1,packages}}
      } else if (userText.trim() === 'integration:task-run') {
        name = 'bot_task_start'
        args = { backend: 'mr-api', requestKey: 'task-run-1', input: { task: 'integration:task-ok' } }
      } else if (userText.trim() === 'integration:task-fail') {
        name = 'bot_task_start'
        args = { backend: 'mr-api', requestKey: 'task-fail-1', input: { task: 'integration:task-failure' } }
      } else if (userText.trim() === 'integration:task-cancel') {
        name = 'bot_task_start'
        args = { backend: 'mr-api', requestKey: 'task-cancel-1', input: { task: 'integration:task-wait' } }
      } else if (userText.trim() === 'integration:task-parallel-a') {
        name = 'bot_task_start'
        args = { backend: 'mr-api', requestKey: 'parallel-a', input: { task: 'integration:task-wait' } }
      } else if (userText.trim() === 'integration:task-parallel-b') {
        name = 'bot_task_start'
        args = { backend: 'mr-api', requestKey: 'parallel-b', input: { task: 'integration:task-wait' } }
      } else if (userText.trim() === 'integration:cli-task') {
        name = 'bot_task_start'
        args = { backend: 'codex-read', requestKey: 'cli-task-1', input: { task: 'integration:cli-read' } }
      } else if (/^integration:task-cancel-task:(task-[A-Za-z0-9_-]+)$/.test(userText.trim())) {
        name = 'bot_task_cancel'
        args = { taskId: userText.trim().slice('integration:task-cancel-task:'.length) }
      } else if (/^integration:task-status:(task-[A-Za-z0-9_-]+)$/.test(userText.trim())) {
        name = 'bot_task_status'
        args = { taskId: userText.trim().slice('integration:task-status:'.length) }
      } else if (/^integration:task-retry:(task-[A-Za-z0-9_-]+)$/.test(userText.trim())) {
        name = 'bot_task_retry'
        args = { taskId: userText.trim().slice('integration:task-retry:'.length), requestKey: 'task-retry-1' }
      } else if (/^integration:task-reconcile:(task-[A-Za-z0-9_-]+)$/.test(userText.trim())) {
        name = 'bot_task_reconcile'
        args = { taskId: userText.trim().slice('integration:task-reconcile:'.length), requestKey: 'task-reconcile-1' }
      }
      const block = name
        ? { type: 'tool-call', id: `integration-call-${calls.length}`, name, arguments: JSON.stringify(args) }
        : { type: 'text', text: isAgentLoopRequest(options) ? finalText ?? 'integration:fixture-reply' : '{"changes":[]}' }
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
    if (['create_bot', 'message_bot', 'model_router_routes', 'model_router_consult', 'remote_computer_read','remote_computer_write','read','write',
      'bot_task_start', 'bot_task_status', 'bot_task_cancel', 'bot_task_retry', 'bot_task_reconcile','bot_task_plan_start','bot_task_plan_status','bot_task_plan_cancel'].includes(execution.name)) {
      toolResults.push({ name: execution.name, agentId: execution.agent?.id ?? null, result })
    }
  })
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/integration-probe', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      const body = await request.json()
      if (body.action === 'credential-outage') credential.unavailable = true
      if (body.action === 'credential-restore') credential.unavailable = false
      return Response.json({ calls, toolResults, credential, providers: ctx.llm.listProviders(), registeredTools: ctx.tools.schemas().map(tool => tool.name),
        searchProviders: [...(ctx.get('web')?.searchProviders?.keys() ?? [])],
        automaticSearchEntries: [...ctx.root.get('loader').entries()]
          .filter(entry => entry.fiber?.state === 2 && ['ds-bot/web-search', '@ljwei-stak/dsh-model-router/web-search'].includes(entry.options.name))
          .map(entry => entry.options.name),
      })
    },
  }), 'integration: diagnostics')
}
