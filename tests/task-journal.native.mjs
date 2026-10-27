import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {setTimeout as sleep} from 'node:timers/promises'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'

assert.ok(process.env.DSH_TASK_DRIVER,'Run through integration-task-probe.mjs with the verified native driver')
const {default:Database}=await import(process.env.DSH_TASK_DRIVER)
const parent=resolve('tmp/integration/task-native');await mkdir(parent,{recursive:true})
const fresh=async()=>join(await mkdtemp(join(parent,'db-')),'orchestration.sqlite')
const payload={backend:'fixture',input:{text:'fixture'},target:{fixture:true}}
async function store(t){const path=await fresh(),j=openTaskJournal(Database,path);t.after(()=>j.close());return {j,path,f:j.claimRunner('runner-a',1000,0)}}
const wait=async check=>{const end=Date.now()+5000;while(Date.now()<end){const v=check();if(v)return v;await sleep(10)}throw new Error('Task did not settle')}

test('journal/native: submission is atomic and owner-scoped idempotency rejects changed content',async t=>{
  const {j,f}=await store(t)
  const a=j.submit(f,'bot-a','same','hash-a',payload,1000,0)
  const again=j.submit(f,'bot-a','same','hash-a',payload,1000,1)
  assert.equal(again.taskId,a.taskId);assert.equal(again.replayed,true)
  assert.throws(()=>j.submit(f,'bot-a','same','changed',payload,1000,2),/TASK_REQUEST_CONFLICT/)
  assert.notEqual(j.submit(f,'bot-b','same','hash-a',payload,1000,2).taskId,a.taskId)
  assert.equal(new Set([a.taskId,a.packageId,a.attemptId,a.operationId]).size,4)
  assert.equal(j.events('bot-a',a.taskId).length,1)
})
test('journal/native: operation intent is consumed once and active runners are exclusive',async t=>{
  const {j,path,f}=await store(t),other=openTaskJournal(Database,path);t.after(()=>other.close())
  assert.throws(()=>other.claimRunner('another',1000,1),/TASK_RUNNER_BUSY/)
  const task=j.submit(f,'bot-a','once','hash',payload,1000,2)
  assert.equal(j.claim(f,'bot-a',task.taskId,3).state,'running')
  assert.equal(other.claim(f,'bot-a',task.taskId,4),null)
  assert.equal(j.recover(f,5),0)
})
test('journal/native: get, cancellation and legacy rerun lookups refuse another owner',async t=>{
  const {j,f}=await store(t),a=j.submit(f,'bot-a','private','hash',payload,1000,1)
  j.claim(f,'bot-a',a.taskId,2)
  j.finish(f,'bot-a',a.taskId,a.attemptId,'failed',{legacyRunId:'actual-legacy-id'},3)
  for(const op of [()=>j.get('bot-b',a.taskId),()=>j.cancel(f,'bot-b',a.taskId,4),()=>j.fromLegacy('bot-b','actual-legacy-id')])assert.throws(op,/TASK_NOT_FOUND/)
  assert.equal(j.fromLegacy('bot-a','actual-legacy-id').taskId,a.taskId)
})
test('journal/native: retries preserve task/package identity, issue fresh attempt/operation ids and retain the deadline',async t=>{
  const {j,f}=await store(t),a=j.submit(f,'bot-a','create','hash',payload,800,1)
  j.claim(f,'bot-a',a.taskId,2);j.finish(f,'bot-a',a.taskId,a.attemptId,'failed',{legacyRunId:'legacy-a'},3)
  const next=j.retry(f,'bot-a',a.taskId,'retry','retry-hash',4)
  assert.equal(next.taskId,a.taskId);assert.equal(next.packageId,a.packageId)
  assert.notEqual(next.attemptId,a.attemptId);assert.notEqual(next.operationId,a.operationId)
  assert.equal(next.attempts[1].parent_id,a.attemptId);assert.equal(next.deadlineAt,800)
  assert.equal(j.retry(f,'bot-a',a.taskId,'retry','retry-hash',5).attemptId,next.attemptId)
  assert.throws(()=>j.retry(f,'bot-a',a.taskId,'retry','changed',5),/TASK_REQUEST_CONFLICT/)
})
test('journal/native: success cannot be retried and never-dispatched cancellation records skipped attempts',async t=>{
  const {j,f}=await store(t),a=j.submit(f,'bot-a','done','hash',payload,1000,1)
  j.claim(f,'bot-a',a.taskId,2);j.finish(f,'bot-a',a.taskId,a.attemptId,'succeeded',{},3)
  assert.throws(()=>j.retry(f,'bot-a',a.taskId,'retry','h',4),/TASK_RETRY_NOT_ALLOWED/)
  const b=j.submit(f,'bot-a','queued','hash',payload,1000,5),cancelled=j.cancel(f,'bot-a',b.taskId,6)
  assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.attempts[0].state,'skipped');assert.equal(cancelled.attempts[0].started_ms,null)
})
test('journal/native: cancellation stays cancelling until the actual attempt settles',async t=>{
  const {j,f}=await store(t),a=j.submit(f,'bot-a','wait','hash',payload,1000,1)
  j.claim(f,'bot-a',a.taskId,2)
  assert.equal(j.cancel(f,'bot-a',a.taskId,3).state,'cancelling')
  assert.equal(j.finish(f,'bot-a',a.taskId,a.attemptId,'succeeded',{legacyRunId:'partial-run'},4).state,'cancelled')
  assert.equal(j.fromLegacy('bot-a','partial-run').taskId,a.taskId)
})
test('journal/native: a new generation fences old writers and never replays a claimed unknown operation',async t=>{
  const {j,path,f}=await store(t),a=j.submit(f,'bot-a','crash','hash',payload,5000,1)
  j.claim(f,'bot-a',a.taskId,2)
  const other=openTaskJournal(Database,path);t.after(()=>other.close())
  const next=other.claimRunner('runner-b',1000,1001)
  assert.equal(other.recover(next,1002),1)
  assert.equal(other.get('bot-a',a.taskId).state,'needs-reconciliation');assert.equal(other.ready().length,0)
  assert.throws(()=>j.finish(f,'bot-a',a.taskId,a.attemptId,'succeeded',{},1003),/STALE_TASK_RUNNER/)
  assert.throws(()=>other.retry(next,'bot-a',a.taskId,'retry','h',1004),/TASK_RECONCILIATION_REQUIRED/)
  assert.throws(()=>other.submit(next,'bot-a','new','h',payload,2000,1004),/TASK_RECONCILIATION_REQUIRED/)
})
test('journal/native: claiming an expired task does not dispatch it; retries cannot extend its total deadline',async t=>{
  const {j,f}=await store(t),a=j.submit(f,'bot-a','deadline','hash',payload,10,1)
  assert.equal(j.claim(f,'bot-a',a.taskId,11),null)
  assert.equal(j.get('bot-a',a.taskId).result.notStarted,true)
  assert.throws(()=>j.retry(f,'bot-a',a.taskId,'retry','h',12),/TASK_DEADLINE/)
})
test('journal/native: a conflicting legacy-run owner rolls the whole completion transaction back',async t=>{
  const {j,f}=await store(t),a=j.submit(f,'bot-a','a','h',payload,1000,1),b=j.submit(f,'bot-b','b','h',payload,1000,1)
  j.claim(f,'bot-a',a.taskId,2);j.finish(f,'bot-a',a.taskId,a.attemptId,'failed',{legacyRunId:'same-run'},3)
  j.claim(f,'bot-b',b.taskId,4)
  assert.throws(()=>j.finish(f,'bot-b',b.taskId,b.attemptId,'succeeded',{legacyRunId:'same-run'},5),/LEGACY_RUN_OWNER_CONFLICT/)
  assert.equal(j.get('bot-b',b.taskId).state,'running')
  assert.equal(j.fromLegacy('bot-a','same-run').taskId,a.taskId)
})
test('journal/native: abrupt process exit preserves dispatched identity and recovery marks it unknown',async t=>{
  const path=await fresh()
  const child=spawnSync(process.execPath,[resolve('scripts/integration-task-probe.mjs'),'--crash-child',fileURLToPath(process.env.DSH_TASK_DRIVER),path],{encoding:'utf8',timeout:15000,windowsHide:true})
  assert.equal(child.status,23,child.stderr)
  const task=JSON.parse(child.stdout),j=openTaskJournal(Database,path);t.after(()=>j.close())
  const f=j.claimRunner('after-crash',1000,2000)
  assert.equal(j.recover(f,2001),1)
  const recovered=j.get('crash-bot',task.taskId)
  assert.equal(recovered.operationId,task.operationId);assert.equal(recovered.state,'needs-reconciliation');assert.equal(j.ready().length,0)
})

test('journal/native: the bounded queue includes its last owner and retries cannot exceed admission capacity',async t=>{
  const {j,f}=await store(t),old=j.submit(f,'bot-a','old','h',payload,1000,0)
  j.claim(f,'bot-a',old.taskId,0);j.finish(f,'bot-a',old.taskId,old.attemptId,'failed',{},0)
  for(let i=0;i<127;i++)j.submit(f,'bot-a',`queued-${i}`,'h',payload,1000,0)
  const last=j.submit(f,'bot-b','last-owner','h',payload,1000,0)
  assert.ok(j.ready().some(row=>row.id===last.taskId))
  assert.throws(()=>j.submit(f,'bot-b','overfull','h',payload,1000,0),/TASK_QUEUE_LIMIT/)
  assert.throws(()=>j.retry(f,'bot-a',old.taskId,'overfull-retry','h',0),/TASK_QUEUE_LIMIT/)
  assert.equal(j.get('bot-a',old.taskId).attempts.length,1)
})

test('journal/native: unresolved operations block retry of an earlier failed task by the same owner',async t=>{
  const {j,f}=await store(t),old=j.submit(f,'bot-a','old','h',payload,5000,0)
  j.claim(f,'bot-a',old.taskId,0);j.finish(f,'bot-a',old.taskId,old.attemptId,'failed',{},0)
  const unknown=j.submit(f,'bot-a','unknown','h',payload,5000,1);j.claim(f,'bot-a',unknown.taskId,2)
  const next=j.claimRunner('runner-b',1000,1001);j.recover(next,1002)
  assert.throws(()=>j.retry(next,'bot-a',old.taskId,'unsafe','h',1003),/TASK_RECONCILIATION_REQUIRED/)
  assert.equal(j.get('bot-a',old.taskId).attempts.length,1)
})

const caps=['task/submit','task/read','task/cancel','task/retry','task/execute','execution/read','execution/retry']
async function managed(t,run) {
  const journal=openTaskJournal(Database,await fresh()),authority=createAuthority(),directory=createPrincipalDirectory(authority)
  for(const id of ['bot-a','bot-b'])directory.register(id,{tools:caps,modelRoutes:[{provider:'fixture',model:'gpt-test'}]})
  const parse=input=>{if(!input||Object.keys(input).some(key=>key!=='text')||typeof input.text!=='string')throw new Error('invalid fixture input');return {text:input.text}}
  const service=createTaskService({journal,authority,directory,runnerTtlMs:1000,taskTtlMs:4000,backends:[{id:'read',version:'v1',effect:'read',machineId:'machine',workspaceId:'workspace',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:{provider:'fixture',model:'gpt-test'},parse,run}]})
  service.start();t.after(async()=>{await service.close();authority.dispose()})
  return {service,journal,authority,directory,a:directory.forBot('bot-a'),b:directory.forBot('bot-b')}
}
test('service/native: forged subjects and cross-Bot task/legacy retries fail before a backend can run',async t=>{
  let calls=0
  const {service,a,b}=await managed(t,async()=>{calls++;return {outcome:'failed',legacyRunId:'managed-legacy'}})
  assert.throws(()=>service.submit({botId:'bot-a'},{requestKey:'x',backend:'read',input:{text:'x'}}),/UNKNOWN_SUBJECT/)
  const task=service.submit(a,{requestKey:'one',backend:'read',input:{text:'中文\nfixture'}})
  await wait(()=>service.get(a,{taskId:task.taskId}).state==='failed')
  assert.throws(()=>service.get(b,{taskId:task.taskId}),/TASK_NOT_FOUND/)
  assert.throws(()=>service.retryLegacy(b,{runId:'managed-legacy',requestKey:'steal'}),/TASK_NOT_FOUND/)
  assert.equal(calls,1)
})
test('service/native: owner retries use the immutable backend/input and a new persisted attempt',async t=>{
  const inputs=[]
  const {service,a}=await managed(t,async({input,attemptNumber})=>{inputs.push(input);return {outcome:attemptNumber===1?'failed':'succeeded',legacyRunId:'retry-owned-run'}})
  const task=service.submit(a,{requestKey:'one',backend:'read',input:{text:'original'}})
  await wait(()=>service.get(a,{taskId:task.taskId}).state==='failed')
  const retry=service.retryLegacy(a,{runId:'retry-owned-run',requestKey:'again'})
  assert.notEqual(retry.attemptId,task.attemptId)
  await wait(()=>service.get(a,{taskId:task.taskId}).state==='succeeded')
  assert.deepEqual(inputs,[{text:'original'},{text:'original'}])
  assert.equal(service.retryLegacy(a,{runId:'retry-owned-run',requestKey:'again'}).replayed,true)
})
test('service/native: cancel acknowledges only a request until cooperative cleanup reaches quiescence',async t=>{
  let entered=false,quiescent=false
  const {service,a}=await managed(t,async({signal})=>{
    entered=true
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))
    await sleep(100);quiescent=true
    return {outcome:'cancelled',legacyRunId:'cancelled-owned-run'}
  })
  const task=service.submit(a,{requestKey:'one',backend:'read',input:{text:'wait'}})
  await wait(()=>entered)
  assert.equal(service.cancel(a,{taskId:task.taskId}).state,'cancelling');assert.equal(quiescent,false)
  await wait(()=>service.get(a,{taskId:task.taskId}).state==='cancelled')
  assert.equal(quiescent,true);assert.equal(service.getLegacy(a,'cancelled-owned-run').taskId,task.taskId)
})
test('service/native: queued cancellation never dispatches and revocation before entry blocks the backend',async t=>{
  let calls=0
  const {service,a,directory,journal}=await managed(t,async()=>{calls++;return {outcome:'succeeded'}})
  const cancelled=service.submit(a,{requestKey:'cancel',backend:'read',input:{text:'cancel'}})
  service.cancel(a,{taskId:cancelled.taskId})
  const blocked=service.submit(a,{requestKey:'block',backend:'read',input:{text:'block'}})
  directory.replaceGrant('bot-a',{tools:['task/read'],modelRoutes:[]})
  await wait(()=>journal.get('bot-a',blocked.taskId).state==='blocked')
  assert.equal(journal.get('bot-a',cancelled.taskId).attempts[0].started_ms,null);assert.equal(calls,0)
})
test('service/native: one Bot has one active package while an independent Bot can progress',async t=>{
  const releases=new Map()
  const {service,a,b}=await managed(t,async({input,signal})=>new Promise(resolve=>{
    const done=()=>resolve({outcome:signal.aborted?'cancelled':'succeeded'})
    releases.set(input.text,done);signal.addEventListener('abort',done,{once:true})
  }))
  const first=service.submit(a,{requestKey:'one',backend:'read',input:{text:'a-one'}})
  service.submit(a,{requestKey:'two',backend:'read',input:{text:'a-two'}})
  service.submit(b,{requestKey:'one',backend:'read',input:{text:'b-one'}})
  await wait(()=>releases.has('a-one')&&releases.has('b-one'))
  assert.equal(releases.has('a-two'),false)
  releases.get('a-one')()
  await wait(()=>releases.has('a-two'))
  releases.get('a-two')();releases.get('b-one')()
  await wait(()=>service.get(a,{taskId:first.taskId}).state==='succeeded')
})
