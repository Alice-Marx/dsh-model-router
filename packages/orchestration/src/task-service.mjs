import { randomUUID } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'
import { canonicalTaskJson, taskHash, taskRef, parseTaskSubmit, parseTaskReference, parseTaskRetry, parseTaskReconcile, parseLegacyTaskRetry, parseTaskPlan, validateTaskPlan } from './task-contract.mjs'
import {withinTaskAdmission} from './task-admission.mjs'

const fail=code=>{throw new PolicyError(code)}

/** A single runner with registered effect-bound backends; disconnect never owns the task signal. */
export function createTaskService({journal,authority,directory,backends,within=(subject,signal,work)=>work(),now=Date.now,runnerTtlMs=15_000,taskTtlMs=120_000,maxActive=4,executionLeaseMs=30_000,concurrencyFor=()=>1,planTargetsFor=subject=>[authority.describe(subject).botId]}) {
  if(!Number.isSafeInteger(runnerTtlMs)||runnerTtlMs<500||runnerTtlMs>60_000||!Number.isSafeInteger(taskTtlMs)||taskTtlMs<1||taskTtlMs>7_200_000||!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>4||!Number.isSafeInteger(executionLeaseMs)||executionLeaseMs<100||executionLeaseMs>300_000||typeof authority.renew!=='function'||typeof concurrencyFor!=='function')fail('INVALID_TASK_SERVICE_LIMIT')
  const registry=new Map()
  for(const backend of backends) {
    if(backend.atomicAdmission===true&&journal.supportsAtomicAdmission!==true)fail('TASK_ATOMIC_CONNECTION_REQUIRED')
    taskRef(backend.id);taskRef(backend.version);taskRef(backend.machineId);taskRef(backend.workspaceId)
    for(const key of ['capability','retryCapability'])if(typeof backend[key]!=='string'||!backend[key]||backend[key].length>256)fail('INVALID_TASK_BACKEND')
    if((backend.reconcile!==undefined||backend.reconcileCapability!==undefined)&&(typeof backend.reconcile!=='function'||typeof backend.reconcileCapability!=='string'||!backend.reconcileCapability||backend.reconcileCapability.length>256))fail('INVALID_TASK_BACKEND')
    if(registry.has(backend.id)||!['read','workspace-write'].includes(backend.effect)||!['local','remote'].includes(backend.location)||typeof backend.parse!=='function'||typeof backend.run!=='function'||backend.targetFor!==undefined&&typeof backend.targetFor!=='function')fail('INVALID_TASK_BACKEND')
    if(backend.effect==='workspace-write'&&(!['scoped-remote-file-v1','scoped-remote-command-v1'].includes(backend.writeContract)||backend.location!=='remote'||typeof backend.targetFor!=='function'||typeof backend.canObserve!=='function'||typeof backend.reconcile!=='function'))fail('INVALID_TASK_BACKEND')
    registry.set(backend.id,backend)
  }
  const target=backend=>({backend:backend.id,version:backend.version,effect:backend.effect,machineId:backend.machineId,workspaceId:backend.workspaceId,location:backend.location,capability:backend.capability,retryCapability:backend.retryCapability,model:backend.model??null,...(backend.reconcileCapability?{reconcileCapability:backend.reconcileCapability}:{})})
  const resolvedTarget=(backend,subject,input)=>{
    const base=target(backend);if(!backend.targetFor)return base
    const value=backend.targetFor(subject,input)
    if(!value||Object.keys(value).some(k=>!['machineId','workspaceId','remoteMachineRevision','remoteBindingRevision'].includes(k)))fail('INVALID_TASK_BACKEND_TARGET')
    taskRef(value.machineId);taskRef(value.workspaceId)
    for(const key of ['remoteMachineRevision','remoteBindingRevision'])if(!Number.isSafeInteger(value[key])||value[key]<1)fail('INVALID_TASK_BACKEND_TARGET')
    return {...base,...value}
  }
  const owner=(subject,capability)=>{authority.assertTool(subject,capability);return authority.describe(subject).botId}
  const planReference=request=>{
    const value=JSON.parse(canonicalTaskJson(request))
    if(!value||Object.keys(value).length!==1||!Object.hasOwn(value,'planId'))fail('INVALID_TASK_REQUEST')
    return taskRef(value.planId)
  }
  const active=new Map()
  const observations=new Map()
  let identity,heartbeat,stopped=false,pumping=false,scheduled=false,closing
  const writable=()=>{if(stopped||!identity)fail('TASK_RUNNER_UNAVAILABLE')}
  const admit=(subject,payload,retry=false)=>{
    authority.assertTool(subject,'task/execute')
    const backend=registry.get(payload.backend)
    if(!backend||taskHash(resolvedTarget(backend,subject,payload.input))!==payload.targetHash)fail('TASK_BACKEND_CHANGED')
    authority.assertTool(subject,backend.capability)
    if(retry)authority.assertTool(subject,backend.retryCapability)
    if(backend.model)authority.assertModel(subject,backend.model.provider,backend.model.model)
    backend.parse(JSON.parse(canonicalTaskJson(payload.input)))
    return backend
  }
  const stopRunner=()=>{
    stopped=true;clearInterval(heartbeat)
    for(const entry of active.values())entry.controller.abort(new PolicyError('STALE_TASK_RUNNER'))
    for(const entry of observations.values())entry.controller.abort(new PolicyError('STALE_TASK_RUNNER'))
  }
  const execute=async(subject,task,backend,controller)=>{
    const binding={taskId:task.taskId,attemptId:task.attemptId,machineId:task.input.target.machineId,workspaceId:task.input.target.workspaceId,location:task.input.target.location}
    let lease,result,outcome,observedResult,renewal,admission,executionSignal,backendStarted=false,backendClosed=false
    const timer=setTimeout(()=>controller.abort(new PolicyError('TASK_DEADLINE')),Math.max(1,task.deadlineAt-now()))
    try {
      if(backend.atomicAdmission===true)admission=journal.createAdmission(identity,task.ownerBotId,task.taskId,task.attemptId,now,()=>{
        controller.signal.throwIfAborted();executionSignal?.throwIfAborted();admit(subject,task.input)
      })
      lease=authority.issue(subject,{binding,tools:['task/execute',backend.capability],ttlMs:Math.max(1,Math.min(executionLeaseMs,task.deadlineAt-now()))})
      renewal=setInterval(()=>{
        try{if(task.deadlineAt<=now())throw new PolicyError('TASK_DEADLINE');authority.renew(lease.token,binding,{ttlMs:Math.max(1,Math.min(executionLeaseMs,task.deadlineAt-now()))})}
        catch(error){controller.abort(error)}
      },Math.max(10,Math.floor(executionLeaseMs/3)));renewal.unref()
      result=await authority.run(lease.token,binding,backend.capability,({signal})=>within(subject,signal,async()=>{
        executionSignal=signal
        const run=()=>{
        // A delayed within/admission callback cannot dispatch after this
        // invocation has settled or after its authority was cancelled.
        if(backendClosed||backendStarted)fail('TASK_DISPATCH_CLOSED')
        signal.throwIfAborted();journal.beginDispatch(identity,task.ownerBotId,task.taskId,task.attemptId,now());backendStarted=true
        return backend.run({
        input:JSON.parse(canonicalTaskJson(task.input.input)),target:task.input.target,signal,binding,attemptNumber:task.attemptNumber,
        previous:task.attemptNumber>1?journal.get(task.ownerBotId,task.taskId).attempts.at(-2):null,
        legacyRunIds:task.legacyRunIds,
        operationId:task.operationId,targetHash:task.input.targetHash,
        ownerBotId:task.ownerBotId,
        checkpoint:reference=>admission?admission.checkpoint(reference):journal.linkExecution(identity,task.ownerBotId,task.taskId,task.attemptId,reference,now()),
        beforeAdmission:()=>admission?journal.assertPreparing(identity,task.ownerBotId,task.taskId,task.attemptId,now()):journal.assertDispatch(identity,task.ownerBotId,task.taskId,task.attemptId,now()),
        beforeRequest:()=>journal.assertDispatch(identity,task.ownerBotId,task.taskId,task.attemptId,now()),
        })}
        const value=await (admission?withinTaskAdmission(admission,run):run())
        canonicalTaskJson(value)
        observedResult=value
        return value
      }),{signal:controller.signal})
      if(!result||!['succeeded','failed','cancelled','unknown','waiting-budget'].includes(result.outcome))fail('INVALID_TASK_BACKEND_RESULT')
      canonicalTaskJson(result)
      outcome=result.outcome
    } catch(error) {
      backendClosed=true
      outcome=controller.signal.aborted||['GRANT_CHANGED','SUBJECT_REVOKED','LEASE_EXPIRED','AUTHORITY_CLOSED'].includes(error.code)?'cancelled':'failed'
      const hasReference=!!journal.get(task.ownerBotId,task.taskId).executionRef
      if(observedResult?.outcome==='unknown'||!observedResult&&hasReference)outcome='unknown'
      result={code:error instanceof PolicyError?error.code:'TASK_BACKEND_FAILED',
        ...(!backendStarted&&!hasReference?{notStarted:true}:{}),
        ...(observedResult?.legacyRunId?{legacyRunId:observedResult.legacyRunId}:{}),
        ...(observedResult?.summary?{summary:observedResult.summary}:{})}
    } finally {backendClosed=true;clearTimeout(timer);clearInterval(renewal);if(lease)authority.release(lease.token)}
    if(!backendStarted)journal.closeDispatch(identity,task.ownerBotId,task.taskId,task.attemptId,now())
    if(admission&&!admission.committed()){
      let proven=false;try{proven=admission.notDispatched()}catch{}
      if(!proven)outcome='unknown'
      else if(['unknown','succeeded'].includes(outcome))outcome=controller.signal.aborted?'cancelled':'failed'
      result={...result,admissionCommitted:false,notDispatched:proven}
    }
    try {journal.finish(identity,task.ownerBotId,task.taskId,task.attemptId,outcome,result,now())}
    catch(error) {if(error.code==='STALE_TASK_RUNNER')stopRunner();else{stopRunner();throw error}}
  }
  const pump=()=>{
    if(stopped||pumping)return
    pumping=true
    try {
      for(const item of journal.ready()) {
        if(active.size>=maxActive)break
        // A committed binding may allow several managed tasks per Bot. An
        // unconfigured Bot, or any answer outside the stored 1..32 range, keeps
        // the conservative single-task default instead of failing open.
        let running=0
        for(const entry of active.values())if(entry.owner===item.owner_bot)running++
        const allowed=concurrencyFor(item.owner_bot)
        if(running>=(Number.isSafeInteger(allowed)&&allowed>=1&&allowed<=32?allowed:1))continue
        let subject,backend
        try {
          if(journal.ownerBlocked(item.owner_bot))fail('TASK_RECONCILIATION_REQUIRED')
          subject=directory.forBot(item.owner_bot)
          backend=admit(subject,item.payload)
        }catch(error){journal.block(identity,item.owner_bot,item.id,error instanceof PolicyError?error.code:'TASK_POLICY_FAILED',now());continue}
        const task=journal.claim(identity,item.owner_bot,item.id,now(),{atomic:backend.atomicAdmission===true})
        if(!task)continue
        const controller=new AbortController()
        const work=execute(subject,task,backend,controller)
        active.set(task.taskId,{owner:item.owner_bot,controller,work})
        work.catch(()=>{}).finally(()=>{active.delete(task.taskId);schedule()})
      }
    }catch(error){stopRunner()}
    finally{pumping=false}
  }
  const schedule=()=>{
    if(stopped||scheduled)return
    scheduled=true
    queueMicrotask(()=>{scheduled=false;pump()})
  }
  const service=Object.freeze({
    start() {
      if(identity||stopped)fail('TASK_RUNNER_UNAVAILABLE')
      identity=journal.claimRunner(`runner-${randomUUID()}`,runnerTtlMs,now())
      journal.recover(identity,now())
      journal.expire(identity,now())
      heartbeat=setInterval(()=>{try{journal.renew(identity,runnerTtlMs,now());journal.expire(identity,now());schedule()}catch{stopRunner()}},Math.floor(runnerTtlMs/3))
      heartbeat.unref();schedule()
    },
    submit(subject,request) {
      writable();const id=owner(subject,'task/submit'),parsed=parseTaskSubmit(request)
      const backend=registry.get(parsed.backend)
      if(!backend)fail('TASK_BACKEND_UNAVAILABLE')
      const input=backend.parse(parsed.input),descriptor=resolvedTarget(backend,subject,input)
      const payload={backend:backend.id,input:JSON.parse(canonicalTaskJson(input)),target:descriptor,targetHash:taskHash(descriptor)}
      admit(subject,payload)
      const task=journal.submit(identity,id,parsed.requestKey,taskHash({kind:'submit',payload}),payload,now()+taskTtlMs,now())
      schedule();return task
    },
    submitPlan(subject,request,caller={}){
      writable();const id=owner(subject,'task/submit'),value=JSON.parse(canonicalTaskJson(request))
      if(!value||Object.keys(value).some(key=>!['requestKey','plan'].includes(key)))fail('INVALID_TASK_REQUEST')
      taskRef(value.requestKey)
      const plan=parseTaskPlan(value.plan)
      if(plan.origin.botId!==id)fail('TASK_PLAN_ORIGIN_MISMATCH')
      if(caller.sessionId!==undefined){
        if(plan.origin.sessionId!==null&&plan.origin.sessionId!==caller.sessionId)fail('TASK_PLAN_ORIGIN_MISMATCH')
        plan.origin.sessionId=taskRef(caller.sessionId)
      }
      // A trusted owner replay is a lookup of the original canonical command,
      // not a new dispatch. Its old Session may be detached or archived.
      if(caller.owner===true){const previous=journal.replayPlan(identity,id,value.requestKey,plan,now());if(previous)return previous}
      if(caller.owner!==true&&plan.origin.sessionId!==null&&directory.forSession(plan.origin.sessionId)!==subject)fail('TASK_PLAN_ORIGIN_MISMATCH')
      const allowed=planTargetsFor(subject,plan,caller)
      validateTaskPlan(plan,{knownBots:allowed})
      const payloads=plan.packages.map(item=>{
        let targetSubject
        try{targetSubject=directory.forBot(item.targetBotId)}catch{fail('TASK_PLAN_TARGET_UNKNOWN')}
        authority.assertTool(targetSubject,'task/submit')
        const backend=item.execution?registry.get(item.execution.backend):[...registry.values()].find(value=>value.effect===item.effectClass&&!value.requiresExecutionInput)
        if(!backend)fail('EXECUTION_FACADE_REQUIRED')
        if(backend.effect!==item.effectClass)fail('TASK_PLAN_EFFECT_MISMATCH')
        const input=backend.parse(item.execution?item.execution.input:{task:item.objective}),descriptor=resolvedTarget(backend,targetSubject,input)
        const payload={backend:backend.id,input:JSON.parse(canonicalTaskJson(input)),target:descriptor,targetHash:taskHash(descriptor)}
        admit(targetSubject,payload)
        return{id:item.id,payload}
      })
      const result=journal.submitPlan(identity,id,value.requestKey,plan,now(),{payloads,deadline:now()+taskTtlMs})
      schedule();return result
    },
    getPlan(subject,request){return journal.getPlan(owner(subject,'task/read'),planReference(request))},
    listPlans(subject){return journal.listPlans(owner(subject,'task/read'))},
    cancelPlan(subject,request){
      writable();const id=owner(subject,'task/cancel'),plan=journal.cancelPlan(identity,id,planReference(request),now())
      for(const taskId of plan.cancelledTaskIds)active.get(taskId)?.controller.abort(new PolicyError('TASK_CANCEL_REQUESTED'))
      schedule();return plan
    },
    get(subject,request) {const id=owner(subject,'task/read');return journal.get(id,parseTaskReference(request).taskId)},
    getLegacy(subject,runId) {return journal.fromLegacy(owner(subject,'task/read'),taskRef(runId))},
    cancel(subject,request) {
      writable();const id=owner(subject,'task/cancel'),taskId=parseTaskReference(request).taskId
      const task=journal.cancel(identity,id,taskId,now())
      for(const cancelled of task.cancelledTaskIds??[taskId])active.get(cancelled)?.controller.abort(new PolicyError('TASK_CANCEL_REQUESTED'))
      schedule()
      return task
    },
    retry(subject,request) {
      writable();const id=owner(subject,'task/retry'),parsed=parseTaskRetry(request),previous=journal.get(id,parsed.taskId)
      admit(subject,previous.input,true)
      const task=journal.retry(identity,id,parsed.taskId,parsed.requestKey,taskHash({kind:'retry',taskId:parsed.taskId}),now())
      schedule();return task
    },
    retryLegacy(subject,request) {
      const parsed=parseLegacyTaskRetry(request),id=owner(subject,'task/retry')
      const previous=journal.fromLegacy(id,parsed.runId)
      return service.retry(subject,{taskId:previous.taskId,requestKey:parsed.requestKey})
    },
    async reconcile(subject,request) {
      writable();const id=owner(subject,'task/reconcile'),parsed=parseTaskReconcile(request)
      const hash=taskHash({kind:'reconcile',taskId:parsed.taskId})
      const replay=journal.reconciliationReplay(identity,id,parsed.taskId,parsed.requestKey,hash,now())
      if(replay)return replay
      const task=journal.get(id,parsed.taskId),backend=registry.get(task.input.backend)
      if(task.state!=='needs-reconciliation')fail('TASK_RECONCILE_NOT_ALLOWED')
      if(!backend||typeof backend.reconcile!=='function'||!backend.reconcileCapability)fail('TASK_RECONCILER_UNAVAILABLE')
      const observeAllowed=backend.canObserve?backend.canObserve(subject,task.input.target,task.input.input):taskHash(target(backend))===task.input.targetHash
      if(!observeAllowed)fail('TASK_RECONCILER_UNAVAILABLE')
      authority.assertTool(subject,backend.reconcileCapability)
      const existing=observations.get(task.taskId)
      if(existing){if(existing.key!==parsed.requestKey)fail('TASK_RECONCILIATION_BUSY');return existing.work}
      if(observations.size>=4)fail('TASK_RECONCILIATION_BUSY')
      const controller=new AbortController()
      const work=(async()=>{
        const binding={taskId:task.taskId,attemptId:task.attemptId,machineId:task.input.target.machineId,workspaceId:task.input.target.workspaceId,location:task.input.target.location}
        let lease
        try{
          lease=authority.issue(subject,{binding,tools:['task/reconcile',backend.reconcileCapability],ttlMs:5000})
          const snapshot={taskId:task.taskId,attemptId:task.attemptId,operationId:task.operationId,input:{targetHash:task.input.targetHash}}
          const verdict=await authority.run(lease.token,binding,backend.reconcileCapability,({signal})=>backend.reconcile({task:snapshot,reference:task.executionRef,signal,ownerBotId:id}),{signal:controller.signal})
          canonicalTaskJson(verdict)
          const result=journal.reconcile(identity,id,task.taskId,task.attemptId,parsed.requestKey,hash,verdict,now());schedule();return result
        }finally{if(lease)authority.release(lease.token);observations.delete(task.taskId)}
      })()
      observations.set(task.taskId,{key:parsed.requestKey,controller,work})
      return work
    },
    async close() {
      if(closing)return closing
      stopped=true;clearInterval(heartbeat)
      for(const entry of active.values())entry.controller.abort(new PolicyError('TASK_HOST_STOPPED'))
      for(const entry of observations.values())entry.controller.abort(new PolicyError('TASK_HOST_STOPPED'))
      closing=(async()=>{await Promise.allSettled([...active.values(),...observations.values()].map(entry=>entry.work));if(identity)journal.release(identity,now());journal.close()})()
      return closing
    },
  })
  return service
}
