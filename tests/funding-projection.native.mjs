import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import Database from 'better-sqlite3'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {archiveSpending,spending} from '../.dsh-plugin/shared/run-ledger.mjs'
import {normalizeModelReceipt,modelReceiptIdentity} from '../packages/orchestration/src/model-receipt.mjs'
import {taskHash} from '../packages/orchestration/src/task-contract.mjs'

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} vs ${expected}`)
function run(id,cost,botId='bot-a',scope='account-a'){
  const now=Date.now()
  return{id,createdAt:now,finishedAt:now,status:'completed',...(botId?{modelCall:{botId,...(scope?{fundingScopeId:scope}:{})}}:{}),packages:[{id:'direct',ran:true,billing:'api',status:'succeeded',costUsd:cost,finishedAt:now}],reviews:[]}
}
async function fixture(t,options={}){
  await mkdir(resolve('tmp/integration/funding-projection'),{recursive:true});const dir=await mkdtemp(resolve('tmp/integration/funding-projection/case-'))
  const legacyFile=join(dir,'state.json'),file=join(dir,'ledger.sqlite'),json=createRouterState({file:legacyFile})
  if(options.initial)await json.update(state=>{Object.assign(state,options.initial)})
  else await json.saveHealth(null)
  const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1,maxRuns:options.maxRuns??200})
  t.after(()=>store.close());return{store,file,legacyFile}
}
test('funding/native: per-Bot and shared-account totals are derived from the original invoice exactly once after pruning',async t=>{
  const f=await fixture(t,{maxRuns:1});await f.store.appendRun(run('a',0.2));await f.store.appendRun(run('b',0.3,'bot-b'));await f.store.appendRun(run('c',0.4,'bot-a','account-b'))
  assert.equal((await f.store.read()).runs.length,1)
  close(f.store.fundingTotals({botId:'bot-a',includeUnassigned:false}).today,0.6)
  close(f.store.fundingTotals({scopeId:'account-a',includeUnassigned:false}).today,0.5)
  close(f.store.fundingTotals({scopeId:'account-b',includeUnassigned:false}).today,0.4)
  const state=await f.store.read();close(spending(state.runs,Date.now(),state.archivedSpending).today,0.9)
  close(f.store.fundingTotals({}).today,0.9)
})
test('funding/native: a revised live invoice replaces its contribution; archived run replay is refused without changing money',async t=>{
  const f=await fixture(t,{maxRuns:1});await f.store.appendRun(run('a',0.2));await f.store.updateRun('a',r=>{r.packages[0].costUsd=0.5})
  close(f.store.fundingTotals({botId:'bot-a'}).today,0.5)
  await f.store.appendRun(run('b',0.1));const before=JSON.stringify(await f.store.read())
  await assert.rejects(f.store.appendRun(run('a',0.5)),/ROUTER_ARCHIVED_RUN_REPLAY/)
  assert.equal(JSON.stringify(await f.store.read()),before);close(f.store.fundingTotals({botId:'bot-a'}).today,0.6)
})
test('funding/native: unassigned legacy history and archive remain visible and conservatively occupy every limited scope',async t=>{
  const previous=run('legacy-archived',0.4,null),current=run('legacy-current',0.2,null)
  const f=await fixture(t,{initial:{runs:[current],archivedSpending:archiveSpending([previous])},maxRuns:1})
  await f.store.appendRun(run('owned',0.1))
  const value=f.store.fundingTotals({botId:'bot-a',scopeId:'account-a'})
  close(value.today,0.7);close(value.unassigned.today,0.6)
  close(f.store.fundingTotals({botId:'bot-a',scopeId:'account-a',includeUnassigned:false}).today,0.1)
  const reopened=await openSqliteRouterState({Database,file:f.file,legacyFile:f.legacyFile,lockStaleMs:1,maxRuns:1})
  try{close(reopened.fundingTotals({}).today,0.7)}finally{await reopened.close()}
})
test('funding/native: missing amount stays unknown and subscription reference prices do not become API charges',async t=>{
  const f=await fixture(t),unknown=run('unknown',null)
  unknown.packages[0].knownCostUsd=0.03;await f.store.appendRun(unknown)
  const subscription=run('subscription',0);subscription.packages[0]={...subscription.packages[0],billing:'subscription',referenceCostUsd:9};await f.store.appendRun(subscription)
  const value=f.store.fundingTotals({botId:'bot-a'});close(value.today,0.03);assert.equal(value.unknownToday,1);assert.equal(value.subscriptionRunsToday,1);assert.equal(value.subscriptionToday,9)
})
test('funding/native: owner/scope changes and corrupted projection data fail closed instead of crediting a different wallet',async t=>{
  const f=await fixture(t);await f.store.appendRun(run('owned',0.1))
  await assert.rejects(f.store.updateRun('owned',r=>{r.modelCall={botId:'other',fundingScopeId:'account-a'}}),/FUNDING_RUN_IDENTITY_CONFLICT/)
  await assert.rejects(f.store.updateRun('owned',r=>{r.modelCall={botId:'bot-a',fundingScopeId:'other'}}),/FUNDING_RUN_IDENTITY_CONFLICT/)
  const db=new Database(f.file);db.prepare("UPDATE router_funding_runs SET payload='{}' WHERE run_id='owned'").run();db.close()
  assert.throws(()=>f.store.fundingTotals({botId:'bot-a'}),/FUNDING_PROJECTION_CORRUPT/)
})
test('funding/native: scope is immutable when present, while old v1 receipts keep their original identity',()=>{
  const receipt={schemaVersion:1,id:'receipt',runId:'run',packageId:'p',botId:'bot',sessionId:null,taskId:null,attemptId:'a',operationId:'o',source:'bot',provider:'fixture',model:'gpt-exact',funding:'api',pricing:{input:1,output:2},requestHash:'a'.repeat(64),createdAt:1,ownerPid:1,state:'admitted',finishedAt:null,usage:null,usageComplete:false,actualModel:null,reportedCostUsd:null,finishKind:null,outcome:null}
  assert.deepEqual(normalizeModelReceipt(receipt),receipt)
  const oldKeys=['schemaVersion','id','runId','packageId','botId','sessionId','taskId','attemptId','operationId','source','provider','model','funding','pricing','requestHash','createdAt','ownerPid']
  assert.equal(modelReceiptIdentity(receipt),taskHash(Object.fromEntries(oldKeys.map(key=>[key,receipt[key]]))))
  assert.notEqual(modelReceiptIdentity({...receipt,fundingScopeId:'account'}),modelReceiptIdentity(receipt))
})

test('funding/native: subscription quotas retain uninstrumented history and count a sourced package once after pruning and reopening',async t=>{
  const f=await fixture(t,{maxRuns:1}),subscription=id=>{
    const value=run(id,0);value.packages[0]={...value.packages[0],billing:'subscription'};return value
  }
  await f.store.appendRun(subscription('legacy-subscription'))
  const value=subscription('sourced-subscription'),receipt={schemaVersion:1,id:'sub-receipt',runId:value.id,packageId:'direct',botId:'bot-a',fundingScopeId:'account-a',sessionId:null,taskId:null,attemptId:'a',operationId:'o',source:'aux',provider:'fixture',model:'gpt-exact',funding:'subscription',pricing:null,requestHash:'a'.repeat(64),createdAt:Date.now(),ownerPid:process.pid,state:'admitted',finishedAt:null,usage:null,usageComplete:false,actualModel:null,reportedCostUsd:null,finishKind:null,outcome:null}
  await f.store.recordModelReceipt(receipt)
  await f.store.appendRun(value)
  await f.store.recordModelReceipt({...receipt,state:'settled',finishedAt:Date.now(),finishKind:'stop',outcome:'succeeded'})
  await f.store.appendRun(run('prune',0))
  const count=f.store.fundingSubscriptionUsage({botId:'bot-a',scopeId:'account-a'})
  assert.deepEqual(count.today,{calls:2,sourceCalls:1,legacyCalls:1});assert.deepEqual(count.month,count.today)
  assert.equal(f.store.fundingSubscriptionUsage({botId:'bot-b',scopeId:'account-a'}).today.calls,0)
  const reopened=await openSqliteRouterState({Database,file:f.file,legacyFile:f.legacyFile,lockStaleMs:1,maxRuns:1})
  try{assert.deepEqual(reopened.fundingSubscriptionUsage({botId:'bot-a'}).today,count.today)}finally{await reopened.close()}
})

test('funding/native: unattributed archived subscription quantities consume quota without inventing Bot ownership',async t=>{
  const previous=run('archived-subscription',0,null);previous.packages[0].billing='subscription'
  const f=await fixture(t,{initial:{archivedSpending:archiveSpending([previous])}})
  assert.equal(f.store.fundingSubscriptionUsage({botId:'bot-a'}).today.calls,1)
  assert.equal(f.store.fundingSubscriptionUsage({botId:'bot-b',scopeId:'account-b'}).today.calls,1)
})
