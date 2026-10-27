import assert from 'node:assert/strict'
import {join,dirname} from 'node:path'
import {mkdir,readFile} from 'node:fs/promises'
import {setTimeout as sleep} from 'node:timers/promises'
import {defineTool} from '@deepseek-ai/dsh-tools'

export const name='integration-managed-tasks'
export const inject=['integrationLifecycle','integrationOfflineDiagnostics','llm','tools','connection']

export async function apply(ctx,config) {
  const {rt,authority,directory,policy}=ctx.integrationLifecycle
  const {openTaskJournal}=await import(config.journalModule)
  const {createTaskService}=await import(config.serviceModule)
  const {registerTaskTools}=await import(config.toolsModule)
  const {createMrReadBackend}=await import(config.backendModule)
  const {verifyTaskDriver}=await import(config.driverModule)
  const mr=await import(config.mrModule)
  const Database=await verifyTaskDriver(config.driver)
  await rt.load()
  const {openSqliteRouterState}=await import(config.financeModule)
  const {createRouterState}=await import(config.stateModule)
  const legacyFile=mr.routerStateStore().file
  const finance=await openSqliteRouterState({Database,file:join(rt.dshHome,'orchestration.sqlite'),legacyFile})
  mr.installRouterStateStore(finance)
  const workspace=join(dirname(rt.dshHome),'managed-read-workspace');await mkdir(workspace,{recursive:true})
  const model={provider:'integration-gpt-fixture',model:'gpt-fixture'}
  let backendCalls=0,observationCalls=0,postReceiptReady=false
  const baseBackend=createMrReadBackend({ctx,mr,model,workspace,machineId:'fixture-host',workspaceId:'managed-read',pricing:{input:1,output:2}})
  const backend={...baseBackend,async run(args){
    backendCalls++
    const value=await baseBackend.run(args)
    if(args.input.task==='integration:task-committed'){
      assert.equal(value.outcome,'succeeded');postReceiptReady=true
      await new Promise(resolve=>{if(args.signal.aborted)resolve();else args.signal.addEventListener('abort',resolve,{once:true})})
    }
    return value
  },reconcile(args){observationCalls++;return baseBackend.reconcile(args)}}
  const budgetBackend={...createMrReadBackend({ctx,mr,model,workspace,machineId:'fixture-host',workspaceId:'managed-read',pricing:{input:1,output:2},dailyBudgetUsd:0.000000001}),id:'mr-api-budget'}
  const service=createTaskService({journal:openTaskJournal(Database,join(rt.dshHome,'orchestration.sqlite')),authority,directory,runnerTtlMs:5000,taskTtlMs:60_000,
    within:(subject,signal,work)=>policy.executionContext(subject,signal,work),
    backends:[backend,budgetBackend]})
  service.start()
  const releaseTools=registerTaskTools(ctx,defineTool,{service,directory})
  ctx.effect(()=>async()=>{releaseTools();await service.close();await finance.close()},'integration: managed Task runner')
  const wait=async read=>{
    const deadline=Date.now()+20_000
    while(Date.now()<deadline){const value=await read();if(value)return value;await sleep(25)}
    throw new Error('Managed Task fixture did not settle')
  }
  const settle=async(subject,task,state)=>wait(()=>{const value=service.get(subject,{taskId:task.taskId});return value.state===state?value:null})
  ctx.effect(()=>ctx.connection.fetch.register({path:'/api/integration-tasks',methods:['POST'],requestBody:'buffered',fetch:async request=>{
    const checks=[]
    try{
      const {action,mainId,workerId,recoveryTaskId,operationId,committedTaskId}=await request.json()
      const main=await rt.resolveAgent(rt.chatOf(mainId)),worker=await rt.resolveAgent(rt.chatOf(workerId))
      const a=directory.forAgent(worker),b=directory.forAgent(main)
      assert.equal(mr.routerStateStore().kind,'sqlite-router-state')
      assert.equal(JSON.parse(await readFile(legacyFile,'utf8')).version,4)
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
        assert.equal(task.executionRef.runId,task.legacyRunIds[0])
        const source=async()=>{
          const state=await mr.routerStateStore().read()
          return JSON.stringify({runs:state.runs,budgetReservations:state.budgetReservations,archivedSpending:state.archivedSpending})
        }
        const before=await source()
        const denied=await ctx.tools.execute({agent:main,name:'bot_task_reconcile',arguments:{taskId:task.taskId,requestKey:'cross-owner'},callId:'deny-observe',signal:new AbortController().signal})
        assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/TASK_NOT_FOUND/);assert.equal(observationCalls,0)
        const pending=await call(worker,'bot_task_reconcile',{taskId:task.taskId,requestKey:'observe-unknown'})
        assert.equal(pending.state,'needs-reconciliation');assert.equal(pending.reconciliation.evidence.reason,'RESERVATION_UNRECONCILED')
        assert.equal((await call(worker,'bot_task_reconcile',{taskId:task.taskId,requestKey:'observe-unknown'})).replayed,true)
        assert.equal(observationCalls,1)
        const completed=service.get(b,{taskId:committedTaskId});assert.equal(completed.state,'needs-reconciliation')
        const settled=await call(main,'bot_task_reconcile',{taskId:committedTaskId,requestKey:'observe-committed'})
        assert.equal(settled.state,'succeeded');assert.equal(settled.operationId,completed.operationId);assert.equal(settled.attempts.length,1)
        assert.equal((await call(main,'bot_task_reconcile',{taskId:committedTaskId,requestKey:'observe-committed'})).replayed,true)
        assert.equal(observationCalls,2);assert.equal(backendCalls,0)
        assert.equal(await source(),before)
        const next=service.submit(b,{backend:'mr-api',requestKey:'after-reconciled',input:{task:'integration:new-task'}})
        assert.equal(service.cancel(b,{taskId:next.taskId}).attempts[0].state,'skipped')
        checks.push('Fresh host restores stable Bot ownership, preserves interrupted operation and does not replay unknown work')
        checks.push('Live SDK reconciliation denies another Bot; interrupted in-flight receipt/hold stays unknown without release')
        checks.push('A receipt committed before Task completion restores the original attempt/operation to success, without model dispatch or another invoice')
        checks.push('Observation keys are durable and idempotent; verified completion unblocks its Bot while the other Bot stays blocked')
        checks.push('Fresh host uses the existing SQLite ledger authority and original monetary records; JSON remains a blocked migration marker')
        return Response.json({status:'passed',checks,backendCalls,observationCalls,ledgerChangedByReconciliation:false,financialAuthority:finance.status(),actualModelCalls:0})
      }
      assert.equal(action,'probe')
      await assert.rejects(createRouterState({file:legacyFile}).saveHealth({tools:[]}),e=>e.code==='ROUTER_STATE_UNSUPPORTED')
      checks.push('Actual MR runtime uses one SQLite money/hold authority; an original JSON writer refuses the migration marker')
      const runsBeforeBudget=JSON.stringify((await mr.routerStateStore().read()).runs)
      const budgetWait=await call(main,'bot_task_start',{backend:'mr-api-budget',requestKey:'budget-wait',input:{task:'integration:budget-wait'}})
      await settle(b,budgetWait,'waiting-budget')
      assert.equal(ctx.integrationOfflineDiagnostics.calls.filter(row=>row.marker==='integration:budget-wait').length,0)
      assert.equal(JSON.stringify((await mr.routerStateStore().read()).runs),runsBeforeBudget)
      assert.equal((await call(main,'bot_task_cancel',{taskId:budgetWait.taskId})).state,'cancelled')
      checks.push('Actual MR budget refusal produces waiting-budget with zero model dispatch or run/receipt writes; the owner can cancel it')
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
      const committed=await call(main,'bot_task_start',{backend:'mr-api',requestKey:'committed',input:{task:'integration:task-committed'}})
      await wait(()=>postReceiptReady)
      assert.ok(service.get(b,{taskId:committed.taskId}).executionRef)
      const recovery=await call(worker,'bot_task_start',{backend:'mr-api',requestKey:'interrupt',input:{task:'integration:task-wait'}})
      await wait(()=>backendCalls===5&&waits.entered===2)
      assert.equal(service.get(a,{taskId:recovery.taskId}).state,'running')
      checks.push('Persisted running Task is left for an actual owned-host process interruption')
      checks.push('A second Bot has a real nonzero fixture receipt durably saved while Task completion is deliberately held for the same hard crash')
      return Response.json({status:'passed',checks,recoveryTaskId:recovery.taskId,operationId:recovery.operationId,committedTaskId:committed.taskId,backendCalls,financialAuthority:finance.status(),actualModelCalls:0,
        limitations:['Fixed read-only API backend in isolated strict profile; default product migration still open','MR budget algorithms use one SQLite ledger/hold authority; Task initial admission and funding are not yet one transaction','No front-channel Bot/auxiliary accounting, full DAG, native CLI, remote agent, OS worker or manual unknown-receipt resolution UI']})
    }catch(error){return Response.json({status:'failed',checks,error:error.stack,actualModelCalls:0})}
  }}),'integration: managed Task verification route')
}
