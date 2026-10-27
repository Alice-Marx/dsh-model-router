import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {createBudgetReservations} from '../.dsh-plugin/shared/budget-reservations.mjs'
import {spending,archiveSpending} from '../.dsh-plugin/shared/run-ledger.mjs'
import {archiveSubscriptionUsage,subscriptionUsage} from '../.dsh-plugin/shared/subscription-usage.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'

assert.ok(process.env.DSH_TASK_DRIVER,'Run through integration-finance-probe.mjs')
const {default:Database}=await import(process.env.DSH_TASK_DRIVER)
const parent=resolve('tmp/integration/finance-native');await mkdir(parent,{recursive:true})
const receipt=(id,cost=0.2)=>({id,createdAt:Date.now(),finishedAt:Date.now(),kind:'assign',status:'completed',packages:[{id:'direct',ran:true,ok:true,billing:'api',costUsd:cost,finishedAt:Date.now()}],reviews:[]})
async function home(){const dir=await mkdtemp(join(parent,'case-'));return {file:join(dir,'orchestration.sqlite'),legacyFile:join(dir,'state.json'),lockStaleMs:1}}
async function fixture(t,options={}){
  const {seed,...storageOptions}=options
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});await legacy.appendRun(receipt('old'))
  if(seed)await legacy.update(seed)
  const expected=await legacy.read()
  const original=await readFile(paths.legacyFile)
  const store=await openSqliteRouterState({Database,...paths,...storageOptions});t.after(()=>store.close())
  return {...paths,legacy,original,expected,store}
}
const total=state=>spending(state.runs,undefined,state.archivedSpending).today
const close=(left,right)=>assert.ok(Math.abs(left-right)<1e-10,`${left} vs ${right}`)
const crash=(paths,step)=>spawnSync(process.execPath,[resolve('scripts/integration-finance-probe.mjs'),'--crash',fileURLToPath(process.env.DSH_TASK_DRIVER),paths.file,paths.legacyFile,step],{encoding:'utf8',windowsHide:true,timeout:20000})

test('finance/native: cutover keeps original bytes, normalized receipts and one authority; cached legacy writers refuse',async t=>{
  const {store,legacy,legacyFile,original,expected}=await fixture(t,{seed:state=>{
    const sub={id:'archived-subscription',createdAt:Date.now(),packages:[{id:'sub',provider:'fixture',model:'gpt-test',toolId:'fixture-cli',channel:'official-cli',billing:'subscription',ran:true,usage:null,referenceCostUsd:999,finishedAt:Date.now()}]}
    state.archivedSpending=archiveSpending([sub],state.archivedSpending)
    state.archivedSubscriptionUsage=archiveSubscriptionUsage([sub],state.archivedSubscriptionUsage)
    state.quota.fixture={until:Date.now()+60000};state.authFailures.fixture={at:Date.now(),detail:'synthetic'}
    state.onboarding.completedAt=Date.now()
  }})
  const marker=JSON.parse(await readFile(legacyFile,'utf8'));assert.equal(marker.version,4)
  assert.deepEqual(await readFile(join(resolve(legacyFile,'..'),marker.migration.backup)),original)
  close(total(await store.read()),0.2);assert.equal(store.status().phase,'active')
  assert.deepEqual(await store.read(),expected)
  const usage=subscriptionUsage((await store.read()).runs,undefined,(await store.read()).archivedSubscriptionUsage)
  assert.equal(usage.today.unknownUsageCalls,1);assert.equal(usage.today.inputTokens,null)
  await assert.rejects(legacy.saveQuota({forged:{until:Date.now()+10000}}),/不受支持/)
  assert.equal(JSON.parse(await readFile(legacyFile,'utf8')).version,4)
})
test('finance/native: run and hold write atomically; repeated settlement does not count another receipt',async t=>{
  const {store}=await fixture(t),manager=createBudgetReservations({state:store})
  const run={...receipt('current',0),status:'running',packages:[]}
  const admitted=await manager.beginExecution({run,packageEstimates:[{id:'direct',estimatedCostUsd:0.3}],dailyLimitUsd:1})
  assert.equal(admitted.accepted,true);assert.ok((await store.read()).budgetReservations.current)
  await manager.finishExecution({reservationId:'current',ownerToken:admitted.ownerToken,run:receipt('current',0.3)})
  close(total(await store.read()),0.5);assert.deepEqual((await store.read()).budgetReservations,{})
  await assert.rejects(manager.finishExecution({reservationId:'current',ownerToken:admitted.ownerToken,run:receipt('current',0.3)}),e=>e.code==='ROUTER_RESERVATION_OWNERSHIP')
  close(total(await store.read()),0.5)
})
test('finance/native: two native connections cannot both spend the same remaining budget',async t=>{
  const {store,...paths}=await fixture(t)
  const other=await openSqliteRouterState({Database,...paths});t.after(()=>other.close())
  const results=await Promise.all([store,other].map((state,i)=>createBudgetReservations({state}).beginExecution({run:{id:`race-${i}`,createdAt:Date.now(),status:'running',packages:[]},packageEstimates:[{id:'direct',estimatedCostUsd:0.6}],dailyLimitUsd:1})))
  assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(Object.keys((await store.read()).budgetReservations).length,1)
})
test('finance/native: concurrent real child processes serialize budget admission without inherited credentials',async t=>{
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});await legacy.saveHealth(null)
  const store=await openSqliteRouterState({Database,...paths});t.after(()=>store.close())
  const run=id=>new Promise((accept,reject)=>{
    const child=spawn(process.execPath,[resolve('scripts/integration-finance-probe.mjs'),'--writer',fileURLToPath(process.env.DSH_TASK_DRIVER),paths.file,paths.legacyFile,id],{windowsHide:true,env:{...process.env},stdio:['ignore','pipe','pipe']})
    let out='',err='';child.stdout.on('data',b=>{out+=b});child.stderr.on('data',b=>{err+=b});child.once('error',reject)
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Owned budget writer timeout'))},20000)
    child.once('close',code=>{clearTimeout(timeout);code===0?accept(JSON.parse(out)):reject(new Error(err))})
  })
  const values=await Promise.all([run('child-a'),run('child-b')]);assert.equal(values.filter(x=>x.accepted).length,1)
  assert.equal(Object.keys((await store.read()).budgetReservations).length,1)
})
test('finance/native: unsafe asynchronous callbacks run once and fail on conflict without leaking candidate changes',async t=>{
  const {store,...paths}=await fixture(t),other=await openSqliteRouterState({Database,...paths});t.after(()=>other.close())
  let entered,release,calls=0;const ready=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r})
  const work=store.update(async current=>{calls++;current.health={tools:[],note:'uncommitted'};entered();await gate})
  await ready;await other.saveQuota({other:{until:Date.now()+10000}});release()
  await assert.rejects(work,/ROUTER_STATE_CONFLICT/);assert.equal(calls,1)
  assert.equal((await store.read()).health,null);assert.ok((await store.read()).quota.other)
})
test('finance/native: explicitly pure callbacks recompute on a new revision without holding a lock across awaits',async t=>{
  const {store,...paths}=await fixture(t),other=await openSqliteRouterState({Database,...paths});t.after(()=>other.close())
  let entered,release,calls=0;const ready=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r})
  const work=store.update(async current=>{calls++;if(calls===1){entered();await gate}current.quota.mine={until:Date.now()+10000}},{retrySafe:true})
  await ready;await other.saveQuota({other:{until:Date.now()+10000}});release();await work
  assert.equal(calls,2);assert.ok((await store.read()).quota.mine);assert.ok((await store.read()).quota.other)
})
test('finance/native: retention archives money once and protects held run identities',async t=>{
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});for(let i=0;i<4;i++)await legacy.appendRun(receipt(`old-${i}`))
  await legacy.update(state=>{
    state.runs.push({id:'held',createdAt:Date.now(),status:'interrupted',packages:[]})
    state.budgetReservations.held={id:'held',runId:'held',ownerToken:'owner',ownerPid:process.pid,status:'interrupted',createdAt:Date.now(),updatedAt:Date.now(),packages:[{id:'direct',estimatedCostUsd:0.1,started:true}],completedIds:[]}
  })
  const store=await openSqliteRouterState({Database,...paths,maxRuns:2});t.after(()=>store.close())
  const state=await store.read();assert.equal(state.runs.length,2);close(total(state),0.8)
  assert.ok(state.runs.some(run=>run.id==='held'));assert.ok(state.budgetReservations.held)
  await store.saveHealth({tools:[]});close(total(await store.read()),0.8)
})
test('finance/native: corrupt, incomplete and active source states are preserved rather than silently migrated',async()=>{
  for(const kind of ['corrupt','incomplete','active']){
    const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});await legacy.appendRun(receipt('run'))
    if(kind==='corrupt')await writeFile(paths.legacyFile,'{corrupt')
    else await legacy.update(state=>{if(kind==='incomplete')state.historyIncomplete=true;else state.budgetReservations.run={id:'run',runId:'run',ownerToken:'owner',ownerPid:process.pid,status:'active',createdAt:Date.now(),updatedAt:Date.now(),packages:[],completedIds:[]}})
    const before=await readFile(paths.legacyFile)
    await assert.rejects(openSqliteRouterState({Database,...paths}));assert.deepEqual(await readFile(paths.legacyFile),before)
  }
})
test('finance/native: interrupted unknown holds survive migration and refuse unapproved budget admission',async t=>{
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});await legacy.appendRun(receipt('unknown',0))
  await legacy.update(state=>{state.runs[0].packages[0].costUsd=null;state.budgetReservations.unknown={id:'unknown',runId:'unknown',ownerToken:'owner',ownerPid:process.pid,status:'interrupted',createdAt:Date.now(),updatedAt:Date.now(),packages:[{id:'direct',estimatedCostUsd:0.3,started:true,billing:'api'}],completedIds:[]}})
  const store=await openSqliteRouterState({Database,...paths});t.after(()=>store.close())
  assert.equal((await store.read()).budgetReservations.unknown.status,'interrupted')
  const value=await createBudgetReservations({state:store}).beginExecution({run:{id:'new',packages:[]},packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1})
  assert.equal(value.accepted,false)
  await assert.rejects(store.rollback(),/ROUTER_ROLLBACK_UNRESOLVED_HOLDS/)
})
test('finance/native: rollback exports latest SQLite receipts, leaves immutable backup, and invalidates old SQLite handles',async t=>{
  const {store,legacy,legacyFile,original,...paths}=await fixture(t);await store.appendRun(receipt('new',0.3))
  const result=await store.rollback();assert.equal(result.status,'rolled-back');close(total(await legacy.read()),0.5)
  await assert.rejects(store.saveHealth({tools:[]}),/ROUTER_AUTHORITY_INACTIVE/)
  const again=await openSqliteRouterState({Database,...paths,legacyFile});t.after(()=>again.close())
  close(total(await again.read()),0.5);await assert.rejects(store.read(),/ROUTER_AUTHORITY_INACTIVE/)
})
test('finance/native: rollback refuses active Task state in the same database',async t=>{
  const {store,file}=await fixture(t),journal=openTaskJournal(Database,file);t.after(()=>journal.close())
  const runner=journal.claimRunner('runner',1000,0),task=journal.submit(runner,'bot','request','hash',{},1000,0)
  await assert.rejects(store.rollback(),/ROUTER_ROLLBACK_ACTIVE_TASKS/)
  journal.cancel(runner,'bot',task.taskId,1);assert.equal((await store.rollback()).status,'rolled-back')
})
for(const step of ['prepared','marker-written','active'])test(`finance/native: real process exit at migration ${step} recovers without dropping source changes`,async t=>{
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});await legacy.appendRun(receipt('old'))
  const child=crash(paths,step);assert.equal(child.status,42,child.stderr)
  if(step==='prepared')await legacy.appendRun(receipt('late-old-writer',0.3))
  const store=await openSqliteRouterState({Database,...paths});t.after(()=>store.close())
  close(total(await store.read()),step==='prepared'?0.5:0.2);assert.equal(store.status().phase,'active')
})
for(const step of ['rollback-prepared','rollback-file-written'])test(`finance/native: real process exit at ${step} requires explicit rollback recovery`,async t=>{
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile,lockStaleMs:1});await legacy.appendRun(receipt('old'))
  const initial=await openSqliteRouterState({Database,...paths});await initial.appendRun(receipt('new',0.3));await initial.close()
  const child=crash(paths,step);assert.equal(child.status,42,child.stderr)
  await assert.rejects(openSqliteRouterState({Database,...paths}))
  const resumed=await openSqliteRouterState({Database,...paths,mode:'resume-rollback'});t.after(()=>resumed.close())
  assert.equal((await resumed.rollback()).status,'rolled-back');close(total(await legacy.read()),0.5)
})
test('finance/native: missing/tampered authority marker never falls back to a JSON money writer',async t=>{
  const {store,legacyFile,original}=await fixture(t);await writeFile(legacyFile,original)
  await assert.rejects(store.read(),/ROUTER_AUTHORITY_CHANGED/)
  await assert.rejects(store.appendRun(receipt('forged')),/ROUTER_AUTHORITY_CHANGED/)
})
test('finance/native: future ledger schemas and changed migration backups are refused without downgrade',async t=>{
  const first=await fixture(t),raw=new Database(first.file)
  raw.prepare('UPDATE router_meta SET schema_version=99').run();raw.close()
  await assert.rejects(openSqliteRouterState({Database,file:first.file,legacyFile:first.legacyFile}),/ROUTER_LEDGER_VERSION_UNSUPPORTED/)
  const check=new Database(first.file);assert.equal(check.prepare('SELECT schema_version FROM router_meta').get().schema_version,99);check.close()
  const second=await fixture(t),marker=JSON.parse(await readFile(second.legacyFile,'utf8'))
  await writeFile(join(resolve(second.legacyFile,'..'),marker.migration.backup),'tampered')
  await assert.rejects(openSqliteRouterState({Database,file:second.file,legacyFile:second.legacyFile}),/ROUTER_MIGRATION_BACKUP_CHANGED/)
})
test('finance/native: production lock timing recovers a genuinely dead migration owner after the default stale interval',async t=>{
  const paths=await home(),legacy=createRouterState({file:paths.legacyFile});await legacy.appendRun(receipt('old'))
  const child=crash(paths,'marker-written');assert.equal(child.status,42,child.stderr)
  const store=await openSqliteRouterState({Database,file:paths.file,legacyFile:paths.legacyFile});t.after(()=>store.close())
  assert.equal(store.status().phase,'active');close(total(await store.read()),0.2)
})
