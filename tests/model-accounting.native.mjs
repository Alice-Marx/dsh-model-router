import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createModelAccounting} from '../packages/orchestration/src/model-accounting.mjs'
import {markManagedModelRequest,markTaskModelRequest} from '../packages/orchestration/src/model-receipt.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {createBudgetReservations} from '../.dsh-plugin/shared/budget-reservations.mjs'
import {spending} from '../.dsh-plugin/shared/run-ledger.mjs'
import {subscriptionUsage} from '../.dsh-plugin/shared/subscription-usage.mjs'

const {default:Database}=await import(process.env.DSH_TASK_DRIVER)
const model={provider:'fixture',model:'gpt-test'},pricing={input:1,output:2}
const policy={funding:'api',pricing,maxInputTokens:1000,maxOutputTokens:100}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} vs ${b}`)
async function setup(t,options={}){
  const parent=resolve('tmp/integration/model-accounting');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'case-'))
  const legacyFile=join(dir,'state.json');await createRouterState({file:legacyFile}).saveHealth(null)
  const store=await openSqliteRouterState({Database,file:join(dir,'orchestration.sqlite'),legacyFile,lockStaleMs:1})
  const authority=createAuthority(),subject=Object.freeze({})
  const grant={botId:'bot-a',tools:['model/infer'],modelRoutes:[model]};authority.register(subject,grant)
  const accounting=createModelAccounting({store,authority,pricingFor:async()=>policy,inputBoundFor:async()=>1000,machineId:'machine',workspaceId:'workspace',...options})
  const identity={subject,botId:'bot-a',sessionId:'session-a',source:'bot'}
  t.after(async()=>{await accounting.close();await store.close();authority.dispose()})
  return {store,authority,subject,accounting,identity,grant}
}
const request=()=>({...model,messages:[{role:'user',content:'sensitive prompt fixture'}],maxTokens:20,signal:new AbortController().signal})
const chunks=async function*(){yield {type:'text-delta',text:'reply'};yield {type:'usage',usage:{inputTokens:11,outputTokens:5}};yield {type:'finish',reason:{kind:'stop'}}}
const drain=async stream=>{const out=[];for await(const c of stream)out.push(c);return out}

test('model/native: routed task receipts keep their task identity while each request receives real independent admission',async t=>{
  const {store,accounting,identity}=await setup(t)
  for(let i=0;i<2;i++){
    const options=request()
    markTaskModelRequest(options,{botId:'bot-a',taskId:'routed-task',attemptId:'routed-attempt',operationId:'routed-operation',...model})
    await drain(accounting.stream(options,chunks,identity))
  }
  const receipts=(await store.modelCalls({botId:'bot-a'})).items,state=await store.read()
  assert.equal(receipts.length,2);assert.equal(new Set(receipts.map(row=>row.runId)).size,2)
  assert.ok(receipts.every(row=>row.taskId==='routed-task'&&row.attemptId==='routed-attempt'&&row.operationId==='routed-operation'&&row.state==='settled'))
  assert.equal(state.runs.length,2);assert.deepEqual(state.budgetReservations,{})
  close(spending(state.runs).today,0.000042)
})

test('model/native: front and auxiliary calls admit before dispatch, retain distinct source rows and one invoice each',async t=>{
  const {store,accounting,identity}=await setup(t)
  let calls=0
  for(const source of ['bot','aux']){
    const options=request(),originalSignal=options.signal
    await drain(accounting.stream(options,()=>{calls++;return (async function*(){const state=await store.read();assert.equal(Object.keys(state.budgetReservations).length,1);yield*chunks()})()},{...identity,source}))
    assert.equal(options.signal,originalSignal)
  }
  assert.equal(calls,2);const receipts=(await store.modelCalls({botId:'bot-a'})).items
  assert.deepEqual(receipts.map(r=>r.source),['bot','aux']);assert.ok(receipts.every(r=>r.state==='settled'&&r.usageComplete))
  const state=await store.read();assert.equal(state.runs.length,2);close(spending(state.runs).today,0.000042)
  assert.equal(JSON.stringify(receipts).includes('sensitive prompt fixture'),false);assert.deepEqual(state.budgetReservations,{})
})

test('model/native: shared account and project holds serialize different Bots while independent funds remain usable',async t=>{
  const config={...policy,scopeId:'account-shared',projectId:'project-shared',botDailyLimitUsd:1,accountDailyLimitUsd:0.0011,projectMonthlyLimitUsd:0.0011}
  const {store,accounting,identity,authority}=await setup(t,{pricingFor:async()=>config})
  const subject=Object.freeze({});authority.register(subject,{botId:'bot-b',tools:['model/infer'],modelRoutes:[model]})
  let entered,release;const started=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r});let dispatches=0
  const first=drain(accounting.stream(request(),()=> (async function*(){dispatches++;entered();await gate;yield*chunks()})(),identity))
  await started
  await assert.rejects(drain(accounting.stream(request(),()=>{dispatches++;return chunks()},{...identity,subject,botId:'bot-b'})),/MODEL_WAITING_BUDGET/)
  assert.equal(store.fundingTotals({botId:'bot-b',includeUnassigned:false}).today,0)
  release();await first
  await drain(accounting.stream(request(),chunks,{...identity,subject,botId:'bot-b'}))
  const rows=(await store.modelCalls()).items
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.fundingScopeId==='account-shared'&&row.fundingProjectId==='project-shared'))
  close(store.fundingTotals({scopeId:'account-shared'}).today,0.000042);assert.equal(dispatches,1)
})

test('model/native: exact zero paid cap rejects even a sub-epsilon amount before provider dispatch',async t=>{
  const {accounting,identity,store}=await setup(t,{pricingFor:async()=>({...policy,pricing:{input:1e-20,output:1e-20},botDailyLimitUsd:0})})
  let dispatched=false
  await assert.rejects(drain(accounting.stream(request(),()=>{dispatched=true;return chunks()},identity)),/MODEL_WAITING_BUDGET/)
  assert.equal(dispatched,false);assert.equal((await store.modelCalls()).items.length,0)
})

test('model/native: output is clamped where the request allows it and a frozen bound is reserved as it is',async t=>{
  const {accounting,identity,store}=await setup(t)
  const options=request();options.maxTokens=10000;const descriptor=Object.getOwnPropertyDescriptor(options,'maxTokens')
  await drain(accounting.stream(options,()=>{assert.equal(options.maxTokens,100);return chunks()},identity))
  assert.deepEqual(Object.getOwnPropertyDescriptor(options,'maxTokens'),descriptor)
  await assert.rejects(drain(accounting.stream({...request(),maxTokens:'20'},chunks,identity)),/MODEL_OUTPUT_BOUNDARY_REQUIRED/)
  // The SDK AgentLoop freezes its request, so the model's own bound cannot be lowered. It is
  // admitted unchanged and reserved at the bound the provider will receive; the budget decides.
  const immutable=Object.defineProperty(request(),'maxTokens',{value:10000,writable:false})
  await drain(accounting.stream(immutable,()=>{assert.equal(immutable.maxTokens,10000);return chunks()},identity))
  assert.equal((await store.modelCalls()).items.filter(row=>row.finishKind!==null).length,2)
})

test('model/native: an unverified input allowance cannot reserve less than the trusted model capacity',async t=>{
  const {accounting,identity,store}=await setup(t,{inputBoundFor:async()=>1001})
  let dispatched=false
  await assert.rejects(drain(accounting.stream(request(),()=>{dispatched=true;return chunks()},identity)),/MODEL_INPUT_BOUNDARY_REQUIRED/)
  assert.equal(dispatched,false);assert.equal((await store.modelCalls()).items.length,0)
  const absent=await setup(t,{inputBoundFor:undefined})
  await assert.rejects(drain(absent.accounting.stream(request(),chunks,absent.identity)),/MODEL_INPUT_BOUNDARY_REQUIRED/)
})

test('model/native: subscription zero forbids dispatch; daily and monthly quotas count durable front and auxiliary admissions per Bot',async t=>{
  let config={funding:'subscription',subscriptionMaxCalls:0,subscriptionMonthlyCalls:3}
  const {store,accounting,identity,authority}=await setup(t,{pricingFor:async()=>config})
  let calls=0;const next=()=>{calls++;return chunks()}
  await assert.rejects(drain(accounting.stream(request(),next,identity)),/MODEL_SUBSCRIPTION_LIMIT/);assert.equal(calls,0)
  config={...config,subscriptionMaxCalls:2,subscriptionMonthlyCalls:1}
  await drain(accounting.stream(request(),next,{...identity,source:'aux'}))
  await assert.rejects(drain(accounting.stream(request(),next,identity)),/MODEL_SUBSCRIPTION_LIMIT/)
  const other=Object.freeze({});authority.register(other,{botId:'bot-b',tools:['model/infer'],modelRoutes:[model]})
  await drain(accounting.stream(request(),next,{...identity,subject:other,botId:'bot-b'}))
  assert.equal(calls,2);assert.equal((await store.modelCalls()).items.length,2)
})
test('model/native: budget denial has no provider or receipt; two calls cannot reserve the same remaining money',async t=>{
  const {store,accounting,identity}=await setup(t,{limits:{dailyLimitUsd:0.0011}})
  let firstStarted,release;const started=new Promise(r=>{firstStarted=r}),gate=new Promise(r=>{release=r});let dispatches=0
  const first=drain(accounting.stream(request(),()=> (async function*(){dispatches++;firstStarted();await gate;yield*chunks()})(),identity))
  await started
  await assert.rejects(drain(accounting.stream(request(),()=>{dispatches++;return chunks()},identity)),/MODEL_WAITING_BUDGET/)
  release();await first
  assert.equal(dispatches,1);assert.equal((await store.modelCalls()).items.length,1)
})
test('model/native: a missing receipt stays unknown and blocks the next budgeted call',async t=>{
  const {store,accounting,identity}=await setup(t);let calls=0
  await drain(accounting.stream(request(),()=>{calls++;return (async function*(){yield {type:'text-delta',text:'no invoice'}})()},identity))
  assert.equal((await store.modelCalls()).items[0].state,'unknown')
  assert.equal(spending((await store.read()).runs).unknownToday,1)
  await assert.rejects(drain(accounting.stream(request(),()=>{calls++;return chunks()},identity)),/MODEL_WAITING_BUDGET/);assert.equal(calls,1)
})
test('model/native: caller closes after partial usage, cleanup stops before cancellation settles and known charges remain',async t=>{
  const {store,accounting,identity}=await setup(t);let cleaned=false
  const stream=accounting.stream(request(),()=> (async function*(){try{yield {type:'usage',usage:{inputTokens:11,outputTokens:0}};await sleep(100)}finally{await sleep(40);cleaned=true}})(),identity)
  for await(const _chunk of stream)break
  assert.equal(cleaned,true);const row=(await store.modelCalls()).items[0];assert.equal(row.outcome,'unknown')
  const state=await store.read(),totals=spending(state.runs);assert.equal(totals.unknownToday,1);close(totals.today,0.000011)
})
test('model/native: revocation aborts a quiet actual provider signal and refuses a late successful return',async t=>{
  const {store,accounting,identity,authority,subject,grant}=await setup(t);let opened,ended=false
  const ready=new Promise(r=>{opened=r}),options=request()
  const work=drain(accounting.stream(options,()=> (async function*(){opened();await new Promise(r=>options.signal.addEventListener('abort',r,{once:true}));await sleep(30);ended=true;yield {type:'finish',reason:{kind:'stop'}}})(),identity))
  const refused=assert.rejects(work,/GRANT_CHANGED/);await ready;authority.replaceGrant(subject,{...grant,tools:[]});await refused
  assert.equal(ended,true);assert.equal((await store.modelCalls()).items[0].usageComplete,false)
})
test('model/native: a frozen caller request is admitted and the lease gates a quiet provider until revocation',async t=>{
  const {store,accounting,identity,authority,subject,grant}=await setup(t)
  // The SDK AgentLoop passes a frozen request whose signal cannot be replaced.
  let opened,returned=false
  const ready=new Promise(r=>{opened=r}),gate=new Promise(r=>{setTimeout(r,10_000)})
  const options=Object.freeze(request())
  const work=drain(accounting.stream(options,()=>(async function*(){
    opened()
    try{await gate}finally{returned=true}
    yield {type:'finish',reason:{kind:'stop'}}
  })(),identity))
  await ready
  authority.replaceGrant(subject,{...grant,tools:[]})
  await assert.rejects(work,/GRANT_CHANGED|MODEL_LEASE_ENDED/)
  const row=(await store.modelCalls()).items[0]
  assert.equal(row.state,'unknown');assert.equal(row.usageComplete,false)
  assert.equal(returned,true,'a gated quiet provider is returned on revocation')
})
test('model/native: subscription unknown tokens remain unknown, dollar spend stays zero and atomic call quota rejects another call',async t=>{
  const {store,accounting,identity}=await setup(t,{pricingFor:async()=>({funding:'subscription',subscriptionMaxCalls:1})})
  await drain(accounting.stream(request(),()=> (async function*(){yield {type:'finish',reason:{kind:'stop'}}})(),identity))
  const state=await store.read();assert.equal(spending(state.runs).today,0)
  const usage=subscriptionUsage(state.runs);assert.equal(usage.today.calls,1);assert.equal(usage.today.inputTokens,null)
  await assert.rejects(drain(accounting.stream(request(),chunks,identity)),/MODEL_SUBSCRIPTION_LIMIT/)
})
test('model/native: a linked MR request writes source evidence but neither a second reservation nor another money run',async t=>{
  const {store,accounting,identity}=await setup(t),manager=createBudgetReservations({state:store})
  const marker={schemaVersion:1,taskId:'task-a',attemptId:'attempt-a',operationId:'operation-a',targetHash:'a'.repeat(64)}
  const run={id:'mr-run',createdAt:Date.now(),status:'running',managedExecution:marker,packages:[],reviews:[]}
  const admitted=await manager.beginExecution({run,packageEstimates:[{id:'direct',estimatedCostUsd:0.1}],dailyLimitUsd:1})
  await manager.checkpointExecution({reservationId:run.id,ownerToken:admitted.ownerToken,run,startedIds:['direct']})
  const options=request();markManagedModelRequest(options,{...marker,botId:'bot-a',runId:run.id,...model})
  await drain(accounting.stream(options,chunks,identity))
  const rows=(await store.modelCalls()).items;assert.equal(rows.length,1);assert.equal(rows[0].source,'mr-api');assert.equal(rows[0].runId,run.id)
  const state=await store.read();assert.equal(state.runs.length,1);assert.equal(Object.keys(state.budgetReservations).length,1)
  await manager.finishExecution({reservationId:run.id,ownerToken:admitted.ownerToken,run:{...run,status:'completed',packages:[{id:'direct',ran:true,billing:'api',costUsd:0.000021,finishedAt:Date.now()}]}})
  close(spending((await store.read()).runs).today,0.000021)
})
test('model/native: copied actor, foreign managed marker and receipt rewrites fail closed',async t=>{
  const {store,accounting,identity}=await setup(t)
  await assert.rejects(drain(accounting.stream(request(),chunks,{...identity,subject:{}})),/UNKNOWN_SUBJECT/)
  // A frozen caller request is admitted: the lease gates the iteration instead of the request
  // signal (see the dedicated frozen-request check). A frozen bound above the allowance cannot
  // be clamped and is admitted too, estimated at the allowance; the daily/monthly budget is the
  // hard limit (decision: usability first).
  await drain(accounting.stream(Object.freeze(request()),chunks,identity))
  await drain(accounting.stream(Object.freeze({...request(),maxTokens:10000}),chunks,identity))
  const options=request();markManagedModelRequest(options,{botId:'other',...model})
  await assert.rejects(drain(accounting.stream(options,chunks,identity)),/MODEL_MANAGED_OWNER_MISMATCH/)
  const row=(await store.modelCalls()).items[0]
  assert.throws(()=>store.recordModelReceipt({...row,botId:'other',sequence:undefined}),/INVALID_TASK_JSON|INVALID_MODEL_RECEIPT/)
  const {sequence,...receipt}=row
  await assert.rejects(store.recordModelReceipt({...receipt,botId:'other'}),/MODEL_RECEIPT_IDENTITY_CONFLICT/)
  await assert.rejects(store.recordModelReceipt({...receipt,usage:{inputTokens:99,outputTokens:99}}),/MODEL_RECEIPT_ALREADY_FINAL/)
})
