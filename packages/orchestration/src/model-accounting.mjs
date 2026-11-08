import {randomUUID,createHash} from 'node:crypto'
import {createBudgetReservations} from '../../../.dsh-plugin/shared/budget-reservations.mjs'
import {actualCost} from '../../../.dsh-plugin/shared/run-ledger.mjs'
import {managedModelRequest,taskModelRequest} from './model-receipt.mjs'
import {assessFundingAdmission} from './funding-admission.mjs'
import {taskHash} from './task-contract.mjs'

// The code stays the message prefix: callers and logs match on it.
const HINTS=Object.freeze({
  MODEL_FUNDING_REQUIRED:'此 Bot 没有可用的资金来源。请在「Bot 与模型」打开快速模式，或启用高级绑定。',
  MODEL_PRICE_REQUIRED:'此模型还没有价格，按 API 计费前必须知道价格。请在「Bot 与模型 › 快速模式」填写每百万 Token 价格，或改用官方工具引擎。',
  MODEL_WAITING_BUDGET:'预算已用完，或有尚未核对的费用。请在「费用与用量」核对收据，或调高预算后再试。',
  MODEL_SUBSCRIPTION_LIMIT:'订阅调用次数已达上限。请等到下一个周期，或调高次数限制。',
  MODEL_ESTIMATE_REQUIRED:'缺少请求上界，无法预估费用。请填写最大输入与输出 Token。',
  MODEL_INPUT_BOUNDARY_REQUIRED:'缺少输入 Token 上界，无法预估费用。',
})
const fail=code=>{throw Object.assign(new Error(HINTS[code]?`${code}：${HINTS[code]}`:code),{code})}
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
export function createModelAccounting({store,authority,pricingFor,inputBoundFor,machineId,workspaceId,now=Date.now,ttlMs=120000,limits={dailyLimitUsd:1,monthlyLimitUsd:0},maxActive=16}){
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
  const callStore=(receipt,config,estimate)=>({read:()=>store.read(),update:(change,options)=>store.update(current=>{
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
      const config=await pricingFor({botId:identity.botId,provider:options.provider,model:options.model,source:identity.source})
      if(active.size>=maxActive||active.has(options))fail('MODEL_CONCURRENCY_LIMIT')
      if(!config||!['api','subscription'].includes(config.funding))fail('MODEL_FUNDING_REQUIRED')
      if(config.funding==='api'&&(!config.pricing||!['input','output'].every(k=>Number.isFinite(config.pricing[k])&&config.pricing[k]>=0)))fail('MODEL_PRICE_REQUIRED')
      if(options.maxTokens!==undefined&&options.maxTokens!==null&&(!Number.isSafeInteger(options.maxTokens)||options.maxTokens<1))fail('MODEL_OUTPUT_BOUNDARY_REQUIRED')
      if(config.funding==='api'&&(!Number.isSafeInteger(config.maxOutputTokens)||config.maxOutputTokens<1))fail('MODEL_ESTIMATE_REQUIRED')
      // A declared request allowance is not a tokenizer. The trusted Host must
      // supply an upper bound, normally the pinned model's whole context window.
      // This also covers images and adapter framing instead of guessing from URL bytes.
      if(config.funding==='api'){
        const inputBound=await inputBoundFor?.({options,identity,config})
        if(!Number.isSafeInteger(inputBound)||inputBound<1||!Number.isSafeInteger(config.maxInputTokens)||inputBound>config.maxInputTokens)fail('MODEL_INPUT_BOUNDARY_REQUIRED')
      }
      const outputBound=config.maxOutputTokens
      const effectiveOutput=Number.isSafeInteger(outputBound)&&outputBound>0?Math.min(options.maxTokens??outputBound,outputBound):options.maxTokens
      // The SDK AgentLoop hands the adapter a frozen request that already carries the model's own
      // output bound, so the Host cannot lower it. Such a request is admitted with the configured
      // allowance as its estimate (decision: usability first); the daily/monthly budget stays the
      // hard limit, and the per-call output bound is advisory where the request cannot be changed.
      const descriptor=Object.getOwnPropertyDescriptor(options,'signal'),tokenDescriptor=Object.getOwnPropertyDescriptor(options,'maxTokens')
      const carrier=descriptor?descriptor.writable:Object.isExtensible(options)
      const clampable=carrier&&!(tokenDescriptor&&!tokenDescriptor.writable)&&Boolean(tokenDescriptor||Object.isExtensible(options))
      const record=receiptBase(identity,{...options,...(effectiveOutput!==undefined?{maxTokens:effectiveOutput}:{})},config,managed,task)
      let manager,accepted,binding,lease,guard,inner,estimate,previousSignal=options.signal,changedOutput=false,leaseSignal=null
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
          manager=createBudgetReservations({state:callStore(record,config,estimate)})
          accepted=await manager.beginExecution({run:pending,packageEstimates:[{id:'inference',billing:record.funding,estimatedCostUsd:estimate}],...limits})
          if(!accepted.accepted)fail(accepted.reason==='subscription-call-limit'?'MODEL_SUBSCRIPTION_LIMIT':'MODEL_WAITING_BUDGET')
        }
        binding={taskId:record.taskId??record.runId,attemptId:record.attemptId,machineId,workspaceId,location:'local'}
        lease=authority.issue(identity.subject,{binding,tools:['model/infer'],ttlMs})
        // The caller request may be frozen (the SDK AgentLoop passes one). A
        // mutable request carries the combined lease signal so the provider
        // aborts directly; a frozen request cannot, so the lease gates the
        // iteration instead and cleanup still returns the provider iterator.
        // Clamping happens when the request allows it; when it does not, the
        // reservation above already covers the bound the provider will see.
        const clampNeeded=effectiveOutput!==undefined&&options.maxTokens!==undefined&&options.maxTokens!==effectiveOutput
        if(clampNeeded&&clampable){
          options.maxTokens=effectiveOutput;changedOutput=true
        }else if(carrier&&effectiveOutput!==undefined&&options.maxTokens===undefined&&(!tokenDescriptor||tokenDescriptor.writable)&&Object.isExtensible(options)){
          // Adoption is best effort: the estimate above already uses the full allowance, so a
          // sealed request without an output bound is admitted as it is instead of failing.
          options.maxTokens=effectiveOutput;changedOutput=true
        }
        guard=authority.run(lease.token,binding,'model/infer',async({signal})=>{
          if(carrier){options.signal=AbortSignal.any([signal,...(previousSignal?[previousSignal]:[])]);options.signal.throwIfAborted()}
          else{leaseSignal=signal;signal.throwIfAborted()}
          record.state='running'
          if(managed)await store.recordModelReceipt(record)
          else{
            const value=await createBudgetReservations({state:callStore(record,config,estimate)}).checkpointExecution({reservationId:accepted.reservationId,ownerToken:accepted.ownerToken,run:{id:record.runId,createdAt:record.createdAt,status:'running',packages:[],reviews:[]},startedIds:['inference'],...limits,checkBudget:true})
            if(value.accepted===false)fail('MODEL_WAITING_BUDGET')
          }
          authority.assertModel(identity.subject,options.provider,options.model)
          if(carrier)options.signal.throwIfAborted();else signal.throwIfAborted()
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
        if(descriptor)Object.defineProperty(options,'signal',descriptor);else delete options.signal
        if(changedOutput){if(tokenDescriptor)Object.defineProperty(options,'maxTokens',tokenDescriptor);else delete options.maxTokens}
        record.finishedAt=now();record.usage=observed.usage;record.usageComplete=terminal&&observed.complete;record.finishKind=finishKind
        record.state=started&&(!terminal||cleanupError)?'unknown':'settled'
        record.outcome=!started?'cancelled':!terminal||cleanupError?'unknown':aborted||finishKind==='aborted'?'cancelled':finishKind==='error'?'failed':'succeeded'
        try{
          if(managed){if(lease)await store.recordModelReceipt(record)}
          else if(accepted?.accepted){
            const run=build();await createBudgetReservations({state:callStore(record,config,estimate)}).finishExecution({reservationId:accepted.reservationId,ownerToken:accepted.ownerToken,run})
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
