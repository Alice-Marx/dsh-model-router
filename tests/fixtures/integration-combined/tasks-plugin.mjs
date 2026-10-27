import assert from 'node:assert/strict'
import {join,dirname} from 'node:path'
import {mkdir} from 'node:fs/promises'
import {setTimeout as sleep} from 'node:timers/promises'
import {defineTool} from '@deepseek-ai/dsh-tools'

export const name='integration-managed-tasks'
export const inject=['integrationLifecycle','integrationOfflineDiagnostics','llm','tools','connection']

export async function apply(ctx,config) {
  const {rt,authority,directory,policy}=ctx.integrationLifecycle
  const {openTaskJournal}=await import(config.journalModule)
  const {createTaskService}=await import(config.serviceModule)
  const {registerTaskTools}=await import(config.toolsModule)
  const {canonicalTaskJson}=await import(config.contractModule)
  const {verifyTaskDriver}=await import(config.driverModule)
  const mr=await import(config.mrModule)
  const Database=await verifyTaskDriver(config.driver)
  await rt.load()
  const workspace=join(dirname(rt.dshHome),'managed-read-workspace');await mkdir(workspace,{recursive:true})
  const model={provider:'integration-gpt-fixture',model:'gpt-fixture'}
  const settings={dynamicDataEnabled:false,reviewMode:'off',modelProfilesJson:JSON.stringify([{...model,quality:95,execution:'api',billing:'api-only',subscription:'none',pricing:{input:0,output:0}}])}
  const parse=input=>{
    const v=JSON.parse(canonicalTaskJson(input))
    if(!v||Object.keys(v).length!==1||typeof v.task!=='string'||!v.task.trim()||v.task.length>2000)throw new Error('INVALID_TASK_INPUT')
    return v
  }
  let backendCalls=0
  const service=createTaskService({journal:openTaskJournal(Database,join(rt.dshHome,'orchestration.sqlite')),authority,directory,runnerTtlMs:5000,taskTtlMs:60_000,
    within:(subject,signal,work)=>policy.executionContext(subject,signal,work),
    backends:[{id:'mr-api',version:'v1',effect:'read',machineId:'fixture-host',workspaceId:'managed-read',location:'local',capability:'execution/mr-api',retryCapability:'execution/mr-retry',model,parse,
      async run({input,signal,attemptNumber,legacyRunIds}){
        backendCalls++
        const options={...model,workspace,signal,billing:false,skipToolProbe:true,installedToolIds:[],runnableToolIds:[],skipOfficial:()=> 'offline task fixture'}
        try{
          let value
          if(attemptNumber===1)value=await mr.executeConfiguredAssignment(ctx,input.task,settings,options)
          else{
            const run=(await mr.routerStateStore().read()).runs.find(row=>row.id===legacyRunIds.at(-1))
            const target=run?.packages.find(row=>row.ok!==true)
            if(!target)throw new Error('NO_RECORDED_FAILED_PACKAGE')
            value=await mr.rerunRecordedStep(ctx,settings,{...options,runId:run.id,packageId:target.id})
          }
          const success=value.stored!==false&&!value.paused&&value.run?.packages.length>0&&value.run.packages.every(row=>row.ok===true)
          return {outcome:signal.aborted?'cancelled':success?'succeeded':'failed',...(value.run?.id?{legacyRunId:value.run.id}:{}),summary:{stored:value.stored!==false,packages:value.run?.packages.length??0}}
        }catch(error){return {outcome:signal.aborted?'cancelled':'failed',...(error.runId?{legacyRunId:error.runId}:{}),summary:{code:signal.aborted?'ABORTED':'MR_EXECUTION_FAILED'}}}
      }}]})
  service.start()
  const releaseTools=registerTaskTools(ctx,defineTool,{service,directory})
  ctx.effect(()=>async()=>{releaseTools();await service.close()},'integration: managed Task runner')
  const wait=async read=>{
    const deadline=Date.now()+20_000
    while(Date.now()<deadline){const value=await read();if(value)return value;await sleep(25)}
    throw new Error('Managed Task fixture did not settle')
  }
  const settle=async(subject,task,state)=>wait(()=>{const value=service.get(subject,{taskId:task.taskId});return value.state===state?value:null})
  ctx.effect(()=>ctx.connection.fetch.register({path:'/api/integration-tasks',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    const checks=[]
    try{
      const {action,mainId,workerId,recoveryTaskId,operationId}=await request.json()
      const main=await rt.resolveAgent(rt.chatOf(mainId)),worker=await rt.resolveAgent(rt.chatOf(workerId))
      const a=directory.forAgent(worker),b=directory.forAgent(main)
      const call=async(agent,name,args)=>{
        const result=await ctx.tools.execute({agent,name,arguments:args,callId:`task-${name}`,signal:new AbortController().signal})
        assert.notEqual(result.isError,true,JSON.stringify(result));return result.value
      }
      if(action==='restored'){
        const task=service.get(a,{taskId:recoveryTaskId})
        assert.equal(task.state,'needs-reconciliation');assert.equal(task.operationId,operationId)
        assert.throws(()=>service.retry(a,{taskId:task.taskId,requestKey:'unsafe-replay'}),/TASK_RECONCILIATION_REQUIRED/)
        assert.throws(()=>service.submit(a,{backend:'mr-api',requestKey:'after-unknown',input:{task:'integration:managed-next'}}),/TASK_RECONCILIATION_REQUIRED/)
        assert.equal(backendCalls,0)
        checks.push('Fresh host restores stable Bot ownership, preserves interrupted operation and does not replay unknown work')
        checks.push('Unknown outcome blocks owner retry/new execution until reconciliation; no fabricated completion')
        return Response.json({status:'passed',checks,backendCalls,actualModelCalls:0})
      }
      assert.equal(action,'probe')
      const requestOne={backend:'mr-api',requestKey:'first',input:{task:'integration:task-failure'}}
      const first=await call(worker,'bot_task_start',requestOne)
      const replay=await call(worker,'bot_task_start',requestOne)
      assert.equal(replay.taskId,first.taskId);assert.equal(replay.operationId,first.operationId)
      const failed=await settle(a,first,'failed')
      assert.equal(backendCalls,1);assert.equal(failed.legacyRunIds.length,1)
      assert.equal((await call(worker,'bot_task_status',{taskId:first.taskId})).state,'failed')
      checks.push('Actual SDK Task tools submit once; first real MR execution fails and persists an owner-linked legacy run')
      for(const method of ['get','cancel'])assert.throws(()=>service[method](b,{taskId:first.taskId}),/TASK_NOT_FOUND/)
      for(const name of ['bot_task_status','bot_task_cancel','bot_task_retry']){
        const denied=await ctx.tools.execute({agent:main,name,arguments:{taskId:first.taskId,...(name==='bot_task_retry'?{requestKey:'steal-tool'}:{})},callId:'task-denied',signal:new AbortController().signal})
        assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/TASK_NOT_FOUND/)
      }
      assert.throws(()=>service.retryLegacy(b,{runId:failed.legacyRunIds[0],requestKey:'steal'}),/TASK_NOT_FOUND/)
      assert.throws(()=>service.retryLegacy(a,{runId:'unowned-old-run',requestKey:'adopt'}),/TASK_NOT_FOUND/)
      assert.throws(()=>service.submit(a,{...requestOne,model:'override'}),/INVALID_TASK_REQUEST/)
      checks.push('Cross-Bot task/cancel/legacy retry and unowned old-run adoption fail before MR entry; metadata cannot override route')
      const retry=service.retryLegacy(a,{runId:failed.legacyRunIds[0],requestKey:'retry-owned'})
      assert.notEqual(retry.attemptId,first.attemptId);assert.notEqual(retry.operationId,first.operationId)
      assert.equal(retry.packageId,first.packageId);assert.deepEqual(retry.input,first.input)
      const done=await settle(a,retry,'succeeded')
      assert.equal(done.attempts.length,2);assert.equal(done.attempts[1].parent_id,first.attemptId)
      assert.equal(backendCalls,2)
      assert.equal(service.retryLegacy(a,{runId:failed.legacyRunIds[0],requestKey:'retry-owned'}).replayed,true)
      const legacy=(await mr.routerStateStore().read()).runs.find(row=>row.id===failed.legacyRunIds[0])
      assert.ok(legacy.packages.every(row=>row.ok===true))
      checks.push('Owner retry uses actual rerunRecordedStep, keeps target/input/package, adds linked attempt/operation and updates original MR run')
      const cancelled=await call(worker,'bot_task_start',{backend:'mr-api',requestKey:'cancel',input:{task:'integration:task-wait'}})
      const waits=ctx.integrationOfflineDiagnostics.taskWaits
      await wait(()=>backendCalls===3&&waits.entered===1)
      const requested=await call(worker,'bot_task_cancel',{taskId:cancelled.taskId})
      assert.equal(requested.state,'cancelling')
      assert.equal(waits.cleaned,0)
      const stopped=await settle(a,cancelled,'cancelled')
      assert.equal(stopped.legacyRunIds.length,1)
      assert.equal(waits.cleaned,1)
      checks.push('Actual MR stream cancellation remains cancelling through cleanup; terminal state retains legacy receipt reference')
      const recovery=await call(worker,'bot_task_start',{backend:'mr-api',requestKey:'interrupt',input:{task:'integration:task-wait'}})
      await wait(()=>backendCalls===4&&waits.entered===2)
      assert.equal(service.get(a,{taskId:recovery.taskId}).state,'running')
      checks.push('Persisted running Task is left for an actual owned-host process interruption')
      return Response.json({status:'passed',checks,recoveryTaskId:recovery.taskId,operationId:recovery.operationId,backendCalls,actualModelCalls:0,
        limitations:['Fixed read-only API backend in isolated strict profile; default product migration still open','Legacy MR remains the money writer; Task database stores references, not costs','No DAG, approval/budget protocol, native CLI, remote agent, OS worker or reconciliation resolution UI']})
    }catch(error){return Response.json({status:'failed',checks,error:error.stack,actualModelCalls:0})}
  }}),'integration: managed Task verification route')
}
