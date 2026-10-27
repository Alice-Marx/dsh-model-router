import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const name = 'integration-owned-ds-runtime'
export const inject = ['llm','tools','systemPrompt','sessionController','sessions','sessionTitle','workspaceRegistry','connection']

export async function apply(ctx,config) {
  const {createRuntime} = await import(config.dsEntry)
  const {createAuthority} = await import(config.authorityModule)
  const {createPrincipalDirectory} = await import(config.principalsModule)
  const {createBotPolicy} = await import(config.policyModule)
  const {attachDsLifecycle} = await import(config.lifecycleModule)
  const authority=createAuthority(),directory=createPrincipalDirectory(authority)
  const policy=createBotPolicy({authority,directory,machineId:'fixture-host',workspaceId:'fixture-workspace',
    ownerGrant:{tools:['remote/boundaries'],modelRoutes:[{provider:'integration-gpt-fixture',model:'gpt-fixture'}]}})
  ctx.provide('botIntegrationPolicy',policy)
  const rt=createRuntime(ctx,{updateCheck:false})
  ctx.provide('integrationLifecycle',Object.freeze({rt,authority,directory,policy}))
  const lifecycle=attachDsLifecycle({runtime:rt,directory,
    grantFor:bot=>({tools:['tool/model_router_routes','command/router',...(config.enableTasks?['task/submit','task/read','task/cancel','task/retry','task/reconcile','task/execute','execution/mr-api','execution/mr-retry','execution/mr-observe']:[])],modelRoutes:bot.model==='integration-gpt-fixture/gpt-fixture'?[{provider:'integration-gpt-fixture',model:'gpt-fixture'}]:[]}),
    onBind:(agent,grant)=>{
      const scoped=agent.ctx.get('tools')
      let key,release=()=>{}
      const refresh=()=>{
        const deny=ctx.tools.schemas().map(tool=>tool.name).filter(name=>name.startsWith('model_router_')&&!grant.tools.includes(`tool/${name}`)).sort()
        const next=JSON.stringify(deny)
        if(next===key)return
        key=next;release();release=deny.length?scoped.restrict({deny}):()=>{}
      }
      const off=ctx.on('tools/change',refresh)
      refresh()
      return ()=>{off();release()}
    },
  })
  ctx.on('agent/created',({agent})=>lifecycle.observeAgent(agent))
  ctx.on('llm/stream',(options,next)=>(async function*(){
    await rt.load()
    yield* policy.modelStream(options,next)
  })())
  ctx.effect(()=>()=>{lifecycle.close();authority.dispose()},'integration: owned Bot policy lifecycle')
  const call=agent=>ctx.tools.execute({agent,name:'model_router_routes',arguments:{},callId:'lifecycle-probe',signal:new AbortController().signal})
  const wait=async(test)=>{
    const deadline=Date.now()+20_000
    while(Date.now()<deadline){if(await test())return;await sleep(100)}
    throw new Error('Lifecycle transition did not settle')
  }
  let consumed=false
  ctx.effect(()=>ctx.connection.fetch.register({path:'/api/integration-lifecycle',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    const checks=[]
    try{
      const {action,mainId,workerId}=await request.json()
      await rt.load()
      const main=await rt.resolveAgent(rt.chatOf(mainId)),worker=await rt.resolveAgent(rt.chatOf(workerId))
      assert.ok(directory.forAgent(main)!==directory.forAgent(worker))
      assert.notEqual((await call(main)).isError,true)
      assert.notEqual((await call(worker)).isError,true)
      assert.deepEqual(ctx.tools.schemas(worker).filter(tool=>tool.name.startsWith('model_router_')).map(tool=>tool.name),['model_router_routes'])
      checks.push('Original Main and worker acquire exact grants automatically from committed DS ownership')
      if(action==='probe'){
        assert.equal(consumed,false);consumed=true
        const bot=await rt.createBot({name:'LifecycleDisposable',model:'integration-gpt-fixture/gpt-fixture'})
        const own=await rt.resolveAgent(rt.chatOf(bot.id))
        const subject=directory.forAgent(own)
        assert.notEqual((await call(own)).isError,true)
        checks.push('Real DS createBot/save/resolve automatically binds a new Bot without manual directory calls')
        const room=await rt.createRoom({members:[workerId,bot.id],name:'LifecycleFixtureRoom'})
        await rt.updateRoom(room.id,{mode:'everyone'})
        await ctx.sessionController.prompt({requestId:randomUUID(),sessionId:room.id,mode:'queue',content:[{type:'text',text:'offline lifecycle group fixture'}]},AbortSignal.timeout(15_000))
        await wait(()=>{
          const ids=Object.values(rt.state.rooms[room.id]?.sessions??{})
          if(ids.length!==2)return false
          try{for(const id of ids)directory.forSession(id);return true}catch{return false}
        })
        const groupId=rt.state.rooms[room.id].sessions[bot.id]
        const group=await rt.resolveAgent(groupId)
        assert.equal(directory.forAgent(group),subject)
        assert.notEqual((await call(group)).isError,true)
        checks.push('Real group-member Session inherits the same stable Bot subject from saved room ownership')
        const nextFolder=join(dirname(rt.dshHome),'lifecycle-next-workspace')
        await mkdir(nextFolder,{recursive:true})
        await rt.updateBot(bot.id,{workDir:nextFolder})
        await wait(()=>{
          const id=rt.chatOf(bot.id)
          if(id===own.session.id)return false
          try{directory.forSession(id);return true}catch{return false}
        })
        const current=await rt.resolveAgent(rt.chatOf(bot.id))
        assert.equal(directory.forAgent(current),subject)
        assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
        assert.notEqual((await call(current)).isError,true)
        checks.push('Actual DS folder/part transition binds the fresh Agent and removes its archived predecessor')
        await rt.deleteBot(bot.id)
        assert.throws(()=>directory.forAgent(current),/UNKNOWN_SUBJECT/)
        assert.throws(()=>directory.forAgent(group),/UNKNOWN_SUBJECT/)
        await rt.deleteRoom(room.id)
        assert.notEqual((await call(worker)).isError,true)
        assert.notEqual((await call(main)).isError,true)
        checks.push('Real DS deletion revokes own/group identities while surviving Main and worker remain usable')
      }else{
        assert.equal(action,'restored')
        checks.push('Fresh host process rebuilds live Agent bindings from persisted Bot ownership')
      }
      return Response.json({status:'passed-for-described-checks',checks,lifecycle:lifecycle.status(),actualModelCalls:0,
        limitations:['Strict test composition only; no default user profile migration','Only exact fixture model and limited MR capabilities granted','No task ledger, CLI bootstrap or OS worker verified','Read-only/lock-takeover and every schedule/recovery interleaving remain open']})
    }catch(error){return Response.json({status:'failed',checks,error:error.stack,actualModelCalls:0})}
  }}),'integration: lifecycle verification route')
}
