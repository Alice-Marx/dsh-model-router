import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {inspectMrTaskEvidence,observeMrTask,createMrReadBackend} from '../packages/orchestration/src/mr-read-backend.mjs'
import {beginExecutionLifecycle,prepareManagedExecution} from '../.dsh-plugin/shared/execution-lifecycle.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {parseTaskReconcile,taskHash} from '../packages/orchestration/src/task-contract.mjs'

const model={provider:'fixture',model:'gpt-test'},pricing={input:1,output:2}
const marker={schemaVersion:1,taskId:'task-a',attemptId:'attempt-a',operationId:'operation-a',targetHash:'a'.repeat(64)}
const reference={kind:'mr-run',runId:'run-a',marker}
const task={...marker,input:{targetHash:marker.targetHash}}
const context={task,reference,model,pricing}
const snapshot=()=>({version:3,historyIncomplete:false,subscriptionUsageIncomplete:false,budgetReservations:{},runs:[{
  id:'run-a',kind:'assign',executionMode:'read-only',createdAt:100,finishedAt:200,status:'completed',managedExecution:{...marker},reviews:[],
  packages:[{id:'direct',...model,status:'succeeded',ok:true,ran:true,channel:'harness-llm',billing:'api',usage:{inputTokens:11,outputTokens:5},pricingSnapshot:{...pricing},costUsd:0.000021,costSource:'usage',finishedAt:200,answer:'fixture result'}],
}]})
async function file(){const parent=resolve('tmp/integration/reconciliation-unit');await mkdir(parent,{recursive:true});return join(await mkdtemp(join(parent,'case-')),'state.json')}

test('reconciliation: wire command cannot supply an outcome, amount, run or proof',()=>{
  assert.deepEqual(parseTaskReconcile({taskId:'task-a',requestKey:'query'}),{taskId:'task-a',requestKey:'query'})
  for(const key of ['outcome','costUsd','runId','evidenceHash','botId'])assert.throws(()=>parseTaskReconcile({taskId:'task-a',requestKey:'query',[key]:'forged'}),/INVALID_TASK_REQUEST/)
})
test('reconciliation: a terminal nonzero API receipt proves only the bound operation and leaves ledger data unchanged',()=>{
  const state=snapshot(),before=structuredClone(state),value=inspectMrTaskEvidence(state,context)
  assert.equal(value.outcome,'succeeded');assert.equal(value.referenceHash,taskHash(reference));assert.match(value.evidenceHash,/^[a-f0-9]{64}$/)
  assert.deepEqual(state,before)
  const item=state.runs[0].packages[0]
  item.pricingSnapshot={...pricing,currency:'USD',provider:model.provider,model:model.model,source:'user',version:null,asOf:null}
  item.fallback={reason:'Configured API-only route'}
  item.status='fallback'
  assert.equal(inspectMrTaskEvidence(state,context).outcome,'succeeded')
})
test('reconciliation: failed and cancelled executions with complete receipts have distinct terminal results',()=>{
  for(const status of ['failed','cancelled']){const state=snapshot();state.runs[0].status=status;Object.assign(state.runs[0].packages[0],{status,ok:false,answer:''});assert.equal(inspectMrTaskEvidence(state,context).outcome,status)}
})
test('reconciliation: missing, incomplete, changed-attempt and active-hold evidence stays unknown',()=>{
  const cases=[s=>{s.runs=[]},s=>{s.historyIncomplete=true},s=>{s.subscriptionUsageIncomplete=true},s=>{s.runs[0].managedExecution.attemptId='old-attempt'},s=>{s.runs[0].status='interrupted'},s=>{s.runs[0].recovery={unreconciled:true}},s=>{s.runs[0].priorAttemptSpending={days:{'2026-10-27':{costUsd:0.1,unknown:1}},months:{}}},s=>{s.budgetReservations['run-a']={id:'run-a',runId:'run-a',ownerToken:'owner',ownerPid:1,status:'active',createdAt:100,updatedAt:100,packages:[{id:'direct',estimatedCostUsd:0.1,started:true,billing:'api'}],completedIds:[]}}]
  for(const change of cases){const state=snapshot();change(state);assert.equal(inspectMrTaskEvidence(state,context).outcome,'unknown')}
  assert.equal(inspectMrTaskEvidence(snapshot(),{...context,reference:null}).reason,'EXECUTION_REFERENCE_MISSING')
  assert.equal(inspectMrTaskEvidence(snapshot(),{...context,reference:{...reference,marker:{}}}).reason,'EXECUTION_REFERENCE_MISMATCH')
})
test('reconciliation: absent/contradictory prices, receipts, route, execution mode and textual success cannot settle a task',()=>{
  const changes=[i=>{i.costUsd=null},i=>{i.costUsd=0},i=>{i.usageIncomplete=true},i=>{i.inFlight=true},i=>{i.model='another'},i=>{i.billing='subscription'},i=>{i.channel='official-cli'},i=>{i.pricingSnapshot.input=2},i=>{i.ran=false},i=>{i.answer=''},i=>{i.usage.outputTokens=-1}]
  for(const change of changes){const state=snapshot();change(state.runs[0].packages[0]);assert.equal(inspectMrTaskEvidence(state,context).outcome,'unknown')}
  const state=snapshot();state.runs[0].executionMode='workspace-write';assert.equal(inspectMrTaskEvidence(state,context).outcome,'unknown')
})
test('reconciliation: a malformed/missing source is observed without repair or file replacement',async()=>{
  const path=await file();await writeFile(path,'{broken source')
  assert.equal((await observeMrTask(path,context)).outcome,'unknown');assert.equal(await readFile(path,'utf8'),'{broken source')
  assert.equal((await observeMrTask(path+'-missing',context)).reason,'LEDGER_MISSING')
  await writeFile(path,JSON.stringify(snapshot()));assert.equal((await observeMrTask(path,context)).outcome,'succeeded')
})
test('managed admission: failing the durable link refuses a legacy reservation before execution can start',async()=>{
  const state=createRouterState({file:await file()})
  const {schemaVersion,...binding}=marker
  await assert.rejects(beginExecutionLifecycle({state,buildRun:()=>({id:'run-a',packages:[]}),packageEstimates:[],managedExecution:{binding,onPrepared:()=>{throw new Error('durable link unavailable')}}}),/durable link unavailable/)
  const saved=await state.read();assert.equal(saved.runs.length,0);assert.deepEqual(saved.budgetReservations,{})
})
test('managed admission: bindings are captured before awaiting and stamp initial, checkpoint and final records',async()=>{
  const state=createRouterState({file:await file()}),{schemaVersion,...binding}=marker
  let observed
  const lifecycle=await beginExecutionLifecycle({state,buildRun:({status,results})=>({id:'run-a',createdAt:100,finishedAt:200,status,packages:results}),packageEstimates:[],managedExecution:{binding,onPrepared:async ref=>{observed=ref;binding.attemptId='forged-after-admission';assert.equal((await state.read()).runs.length,0)}}})
  assert.deepEqual(observed,reference);assert.deepEqual((await state.read()).runs[0].managedExecution,marker)
  const final={id:'run-a',createdAt:100,finishedAt:200,status:'completed',packages:[]};await lifecycle.finish(final)
  assert.deepEqual((await state.read()).runs[0].managedExecution,marker)
  assert.throws(()=>prepareManagedExecution({binding:{...binding,outcome:'succeeded'},onPrepared:()=>{}}),/INVALID_MANAGED_EXECUTION/)
})
test('managed backend: execution target revision changes when trusted workspace/model/pricing/budget changes',async()=>{
  const base={ctx:{},mr:{},model,workspace:resolve('tmp/integration/workspace-a'),machineId:'machine',workspaceId:'workspace',pricing}
  const first=createMrReadBackend(base)
  for(const patch of [{workspace:resolve('tmp/integration/workspace-b')},{model:{...model,model:'gpt-other'}},{pricing:{input:2,output:2}},{dailyBudgetUsd:2}])assert.notEqual(createMrReadBackend({...base,...patch}).version,first.version)
  assert.throws(()=>first.parse({task:'x',model:'override'}),/INVALID_TASK_INPUT/)
  assert.throws(()=>createMrReadBackend({...base,workspace:'relative'}),/INVALID_MR_BACKEND_CONFIGURATION/)
  let calls=0
  const paused=createMrReadBackend({...base,mr:{routerStateStore:()=>({read:async()=>({runs:[]})}),executeConfiguredAssignment:async()=>{calls++;return {paused:true}}}})
  const args={input:{task:'fixture'},signal:new AbortController().signal,binding:{taskId:'task-a',attemptId:'attempt-a'},operationId:'operation-a',targetHash:'a'.repeat(64),attemptNumber:1,legacyRunIds:[],checkpoint:()=>{}}
  assert.equal((await paused.run(args)).outcome,'waiting-budget')
  assert.equal((await paused.run({...args,attemptNumber:2,legacyRunIds:['allocated-but-not-admitted'],previous:{state:'waiting-budget'}})).outcome,'waiting-budget');assert.equal(calls,2)
  let dispatches=0,checks=0
  const guarded=createMrReadBackend({...base,ctx:{llm:{stream:()=>{dispatches++}}},mr:{executeConfiguredAssignment:async(ctx,_task,_settings,options)=>{await options.managedExecution.onPrepared(reference);ctx.llm.stream({});return {paused:true}}}})
  assert.equal((await guarded.run({...args,beforeRequest:()=>{checks++;throw new Error('runner fenced')}})).outcome,'unknown')
  assert.equal(checks,1);assert.equal(dispatches,0)
})
