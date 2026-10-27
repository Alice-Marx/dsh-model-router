import {createHash} from 'node:crypto'
import {open} from 'node:fs/promises'
import {isAbsolute} from 'node:path'
import {actualCost} from '../../../.dsh-plugin/shared/run-ledger.mjs'
import {inspectRouterState} from '../../../.dsh-plugin/shared/router-state.mjs'
import {canonicalTaskJson,taskHash} from './task-contract.mjs'

const digest=value=>createHash('sha256').update(value).digest('hex')
const unknown=reason=>({outcome:'unknown',reason})
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0
const same=(left,right)=>{try{return taskHash(left)===taskHash(right)}catch{return false}}
const rates=value=>Object.fromEntries(['input','output','cacheRead','cacheWrite'].filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]))

/** Only this fixed single-package API backend's terminal evidence is accepted. */
export function inspectMrTaskEvidence(raw,{task,reference,model,pricing}) {
  if(!reference||reference.kind!=='mr-run')return unknown('EXECUTION_REFERENCE_MISSING')
  const marker={schemaVersion:1,taskId:task.taskId,attemptId:task.attemptId,operationId:task.operationId,targetHash:task.input.targetHash}
  if(!same(reference.marker,marker))return unknown('EXECUTION_REFERENCE_MISMATCH')
  let state
  try{state=inspectRouterState(raw)}catch{return unknown('LEDGER_INVALID')}
  if(state.historyIncomplete||state.subscriptionUsageIncomplete)return unknown('LEDGER_INCOMPLETE')
  if(Object.hasOwn(state.budgetReservations,reference.runId))return unknown('RESERVATION_UNRECONCILED')
  const run=state.runs.find(row=>row.id===reference.runId)
  if(!run)return unknown('RUN_RECORD_MISSING')
  if(!run.managedExecution||!same(run.managedExecution,marker))return unknown('RUN_ATTEMPT_MISMATCH')
  if(['days','months'].some(period=>Object.values(run.priorAttemptSpending?.[period]??{}).some(row=>row.unknown>0)))return unknown('PRIOR_RECEIPTS_UNRECONCILED')
  if(run.kind!=='assign'||run.executionMode!=='read-only'||run.packages?.length!==1||!Array.isArray(run.reviews)||run.reviews.length)return unknown('EXECUTION_SHAPE_UNSUPPORTED')
  if(!['completed','failed','cancelled'].includes(run.status)||run.recovery?.unreconciled||!amount(run.finishedAt)||run.finishedAt<run.createdAt)return unknown('EXECUTION_NOT_TERMINAL')
  const item=run.packages[0]
  const routeNotice=item.fallback&&typeof item.fallback.reason==='string'&&Object.keys(item.fallback).every(key=>key==='reason')
  if(item.provider!==model.provider||item.model!==model.model||item.inFlight||item.usageIncomplete||item.paused||item.waiting||item.qualityAttempts||item.subscriptionAttempts||item.fallback&&!routeNotice
    ||!['succeeded',...(routeNotice?['fallback']:[]),'failed','cancelled','blocked'].includes(item.status))return unknown('RECEIPT_NOT_VERIFIABLE')
  if(item.ran===true){
    if(item.channel!=='harness-llm'||item.billing!=='api'||!amount(item.costUsd)||!amount(item.finishedAt))return unknown('RECEIPT_INCOMPLETE')
    const calculated=actualCost(item,item.pricingSnapshot)
    if(!amount(calculated.costUsd)||Math.abs(calculated.costUsd-item.costUsd)>1e-12||!same(rates(item.pricingSnapshot),rates(pricing))
      ||item.pricingSnapshot.currency&&item.pricingSnapshot.currency!=='USD'
      ||item.pricingSnapshot.provider&&item.pricingSnapshot.provider!==model.provider||item.pricingSnapshot.model&&item.pricingSnapshot.model!==model.model)return unknown('RECEIPT_AMOUNT_UNVERIFIED')
  }else if(item.ran!==false||item.ok===true||item.costSource!=='not-run'||item.costUsd!==null||item.usage&&Object.values(item.usage).some(value=>value!==0))return unknown('NOT_STARTED_UNVERIFIED')
  if(run.status==='completed'&&(item.ok!==true||!['succeeded',...(routeNotice?['fallback']:[])].includes(item.status)||!item.answer?.trim()))return unknown('RESULT_NOT_VERIFIED')
  if(run.status!=='completed'&&item.ok===true)return unknown('RESULT_NOT_VERIFIED')
  return {outcome:run.status==='completed'?'succeeded':run.status,referenceHash:taskHash(reference),evidenceHash:digest(JSON.stringify({run,historyIncomplete:false,subscriptionUsageIncomplete:false,reservation:null})),reason:'MR_TERMINAL_RECEIPT_VERIFIED'}
}

/** A bounded read of the original ledger; never repairs it or releases its holds. */
export async function observeMrTask(file,context,signal) {
  let handle
  try{
    signal?.throwIfAborted();handle=await open(file,'r')
    const stat=await handle.stat(),max=32*1024*1024
    if(!stat.isFile()||stat.size>max)return unknown('LEDGER_INPUT_LIMIT')
    const bytes=Buffer.alloc(stat.size+1);let count=0
    while(count<bytes.length){signal?.throwIfAborted();const read=await handle.read(bytes,count,bytes.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead}
    if(count!==stat.size)return unknown('LEDGER_CHANGED_OR_OVERSIZED')
    signal?.throwIfAborted()
    return inspectMrTaskEvidence(JSON.parse(bytes.subarray(0,count).toString('utf8')),context)
  }catch(error){if(signal?.aborted)throw signal.reason;return unknown(error.code==='ENOENT'?'LEDGER_MISSING':'LEDGER_UNREADABLE')}
  finally{await handle?.close()}
}

export async function observeMrTaskStore(store,context,signal) {
  if(store.kind!=='sqlite-router-state')return observeMrTask(store.file,context,signal)
  try{signal?.throwIfAborted();const state=await store.read();signal?.throwIfAborted();return inspectMrTaskEvidence(state,context)}
  catch(e){if(signal?.aborted)throw signal.reason;return unknown('LEDGER_UNREADABLE')}
}

/** Host-configured API-only adapter; no executable, route or workspace comes from Task input. */
export function createMrReadBackend({ctx,mr,model,workspace,machineId,workspaceId,pricing,dailyBudgetUsd=1}) {
  model=JSON.parse(canonicalTaskJson(model));pricing=JSON.parse(canonicalTaskJson(pricing))
  if(!isAbsolute(workspace)||!model||Object.keys(model).some(key=>!['provider','model'].includes(key))||['provider','model'].some(key=>typeof model[key]!=='string'||!model[key]||model[key].length>256)
    ||!pricing||['input','output'].some(key=>!amount(pricing[key]))||Object.keys(pricing).some(key=>!['input','output','cacheRead','cacheWrite'].includes(key)||!amount(pricing[key]))||!amount(dailyBudgetUsd))throw new Error('INVALID_MR_BACKEND_CONFIGURATION')
  const settings={dynamicDataEnabled:false,reviewMode:'off',dailyBudgetUsd,modelProfilesJson:JSON.stringify([{...model,quality:95,execution:'api',billing:'api-only',subscription:'none',pricing}])}
  const backend={id:'mr-api',version:`mr-read-v2-${taskHash({model,workspace,machineId,workspaceId,pricing,dailyBudgetUsd}).slice(0,24)}`,effect:'read',machineId,workspaceId,location:'local',capability:'execution/mr-api',retryCapability:'execution/mr-retry',reconcileCapability:'execution/mr-observe',model,
    parse(input){
      const v=JSON.parse(canonicalTaskJson(input))
      if(!v||Object.keys(v).length!==1||typeof v.task!=='string'||!v.task.trim()||v.task.length>2000)throw new Error('INVALID_TASK_INPUT')
      return v
    },
    async run({input,signal,binding,operationId,targetHash,attemptNumber,legacyRunIds,previous:previousAttempt,checkpoint,beforeRequest}) {
      let reference
      const managedExecution={binding:{taskId:binding.taskId,attemptId:binding.attemptId,operationId,targetHash},onPrepared:ref=>{checkpoint(ref);reference=ref}}
      const options={...model,workspace,signal,billing:false,skipToolProbe:true,installedToolIds:[],runnableToolIds:[],skipOfficial:()=> 'Managed read-only API backend',managedExecution}
      const executionCtx=Object.create(ctx)
      Object.defineProperty(executionCtx,'llm',{value:new Proxy(ctx.llm??{}, {get(target,key){
        if(key==='stream')return request=>{if(!reference)throw new Error('MANAGED_ADMISSION_REQUIRED');beforeRequest();return target.stream(request)}
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
      }})})
      try{
        let value
        if(attemptNumber===1||!legacyRunIds.length)value=await mr.executeConfiguredAssignment(executionCtx,input.task,settings,options)
        else{
          const previous=(await mr.routerStateStore().read()).runs.find(row=>row.id===legacyRunIds.at(-1))
          const item=previous?.packages.find(row=>row.ok!==true)
          if(!previous&&previousAttempt?.state==='waiting-budget')value=await mr.executeConfiguredAssignment(executionCtx,input.task,settings,options)
          else{
            if(!item||previous.kind!=='assign'||previous.executionMode!=='read-only'||previous.packages.length!==1||previous.packages.some(row=>row.manualAssignment&&row.manualAssignment.kind!=='api'))throw new Error('NO_RECORDED_FAILED_API_PACKAGE')
            value=await mr.rerunRecordedStep(executionCtx,settings,{...options,runId:previous.id,packageId:item.id})
          }
        }
        if(value.paused)return {outcome:'waiting-budget',summary:{code:'MR_WAITING_BUDGET',notStarted:true}}
        const task={taskId:binding.taskId,attemptId:binding.attemptId,operationId,input:{targetHash}}
        const verdict=value.stored===false?unknown('MR_SAVE_UNCONFIRMED'):await observeMrTaskStore(mr.routerStateStore(),{task,reference,model,pricing})
        return {outcome:verdict.outcome,...(reference?{legacyRunId:reference.runId}:{}),summary:{code:verdict.reason}}
      }catch(error){return {outcome:reference?'unknown':signal.aborted?'cancelled':'failed',...(reference?{legacyRunId:reference.runId}:{}),summary:{code:reference?'MR_OUTCOME_UNCONFIRMED':'MR_NOT_ADMITTED'}}}
    },
    reconcile:({task,reference,signal})=>observeMrTaskStore(mr.routerStateStore(),{task,reference,model,pricing},signal),
  }
  return Object.freeze(backend)
}
