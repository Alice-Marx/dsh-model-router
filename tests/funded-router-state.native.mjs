import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'
import {createBotPolicy} from '../packages/orchestration/src/bot-policy.mjs'
import {createModelAccounting} from '../packages/orchestration/src/model-accounting.mjs'
import {createFundedRouterState} from '../packages/orchestration/src/funded-router-state.mjs'
import {createDeferredRouterState} from '../packages/orchestration/src/deferred-router-state.mjs'
import {openProductFunding} from '../packages/orchestration/src/product-funding.mjs'
import {beginExecutionLifecycle} from '../.dsh-plugin/shared/execution-lifecycle.mjs'
import {spending} from '../.dsh-plugin/shared/run-ledger.mjs'

const route={provider:'fixture',model:'gpt-bound'},pricing={input:1,output:2}
const config={route,funding:'api',scopeId:'account-shared',projectId:'project-a',pricing,maxInputTokens:1000,maxOutputTokens:100,botDailyLimitUsd:1,accountDailyLimitUsd:1,projectMonthlyLimitUsd:1}
const chunks=async function*(){yield{type:'text-delta',text:'controlled provider'};yield{type:'usage',usage:{inputTokens:11,outputTokens:5}};yield{type:'finish',reason:{kind:'stop'}}}
const drain=async stream=>{for await(const _ of stream){}}
async function fixture(t,overrides={}){
  await mkdir(resolve('tmp/integration/funded-router'),{recursive:true});const dir=await mkdtemp(resolve('tmp/integration/funded-router/case-'))
  const file=join(dir,'ledger.sqlite'),legacyFile=join(dir,'state.json');await createRouterState({file:legacyFile}).saveHealth(null)
  const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1})
  const authority=createAuthority(),directory=createPrincipalDirectory(authority),agents={}
  for(const id of ['bot-a','bot-b']){directory.register(id,{tools:['model/infer','tool/model_router_consult'],modelRoutes:[route]});agents[id]={session:{id:`session-${id}`}};directory.bind(id,agents[id])}
  const policy=createBotPolicy({authority,directory,machineId:'fixture',workspaceId:'fixture'}),pricingFor=async()=>({...config,...overrides})
  const funding=createFundedRouterState({store,policy,authority,pricingFor}),accounting=createModelAccounting({store,authority,pricingFor,inputBoundFor:async()=>1000,machineId:'fixture',workspaceId:'fixture'})
  let dispatches=0
  const ctx={get:name=>name==='botFunding'?funding:undefined,llm:{stream:options=>policy.modelStream(options,()=>{
    funding.bindModelRequest(options)
    return accounting.stream(options,()=>{dispatches++;return chunks()},{...policy.modelIdentity(options),source:'aux'})
  })}}
  // The immutable state authority lives in the shared router core. Each fixture
  // needs a fresh core instance, rather than a fresh full-product wrapper.
  const mr=await import(`../.dsh-plugin/router-core.mjs?funding-native=${randomUUID()}`);mr.installRouterStateStore(funding.state)
  t.after(async()=>{await accounting.close();await store.close();authority.dispose()})
  return{store,funding,accounting,authority,policy,agents,ctx,mr,dispatches:()=>dispatches,call:(id,operation)=>policy.run({kind:'tool',name:'model_router_consult',agent:agents[id]},operation)}
}

test('funded MR/native: actual consult keeps one MR hold/invoice and a linked source receipt with the bound price',async t=>{
  const f=await fixture(t)
  const result=await f.call('bot-a',signal=>f.mr.executeBudgetedConsult(f.ctx,{...route,pricing:{input:999,output:999}},'controlled opinion',{}, {signal}))
  assert.equal(result.ok,true);assert.equal(f.dispatches(),1)
  const state=await f.store.read(),rows=(await f.store.modelCalls()).items
  assert.equal(state.runs.length,1);assert.deepEqual(state.budgetReservations,{})
  assert.equal(rows.length,1);assert.equal(rows[0].source,'mr-api');assert.equal(rows[0].runId,result.runId);assert.equal(rows[0].packageId,'direct')
  assert.equal(rows[0].fundingScopeId,'account-shared');assert.deepEqual(rows[0].pricing,pricing)
  assert.ok(Math.abs(spending(state.runs).today-0.000021)<1e-12)
  assert.ok(Math.abs(f.store.fundingTotals({botId:'bot-a'}).today-0.000021)<1e-12)
})

test('funded MR/native: owner budget confirmation cannot override a Bot zero cap',async t=>{
  const f=await fixture(t,{botDailyLimitUsd:0})
  const result=await f.call('bot-a',signal=>f.mr.executeBudgetedConsult(f.ctx,route,'controlled opinion',{}, {signal,confirmOverBudget:true}))
  assert.equal(result.paused,true);assert.equal(f.dispatches(),0);assert.equal((await f.store.modelCalls()).items.length,0)
  assert.deepEqual((await f.store.read()).budgetReservations,{})
})

test('funded MR/native: another Bot cannot reserve the same shared funds and a started package is required to link',async t=>{
  const f=await fixture(t,{accountDailyLimitUsd:0.00121}),make=id=>({id,createdAt:Date.now(),status:'running',packages:[],reviews:[]})
  let entered,release;const ready=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r})
  const first=f.call('bot-a',async()=>{
    const lifecycle=await beginExecutionLifecycle({state:f.funding.state,buildRun:()=>make('held'),packageEstimates:[{id:'direct',estimatedCostUsd:0.000001}]})
    assert.equal(lifecycle.accepted,true)
    assert.throws(()=>f.funding.bindModelRequest({...route}),/FINANCIAL_PACKAGE_NOT_STARTED/)
    entered();await gate;await lifecycle.finish({...make('held'),status:'completed',finishedAt:Date.now()})
  })
  await ready
  const second=await f.call('bot-b',()=>beginExecutionLifecycle({state:f.funding.state,buildRun:()=>make('blocked'),packageEstimates:[{id:'direct',estimatedCostUsd:0.000001}]}))
  assert.equal(second.accepted,false);assert.equal(second.reason,'account-daily-limit')
  release();await first;assert.equal(f.dispatches(),0)
})

test('funded MR/native: DS auxiliary calls retain their own invoice even inside an admitted MR frame',async t=>{
  const f=await fixture(t),make=()=>({id:'mr-holder',createdAt:Date.now(),status:'running',packages:[],reviews:[]})
  await f.call('bot-a',async()=>{
    const lifecycle=await beginExecutionLifecycle({state:f.funding.state,buildRun:make,packageEstimates:[{id:'direct',estimatedCostUsd:0.001}]})
    await lifecycle.onCheckpointStart({id:'direct'})
    const request={...route,messages:[{role:'user',content:'auxiliary fixture'}],maxTokens:20}
    assert.equal(f.funding.bindModelRequest(request,{ownRequest:true}),false)
    await drain(f.accounting.stream(request,chunks,{...f.policy.modelIdentity(request),source:'aux'}))
    await lifecycle.finish({...make(),status:'completed',finishedAt:Date.now()})
    assert.equal(f.policy.financialRunActive(),false)
  })
  const rows=(await f.store.modelCalls()).items;assert.equal(rows[0].source,'aux');assert.notEqual(rows[0].runId,'mr-holder')
  assert.equal((await f.store.read()).runs.length,2)
})

test('product funding/native: deferred facade waits for migration, delegates the complete store and closes it',async t=>{
  await mkdir(resolve('tmp/integration/funded-router'),{recursive:true});const dir=await mkdtemp(resolve('tmp/integration/funded-router/deferred-'))
  const file=join(dir,'ledger.sqlite'),legacyFile=join(dir,'state.json')
  await createRouterState({file:legacyFile}).completeOnboarding(12345)
  const deferred=createDeferredRouterState({file}),state=deferred.state
  let settled=false
  const early=state.read().then(value=>{settled=true;return value})
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(settled,false)
  assert.throws(()=>state.fundingTotals({}),{code:'FINANCIAL_AUTHORITY_STARTING'})
  const funding=await openProductFunding({Database,file,legacyFile,policy:{activeIdentity:()=>null},pricingFor:async()=>null})
  t.after(async()=>{await funding.close()})
  deferred.resolve(funding.state)
  assert.equal((await early).onboarding.completedAt,12345)
  assert.equal((await state.read()).onboarding.completedAt,12345)
  assert.equal(await state.prepareExecutionFunding({packageEstimates:[]}),null)
  for(const method of ['read','update','completeOnboarding','saveHealth','saveQuota','saveAuthFailure','appendTerminalSession','appendRun','updateRun','dismissNotice','modelCalls','modelCall','recordModelReceipt','rollback','prepareExecutionFunding','close','status','fundingTotals','fundingIdentity','fundingExecution','fundingSubscriptionUsage','countModelCalls'])assert.equal(typeof state[method],'function',method)
  assert.equal(state.status().phase,'active')
  await state.close()
  await assert.rejects(state.read(),{code:'ROUTER_STORE_CLOSED'})
  assert.throws(()=>state.fundingTotals({}),{code:'ROUTER_STORE_CLOSED'})
})
