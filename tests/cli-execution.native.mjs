import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import Database from 'better-sqlite3'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createCliReadBackend} from '../packages/orchestration/src/cli-execution.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {spending} from '../.dsh-plugin/shared/run-ledger.mjs'

const model={provider:'fixture',model:'gpt-exact'}
const tools=['task/submit','task/execute','task/read','task/cancel','task/retry','task/reconcile','cli/codex','cli/read','cli/cancel','cli/retry']
async function fixture(t,overrides={}){
  await mkdir(resolve('tmp/integration/cli-execution'),{recursive:true})
  const dir=await mkdtemp(resolve('tmp/integration/cli-execution/case-')),file=join(dir,'orchestration.sqlite'),legacyFile=join(dir,'state.json')
  await createRouterState({file:legacyFile}).saveHealth(null)
  const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1,maxRuns:overrides.maxRuns??200})
  const authority=createAuthority(),directory=createPrincipalDirectory(authority)
  for(const botId of ['bot-a','bot-b'])directory.register(botId,{tools,modelRoutes:[model]})
  const subject=directory.forBot('bot-a'),other=directory.forBot('bot-b')
  const stats={created:0,dispatched:0,stopped:0},waits={entered:null}
  const sessionFactory=async options=>{
    stats.created++
    let snapshot={terminal:null,finalText:'',cliTurnRequestsDispatched:0,actualProviderRequestCount:null,usage:{inputTokens:null,outputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null},
      identity:{requestedCliModel:'gpt-exact',reportedCliModel:overrides.mismatch?'gpt-other':'gpt-exact',reportedProvider:'openai',verification:overrides.mismatch?'mismatch':'cli-configured-model',actualResponseModelVerified:false,reroutes:[]}}
    return {
      async run(){
        await options.onBeforeRequest();stats.dispatched++;snapshot.cliTurnRequestsDispatched=1
        snapshot.usage={inputTokens:11,outputTokens:5,cachedInputTokens:3,cacheWriteInputTokens:null}
        await options.onUsage({...snapshot})
        if(overrides.wait){waits.entered?.();await new Promise(done=>{if(options.signal.aborted)done();else options.signal.addEventListener('abort',done,{once:true})});await sleep(50);snapshot.terminal='interrupted';throw new Error('cancelled fixture')}
        snapshot.terminal='completed';snapshot.finalText='offline CLI result';return {...snapshot,status:'succeeded'}
      },
      async close(){stats.stopped++;return {treeStopped:overrides.stopConfirmed!==false}},
      snapshot(){return structuredClone(snapshot)},
    }
  }
  const options={store,authority,directory,model,requestedModel:'gpt-exact',machineId:'machine',workspaceId:'workspace',workspace:dir,runtimeRoot:dir,
    entry:{executable:process.execPath,sha256:'a'.repeat(64),version:'0.163.0'},billing:'subscription',subscriptionMaxCalls:100,sessionFactory,...overrides}
  const backend=createCliReadBackend(options)
  let journal=openTaskJournal(Database,file)
  if(overrides.failTaskFinish)journal={...journal,finish(){throw new Error('Simulated Task completion write failure')}}
  let service=createTaskService({journal,authority,directory,backends:[backend],runnerTtlMs:1000,taskTtlMs:5000,...(overrides.concurrencyFor?{concurrencyFor:overrides.concurrencyFor}:{})})
  service.start()
  t.after(async()=>{await service.close();await backend.facade.close();await store.close();authority.dispose()})
  return{dir,file,store,authority,directory,subject,other,backend,options,stats,waits,get service(){return service},get journal(){return journal},
    async replaceService(replacementJournal,backends=[backend]){await service.close();journal=replacementJournal??openTaskJournal(Database,file);service=createTaskService({journal,authority,directory,backends,runnerTtlMs:1000,taskTtlMs:5000,...(overrides.concurrencyFor?{concurrencyFor:overrides.concurrencyFor}:{})});service.start()}}
}
const submit=(f,key='one')=>f.service.submit(f.subject,{requestKey:key,backend:'codex-read',input:{task:'offline fixture task'}})
async function settled(f,task,state){for(let i=0;i<300;i++){const value=f.service.get(f.subject,{taskId:task.taskId});if(value.state===state)return value;await sleep(10)}assert.fail(`Task did not reach ${state}`)}

test('CLI execution/native: Task admission, pre-turn fence, source receipt and a single subscription invoice share the original operation',async t=>{
  const f=await fixture(t),task=submit(f)
  assert.equal(submit(f).operationId,task.operationId)
  const done=await settled(f,task,'succeeded')
  assert.equal(done.executionRef.kind,'cli-run');assert.equal(done.executionRef.marker.operationId,done.operationId);assert.equal(done.attempts.length,1)
  assert.equal(done.result.summary.finalText,'offline CLI result');assert.equal(done.result.summary.actualResponseModelVerified,false)
  assert.equal(f.stats.dispatched,1);assert.equal(f.stats.stopped,1)
  const bank=await f.store.read(),receipt=(await f.store.modelCalls()).items[0]
  assert.equal(bank.runs.length,1);assert.deepEqual(bank.budgetReservations,{});assert.equal(spending(bank.runs).today,0)
  assert.equal(receipt.source,'cli');assert.equal(receipt.operationId,task.operationId);assert.equal(receipt.state,'settled');assert.equal(receipt.actualModel,null)
  assert.deepEqual(receipt.usage,{cacheReadTokens:3,inputTokens:8,outputTokens:5})
  assert.equal((await f.backend.facade.collect(f.subject,done.legacyRunIds[0])).outcome,'succeeded')
  assert.equal(f.stats.dispatched,1);assert.equal((await f.store.modelCalls()).items.length,1)
  await assert.rejects(f.backend.facade.observe(f.other,done.legacyRunIds[0]),/CLI_EXECUTION_NOT_FOUND/)
})
test('CLI execution/native: a committed maxConcurrentTasks runs several tasks per Bot while the default keeps one',async t=>{
  // The conservative default: one active task per Bot, the second stays queued
  // and is dispatched only after the first releases the slot.
  const single=await fixture(t,{wait:true}),first=submit(single,'one'),second=submit(single,'two')
  const running=await settled(single,first,'running')
  assert.equal(running.state,'running')
  assert.equal(single.service.get(single.subject,{taskId:second.taskId}).state,'ready','the default keeps one active task per Bot')
  assert.equal(single.service.cancel(single.subject,{taskId:first.taskId}).state,'cancelling')
  await settled(single,first,'cancelled')
  const queued=await settled(single,second,'running')
  assert.equal(queued.attempts.length,1,'the queued task is dispatched after the slot frees')
  assert.equal(single.service.cancel(single.subject,{taskId:second.taskId}).state,'cancelling')
  await settled(single,second,'cancelled')
  // A binding that allows two concurrent tasks dispatches both at once.
  const pair=await fixture(t,{wait:true,concurrencyFor:()=>2}),a=submit(pair,'a'),b=submit(pair,'b')
  await settled(pair,a,'running')
  const secondRunning=await settled(pair,b,'running')
  assert.equal(secondRunning.state,'running','a two-task binding runs both managed tasks concurrently')
  for(let i=0;i<300&&pair.stats.dispatched<2;i++)await sleep(10)
  assert.equal(pair.stats.dispatched,2,'both tasks reached their real CLI dispatch boundary')
  for(const task of [a,b]){assert.equal(pair.service.cancel(pair.subject,{taskId:task.taskId}).state,'cancelling');await settled(pair,task,'cancelled')}
})
test('CLI execution/native: finite money denial leaves zero source receipts and starts no CLI process or turn',async t=>{
  const f=await fixture(t,{billing:'api',estimatedCostUsd:0.1,dailyLimitUsd:0.000001}),task=submit(f)
  await settled(f,task,'waiting-budget')
  assert.equal(f.stats.created,0);assert.equal(f.stats.dispatched,0);assert.equal((await f.store.modelCalls()).items.length,0);assert.equal((await f.store.read()).runs.length,0)
})
test('CLI execution/native: caller cancellation waits for cleanup and native stop before settling the same attempt',async t=>{
  const f=await fixture(t,{wait:true}),entered=new Promise(resolve=>{f.waits.entered=resolve}),task=submit(f)
  await entered;assert.equal(f.service.cancel(f.subject,{taskId:task.taskId}).state,'cancelling')
  assert.equal(f.stats.stopped,0)
  const cancelled=await settled(f,task,'cancelled')
  assert.equal(cancelled.operationId,task.operationId);assert.equal(f.stats.stopped,1);assert.equal(cancelled.result.summary.stopConfirmed,true)
  assert.deepEqual((await f.store.read()).budgetReservations,{})
})
test('CLI execution/native: unconfirmed tree stop or configured model mismatch stays unknown and retains the original hold',async t=>{
  for(const options of [{stopConfirmed:false},{mismatch:true},{billing:'api',estimatedCostUsd:0.1}]){
    const f=await fixture(t,options),task=submit(f),unknown=await settled(f,task,'needs-reconciliation')
    assert.equal(f.stats.dispatched,1);assert.equal(unknown.attempts.length,1)
    assert.equal((await f.store.modelCalls()).items[0].state,'unknown')
    assert.equal(Object.keys((await f.store.read()).budgetReservations).length,1)
    assert.throws(()=>f.service.retry(f.subject,{taskId:task.taskId,requestKey:'unsafe'}),/TASK_RECONCILIATION_REQUIRED/)
    const observed=await f.service.reconcile(f.subject,{taskId:task.taskId,requestKey:'observe'})
    assert.equal(observed.state,'needs-reconciliation');assert.equal(f.stats.dispatched,1)
  }
})
test('CLI execution/native: subscription call quota survives money-run archival and rejects before another CLI starts',async t=>{
  const f=await fixture(t,{subscriptionMaxCalls:2,maxRuns:1})
  await settled(f,submit(f,'one'),'succeeded');await settled(f,submit(f,'two'),'succeeded')
  await settled(f,submit(f,'three'),'waiting-budget')
  assert.equal(f.stats.dispatched,2);assert.equal(f.stats.created,2);assert.equal((await f.store.read()).runs.length,1);assert.equal((await f.store.modelCalls()).items.length,2)
})
test('CLI execution/native: copied subjects, remote location and unbound model parameters fail before admission',async t=>{
  const f=await fixture(t)
  assert.throws(()=>f.backend.parse({task:'x',model:'other'}),/INVALID_CLI_TASK_INPUT/)
  const context={binding:{taskId:'task',attemptId:'attempt',machineId:'machine',workspaceId:'workspace',location:'remote'},operationId:'operation',targetHash:'a'.repeat(64)}
  assert.throws(()=>f.backend.facade.prepare({}, {task:'x'},context),/UNKNOWN_SUBJECT/)
  assert.throws(()=>f.backend.facade.prepare(f.subject,{task:'x'},context),/CLI_TARGET_MISMATCH/)
  assert.equal(f.stats.dispatched,0);assert.equal((await f.store.modelCalls()).items.length,0)
})
test('CLI execution/native: an entry, model or money contract change after submission blocks the old queued task before dispatch',async t=>{
  const f=await fixture(t),task=submit(f)
  const next=createCliReadBackend({...f.options,entry:{...f.options.entry,sha256:'b'.repeat(64)}})
  await f.replaceService(undefined,[next]);t.after(()=>next.facade.close())
  const blocked=await settled(f,task,'blocked')
  assert.equal(blocked.result.code,'TASK_BACKEND_CHANGED');assert.equal(f.stats.dispatched,0);assert.equal(f.stats.created,0);assert.equal((await f.store.modelCalls()).items.length,0)
})
test('CLI execution/native: a committed CLI receipt recovers a missing Task completion on the same attempt without replay or another invoice',async t=>{
  const f=await fixture(t,{failTaskFinish:true}),task=submit(f)
  for(let i=0;i<300;i++){if((await f.store.modelCalls()).items[0]?.state==='settled')break;await sleep(10)}
  await sleep(20);assert.equal(f.service.get(f.subject,{taskId:task.taskId}).state,'running')
  const before=JSON.stringify(await f.store.read())
  await f.replaceService()
  assert.equal(f.service.get(f.subject,{taskId:task.taskId}).state,'needs-reconciliation')
  const restored=await f.service.reconcile(f.subject,{taskId:task.taskId,requestKey:'original-receipt'})
  assert.equal(restored.state,'succeeded');assert.equal(restored.attempts.length,1);assert.equal(restored.operationId,task.operationId)
  assert.equal(f.stats.dispatched,1);assert.equal((await f.store.modelCalls()).items.length,1);assert.equal(JSON.stringify(await f.store.read()),before)
  const replay=await f.service.reconcile(f.subject,{taskId:task.taskId,requestKey:'original-receipt'})
  assert.equal(replay.replayed,true);assert.equal(f.stats.dispatched,1)
})
test('CLI execution/native: an archived operation is read from its original compact proof and cannot dispatch again after restart',async t=>{
  const f=await fixture(t,{maxRuns:1}),original=await settled(f,submit(f,'one'),'succeeded')
  await settled(f,submit(f,'two'),'succeeded')
  const restarted=createCliReadBackend(f.options);t.after(()=>restarted.facade.close())
  const context={binding:{taskId:original.taskId,attemptId:original.attemptId,machineId:'machine',workspaceId:'workspace',location:'local'},operationId:original.operationId,targetHash:original.input.targetHash,
    beforeRequest:()=>assert.fail('an archived receipt must not be replayed'),checkpoint:()=>assert.fail('no new checkpoint for a completed operation')}
  const replay=await restarted.facade.start(f.subject,{task:'offline fixture task'},context)
  assert.equal(replay.replayed,true);assert.equal((await restarted.facade.collect(f.subject,replay.executionId)).outcome,'succeeded')
  assert.equal(f.stats.dispatched,2);assert.equal((await f.store.modelCalls()).items.length,2)
  const archived=await restarted.facade.observe(f.subject,replay.executionId);assert.equal(archived.stopConfirmed,true);assert.equal(archived.receipt.operationId,original.operationId)
})
