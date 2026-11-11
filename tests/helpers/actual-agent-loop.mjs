import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AgentRegistry, installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'

// Compile the actual installed loop unchanged, keeping all SDK dependencies
// external so its WeakSet marker, Session and Cordis use this Host's instances.
// There is no loop replay, private hook, SDK edit or synthetic marker here.
let loopModule
async function actualLoopModule() {
  if (!loopModule) loopModule = (async () => {
    const root = resolve(import.meta.dirname, '../..')
    const dir = join(root, 'tmp/integration/actual-agent-loop')
    await mkdir(dir, { recursive: true })
    const outfile = join(dir, `installed-loop-${process.pid}.mjs`)
    await build({ entryPoints: [createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent-loop')],
      outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' })
    return import(pathToFileURL(outfile).href)
  })()
  return loopModule
}

export async function attachActualAgentLoop(host) {
  const scope = host.nativeLlmContext
  if (!scope) throw new Error('ACTUAL_LLM_FIBER_REQUIRED')
  const { AgentLoop } = await actualLoopModule()
  let context, loop
  const fork = await scope.plugin(ctx => {
    context = ctx
    new AgentRegistry(ctx)
    new SessionStore(ctx)
    new SessionProjectionRegistry(ctx)
    new SystemPrompt(ctx, {})
    new ToolRuntime(ctx)
    loop = new AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })
  })
  const names = ['agents', 'sessions', 'sessionProjections', 'tools', 'systemPrompt']
  const previous = Object.fromEntries(names.map(name => [name, host[name]]))
  const selections = new Map()
  context.on('agent/created', ({ agent }) => {
    const selection = { current: undefined, assembled: undefined }
    selections.set(agent.id, selection)
    agent.ctx.effect(() => installModelSelection(agent.ctx, selection))
  })
  previous.sessionController = host.sessionController
  for (const name of names) { host[name] = context[name]; host.provide(name, context[name]) }
  host.sessionController = { ...host.sessionController, selectModel: async input => {
    const selection = selections.get(input.sessionId)
    if (selection) selection.current = { provider: input.provider, model: input.model, ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}) }
    return {}
  }, resolveAgent: async sessionId => {
    const agent = context.agents.get(sessionId)
    return agent ? { agent } : { error: { code: 'session/not-found', message: 'Isolated test Session not found' } }
  } }
  return { context, loop,
    async close() {
      await fork.dispose()
      Object.assign(host, previous)
      for (const name of names) host.provide(name, previous[name])
    } }
}
