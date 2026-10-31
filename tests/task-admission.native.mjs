import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdir,mkdtemp,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {createBudgetReservations} from '../.dsh-plugin/shared/budget-reservations.mjs'
import {withinTaskAdmission} from '../packages/orchestration/src/task-admission.mjs'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'
import {taskHash} from '../packages/orchestration/src/task-contract.mjs'

const parent=resolve('tmp/integration/task-admission');await mkdir(parent,{recursive:true})
const target={backend:'fixture',version:'v1',effect:'read',machineId:'machine-a',workspaceId:'workspace-a',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:null}
const payload={backend:'fixture',input:{task:'fixture'},target,targetHash:taskHash(target)}
async function fixture(t,options={}){
  const dir=await mkdtemp(join(parent,'case-')),file=join(dir,'journal.sqlite'),legacyFile=join(dir,'state.json')
  await createRouterState({file:legacyFile}).saveHealth(null)
  const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1,...options})
  const j=store.openTaskJournal(),f=j.claimRunner('runner-a',1000,0)
  const value={store,j,f,file,legacyFile,beforeClose:null}
  t.after(async()=>{await value.beforeClose?.();j.close();await store.close()})
  return value
}
function prepare(f,id='a'){
  const task=f.j.submit(f.f,'bot-a',id,id,payload,20000,1)
  const running=f.j.claim(f.f,'bot-a',task.taskId,2,{atomic:true})
  const reference={kind:'mr-run',runId:`run-${id}`,marker:{schemaVersion:1,taskId:task.taskId,attemptId:task.attemptId,operationId:task.operationId,targetHash:payload.targetHash}}
  const frame=f.j.createAdmission(f.f,'bot-a',task.taskId,task.attemptId,()=>3)
  frame.checkpoint(reference)
  const run={id:reference.runId,createdAt:Date.now(),status:'running',managedExecution:reference.marker,packages:[],reviews:[]}
  return{task:running,reference,frame,run,admit:()=>withinTaskAdmission(frame,()=>createBudgetReservations({state:f.store}).beginExecution({run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1}))}
}
const snapshot=(db,id)=>{
  const task=db.prepare('SELECT state FROM tasks WHERE id=?').get(id),outbox=db.prepare('SELECT delivered_ms FROM task_outbox o JOIN operations op ON op.id=o.operation_id JOIN attempts a ON a.id=op.attempt_id JOIN packages p ON p.current_attempt=a.id WHERE p.task_id=?').get(id)
  return{state:task.state,delivered:outbox.delivered_ms,runs:db.prepare('SELECT count(*) AS n FROM router_runs').get().n,holds:db.prepare('SELECT count(*) AS n FROM router_holds').get().n,refs:db.prepare('SELECT count(*) AS n FROM task_execution_refs').get().n}
}

test('atomic/native: Task/reference/outbox and original money hold become visible together to another connection',async t=>{
  let observed,observer,taskId
  const f=await fixture(t,{onAtomicStep:stage=>{if(stage==='money-written-before-commit')observed=snapshot(observer,taskId)}})
  observer=new Database(f.file);t.after(()=>observer.close())
  const p=prepare(f);taskId=p.task.taskId
  assert.equal(p.task.state,'admitting');assert.equal(p.frame.committed(),false)
  assert.throws(()=>f.j.assertDispatch(f.f,'bot-a',taskId,p.task.attemptId,3),/STALE_TASK_ATTEMPT/)
  assert.equal((await p.admit()).accepted,true)
  assert.deepEqual(observed,{state:'admitting',delivered:null,runs:0,holds:0,refs:0})
  assert.deepEqual(snapshot(observer,taskId),{state:'running',delivered:3,runs:1,holds:1,refs:1})
  assert.equal(p.frame.committed(),true);f.j.assertDispatch(f.f,'bot-a',taskId,p.task.attemptId,4)
  assert.equal(f.j.get('bot-a',taskId).executionRef.runId,p.reference.runId)
})

test('atomic/native: financial write failure rolls back Task state, outbox and execution link without publishing admission',async t=>{
  const f=await fixture(t,{onAtomicStep:stage=>{if(stage==='task-linked-before-money')throw new Error('injected write failure')}}),p=prepare(f)
  await assert.rejects(p.admit(),/injected write failure/)
  const raw=new Database(f.file);t.after(()=>raw.close())
  assert.deepEqual(snapshot(raw,p.task.taskId),{state:'admitting',delivered:null,runs:0,holds:0,refs:0})
  assert.equal(p.frame.committed(),false);assert.equal(p.frame.notDispatched(),true)
})

test('atomic/native: cancellation and stale runner prevent the money commit and cannot open dispatch',async t=>{
  const f=await fixture(t),p=prepare(f)
  f.j.cancel(f.f,'bot-a',p.task.taskId,4)
  await assert.rejects(p.admit(),/STALE_TASK_ATTEMPT/)
  assert.deepEqual((await f.store.read()).budgetReservations,{})
  assert.equal(p.frame.notDispatched(),true)
  f.j.finish(f.f,'bot-a',p.task.taskId,p.task.attemptId,'cancelled',{notDispatched:true},5)
  assert.equal(f.j.get('bot-a',p.task.taskId).attempts[0].state,'skipped')
  const q=prepare(f,'b');f.j.release(f.f,6);f.j.claimRunner('runner-b',1000,7)
  await assert.rejects(q.admit(),/STALE_TASK_RUNNER/)
  assert.equal((await f.store.read()).runs.length,0)
})

test('atomic/native: a separate SQLite handle or a changed run marker cannot fulfill the Host admission',async t=>{
  const f=await fixture(t),p=prepare(f),other=await openSqliteRouterState({Database,file:f.file,legacyFile:f.legacyFile,lockStaleMs:1})
  t.after(()=>other.close())
  await assert.rejects(withinTaskAdmission(p.frame,()=>createBudgetReservations({state:other}).beginExecution({run:p.run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1})),/TASK_ATOMIC_CONNECTION_REQUIRED/)
  p.run.managedExecution={...p.run.managedExecution,operationId:'another-operation'}
  await assert.rejects(p.admit(),/TASK_ADMISSION_RUN_MISMATCH/)
  assert.equal(p.frame.committed(),false);assert.equal((await f.store.read()).runs.length,0)
})

test('atomic/native: budget denial leaves the outbox undelivered and does not invent a receipt or money run',async t=>{
  const f=await fixture(t),p=prepare(f)
  const denied=await withinTaskAdmission(p.frame,()=>createBudgetReservations({state:f.store}).beginExecution({run:p.run,packageEstimates:[{id:'direct',estimatedCostUsd:2}],dailyLimitUsd:1}))
  assert.equal(denied.accepted,false);assert.equal(p.frame.notDispatched(),true)
  f.j.finish(f.f,'bot-a',p.task.taskId,p.task.attemptId,'waiting-budget',{},4)
  const raw=new Database(f.file);t.after(()=>raw.close())
  assert.deepEqual(snapshot(raw,p.task.taskId),{state:'waiting-budget',delivered:null,runs:0,holds:0,refs:0})
})

test('atomic/native: borrowed journal cannot close its money owner and rejects use after release',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.store.close(),/ROUTER_ACTIVE_JOURNAL/)
  f.j.close();assert.throws(()=>f.j.ready(),/TASK_JOURNAL_CLOSED/)
  await f.store.saveHealth(null);assert.equal((await f.store.read()).health,null)
})

test('atomic/native: schema3 upgrade preserves queued identities and installs admission without closing the owner',async t=>{
  const dir=await mkdtemp(join(parent,'schema3-')),file=join(dir,'journal.sqlite'),legacyFile=join(dir,'state.json')
  const old=openTaskJournal(Database,file),runner=old.claimRunner('old',1000,0),task=old.submit(runner,'bot-a','old','old',payload,20000,1)
  old.close()
  const raw=new Database(file);raw.exec('DROP TABLE task_admission_intents; PRAGMA user_version=3;');raw.close()
  await createRouterState({file:legacyFile}).saveHealth(null)
  const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1}),j=store.openTaskJournal()
  t.after(async()=>{j.close();await store.close()})
  const restored=j.get('bot-a',task.taskId)
  assert.equal(restored.attemptId,task.attemptId);assert.equal(restored.operationId,task.operationId);assert.equal(restored.state,'ready')
  assert.equal(j.supportsAtomicAdmission,true)
  const observer=new Database(file);assert.equal(observer.pragma('user_version',{simple:true}),5);observer.close()
})

test('atomic/native: a competing revision recomputes the budget but commits the Task and original reservation once',async t=>{
  const f=await fixture(t),p=prepare(f),other=await openSqliteRouterState({Database,file:f.file,legacyFile:f.legacyFile,lockStaleMs:1})
  t.after(()=>other.close());let attempts=0
  const competing=Promise.withResolvers(),written=(async()=>{await competing.promise;await other.saveHealth(null)})()
  const state={read:()=>f.store.read(),update:(change,options)=>f.store.update(async current=>{
    const result=change(current)
    if(++attempts===1){competing.resolve();await written}
    return result
  },options)}
  const result=await withinTaskAdmission(p.frame,()=>createBudgetReservations({state}).beginExecution({run:p.run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1}))
  assert.equal(result.accepted,true);assert.equal(attempts,2);assert.equal(p.frame.committed(),true)
  assert.equal((await f.store.read()).runs.length,1)
  const raw=new Database(f.file);t.after(()=>raw.close())
  assert.equal(raw.prepare("SELECT count(*) AS n FROM task_events WHERE kind='financial-admission-committed'").get().n,1)
})

const wait=async check=>{const end=Date.now()+5000;while(Date.now()<end){const value=check();if(value)return value;await sleep(10)}throw new Error('Atomic Task did not finish')}
test('atomic/native: real service beforeRequest is gated until its shared financial admission and preserved through settlement',async t=>{
  const f=await fixture(t);f.j.release(f.f,0)
  const authority=createAuthority(),directory=createPrincipalDirectory(authority),tools=['task/submit','task/execute','task/read','task/cancel','execution/read','execution/retry']
  directory.register('bot-a',{tools,modelRoutes:[]});const subject=directory.forBot('bot-a');let calls=0
  const backend={...target,id:target.backend,atomicAdmission:true,parse:input=>input,async run(ctx){
    assert.throws(()=>ctx.beforeRequest(),/STALE_TASK_ATTEMPT/);ctx.beforeAdmission()
    const ref={kind:'mr-run',runId:'service-run',marker:{schemaVersion:1,taskId:ctx.binding.taskId,attemptId:ctx.binding.attemptId,operationId:ctx.operationId,targetHash:ctx.targetHash}}
    ctx.checkpoint(ref)
    const run={id:ref.runId,createdAt:Date.now(),status:'running',managedExecution:ref.marker,packages:[],reviews:[]},manager=createBudgetReservations({state:f.store})
    const accepted=await manager.beginExecution({run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1})
    ctx.beforeRequest();calls++
    await manager.finishExecution({reservationId:run.id,ownerToken:accepted.ownerToken,run:{...run,status:'completed',finishedAt:Date.now(),packages:[{id:'direct',ran:true,costUsd:0.01,finishedAt:Date.now()}]}})
    return{outcome:'succeeded',legacyRunId:run.id}
  }}
  const service=createTaskService({journal:f.j,authority,directory,backends:[backend]});service.start();f.beforeClose=async()=>{await service.close();authority.dispose()}
  const task=service.submit(subject,{requestKey:'one',backend:'fixture',input:{task:'one'}})
  const done=await wait(()=>{const row=service.get(subject,{taskId:task.taskId});return row.state==='succeeded'&&row})
  assert.equal(calls,1);assert.equal(done.executionRef.runId,'service-run');assert.equal(done.attemptNumber,1)
})

test('atomic/native: concurrent budget contenders only publish the one funded Task',async t=>{
  const f=await fixture(t),a=prepare(f,'left'),b=prepare(f,'right'),manager=createBudgetReservations({state:f.store})
  const work=p=>withinTaskAdmission(p.frame,()=>manager.beginExecution({run:p.run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:0.15}))
  const results=await Promise.all([work(a),work(b)])
  assert.equal(results.filter(value=>value.accepted).length,1)
  assert.equal([a,b].filter(value=>value.frame.committed()).length,1)
  assert.equal(Object.keys((await f.store.read()).budgetReservations).length,1)
})

test('atomic/native: revocation between reference preparation and commit cannot publish a funded Task',async t=>{
  const f=await fixture(t),p=prepare(f),authority=createAuthority(),subject={}
  authority.register(subject,{botId:'bot-a',tools:['task/execute'],modelRoutes:[]});t.after(()=>authority.dispose())
  const guarded=f.j.createAdmission(f.f,'bot-a',p.task.taskId,p.task.attemptId,()=>3,()=>authority.assertTool(subject,'task/execute'))
  guarded.checkpoint(p.reference);authority.replaceGrant(subject,{botId:'bot-a',tools:[],modelRoutes:[]})
  await assert.rejects(withinTaskAdmission(guarded,()=>createBudgetReservations({state:f.store}).beginExecution({run:p.run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1})),/TOOL_DENIED/)
  assert.equal(guarded.notDispatched(),true);assert.equal((await f.store.read()).runs.length,0)
})

for(const action of ['cancel','revoke','deadline']){
  test(`atomic/native service: ${action} during asynchronous preparation cannot reserve funds or dispatch`,async t=>{
    const f=await fixture(t);f.j.release(f.f,0)
    const authority=createAuthority(),directory=createPrincipalDirectory(authority),tools=['task/submit','task/execute','task/read','task/cancel','execution/read','execution/retry']
    directory.register('bot-a',{tools,modelRoutes:[]});const subject=directory.forBot('bot-a')
    const gate=Promise.withResolvers(),prepared=Promise.withResolvers();let calls=0,commitError
    const backend={...target,id:target.backend,atomicAdmission:true,parse:input=>input,async run(ctx){
      ctx.beforeAdmission()
      const ref={kind:'mr-run',runId:`service-${action}`,marker:{schemaVersion:1,taskId:ctx.binding.taskId,attemptId:ctx.binding.attemptId,operationId:ctx.operationId,targetHash:ctx.targetHash}}
      ctx.checkpoint(ref);prepared.resolve(ctx.signal);await gate.promise
      try{
        await createBudgetReservations({state:f.store}).beginExecution({run:{id:ref.runId,createdAt:Date.now(),status:'running',managedExecution:ref.marker,packages:[],reviews:[]},packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1})
        ctx.beforeRequest();calls++;return{outcome:'succeeded'}
      }catch(error){commitError=error;throw error}
    }}
    const service=createTaskService({journal:f.j,authority,directory,backends:[backend],taskTtlMs:action==='deadline'?150:10000});service.start()
    f.beforeClose=async()=>{gate.resolve();await service.close();authority.dispose()}
    const task=service.submit(subject,{requestKey:action,backend:'fixture',input:{task:action}}),signal=await prepared.promise
    if(action==='cancel')service.cancel(subject,{taskId:task.taskId})
    else if(action==='revoke')authority.replaceGrant(subject,{botId:'bot-a',tools:tools.filter(tool=>tool!=='execution/read'),modelRoutes:[]})
    else await wait(()=>signal.aborted)
    gate.resolve()
    const done=await wait(()=>{const row=f.j.get('bot-a',task.taskId);return !['admitting','running','cancelling'].includes(row.state)&&row})
    assert.equal(calls,0);assert.ok(commitError,'commit itself rechecks current authority, even when the backend resumes after cancellation')
    assert.equal(done.state,'cancelled');assert.equal(done.result.notDispatched,true);assert.equal(done.executionRef,null)
    assert.equal((await f.store.read()).runs.length,0);assert.deepEqual((await f.store.read()).budgetReservations,{})
  })
}

for(const stage of ['admitting','reference-prepared','task-linked-before-money','money-written-before-commit','admission-committed','fixture-dispatched']){
  test(`atomic/native crash: ${stage} preserves coupled records and never replays a committed operation`,async t=>{
    const dir=await mkdtemp(join(parent,'crash-')),file=join(dir,'journal.sqlite'),legacyFile=join(dir,'state.json')
    const child=spawnSync(process.execPath,['tests/task-admission-crash-fixture.mjs',dir,stage],{encoding:'utf8',timeout:15000,windowsHide:true})
    assert.equal(child.status,78,child.stderr||child.stdout)
    const identity=JSON.parse(await readFile(join(dir,'identity.json'),'utf8'))
    const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1}),j=store.openTaskJournal(),raw=new Database(file)
    t.after(async()=>{raw.close();j.close();await store.close()})
    const committed=['admission-committed','fixture-dispatched'].includes(stage)
    assert.deepEqual(snapshot(raw,identity.taskId),{state:committed?'running':'admitting',delivered:committed?3:null,runs:committed?1:0,holds:committed?1:0,refs:committed?1:0})
    assert.equal(raw.prepare('SELECT count(*) AS n FROM router_model_calls').get().n,committed?1:0)
    const runner=j.claimRunner('recovery-runner',1000,1001)
    assert.equal(j.recover(runner,1001),1)
    const recovered=j.get('bot-a',identity.taskId)
    assert.equal(recovered.state,committed?'needs-reconciliation':'ready')
    assert.equal(recovered.operationId,identity.operationId);assert.equal(recovered.attemptId,identity.attemptId);assert.equal(recovered.attempts.length,1)
    assert.equal(j.ready().length,committed?0:1)
    if(stage==='fixture-dispatched')assert.deepEqual(JSON.parse(await readFile(join(dir,'dispatch.json'),'utf8')),{operationId:identity.operationId,calls:1})
  })
}
