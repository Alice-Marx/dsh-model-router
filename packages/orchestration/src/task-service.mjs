import { randomUUID } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'
import { canonicalTaskJson, taskHash, taskRef, parseTaskSubmit, parseTaskReference, parseTaskRetry, parseLegacyTaskRetry } from './task-contract.mjs'

const fail=code=>{throw new PolicyError(code)}

/** A single runner, bounded read-only backends; request disconnect never owns the task signal. */
export function createTaskService({journal,authority,directory,backends,within=(subject,signal,work)=>work(),now=Date.now,runnerTtlMs=15_000,taskTtlMs=120_000,maxActive=4}) {
  if(!Number.isSafeInteger(runnerTtlMs)||runnerTtlMs<500||runnerTtlMs>60_000||!Number.isSafeInteger(taskTtlMs)||taskTtlMs<1||taskTtlMs>300_000||!Number.isSafeInteger(maxActive)||maxActive<1||maxActive>4)fail('INVALID_TASK_SERVICE_LIMIT')
  const registry=new Map()
  for(const backend of backends) {
    taskRef(backend.id);taskRef(backend.version);taskRef(backend.machineId);taskRef(backend.workspaceId)
    for(const key of ['capability','retryCapability'])if(typeof backend[key]!=='string'||!backend[key]||backend[key].length>256)fail('INVALID_TASK_BACKEND')
    if(registry.has(backend.id)||backend.effect!=='read'||!['local','remote'].includes(backend.location)||typeof backend.parse!=='function'||typeof backend.run!=='function')fail('INVALID_TASK_BACKEND')
    registry.set(backend.id,backend)
  }
  const target=backend=>({backend:backend.id,version:backend.version,effect:backend.effect,machineId:backend.machineId,workspaceId:backend.workspaceId,location:backend.location,capability:backend.capability,retryCapability:backend.retryCapability,model:backend.model??null})
  const owner=(subject,capability)=>{authority.assertTool(subject,capability);return authority.describe(subject).botId}
  const active=new Map()
  let identity,heartbeat,stopped=false,pumping=false,scheduled=false,closing
  const writable=()=>{if(stopped||!identity)fail('TASK_RUNNER_UNAVAILABLE')}
  const admit=(subject,payload,retry=false)=>{
    authority.assertTool(subject,'task/execute')
    const backend=registry.get(payload.backend)
    if(!backend||taskHash(target(backend))!==payload.targetHash)fail('TASK_BACKEND_CHANGED')
    authority.assertTool(subject,backend.capability)
    if(retry)authority.assertTool(subject,backend.retryCapability)
    if(backend.model)authority.assertModel(subject,backend.model.provider,backend.model.model)
    backend.parse(JSON.parse(canonicalTaskJson(payload.input)))
    return backend
  }
  const stopRunner=()=>{
    stopped=true;clearInterval(heartbeat)
    for(const entry of active.values())entry.controller.abort(new PolicyError('STALE_TASK_RUNNER'))
  }
  const execute=async(subject,task,backend,controller)=>{
    const binding={taskId:task.taskId,attemptId:task.attemptId,machineId:task.input.target.machineId,workspaceId:task.input.target.workspaceId,location:task.input.target.location}
    let lease,result,outcome,observedResult
    const timer=setTimeout(()=>controller.abort(new PolicyError('TASK_DEADLINE')),Math.max(1,task.deadlineAt-now()))
    try {
      lease=authority.issue(subject,{binding,tools:['task/execute',backend.capability],ttlMs:Math.max(1,Math.min(300_000,task.deadlineAt-now()))})
      result=await authority.run(lease.token,binding,backend.capability,({signal})=>within(subject,signal,async()=>{
        const value=await backend.run({
        input:JSON.parse(canonicalTaskJson(task.input.input)),signal,binding,attemptNumber:task.attemptNumber,
        previous:task.attemptNumber>1?journal.get(task.ownerBotId,task.taskId).attempts.at(-2):null,
        legacyRunIds:task.legacyRunIds,
        })
        canonicalTaskJson(value)
        observedResult=value
        return value
      }),{signal:controller.signal})
      if(!result||!['succeeded','failed','cancelled'].includes(result.outcome))fail('INVALID_TASK_BACKEND_RESULT')
      canonicalTaskJson(result)
      outcome=result.outcome
    } catch(error) {
      outcome=controller.signal.aborted||['GRANT_CHANGED','SUBJECT_REVOKED','LEASE_EXPIRED','AUTHORITY_CLOSED'].includes(error.code)?'cancelled':'failed'
      result={code:error instanceof PolicyError?error.code:'TASK_BACKEND_FAILED',
        ...(observedResult?.legacyRunId?{legacyRunId:observedResult.legacyRunId}:{}),
        ...(observedResult?.summary?{summary:observedResult.summary}:{})}
    } finally {clearTimeout(timer);if(lease)authority.release(lease.token)}
    try {journal.finish(identity,task.ownerBotId,task.taskId,task.attemptId,outcome,result,now())}
    catch(error) {if(error.code==='STALE_TASK_RUNNER')stopRunner();else{stopRunner();throw error}}
  }
  const pump=()=>{
    if(stopped||pumping)return
    pumping=true
    try {
      for(const item of journal.ready()) {
        if(active.size>=maxActive)break
        if([...active.values()].some(value=>value.owner===item.owner_bot))continue
        let subject,backend
        try {
          if(journal.ownerBlocked(item.owner_bot))fail('TASK_RECONCILIATION_REQUIRED')
          subject=directory.forBot(item.owner_bot)
          backend=admit(subject,item.payload)
        }catch(error){journal.block(identity,item.owner_bot,item.id,error instanceof PolicyError?error.code:'TASK_POLICY_FAILED',now());continue}
        const task=journal.claim(identity,item.owner_bot,item.id,now())
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
      heartbeat=setInterval(()=>{try{journal.renew(identity,runnerTtlMs,now())}catch{stopRunner()}},Math.floor(runnerTtlMs/3))
      heartbeat.unref();schedule()
    },
    submit(subject,request) {
      writable();const id=owner(subject,'task/submit'),parsed=parseTaskSubmit(request)
      const backend=registry.get(parsed.backend)
      if(!backend)fail('TASK_BACKEND_UNAVAILABLE')
      const input=backend.parse(parsed.input),descriptor=target(backend)
      const payload={backend:backend.id,input:JSON.parse(canonicalTaskJson(input)),target:descriptor,targetHash:taskHash(descriptor)}
      admit(subject,payload)
      const task=journal.submit(identity,id,parsed.requestKey,taskHash({kind:'submit',payload}),payload,now()+taskTtlMs,now())
      schedule();return task
    },
    get(subject,request) {const id=owner(subject,'task/read');return journal.get(id,parseTaskReference(request).taskId)},
    getLegacy(subject,runId) {return journal.fromLegacy(owner(subject,'task/read'),taskRef(runId))},
    cancel(subject,request) {
      writable();const id=owner(subject,'task/cancel'),taskId=parseTaskReference(request).taskId
      const task=journal.cancel(identity,id,taskId,now())
      active.get(taskId)?.controller.abort(new PolicyError('TASK_CANCEL_REQUESTED'))
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
    async close() {
      if(closing)return closing
      stopped=true;clearInterval(heartbeat)
      for(const entry of active.values())entry.controller.abort(new PolicyError('TASK_HOST_STOPPED'))
      closing=(async()=>{await Promise.allSettled([...active.values()].map(entry=>entry.work));if(identity)journal.release(identity,now());journal.close()})()
      return closing
    },
  })
  return service
}
