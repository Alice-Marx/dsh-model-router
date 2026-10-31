import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'
import {taskHash} from '../packages/orchestration/src/task-contract.mjs'

const pkg=(id,dependsOn=[],extra={})=>({id,targetBotId:'bot-a',objective:id,dependsOn,acceptance:['verified'],effectClass:'read',...extra})
const plan=(packages,id='plan-a')=>({schemaVersion:1,taskId:id,origin:{kind:'private',botId:'bot-a',sessionId:null},planRevision:1,packages})
const payload=(item,workspaceId='workspace-a')=>{const target={effect:item.effectClass,machineId:'machine-a',workspaceId};return{backend:'fixture',input:{task:item.objective},target,targetHash:taskHash(target)}}
const prepared=value=>({payloads:value.packages.map(item=>({id:item.id,payload:payload(item)})),deadline:20000})
async function fixture(t){
  await mkdir(resolve('tmp/integration/task-plan'),{recursive:true});const path=join(await mkdtemp(resolve('tmp/integration/task-plan/case-')),'journal.sqlite')
  const journal=openTaskJournal(Database,path),identity=journal.claimRunner('runner-a',1000,0)
  t.after(()=>journal.close());return{j:journal,f:identity,path}
}
const child=(value,id)=>value.packages.find(item=>item.id===id)
const settle=(j,f,row,outcome,now)=>{j.claim(f,row.targetBotId,row.taskId,now);return j.finish(f,row.targetBotId,row.taskId,row.attemptId,outcome,{code:'FIXTURE'},now+1)}
const wait=async check=>{const end=Date.now()+5000;while(Date.now()<end){const value=check();if(value)return value;await sleep(10)}throw new Error('plan did not settle')}

test('plan journal/native: plan/packages/edges/outbox commit once; changed retry and invalid target roll back atomically',async t=>{
  const {j,f,path}=await fixture(t),value=plan([pkg('a'),pkg('b',['a'])]),a=j.submitPlan(f,'bot-a','key',value,1,prepared(value))
  const replay=j.submitPlan(f,'bot-a','key',value,2,prepared(value));assert.equal(replay.replayed,true);assert.deepEqual(replay.packages,a.packages)
  assert.throws(()=>j.submitPlan(f,'bot-a','key',plan([pkg('different')]),3,prepared(plan([pkg('different')]))),/TASK_REQUEST_CONFLICT/)
  const invalid=plan([pkg('c'),pkg('d')],'rollback'),targets=prepared(invalid);targets.payloads[1].payload.target.effect='workspace-write'
  assert.throws(()=>j.submitPlan(f,'bot-a','bad',invalid,3,targets),/TASK_PLAN_EFFECT_MISMATCH/)
  const db=new Database(path);t.after(()=>db.close())
  assert.equal(db.prepare('SELECT count(*) AS n FROM task_plans').get().n,1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n,2)
  assert.equal(db.prepare('SELECT count(*) AS n FROM task_package_deps').get().n,1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM task_outbox').get().n,2)
  assert.throws(()=>j.getPlan('bot-b',a.planId),/TASK_PLAN_NOT_FOUND/)
})

test('plan journal/native: both ready and claim enforce all dependencies; independent branch survives failure',async t=>{
  const {j,f}=await fixture(t),value=plan([pkg('root'),pkg('blocked',['root']),pkg('grandchild',['blocked']),pkg('independent')]),p=j.submitPlan(f,'bot-a','key',value,1,prepared(value))
  assert.deepEqual(new Set(j.ready().map(row=>row.id)),new Set([child(p,'root').taskId,child(p,'independent').taskId]))
  assert.equal(j.claim(f,'bot-a',child(p,'blocked').taskId,2),null)
  const independent=j.claim(f,'bot-a',child(p,'independent').taskId,3)
  settle(j,f,child(p,'root'),'failed',4)
  let state=j.getPlan('bot-a',p.planId);assert.equal(child(state,'blocked').result.code,'DEPENDENCY_FAILED');assert.equal(child(state,'grandchild').state,'blocked');assert.equal(state.state,'running')
  j.finish(f,'bot-a',independent.taskId,independent.attemptId,'succeeded',{},6)
  state=j.getPlan('bot-a',p.planId);assert.equal(state.state,'failed');assert.equal(child(state,'independent').state,'succeeded')
  assert.throws(()=>j.retry(f,'bot-a',child(state,'blocked').taskId,'retry','hash',7),/TASK_DEPENDENCIES_NOT_READY/)
})

test('plan journal/native: success unlocks a join only after every predecessor and never cancels a finished plan',async t=>{
  const {j,f}=await fixture(t),value=plan([pkg('a'),pkg('b'),pkg('join',['a','b'])]),p=j.submitPlan(f,'bot-a','key',value,1,prepared(value))
  settle(j,f,child(p,'a'),'succeeded',2);assert.equal(j.claim(f,'bot-a',child(p,'join').taskId,4),null)
  settle(j,f,child(p,'b'),'succeeded',5);assert.deepEqual(j.ready().map(row=>row.id),[child(p,'join').taskId])
  settle(j,f,child(p,'join'),'succeeded',7);assert.equal(j.getPlan('bot-a',p.planId).state,'succeeded')
  assert.equal(j.cancelPlan(f,'bot-a',p.planId,9).state,'succeeded')
})

test('plan journal/native: subtree cancel skips pending descendants while whole-plan cancel covers independent branches',async t=>{
  const {j,f}=await fixture(t),value=plan([pkg('root'),pkg('dependent',['root']),pkg('independent')]),p=j.submitPlan(f,'bot-a','key',value,1,prepared(value))
  const running=j.claim(f,'bot-a',child(p,'root').taskId,2),cancel=j.cancel(f,'bot-a',running.taskId,3)
  assert.equal(cancel.state,'cancelling');assert.equal(cancel.cancelledTaskIds.length,2)
  let state=j.getPlan('bot-a',p.planId);assert.equal(child(state,'dependent').state,'skipped');assert.equal(child(state,'independent').state,'ready')
  state=j.cancelPlan(f,'bot-a',p.planId,4);assert.equal(state.state,'cancelling');assert.equal(child(state,'independent').state,'skipped');assert.deepEqual(j.ready(),[])
  j.finish(f,'bot-a',running.taskId,running.attemptId,'cancelled',{},5)
  assert.equal(j.getPlan('bot-a',p.planId).state,'cancelled')
  assert.throws(()=>j.retry(f,'bot-a',running.taskId,'retry','hash',6),/TASK_PLAN_CANCELLED/)
})

test('plan journal/native: workspace write locks serialize one root; independent roots and read packages continue',async t=>{
  const {j,f}=await fixture(t),value=plan([pkg('a',[],{effectClass:'workspace-write'}),pkg('b',[],{effectClass:'workspace-write'}),pkg('c',[],{effectClass:'workspace-write'}),pkg('read')]),targets=prepared(value)
  targets.payloads[2].payload.target.workspaceId='independent-worktree'
  targets.payloads[2].payload.targetHash=taskHash(targets.payloads[2].payload.target)
  const p=j.submitPlan(f,'bot-a','key',value,1,targets),a=j.claim(f,'bot-a',child(p,'a').taskId,2)
  assert.equal(j.claim(f,'bot-a',child(p,'b').taskId,3),null)
  assert.ok(j.claim(f,'bot-a',child(p,'c').taskId,4));assert.ok(j.claim(f,'bot-a',child(p,'read').taskId,5))
  j.cancel(f,'bot-a',a.taskId,6);assert.equal(j.claim(f,'bot-a',child(p,'b').taskId,7),null)
  j.finish(f,'bot-a',a.taskId,a.attemptId,'cancelled',{},8)
  assert.ok(j.claim(f,'bot-a',child(p,'b').taskId,9))
})

test('plan journal/native: crash preserves edges and unknown write lock; only a proven reconciliation releases it',async t=>{
  const {j,f,path}=await fixture(t),value=plan([pkg('writer',[],{effectClass:'workspace-write'}),pkg('same-root',[],{effectClass:'workspace-write'}),pkg('after',['writer'])]),p=j.submitPlan(f,'bot-a','key',value,1,prepared(value))
  const a=j.claim(f,'bot-a',child(p,'writer').taskId,2),reference={kind:'mr-run',runId:'fixture-run',marker:{schemaVersion:1,taskId:child(p,'writer').taskId,attemptId:child(p,'writer').attemptId,operationId:child(p,'writer').operationId,targetHash:taskHash(payload(value.packages[0]).target)}}
  j.linkExecution(f,'bot-a',a.taskId,a.attemptId,reference,2)
  // Journal-level protocol test only: no native writer or model is executed.
  j.cancelPlan(f,'bot-a',p.planId,3);j.close()
  const next=openTaskJournal(Database,path);t.after(()=>next.close());const runner=next.claimRunner('runner-b',1000,1001)
  assert.equal(next.recover(runner,1002),1)
  const state=next.getPlan('bot-a',p.planId);assert.equal(state.state,'cancelling');assert.equal(state.needsReconciliation,true)
  assert.equal(child(state,'after').dependsOn[0],'writer');assert.equal(child(state,'after').state,'skipped')
  const unknown=next.reconcile(runner,'bot-a',a.taskId,a.attemptId,'check','hash',{outcome:'unknown',reason:'No trusted exit evidence'},1003)
  assert.equal(unknown.state,'needs-reconciliation')
  const db=new Database(path);t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) AS n FROM task_workspace_locks').get().n,1)
  assert.throws(()=>next.reconcile(runner,'bot-a',a.taskId,a.attemptId,'bad','bad',{outcome:'cancelled',referenceHash:'0'.repeat(64),evidenceHash:'a'.repeat(64)},1004),/INVALID_TASK_RECONCILIATION_PROOF/)
  next.reconcile(runner,'bot-a',a.taskId,a.attemptId,'proven','proven',{outcome:'cancelled',referenceHash:taskHash(reference),evidenceHash:'a'.repeat(64)},1005)
  assert.equal(db.prepare('SELECT count(*) AS n FROM task_workspace_locks').get().n,0)
  assert.equal(next.getPlan('bot-a',p.planId).state,'cancelled')
})

test('plan journal/native: version two migration retains legacy task identity; future schemas are refused',async t=>{
  const {j,f,path}=await fixture(t),old=j.submit(f,'bot-a','old','hash',{backend:'fixture',input:{task:'old'},target:{effect:'read'}},20000,1)
  j.close();const db=new Database(path)
  db.exec('DROP TABLE task_workspace_locks; DROP TABLE task_package_deps; DROP TABLE task_plan_packages; DROP TABLE task_plans; PRAGMA user_version=2;');db.close()
  const next=openTaskJournal(Database,path);t.after(()=>next.close());assert.equal(next.get('bot-a',old.taskId).attemptId,old.attemptId)
  const raw=new Database(path);assert.equal(raw.pragma('user_version',{simple:true}),5);raw.pragma('user_version=6');raw.close()
  assert.throws(()=>openTaskJournal(Database,path),/TASK_SCHEMA_UNSUPPORTED/)
})

test('plan journal/native: target Bot cannot cancel a planner-owned running successor via its completed package',async t=>{
  const {j,f}=await fixture(t),value=plan([pkg('worker',[],{targetBotId:'bot-b'}),pkg('planner',['worker'])]),p=j.submitPlan(f,'bot-a','key',value,1,prepared(value))
  settle(j,f,child(p,'worker'),'succeeded',2)
  const running=j.claim(f,'bot-a',child(p,'planner').taskId,4)
  assert.deepEqual(j.cancel(f,'bot-b',child(p,'worker').taskId,5).cancelledTaskIds,[])
  assert.equal(j.get('bot-a',running.taskId).state,'running')
  j.cancelPlan(f,'bot-a',p.planId,6);assert.equal(j.get('bot-a',running.taskId).state,'cancelling')
})

async function serviceFixture(t,options={}){
  const {j,path}=await (async()=>{await mkdir(resolve('tmp/integration/task-plan'),{recursive:true});const path=join(await mkdtemp(resolve('tmp/integration/task-plan/service-')),'journal.sqlite');return{j:openTaskJournal(Database,path),path}})()
  const authority=createAuthority(),directory=createPrincipalDirectory(authority)
  const tools=['task/submit','task/execute','task/read','task/cancel','task/retry','task/reconcile','execution/read','execution/retry']
  for(const id of ['bot-a','bot-b'])directory.register(id,{tools,modelRoutes:[]})
  const subject=directory.forBot('bot-a'),calls=[]
  const backend={id:'fixture',version:'v1',effect:'read',machineId:'machine-a',workspaceId:'workspace-a',location:'local',capability:'execution/read',retryCapability:'execution/retry',parse:input=>input,
    async run(context){calls.push({text:context.input.task,bot:context.ownerBotId});return options.run?options.run(context):{outcome:context.input.task==='fail'?'failed':'succeeded'}}}
  const service=createTaskService({journal:j,authority,directory,backends:[backend],planTargetsFor:()=>['bot-a','bot-b'],...options})
  service.start();t.after(async()=>{await service.close();authority.dispose()});return{j,service,authority,directory,subject,calls,path}
}

test('plan service/native: dependency failure blocks successors, cross-Bot independent branch runs under its own identity',async t=>{
  const f=await serviceFixture(t),value=plan([pkg('fail'),pkg('downstream',['fail']),pkg('independent',[],{targetBotId:'bot-b'})])
  const p=f.service.submitPlan(f.subject,{requestKey:'key',plan:value})
  const result=await wait(()=>{const v=f.service.getPlan(f.subject,{planId:p.planId});return v.state==='failed'&&v})
  assert.equal(child(result,'downstream').state,'blocked');assert.equal(child(result,'independent').state,'succeeded')
  assert.deepEqual(new Set(f.calls.map(row=>`${row.bot}/${row.text}`)),new Set(['bot-a/fail','bot-b/independent']))
  assert.throws(()=>f.service.getPlan(f.directory.forBot('bot-b'),{planId:p.planId}),/TASK_PLAN_NOT_FOUND/)
})

test('plan service/native: origin/target/effect authorization is checked before any row or provider dispatch',async t=>{
  const f=await serviceFixture(t,{planTargetsFor:()=>['bot-a']})
  assert.throws(()=>f.service.submitPlan(f.subject,{requestKey:'bad',plan:plan([pkg('target',[],{targetBotId:'bot-b'})])}),/TASK_PLAN_TARGET_UNKNOWN/)
  assert.throws(()=>f.service.submitPlan(f.subject,{requestKey:'bad',plan:{...plan([pkg('a')]),origin:{kind:'private',botId:'bot-b',sessionId:null}}}),/TASK_PLAN_ORIGIN_MISMATCH/)
  assert.throws(()=>f.service.submitPlan(f.subject,{requestKey:'bad',plan:plan([pkg('write',[],{effectClass:'workspace-write'})])}),/EXECUTION_FACADE_REQUIRED/)
  assert.deepEqual(f.j.ready(),[]);assert.equal(f.calls.length,0)
})

test('plan service/native: cancellation aborts every running branch, skips waiting packages and waits for cleanup',async t=>{
  const ended=[]
  const f=await serviceFixture(t,{run:async({input,signal})=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));await sleep(25);ended.push(input.task);return{outcome:'cancelled'}}})
  const p=f.service.submitPlan(f.subject,{requestKey:'key',plan:plan([pkg('left'),pkg('right',[],{targetBotId:'bot-b'}),pkg('later',['left','right'])])})
  await wait(()=>f.calls.length===2)
  const cancelled=f.service.cancelPlan(f.subject,{planId:p.planId});assert.equal(cancelled.state,'cancelling');assert.equal(ended.length,0)
  const result=await wait(()=>{const value=f.service.getPlan(f.subject,{planId:p.planId});return value.state==='cancelled'&&value})
  assert.equal(child(result,'later').state,'skipped');assert.equal(ended.length,2);assert.equal(f.calls.length,2)
})

test('plan service/native: caller Session is Host-stamped and cannot be swapped through model plan fields',async t=>{
  const f=await serviceFixture(t)
  f.directory.bind('bot-a',{session:{id:'private-a'}})
  const value=plan([pkg('a')]);value.origin.sessionId='private-a'
  assert.throws(()=>f.service.submitPlan(f.subject,{requestKey:'forged',plan:value},{sessionId:'group-a'}),/TASK_PLAN_ORIGIN_MISMATCH/)
  value.origin.sessionId=null
  const accepted=f.service.submitPlan(f.subject,{requestKey:'stamped',plan:value},{sessionId:'private-a'})
  assert.equal(accepted.plan.origin.sessionId,'private-a')
  await wait(()=>f.service.getPlan(f.subject,{planId:accepted.planId}).state==='succeeded');assert.equal(f.calls.length,1)
})

test('plan service/native: unconfirmed cancellation keeps the parent cancelling and never retries the operation',async t=>{
  const f=await serviceFixture(t,{run:async({signal})=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return{outcome:'unknown',summary:{code:'STOP_UNCONFIRMED'}}}})
  const p=f.service.submitPlan(f.subject,{requestKey:'key',plan:plan([pkg('running'),pkg('later',['running'])])})
  await wait(()=>f.calls.length===1);f.service.cancelPlan(f.subject,{planId:p.planId})
  const result=await wait(()=>{const value=f.service.getPlan(f.subject,{planId:p.planId});return value.needsReconciliation&&value})
  assert.equal(result.state,'cancelling');assert.equal(child(result,'later').state,'skipped');assert.equal(f.calls.length,1)
  assert.throws(()=>f.service.retry(f.subject,{taskId:child(result,'running').taskId,requestKey:'bad-retry'}),/TASK_PLAN_CANCELLED/)
})

test('plan service/native: authenticated owner replay survives detached original Agent Session without dispatching again',async t=>{
  let detached=false
  const f=await serviceFixture(t,{planTargetsFor:()=>{assert.equal(detached,false,'original replay must not rebuild a new target catalog');return['bot-a']}}),unbind=f.directory.bind('bot-a',{session:{id:'private-a'}})
  const value=plan([pkg('once')]);value.origin.sessionId='private-a'
  const request={requestKey:'once',plan:value},original=f.service.submitPlan(f.subject,request,{sessionId:'private-a'})
  await wait(()=>f.service.getPlan(f.subject,{planId:original.planId}).state==='succeeded');unbind();detached=true
  const restored=f.service.submitPlan(f.subject,request,{owner:true})
  assert.equal(restored.replayed,true);assert.equal(restored.packages[0].operationId,original.packages[0].operationId);assert.equal(f.calls.length,1)
  assert.throws(()=>f.service.submitPlan(f.subject,{...request,plan:{...value,planRevision:2}},{owner:true}),/TASK_REQUEST_CONFLICT/)
  assert.throws(()=>f.service.submitPlan(f.subject,request),/UNKNOWN_SUBJECT/)
})

test('plan service/native: configured load keeps Bot and machine ceilings with visible waiting and no duplicate dispatch',async t=>{
  const active={total:0,machine:0,bots:new Map()},maximum={total:0,machine:0,bots:new Map()};let calls=0
  const backend={id:'fixture',version:'v1',effect:'read',machineId:'machine-a',workspaceId:'workspace-a',location:'remote',capability:'execution/read',retryCapability:'execution/retry',parse:input=>input,
    async run(context){
      calls++;active.total++;active.machine++;active.bots.set(context.ownerBotId,(active.bots.get(context.ownerBotId)??0)+1)
      maximum.total=Math.max(maximum.total,active.total);maximum.machine=Math.max(maximum.machine,active.machine)
      for(const [bot,count] of active.bots)maximum.bots.set(bot,Math.max(maximum.bots.get(bot)??0,count))
      try{await sleep(30);return{outcome:'succeeded'}}finally{active.total--;active.machine--;active.bots.set(context.ownerBotId,active.bots.get(context.ownerBotId)-1)}
    }}
  const f=await serviceFixture(t,{backends:[backend],concurrencyFor:()=>2})
  const packages=Array.from({length:24},(_,index)=>pkg(`read-${index}`,[],{targetBotId:index%2?'bot-b':'bot-a',effectClass:'read'}))
  const submitted=f.service.submitPlan(f.subject,{requestKey:'load',plan:plan(packages,'load-plan')})
  const waiting=await wait(()=>{if(calls<4)return null;const value=f.service.getPlan(f.subject,{planId:submitted.planId});return value.packages.some(item=>item.state==='ready')&&value.packages.some(item=>item.state==='running')?value:null})
  assert.ok(waiting.packages.filter(item=>item.state==='ready').length>0,'queued work is visible instead of spinning invisibly')
  const result=await wait(()=>{const value=f.service.getPlan(f.subject,{planId:submitted.planId});return value.state==='succeeded'&&value})
  assert.equal(result.packages.length,24)
  assert.ok(result.packages.every(item=>item.state==='succeeded'&&item.attemptId),'every package settles once with its original attempt')
  assert.equal(calls,24,'no package is lost or dispatched twice')
  assert.ok(maximum.machine<=4,'the service-wide machine ceiling is never exceeded')
  for(const maximumForBot of maximum.bots.values())assert.ok(maximumForBot<=2)
  assert.ok(maximum.total<=4,'the two Bot configured ceilings are never exceeded')
})
