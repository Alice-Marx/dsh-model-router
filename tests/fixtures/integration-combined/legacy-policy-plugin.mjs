import assert from 'node:assert/strict'

export const name = 'integration-legacy-policy'
export const inject = ['tools', 'commands', 'llm', 'sessionController', 'connection']

export function apply(ctx, config) {
  let consumed = false
  let policy
  ctx.on('llm/stream', (options, next) => policy ? policy.modelStream(options, next) : next())
  ctx.effect(() => ctx.connection.fetch.register({
    path:'/api/integration-legacy-policy', methods:['POST'], requestBody:'buffered',
    fetch: async request => {
      if (consumed) return Response.json({ error:'Probe already consumed' }, { status:409 })
      consumed = true
      const checks = []
      let authority
      const cleanup = []
      try {
        const { mainId, workerId } = await request.json()
        const { agent:main } = await ctx.sessionController.resolveAgent(mainId)
        const { agent:worker } = await ctx.sessionController.resolveAgent(workerId)
        const { createAuthority } = await import(config.authorityModule)
        const { createPrincipalDirectory } = await import(config.principalsModule)
        const { createBotPolicy } = await import(config.policyModule)
        const { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } = await import(config.remoteContractModule)
        authority = createAuthority()
        const directory = createPrincipalDirectory(authority)
        const grant = { tools:['tool/model_router_routes','command/router'], modelRoutes:[{provider:'integration-gpt-fixture',model:'gpt-fixture'}] }
        directory.register(mainId, grant)
        directory.register(workerId, grant)
        cleanup.push(directory.bind(mainId, main), directory.bind(workerId, worker))
        policy = createBotPolicy({authority,directory,machineId:'fixture-host',workspaceId:'fixture-workspace'})
        ctx.provide('botIntegrationPolicy', policy)
        const names = ctx.tools.schemas(worker).map(tool=>tool.name).filter(name=>name.startsWith('model_router_'))
        assert.equal(names.length,13)
        const denied = names.filter(name=>name!=='model_router_routes')
        const call = (agent,name,args={}) => ctx.tools.execute({agent,name,arguments:args,callId:`legacy-policy-${name}`,signal:new AbortController().signal})
        // Use valid required fields: parameter validation must not masquerade as a policy denial.
        const argumentsFor = name => ({
          model_router_plan:{task:'offline fixture'}, model_router_consult:{task:'offline fixture'},
          model_router_execute:{task:'offline fixture'}, model_router_team_execute:{task:'offline fixture'},
          model_router_tool_run:{tool:'codex',task:'offline fixture'}, model_router_tool_install:{tool:'codex'},
          model_router_tool_repair:{tool:'codex'}, model_router_tool_uninstall:{tool:'codex'},
          model_router_rerun_step:{runId:'another-run',packageId:'direct'},
          model_router_rate:{runId:'another-run',packageId:'direct',rating:'up'},
        }[name] ?? {})
        for (const name of denied) {
          const result = await call(worker,name,argumentsFor(name))
          assert.equal(result.isError,true,name)
          assert.match(JSON.stringify(result),/TOOL_DENIED/,`${name}: ${JSON.stringify(result)}`)
        }
        checks.push('All 12 ungranted legacy tools, including install, native execution and retry, refuse at policy')
        const allowed = await call(worker,'model_router_routes')
        assert.notEqual(allowed.isError,true,JSON.stringify(allowed))
        assert.deepEqual(allowed.value.routes.map(route=>`${route.provider}/${route.model}`),['integration-gpt-fixture/gpt-fixture'])
        checks.push('Granted real legacy route tool still runs and projects only bound models')
        cleanup.push(worker.ctx.get('tools').restrict({deny:denied}))
        assert.deepEqual(ctx.tools.schemas(worker).filter(tool=>tool.name.startsWith('model_router_')).map(tool=>tool.name),['model_router_routes'])
        checks.push('Actual worker schema hides the 12 ungranted legacy tools')
        const router = await ctx.commands.execute(worker,'/router offline fixture',[],new AbortController().signal)
        assert.equal(router?.result?.kind,'success',JSON.stringify(router))
        const installer = await ctx.commands.execute(worker,'/tools install codex',[],new AbortController().signal)
        assert.equal(installer?.result?.kind,'error',JSON.stringify(installer))
        assert.match(JSON.stringify(installer),/TOOL_DENIED/)
        checks.push('Actual command registry permits bound planning and refuses ungranted installer commands')
        const service = ctx.get('modelRouterOfficialTools')
        assert.ok(service)
        for (const {method} of OFFICIAL_TOOLS_REMOTE_DESCRIPTORS) {
          await assert.rejects(Promise.resolve().then(()=>service[method]({botId:mainId,runId:'another-run'})),/REMOTE_OWNER_REQUIRED/,method)
        }
        checks.push('All 23 actual RPC receiver methods refuse in-process calls without authenticated invocation')
        const created = await ctx.sessionController.create({workspaceId:worker.session.header.workspaceId})
        const {agent:another} = await ctx.sessionController.resolveAgent(created.sessionId)
        cleanup.push(directory.bind(workerId,another))
        assert.equal(directory.forAgent(worker),directory.forAgent(another))
        assert.notEqual((await call(another,'model_router_routes')).isError,true)
        directory.replaceGrant(workerId,{tools:[],modelRoutes:grant.modelRoutes})
        for (const current of [worker,another]) assert.equal((await call(current,'model_router_routes')).isError,true)
        assert.notEqual((await call(main,'model_router_routes')).isError,true)
        checks.push('A second real Session shares its Bot principal; grant removal reaches both and leaves Main usable')
        return Response.json({status:'passed-for-described-checks',checks,legacyTools:names,rpcReceivers:OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.length,actualModelCalls:0,
          limitations:['Manual trusted fixture Session bindings; frozen DS lifecycle not migrated','No authenticated Gateway RPC positive call in this probe','Bot CLI/team/retry/install remain closed pending Execution facade','No unified receipts, budget writer or OS worker; CLI private bootstrap remains open']})
      } catch(error) { return Response.json({status:'failed',checks,error:error.stack,actualModelCalls:0}) }
      finally {
        policy = undefined
        for(const dispose of cleanup.reverse())dispose()
        authority?.dispose()
      }
    },
  }), 'integration: legacy policy probe')
}
