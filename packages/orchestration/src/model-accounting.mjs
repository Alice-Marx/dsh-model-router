import {randomUUID,createHash} from 'node:crypto'
import {createBudgetReservations} from '../../../.dsh-plugin/shared/budget-reservations.mjs'
import {actualCost} from '../../../.dsh-plugin/shared/run-ledger.mjs'
import {managedModelRequest,taskModelRequest} from './model-receipt.mjs'
import {assessFundingAdmission} from './funding-admission.mjs'
import {taskHash} from './task-contract.mjs'
import {planOutputBound,requestFieldAccess} from './model-request-bounds.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const uuid=prefix=>`${prefix}-${randomUUID()}`
function requestHash(options){
  const text=JSON.stringify({provider:options.provider,model:options.model,system:options.system??null,messages:options.messages,tools:options.tools??null,toolHistory:options.toolHistory??null,maxTokens:options.maxTokens??null,reasoningEffort:options.reasoningEffort??null})
  if(Buffer.byteLength(text)>8*1024*1024)fail('MODEL_REQUEST_INPUT_LIMIT')
  return createHash('sha256').update(text).digest('hex')
}
function usageOf(value){
  if(!value||typeof value!=='object')return {usage:null,complete:false}
  const usage={};let complete=true
  for(const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']){
    if(!Object.hasOwn(value,key)&&!['inputTokens','outputTokens'].includes(key))continue
    usage[key]=Number.isSafeInteger(value[key])&&value[key]>=0?value[key]:null
    if(usage[key]===null)complete=false
  }
  return {usage,complete}
}

/** Every observed model call has one source receipt; only the linked run owns money. */
export function createModelAccounting({store,authority,pricingFor,fundingRevisionFor,inputBoundFor,modelBoundsFor,preparedFrameFor,machineId,workspaceId,now=Date.now,ttlMs=120000,limits={dailyLimitUsd:1,monthlyLimitUsd:0},maxActive=16}){
  if(store?.kind!=='sqlite-router-state'||typeof store.recordModelReceipt!=='function'||typeof pricingFor!=='function')fail('MODEL_ACCOUNTING_STORAGE_REQUIRED')
  const active=new Set();let closed=false
  const controllerSet=new Set()
  const receiptBase=(identity,options,policy,managed,task)=>{
    const id=uuid('call'),createdAt=now()
    return {schemaVersion:1,id,runId:managed?.runId??uuid('inference'),packageId:managed?(managed.packageId??'direct'):'inference',botId:identity.botId,
      sessionId:identity.sessionId??null,taskId:managed?.taskId??task?.taskId??null,attemptId:managed?.attemptId??task?.attemptId??uuid('model-attempt'),operationId:managed?.operationId??task?.operationId??uuid('model-operation'),
      source:managed?(managed.source??'mr-api'):identity.source,provider:options.provider,model:options.model,funding:policy.funding,pricing:policy.pricing??null,
      ...(policy.scopeId?{fundingScopeId:policy.scopeId}:{}),...(policy.projectId?{fundingProjectId:policy.projectId}:{}),
      requestHash:requestHash(options),createdAt,ownerPid:process.pid,state:'admitted',finishedAt:null,usage:null,usageComplete:false,actualModel:null,reportedCostUsd:null,finishKind:null,outcome:null}
  }
  const callStore=(receipt,config,estimate,assertFunding)=>({read:()=>store.read(),update:(change,options)=>store.update(current=>{
    if (receipt.state === 'admitted' || receipt.state === 'running') assertFunding()
    if(receipt.state==='admitted'&&config.funding==='api'){
      const checked=assessFundingAdmission({store,state:current,botId:receipt.botId,scopeId:config.scopeId,projectId:config.projectId,policy:config,estimatedCostUsd:estimate,excludeRunId:receipt.runId,now:now()})
      if(!checked.accepted)return checked
    }
    if(receipt.state==='admitted'&&receipt.funding==='subscription'){
      const usage=store.fundingSubscriptionUsage({botId:receipt.botId,at:now()})
      const quotas=[[config.subscriptionMaxCalls,'today'],[config.subscriptionMonthlyCalls,'month']]
      for(const [quota,period] of quotas){
        if(quota===null||quota===undefined)continue
        if(!Number.isSafeInteger(quota)||quota<0)fail('MODEL_SUBSCRIPTION_QUOTA_REQUIRED')
        const calls=usage[period].calls
        if(calls>=quota)return {accepted:false,reason:'subscription-call-limit'}
      }
    }
    return change(current)
  },{...options,modelReceipt:receipt})})
  function stream(options,next,identity){
    const managed=managedModelRequest(options)
    const task=taskModelRequest(options)
    const ready=deferred(),done=deferred()
    return (async function*(){
      if(closed)fail('MODEL_ACCOUNTING_CLOSED')
      if(active.size>=maxActive||active.has(options))fail('MODEL_CONCURRENCY_LIMIT')
      authority.assertModel(identity.subject,options.provider,options.model)
      authority.assertTool(identity.subject,'model/infer')
      if(authority.describe(identity.subject).botId!==identity.botId)fail('MODEL_OWNER_MISMATCH')
      if(task&&(task.botId!==identity.botId||task.provider!==options.provider||task.model!==options.model))fail('MODEL_TASK_OWNER_MISMATCH')
      const fundingQuery={botId:identity.botId,provider:options.provider,model:options.model,source:identity.source}
      const config=await pricingFor(fundingQuery)
      if(active.size>=maxActive||active.has(options))fail('MODEL_CONCURRENCY_LIMIT')
      if(!config||!['api','subscription'].includes(config.funding))fail('MODEL_FUNDING_REQUIRED')
      if(config.funding==='api'&&(!config.pricing||!['input','output'].every(k=>Number.isFinite(config.pricing[k])&&config.pricing[k]>=0)))fail('MODEL_PRICE_REQUIRED')
      if(options.maxTokens!==undefined&&(!Number.isSafeInteger(options.maxTokens)||options.maxTokens<1))fail('MODEL_OUTPUT_BOUNDARY_REQUIRED')
      if(config.funding==='api'&&(!Number.isSafeInteger(config.maxOutputTokens)||config.maxOutputTokens<1))fail('MODEL_ESTIMATE_REQUIRED')
      // A declared request allowance is a price, not a capacity: the trusted
      // input upper bound is the pinned model's own context window, resolved
      // per admission because an adapter registration can be replaced under a
      // live Host. That whole window already covers images, tool declarations
      // and adapter framing, so no tokenizer and no source-length estimate
      // stands in for it. A route whose adapter declares no window has no bound
      // to admit, which is a required-bound failure rather than a smaller number
      // to pretend with.
      // A prepared call (the independent path) already bound one adapter generation and
      // recorded its exact capacities in a Host-owned frame keyed by this request's signal.
      // When that frame is present and names this exact route, admission uses it instead of
      // reading the current registration: the window and default it prices are the ones the
      // prepared dispatch will actually stream, so no metadata read can combine one
      // generation's window with another's endpoint. A frame about another route is ignored.
      const frame=preparedFrameFor?await preparedFrameFor(options):null
      if (!managed && (config.fundingRevision || frame?.fundingRevision)) {
        if (!frame || !Object.hasOwn(frame, 'fundingRevision')) fail('MODEL_FUNDING_FRAME_MISSING')
        if (frame.fundingRevision !== (config.fundingRevision ?? null)) fail('MODEL_FUNDING_CHANGED')
      }
      const assertFunding=()=>{
        if (config.fundingRevision && fundingRevisionFor?.(fundingQuery) !== config.fundingRevision) fail('MODEL_FUNDING_CHANGED')
      }
      assertFunding()
      if(closed)fail('MODEL_ACCOUNTING_CLOSED')
      if(active.size>=maxActive||active.has(options))fail('MODEL_CONCURRENCY_LIMIT')
      options.signal?.throwIfAborted()
      const frameBounds=frame&&frame.bounds&&frame.provider===options.provider&&frame.model===options.model?frame.bounds:null
      let outputDefault=null
      if(config.funding==='api'){
        let inputBound
        if(frameBounds){
          inputBound=frameBounds.contextWindow
          outputDefault=frameBounds.defaultMaxTokens??null
        }else{
          const bounds=modelBoundsFor?await modelBoundsFor({options,identity,config,signal:options.signal??null}):null
          inputBound=bounds?.inputBound??(inputBoundFor?await inputBoundFor({options,identity,config}):null)
          outputDefault=bounds?.outputDefault??null
        }
        if(!Number.isSafeInteger(inputBound)||inputBound<1||!Number.isSafeInteger(config.maxInputTokens)||inputBound>config.maxInputTokens)fail('MODEL_INPUT_BOUNDARY_REQUIRED')
      }
      // The output bound the provider will actually see. An omitted bound is not
      // an unbounded one: the pinned adapter materializes its own per-request
      // cap into the request before dispatch, so that declared cap — and nothing
      // else — is what arrives. A request the Host cannot bring under the
      // allowance, whether frozen above it or declaring no bound at all, is
      // refused here: before a receipt, a reservation, a lease, an active slot or
      // any provider call exists.
      const outputBound=config.maxOutputTokens
      let plan
      if(frameBounds){
        // The prepared config already carries the dispatched bound (clamped before it
        // froze). Admit it as-is and only validate it against the current allowance; a
        // second clamp here would change the dispatched config and fail the prepared call
        // with INVALID_PREPARED_CALL, so a lowered allowance is a refusal, never a re-clamp.
        const dispatched=options.maxTokens??null
        if(config.funding==='api'){
          if(!Number.isSafeInteger(dispatched)||dispatched<1)fail('MODEL_ESTIMATE_REQUIRED')
          if(dispatched>outputBound)fail('MODEL_OUTPUT_BOUND_EXCEEDED')
        }
        plan={ok:true,maxTokens:options.maxTokens??undefined,source:'prepared'}
      }else{
        plan=Number.isSafeInteger(outputBound)&&outputBound>0
          ?planOutputBound({requested:options.maxTokens??null,allowance:outputBound,adapterDefault:outputDefault})
          :{ok:true,maxTokens:options.maxTokens??undefined,source:'none'}
      }
      if(!plan.ok)fail(plan.code)
      // Mutability is per field and independent of every other field's: a request
      // whose signal is read-only may still carry a writable maxTokens.
      const tokenAccess=requestFieldAccess(options,'maxTokens'),signalAccess=requestFieldAccess(options,'signal')
      if(plan.source==='clamp'&&!tokenAccess.canWrite)fail(plan.refusal)
      const effectiveOutput=plan.maxTokens
      // The bounds lookup is asynchronous, so the gates it ran past are re-run
      // here: an accounting that closed while the adapter was being asked, or an
      // active set another admission filled, must not gain a slot because a
      // metadata read was slow.
      if(closed)fail('MODEL_ACCOUNTING_CLOSED')
      if(active.size>=maxActive||active.has(options))fail('MODEL_CONCURRENCY_LIMIT')
      const record=receiptBase(identity,{...options,...(effectiveOutput!==undefined?{maxTokens:effectiveOutput}:{})},config,managed,task)
      let manager,accepted,binding,lease,guard,inner,estimate,previousSignal=options.signal,changedOutput=false,changedSignal=false,leaseSignal=null
      let started=false,exhausted=false,terminal=false,finishKind=null,observed={usage:null,complete:false},primaryError,cleanupError,propagated=false,aborted=false,consumerClosed=false
      const controller=new AbortController();controllerSet.add(controller);active.add(options)
      const build=()=>{
        const complete=terminal&&observed.complete,when=now()
        const billed=record.funding==='subscription'?{costUsd:0,costSource:'subscription',referenceCostUsd:null}:actualCost({usage:observed.usage,usageIncomplete:!complete},record.pricing)
        const known=!complete&&observed.usage?actualCost({usage:observed.usage},record.pricing).costUsd:null
        return {id:record.runId,kind:'model-call',createdAt:record.createdAt,finishedAt:when,status:!started?'cancelled':!terminal||cleanupError?'interrupted':aborted||finishKind==='aborted'?'cancelled':finishKind==='error'?'failed':'completed',
          modelCall:{schemaVersion:1,id:record.id,botId:record.botId,sessionId:record.sessionId,source:record.source,provider:record.provider,model:record.model,...(record.fundingScopeId?{fundingScopeId:record.fundingScopeId}:{}),...(record.fundingProjectId?{fundingProjectId:record.fundingProjectId}:{})},
          packages:[{id:record.packageId,provider:record.provider,model:record.model,channel:'harness-llm',billing:record.funding,ran:started,ok:terminal&&!['error','aborted'].includes(finishKind)&&!cleanupError,
            status:!started?'skipped':!terminal||cleanupError?'interrupted':aborted||finishKind==='aborted'?'cancelled':finishKind==='error'?'failed':'succeeded',usage:observed.usage,usageIncomplete:!complete,pricingSnapshot:record.pricing,
            ...(!started?{costUsd:null,costSource:'not-run'}:billed),...(known!==null&&!complete?{knownCostUsd:known}:{}),finishedAt:when}],reviews:[]}
      }
      try{
        if(managed){
          if(managed.botId!==identity.botId||managed.provider!==options.provider||managed.model!==options.model)fail('MODEL_MANAGED_OWNER_MISMATCH')
          const current=await store.read(),run=current.runs.find(r=>r.id===managed.runId),hold=current.budgetReservations[managed.runId]
          const taskBound=Boolean(run?.managedExecution)&&run.managedExecution.operationId===managed.operationId&&run.managedExecution.attemptId===managed.attemptId
          const funded=run?.fundingExecution,fundingBound=Boolean(funded)&&funded.operationId===managed.operationId&&funded.attemptId===managed.attemptId&&funded.botId===identity.botId&&funded.policyHash===managed.policyHash&&managed.policyHash===taskHash(config)
          if(!run||!hold||hold.status!=='active'||(!taskBound&&!fundingBound)||!hold.packages.some(item=>item.id===record.packageId&&item.started))fail('MODEL_MANAGED_ADMISSION_REQUIRED')
          if(managed.policyHash&&!fundingBound)fail('MODEL_MANAGED_FUNDING_CHANGED')
          await store.recordModelReceipt(record)
        }else{
          const input=config.maxInputTokens,output=effectiveOutput
          if(record.funding==='api'&&(!Number.isSafeInteger(input)||input<1||!Number.isSafeInteger(output)||output<1))fail('MODEL_ESTIMATE_REQUIRED')
          estimate=record.funding==='subscription'?0:(input*config.pricing.input+output*config.pricing.output)/1e6
          if(!Number.isFinite(estimate))fail('MODEL_ESTIMATE_REQUIRED')
          const pending={id:record.runId,createdAt:record.createdAt,status:'running',finishedAt:null,packages:[],reviews:[],modelCall:{schemaVersion:1,id:record.id,botId:record.botId,source:record.source,...(record.fundingScopeId?{fundingScopeId:record.fundingScopeId}:{}),...(record.fundingProjectId?{fundingProjectId:record.fundingProjectId}:{})}}
          manager=createBudgetReservations({state:callStore(record,config,estimate,assertFunding)})
          accepted=await manager.beginExecution({run:pending,packageEstimates:[{id:'inference',billing:record.funding,estimatedCostUsd:estimate}],...limits})
          if(!accepted.accepted)fail(accepted.reason==='subscription-call-limit'?'MODEL_SUBSCRIPTION_LIMIT':'MODEL_WAITING_BUDGET')
        }
        binding={taskId:record.taskId??record.runId,attemptId:record.attemptId,machineId,workspaceId,location:'local'}
        lease=authority.issue(identity.subject,{binding,tools:['model/infer'],ttlMs})
        // The caller request may be frozen (the SDK AgentLoop passes one). A
        // request whose signal field is writable carries the combined lease
        // signal so the provider aborts directly; otherwise the lease gates the
        // iteration instead and cleanup still returns the provider iterator.
        if(plan.source==='clamp'){
          // Write the bound the provider will see, then read it back: a field
          // that reports writable but does not take the value is not one the
          // Host may claim it clamped.
          if(!Reflect.set(options,'maxTokens',effectiveOutput)||options.maxTokens!==effectiveOutput)fail(plan.refusal)
          changedOutput=true
        }
        guard=authority.run(lease.token,binding,'model/infer',async({signal})=>{
          if(signalAccess.canWrite){options.signal=AbortSignal.any([signal,...(previousSignal?[previousSignal]:[])]);changedSignal=true;options.signal.throwIfAborted()}
          else{leaseSignal=signal;signal.throwIfAborted()}
          record.state='running'
          if(managed)await store.recordModelReceipt(record)
          else{
            const value=await createBudgetReservations({state:callStore(record,config,estimate,assertFunding)}).checkpointExecution({reservationId:accepted.reservationId,ownerToken:accepted.ownerToken,run:{id:record.runId,createdAt:record.createdAt,status:'running',packages:[],reviews:[]},startedIds:['inference'],...limits,checkBudget:true})
            if(value.accepted===false)fail('MODEL_WAITING_BUDGET')
          }
          authority.assertModel(identity.subject,options.provider,options.model)
          assertFunding()
          if(signalAccess.canWrite)options.signal.throwIfAborted();else signal.throwIfAborted()
          inner=next()[Symbol.asyncIterator]();started=true;ready.resolve(true)
          await done.promise
        },{signal:controller.signal})
        guard.catch(()=>{})
        await Promise.race([ready.promise,guard.then(()=>{throw new Error('MODEL_STREAM_NOT_STARTED')})])
        // A frozen request cannot carry the lease signal: gate the iteration on
        // it so a quiet provider is still interrupted on revoke or expiry, and
        // keep both racing promises handled so neither leaks.
        const leaseEnd=leaseSignal?new Promise((_,reject)=>{const end=()=>reject(leaseSignal.reason??new Error('MODEL_LEASE_ENDED'));if(leaseSignal.aborted)end();else leaseSignal.addEventListener('abort',end,{once:true})}):null
        if(leaseEnd)leaseEnd.catch(()=>{})
        const pull=async()=>{
          if(!leaseEnd)return inner.next()
          const racing=inner.next();racing.catch(()=>{})
          return Promise.race([racing,leaseEnd])
        }
        while(true){
          const item=await pull()
          if(item.done){exhausted=true;break}
          authority.assertModel(identity.subject,options.provider,options.model)
          if(item.value?.type==='usage')observed=usageOf(item.value.usage)
          if(item.value?.type==='finish'){terminal=true;finishKind=item.value.reason?.kind??'unknown'}
          yield item.value
        }
      }catch(e){primaryError=e;propagated=true;throw e}
      finally{
        if(!exhausted){consumerClosed=!primaryError;controller.abort(new Error('MODEL_CONSUMER_ENDED'))}
        try{await inner?.return?.()}catch(e){cleanupError=e}
        done.resolve();try{await guard}catch(e){primaryError??=e}
        aborted=Boolean(options.signal?.aborted||controller.signal.aborted||previousSignal?.aborted)
        // Restore exactly what this call wrote, and nothing it did not: a request
        // the Host never touched keeps its own shape, sealed or frozen alike.
        if(changedSignal){if(signalAccess.descriptor)Object.defineProperty(options,'signal',signalAccess.descriptor);else delete options.signal}
        if(changedOutput){if(tokenAccess.descriptor)Object.defineProperty(options,'maxTokens',tokenAccess.descriptor);else delete options.maxTokens}
        record.finishedAt=now();record.usage=observed.usage;record.usageComplete=terminal&&observed.complete;record.finishKind=finishKind
        record.state=started&&(!terminal||cleanupError)?'unknown':'settled'
        record.outcome=!started?'cancelled':!terminal||cleanupError?'unknown':aborted||finishKind==='aborted'?'cancelled':finishKind==='error'?'failed':'succeeded'
        try{
          if(managed){if(lease)await store.recordModelReceipt(record)}
          else if(accepted?.accepted){
            const run=build();await createBudgetReservations({state:callStore(record,config,estimate,assertFunding)}).finishExecution({reservationId:accepted.reservationId,ownerToken:accepted.ownerToken,run})
          }
        }finally{
          if(lease)authority.release(lease.token);active.delete(options);controllerSet.delete(controller)
        }
        if(cleanupError&&!primaryError)throw cleanupError
        if(primaryError&&!propagated&&!consumerClosed)throw primaryError
      }
    })()
  }
  return Object.freeze({stream,async close(){closed=true;for(const controller of controllerSet)controller.abort(new Error('MODEL_ACCOUNTING_CLOSED'))},status:()=>({active:active.size,closed})})
}
