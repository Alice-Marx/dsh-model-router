import {createHash} from 'node:crypto'
import {createCodexSession,pinCodexExecutable} from '../../cli-runtime/src/codex-runtime.mjs'
import {createBudgetReservations} from '../../../.dsh-plugin/shared/budget-reservations.mjs'
import {taskRef,taskHash,canonicalTaskJson} from './task-contract.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const usageOf=value=>{
  const input=value?.inputTokens,output=value?.outputTokens,cached=value?.cachedInputTokens,write=value?.cacheWriteInputTokens
  const count=n=>Number.isSafeInteger(n)&&n>=0
  // Codex input is inclusive of the cached input component; the MR ledger stores disjoint counts.
  if(!count(input)||!count(output)||cached!==null&&cached!==undefined&&!count(cached)||write!==null&&write!==undefined&&!count(write)||count(cached)&&cached>input)return {usage:null,complete:false}
  return {usage:{inputTokens:count(cached)?input-cached:input,outputTokens:output,...(count(cached)?{cacheReadTokens:cached}:{}),...(count(write)?{cacheWriteTokens:write}:{})},complete:true}
}
const terminal=new Set(['succeeded','failed','cancelled'])

/** Task-owned, single-attempt CLI execution. The shared SQLite MR ledger owns all money. */
export function createCliExecution({store,authority,directory,entry,runtimeRoot,workspace,machineId,workspaceId,model,requestedModel,
  billing,pricing=null,estimatedCostUsd=null,dailyLimitUsd=1,monthlyLimitUsd=0,subscriptionMaxCalls=null,deadlineMs=120000,
  tools=[],handlers=[],provisionCredentials,providerConfig,roleInstructions,sessionFactory=createCodexSession,now=Date.now,
  location='local',referenceExtra=null,remoteProbe=null,stopSource='native-tree',snapshotValid=null,recover=null}){
  entry=Object.freeze(structuredClone(entry));model=Object.freeze(structuredClone(model));pricing=pricing?Object.freeze(structuredClone(pricing)):null
  providerConfig=providerConfig?Object.freeze(structuredClone(providerConfig)):undefined;tools=Object.freeze([...tools])
  if(store?.kind!=='sqlite-router-state'||typeof store.modelCall!=='function'||!['api','subscription'].includes(billing))fail('CLI_FINANCIAL_AUTHORITY_REQUIRED')
  if(!/^gpt-[A-Za-z0-9_.-]+$/.test(requestedModel)||!model?.provider||!model?.model)fail('CLI_MODEL_BINDING_REQUIRED')
  if(billing==='api'&&(!Number.isFinite(estimatedCostUsd)||estimatedCostUsd<0))fail('CLI_ESTIMATE_REQUIRED')
  if(billing==='subscription'&&(!Number.isSafeInteger(subscriptionMaxCalls)||subscriptionMaxCalls<1))fail('CLI_SUBSCRIPTION_QUOTA_REQUIRED')
  if(!['local','remote'].includes(location)||location==='remote'&&(!referenceExtra||typeof remoteProbe!=='function'||typeof snapshotValid!=='function'))fail('CLI_TARGET_MISMATCH')
  const active=new Map(),finished=new Map();let closed=false
  const assert=(subject,capability='cli/codex')=>{authority.assertTool(subject,capability);authority.assertModel(subject,model.provider,model.model);return authority.describe(subject).botId}
  const refFor=({binding,operationId,targetHash})=>({kind:'cli-run',runId:`cli-${taskRef(operationId)}`,...(referenceExtra?{remote:structuredClone(referenceExtra)}:{}),marker:{schemaVersion:1,taskId:binding.taskId,attemptId:binding.attemptId,operationId,targetHash}})
  const proofFor=(source,reference,evidence)=>({schemaVersion:1,source,...reference.marker,referenceHash:taskHash(reference),evidenceHash:taskHash(evidence)})
  const verifiedStop=(run,receipt,reference)=>{
    const proof=run.cliExecution?.stopProof,marker=reference.marker,source=run.cliExecution?.stopEvidence
    return Boolean(receipt&&receipt.state==='settled'&&terminal.has(receipt.outcome)&&receipt.runId===run.id&&receipt.taskId===marker.taskId&&receipt.attemptId===marker.attemptId&&receipt.operationId===marker.operationId&&receipt.requestHash===run.cliExecution.requestHash&&run.cliExecution.stopConfirmed===true&&[stopSource,'remote-dispatch-not-sent'].includes(source)&&proof?.schemaVersion===1&&proof.source===source&&proof.taskId===marker.taskId&&proof.attemptId===marker.attemptId&&proof.operationId===marker.operationId&&proof.targetHash===marker.targetHash&&proof.referenceHash===taskHash(reference)&&proof.evidenceHash===taskHash(receipt)&&taskHash(run.managedExecution)===taskHash(marker))
  }
  const ownerRun=async(subject,runId)=>{
    authority.assertTool(subject,'cli/read')
    const botId=authority.describe(subject).botId,run=(await store.read()).runs.find(row=>row.id===taskRef(runId))??store.fundingExecution(runId)
    if(!run||run.cliExecution?.botId!==botId)fail('CLI_EXECUTION_NOT_FOUND')
    return {botId,run}
  }
  const facade={
    version:1,
    async probe(subject){assert(subject);if(remoteProbe)return remoteProbe(subject);const pinned=await pinCodexExecutable(entry,workspace);return {status:'available',toolId:'codex',version:pinned.version,sha256:pinned.sha256,configuredModel:requestedModel,actualResponseModelVerified:false,mode:'read-only',location}},
    prepare(subject,input,context){
      const botId=assert(subject)
      if(closed)fail('CLI_EXECUTION_CLOSED')
      if(!input||Object.keys(input).some(k=>k!=='task')||typeof input.task!=='string'||!input.task.trim()||input.task.includes('\0')||Buffer.byteLength(input.task)>16000)fail('INVALID_CLI_TASK_INPUT')
      canonicalTaskJson(input)
      const {binding,operationId,targetHash}=context
      if(binding.machineId!==machineId||binding.workspaceId!==workspaceId||binding.location!==location||!/^[a-f0-9]{64}$/.test(targetHash))fail('CLI_TARGET_MISMATCH')
      for(const key of ['taskId','attemptId'])taskRef(binding[key]);taskRef(operationId)
      return {botId,input:{task:input.task},reference:refFor(context)}
    },
    async start(subject,input,context){
      context={...context,binding:structuredClone(context.binding)}
      const prepared=facade.prepare(subject,input,context),{reference,botId}=prepared,id=reference.runId
      if(active.has(id))return {executionId:id,replayed:true}
      const existing=(await store.read()).runs.find(run=>run.id===id)
      if(existing){if(existing.cliExecution?.requestHash!==taskHash({input,reference})||existing.cliExecution.botId!==botId)fail('CLI_EXECUTION_CONFLICT');return {executionId:id,replayed:true}}
      const historical=await store.modelCall(botId,`receipt-${context.operationId}`)
      if(historical){if(historical.requestHash!==taskHash({input,reference}))fail('CLI_EXECUTION_CONFLICT');return {executionId:id,replayed:true}}
      if(typeof context.checkpoint!=='function'||typeof context.beforeRequest!=='function')fail('CLI_TASK_FENCE_REQUIRED')
      const beforeAdmission=context.beforeAdmission??context.beforeRequest
      // These journal checks precede any sessionFactory call. Their failure
      // proves that this invocation never created a CLI supervisor.
      try{beforeAdmission();await context.checkpoint(reference)}catch(error){
        // No factory has been entered. Persist the exact reference even when
        // cancellation won the preceding check; if that fails remain unknown.
        await context.checkpoint(reference)
        const source='cli-no-dispatch'
        return {executionId:null,outcome:context.signal?.aborted?'cancelled':'failed',summary:{code:'CLI_ADMISSION_FAILED',notStarted:true,stopConfirmed:true,stopEvidence:source,stopProof:proofFor(source,reference,{kind:'admission-refused-before-factory',reference})}}
      }
      const when=now(),receipt={schemaVersion:1,id:`receipt-${context.operationId}`,runId:id,packageId:'cli',botId,sessionId:null,taskId:context.binding.taskId,attemptId:context.binding.attemptId,operationId:context.operationId,source:'cli',provider:model.provider,model:model.model,funding:billing,pricing,requestHash:taskHash({input,reference}),createdAt:when,ownerPid:process.pid,state:'admitted',finishedAt:null,usage:null,usageComplete:false,actualModel:null,reportedCostUsd:null,finishKind:null,outcome:null}
      const metadata={schemaVersion:1,botId,requestedModel,entrySha256:entry.sha256,entryVersion:entry.version,requestHash:receipt.requestHash,receiptId:receipt.id,...(referenceExtra?{remote:structuredClone(referenceExtra)}:{})}
      const run={id,kind:'cli-task',createdAt:when,status:'running',managedExecution:reference.marker,cliExecution:metadata,packages:[],reviews:[]}
      const wrapped={read:()=>store.read(),update:(change,options)=>store.update(state=>{
        if(receipt.state==='admitted'&&billing==='subscription'){
          const from=Date.parse(new Date(now()).toISOString().slice(0,10)+'T00:00:00Z')
          if(store.countModelCalls({botId,source:'cli',funding:'subscription',from,to:from+86400000})>=subscriptionMaxCalls)return {accepted:false,reason:'subscription-call-limit'}
        }
        if(receipt.state==='admitted'&&state.runs.some(r=>r.id===id))return {accepted:false,reason:'duplicate-operation'}
        return change(state)
      },{...options,modelReceipt:{...receipt}})}
      const manager=createBudgetReservations({state:wrapped,now})
      const admitted=await manager.beginExecution({run,packageEstimates:[{id:'cli',billing,estimatedCostUsd:billing==='subscription'?0:estimatedCostUsd}],dailyLimitUsd,monthlyLimitUsd})
      if(!admitted.accepted){if(admitted.reason==='duplicate-operation')return {executionId:id,replayed:true};const source='cli-no-dispatch';return {executionId:null,outcome:'waiting-budget',reason:admitted.reason,summary:{code:'CLI_WAITING_BUDGET',notStarted:true,stopConfirmed:true,stopEvidence:source,stopProof:proofFor(source,reference,{kind:'budget-admission-denied',reference,reason:admitted.reason})}}}
      const controller=new AbortController(),signal=AbortSignal.any([controller.signal,...(context.signal?[context.signal]:[])])
      const record={botId,controller,session:null,promise:null};active.set(id,record)
      record.promise=(async()=>{
        let session,snapshot,stopped,dispatched=false,notStarted=false,error
        const saveProgress=async value=>{
          const snapshot=value??session?.snapshot(),observed=usageOf(snapshot?.usage)
          // Interim snapshots are projection evidence only; no money gets finalized twice.
          receipt.usage=observed.usage;receipt.usageComplete=observed.complete
          if(receipt.state==='running')await store.recordModelReceipt(receipt)
        }
        try{
          session=await sessionFactory({authority,subject,binding:context.binding,operationId:context.operationId,runtimeRoot,workspace,entry,requestedModel,catalogProvider:model.provider,catalogModel:model.model,billing,deadlineMs,tools,handlers,provisionCredentials,providerConfig,roleInstructions,signal,
            onUsage:saveProgress,onObserve:()=>{context.beforeRequest();assert(subject);signal.throwIfAborted()},onBeforeRequest:async()=>{
              context.beforeRequest();assert(subject);signal.throwIfAborted()
              receipt.state='running'
              const checked=await manager.checkpointExecution({reservationId:id,ownerToken:admitted.ownerToken,run,startedIds:['cli'],dailyLimitUsd,monthlyLimitUsd,checkBudget:true})
              if(checked.accepted===false)fail('CLI_WAITING_BUDGET')
              context.beforeRequest();signal.throwIfAborted();dispatched=true
            }})
          record.session=session
          await session.run(input.task)
        }catch(e){error=e;if(location==='remote'&&e.cliDispatchNotSent===true&&e.remoteDispatchNotSent===true){notStarted=true;dispatched=false;snapshot=e.cliSnapshot;stopped={treeStopped:true,status:'not-started'}}}
        finally{
          try{stopped=await session?.close()??stopped}catch(e){error??=e}
          snapshot=session?.snapshot()??snapshot
        }
        let snapshotAccepted=Boolean(snapshot)
        try{if(snapshotValid)snapshotAccepted=snapshotValid(snapshot)===true}catch{snapshotAccepted=false}
        const observed=usageOf(snapshot?.usage),inference=location==='remote'?snapshotAccepted&&snapshot?.cliTurnRequestsDispatched>0:dispatched||(snapshot?.cliTurnRequestsDispatched??0)>0
        const identity=snapshot?.identity,identityValid=snapshotAccepted&&identity?.requestedCliModel===requestedModel&&identity?.reportedCliModel===requestedModel&&identity?.reportedProvider==='openai'&&identity?.verification!=='mismatch'&&!(identity.reroutes??[]).some(row=>row.toModel!==requestedModel)
        // Factory rejection can occur after spawning a supervisor; only the
        // Host transport's dispatch-not-sent marker proves remote non-dispatch.
        const stopConfirmed=stopped?.treeStopped===true
        let outcome=!stopConfirmed?'unknown':!inference?signal.aborted?'cancelled':'failed':!identityValid||!terminal.has(snapshot?.terminal==='completed'?'succeeded':snapshot?.terminal==='failed'?'failed':snapshot?.terminal==='interrupted'?'cancelled':'unknown')?'unknown':snapshot.terminal==='completed'?'succeeded':signal.aborted?'cancelled':'failed'
        if(error&&outcome==='succeeded')outcome=signal.aborted?'cancelled':'unknown'
        const item={id:'cli',provider:model.provider,model:model.model,toolId:'codex',channel:'official-cli',billing,ran:inference,ok:outcome==='succeeded',status:outcome==='unknown'?'interrupted':outcome,usage:observed.usage,usageIncomplete:!observed.complete,finishedAt:now(),pricingSnapshot:pricing,
          costUsd:billing==='subscription'&&inference?0:null,costSource:!inference?'not-run':billing==='subscription'?'subscription':'cli-actual-price-unreported',actualModel:null}
        // Configured model proof cannot manufacture an API bill or actual response identity.
        if(inference&&billing==='api'){outcome='unknown';item.ok=false;item.status='interrupted'}
        receipt.finishedAt=item.finishedAt;receipt.usage=observed.usage;receipt.usageComplete=observed.complete
        if(location==='remote'&&outcome==='unknown'){receipt.finishKind=null;receipt.outcome=null;receipt.state='running'}
        else{receipt.finishKind=snapshot?.terminal??null;receipt.outcome=outcome;receipt.state=outcome==='unknown'?'unknown':'settled'}
        const evidenceSource=notStarted?'remote-dispatch-not-sent':stopSource,stopProof=stopConfirmed?proofFor(evidenceSource,reference,receipt):null
        const final={...run,status:outcome==='unknown'?'interrupted':outcome==='succeeded'?'completed':outcome,finishedAt:item.finishedAt,packages:[item],cliExecution:{...metadata,modelIdentity:identity??null,stopConfirmed,...(stopConfirmed?{stopEvidence:evidenceSource,stopProof}:{}),...(notStarted?{notStarted:true}:{}),cliTurnRequestsDispatched:snapshot?.cliTurnRequestsDispatched??(dispatched?null:0),actualProviderRequestCount:snapshot?.actualProviderRequestCount??null}}
        if(outcome==='unknown')await manager.interruptExecution({reservationId:id,ownerToken:admitted.ownerToken,run:final})
        else await manager.finishExecution({reservationId:id,ownerToken:admitted.ownerToken,run:final})
        const failureCode=[error?.code,error?.message].find(value=>typeof value==='string'&&/^[A-Z][A-Z0-9_:]{0,95}$/.test(value))
        return {outcome,legacyRunId:id,summary:{code:outcome==='unknown'?'CLI_OUTCOME_UNCONFIRMED':outcome==='succeeded'?'CLI_COMPLETED':'CLI_STOPPED',...(failureCode?{failureCode}:{}),stopConfirmed,...(stopConfirmed?{stopEvidence:evidenceSource,stopProof}:{}),...(notStarted?{notStarted:true}:{}),configuredModel:identity?.reportedCliModel??null,actualResponseModelVerified:false,usage:observed.usage,...(Number.isSafeInteger(snapshot?.stopEvidence?.exitCode)?{exitCode:snapshot.stopEvidence.exitCode}:{}),finalText:outcome==='succeeded'?String(snapshot?.finalText??'').slice(0,8000):null}}
      })()
      record.promise.then(result=>{finished.set(id,{botId,result});while(finished.size>128)finished.delete(finished.keys().next().value)},()=>{}).finally(()=>active.delete(id))
      return {executionId:id,replayed:false}
    },
    async observe(subject,executionId){const {run}=await ownerRun(subject,executionId);return {executionId:run.id,status:run.status,source:'cli',configuredModel:run.cliExecution.requestedModel,actualResponseModelVerified:false,stopConfirmed:run.cliExecution.stopConfirmed??false,receipt:await store.modelCall(run.cliExecution.botId,run.cliExecution.receiptId)}},
    async cancel(subject,executionId){const botId=assert(subject,'cli/cancel'),record=active.get(executionId);if(!record||record.botId!==botId)fail('CLI_EXECUTION_NOT_FOUND');record.controller.abort(new Error('CLI_TASK_CANCELLED'));await record.promise;return facade.observe(subject,executionId)},
    async collect(subject,executionId){const {run}=await ownerRun(subject,executionId),record=active.get(executionId);if(record)return record.promise;if(finished.has(executionId))return finished.get(executionId).result;const receipt=await store.modelCall(run.cliExecution.botId,run.cliExecution.receiptId),reference={kind:'cli-run',runId:run.id,...(run.cliExecution.remote?{remote:run.cliExecution.remote}:{}),marker:run.managedExecution},proven=verifiedStop(run,receipt,reference);return {outcome:proven?receipt.outcome:'unknown',legacyRunId:run.id,summary:{code:'CLI_STORED_RESULT',stopConfirmed:proven,...(proven?{stopEvidence:run.cliExecution.stopEvidence,stopProof:run.cliExecution.stopProof}:{})}}},
    async reconcile(subject,{task,reference,signal}){
      let {run}=await ownerRun(subject,reference?.runId)
      const expected=refFor({binding:{taskId:task.taskId,attemptId:task.attemptId},operationId:task.operationId,targetHash:task.input.targetHash})
      if(taskHash(expected)!==taskHash(reference)||taskHash(run.managedExecution)!==taskHash(expected.marker))return {outcome:'unknown',reason:'CLI_EXECUTION_REFERENCE_MISMATCH'}
      let snapshot=await store.read(),receipt=await store.modelCall(run.cliExecution.botId,run.cliExecution.receiptId)
      if((snapshot.budgetReservations[run.id]||!verifiedStop(run,receipt,reference))&&recover&&snapshot.runs.some(row=>row.id===run.id)){
        const recovered=await recover({subject,run,receipt,reference,task,signal})
        if(recovered&&terminal.has(recovered.outcome)&&recovered.stopConfirmed===true){
          receipt={...receipt,...recovered.receipt,id:receipt.id,runId:run.id,botId:receipt.botId,requestHash:receipt.requestHash,outcome:recovered.outcome,state:'settled'}
          const stopProof=proofFor(stopSource,reference,receipt)
          run={...run,...recovered.run,cliExecution:{...run.cliExecution,...recovered.cliExecution,stopConfirmed:true,stopEvidence:stopSource,stopProof}}
          await store.update(state=>{const index=state.runs.findIndex(row=>row.id===run.id);if(index<0)fail('CLI_EXECUTION_NOT_FOUND');state.runs[index]=run;delete state.budgetReservations[run.id]},{retrySafe:true,modelReceipt:receipt})
          snapshot=await store.read()
        }
      }
      if(snapshot.budgetReservations[run.id]||!verifiedStop(run,receipt,reference))return {outcome:'unknown',reason:'CLI_RECEIPT_UNCONFIRMED'}
      return {outcome:receipt.outcome,referenceHash:taskHash(reference),evidenceHash:taskHash(receipt),reason:'CLI_TERMINAL_RECEIPT_VERIFIED',summary:{stopConfirmed:true,stopEvidence:run.cliExecution.stopEvidence,stopProof:run.cliExecution.stopProof}}
    },
    async close(){closed=true;for(const record of active.values())record.controller.abort(new Error('CLI_HOST_STOPPED'));await Promise.allSettled([...active.values()].map(record=>record.promise))},
  }
  return Object.freeze(facade)
}

export function createCliReadBackend(options){
  const facade=createCliExecution(options),hashText=value=>createHash('sha256').update(String(value??'')).digest('hex')
  const contract={entry:options.entry,model:options.model,requestedModel:options.requestedModel,billing:options.billing,pricing:options.pricing??null,estimatedCostUsd:options.estimatedCostUsd??null,
    dailyLimitUsd:options.dailyLimitUsd??1,monthlyLimitUsd:options.monthlyLimitUsd??0,subscriptionMaxCalls:options.subscriptionMaxCalls??null,deadlineMs:options.deadlineMs??120000,
    machineId:options.machineId,workspaceId:options.workspaceId,workspaceHash:hashText(options.workspace),runtimeRootHash:hashText(options.runtimeRoot),roleHash:hashText(options.roleInstructions),providerConfigHash:hashText(JSON.stringify(options.providerConfig??{})),
    tools:options.tools??[],handlerDefinitions:(options.handlers??[]).map(handler=>handler.definition)}
  const version=`cli-${taskHash(contract).slice(0,40)}`
  const parse=input=>{if(!input||Object.keys(input).some(k=>k!=='task')||typeof input.task!=='string'||!input.task.trim()||Buffer.byteLength(input.task)>16000)fail('INVALID_CLI_TASK_INPUT');return JSON.parse(canonicalTaskJson(input))}
  return Object.freeze({id:'codex-read',version,effect:'read',machineId:options.machineId,workspaceId:options.workspaceId,location:'local',capability:'cli/codex',retryCapability:'cli/retry',reconcileCapability:'cli/read',model:Object.freeze(structuredClone(options.model)),parse,
    async run(context){const subject=options.directory.forBot(context.ownerBotId);const started=await facade.start(subject,context.input,context);if(started.outcome)return {outcome:started.outcome,summary:started.summary};return facade.collect(subject,started.executionId)},
    reconcile:context=>facade.reconcile(options.directory.forBot(context.ownerBotId),context),facade})
}
