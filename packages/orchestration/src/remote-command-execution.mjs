import {setTimeout as sleep} from 'node:timers/promises'
import {parseRemoteTaskCommand,taskHash} from './task-contract.mjs'
const fail=code=>{throw Object.assign(new Error(code),{code})}
const terminal=new Set(['succeeded','failed','cancelled'])
const code=value=>/^[A-Z][A-Z0-9_]{0,80}$/.test(value??'')?value:'REMOTE_RECEIPT_UNAVAILABLE'

/**
 * Container-command Task backend. The bound Agent tool is the versioned
 * container_command_v1: a non-container Agent refuses it before any work and
 * there is no native fallback anywhere in this chain. Commands are argv-only
 * against the container configuration's owner-approved executables inside the
 * admitted physical workspace; effects are workspace-write and cancellation
 * is never rollback. Mirrors the remote-file backend's dispatch, polling,
 * unknown-outcome and reconciliation discipline.
 */
export function createRemoteCommandBackend({machines,directory,pollMs=100}={}){
 if(typeof machines!=='function'||typeof directory?.forBot!=='function'||!Number.isSafeInteger(pollMs)||pollMs<5||pollMs>1000)fail('REMOTE_TASK_SERVICES_REQUIRED')
 const machineStore=()=>{const value=machines();if(!value)fail('MACHINE_DIRECTORY_CLOSED');return value}
 const tool='container_command_v1'
 const scope=(subject,input,observe=false)=>machineStore().taskTarget(subject,{machineId:input.machineId,rootId:input.rootId,tool},{observe})
 const descriptor=(subject,input)=>{const t=scope(subject,input);return {machineId:t.machineId,workspaceId:'remote_'+taskHash({rootId:t.rootId}),remoteMachineRevision:t.remoteMachineRevision,remoteBindingRevision:t.remoteBindingRevision}}
 const stopProof=(source,reference,evidence)=>({schemaVersion:1,source,...reference.marker,referenceHash:taskHash(reference),evidenceHash:taskHash(evidence)})
 function receipt(value,reference){
  if(value?.schemaVersion!==1||value.machineId!==reference.machineId||value.operationId!==reference.operationId||value.tool!==tool||!['admitted','running','cancel_pending','unknown',...terminal].includes(value.status))return {outcome:'unknown',summary:{code:'REMOTE_RECEIPT_INVALID'}}
  const result=value.result
  // A container operation settles only with its supervisor receipt: strict
  // boolean stop evidence, never a terminal status alone.
  const stopped=result?.stopConfirmed===true||result?.notStarted===true
  const summary={source:'remote-command',operationId:value.operationId,machineId:value.machineId,status:value.status,stopConfirmed:stopped,possiblyApplied:!stopped||result?.possiblyApplied!==false,...(stopped?{stopEvidence:'container-supervisor',stopProof:stopProof('container-supervisor',reference,value)}:{})}
  if(value.status==='succeeded'){
   if(result?.kind!=='container-command'||!Number.isSafeInteger(result.exitCode))return {outcome:'unknown',summary:{...summary,code:'REMOTE_RECEIPT_INVALID',stopConfirmed:false}}
   if(!stopped)return {outcome:'unknown',summary:{...summary,code:'REMOTE_STOP_UNCONFIRMED'}}
   return {outcome:'succeeded',summary:{...summary,exitCode:result.exitCode,...(result.stdoutArtifactId?{stdoutArtifactId:result.stdoutArtifactId}:{}),...(result.stderrArtifactId?{stderrArtifactId:result.stderrArtifactId}:{}),truncated:result.truncated===true}}
  }
  if(terminal.has(value.status)&&stopped)return {outcome:value.status,summary:{...summary,...(value.error?{code:code(value.error.code)}:{}),...(result?.notStarted===true?{notStarted:true}:{}),...(Number.isSafeInteger(result?.exitCode)?{exitCode:result.exitCode}:{})}}
  if(terminal.has(value.status))return {outcome:'unknown',summary:{...summary,code:'REMOTE_STOP_UNCONFIRMED'}}
  return {outcome:'unknown',summary:{...summary,code:value.status==='unknown'?'REMOTE_OUTCOME_UNKNOWN':'REMOTE_OPERATION_ACTIVE'}}
 }
 const call=(subject,reference,name,signal,{expectedTarget}={})=>machineStore().call(subject,{machineId:reference.machineId,rootId:reference.rootId,taskId:reference.marker.taskId,attemptId:reference.marker.attemptId,operationId:reference.operationId,tool:name,args:{operationId:reference.operationId}},{signal,expectedTarget})
 return Object.freeze({id:'remote-command',version:'remote-command-v1',writeContract:'scoped-remote-command-v1',requiresExecutionInput:true,effect:'workspace-write',location:'remote',machineId:'remote-target',workspaceId:'remote-root',capability:`remote/${tool}`,retryCapability:`remote/${tool}`,reconcileCapability:'remote/operation_status',parse:parseRemoteTaskCommand,targetFor:descriptor,
  canObserve(subject,target,input){try{const current=scope(subject,input,true);return target.backend==='remote-command'&&target.version==='remote-command-v1'&&target.effect==='workspace-write'&&target.machineId===current.machineId&&target.workspaceId==='remote_'+taskHash({rootId:current.rootId})}catch{return false}},
  async run(context){
   const input=parseRemoteTaskCommand(context.input),subject=directory.forBot(context.ownerBotId),target=context.target
   const reference={kind:'remote-operation',machineId:input.machineId,rootId:input.rootId,tool,operationId:context.operationId,inputHash:taskHash(input),marker:{schemaVersion:1,taskId:context.binding.taskId,attemptId:context.binding.attemptId,operationId:context.operationId,targetHash:context.targetHash}}
   let requested=false,checkpointed=false
   try{
    context.signal.throwIfAborted();const prepared=descriptor(subject,input);if(taskHash(prepared)!==taskHash({machineId:target.machineId,workspaceId:target.workspaceId,remoteMachineRevision:target.remoteMachineRevision,remoteBindingRevision:target.remoteBindingRevision}))fail('MACHINE_GRANT_CHANGED')
    await context.checkpoint(reference);checkpointed=true;context.beforeRequest();context.signal.throwIfAborted()
    requested=true
    const expectedTarget={machineId:input.machineId,rootId:input.rootId,remoteMachineRevision:target.remoteMachineRevision,remoteBindingRevision:target.remoteBindingRevision}
    let value=await machineStore().call(subject,{machineId:input.machineId,rootId:input.rootId,taskId:context.binding.taskId,attemptId:context.binding.attemptId,operationId:context.operationId,tool,args:{rootId:input.rootId,workspaceRef:{kind:'remote',machineId:input.machineId,rootId:input.rootId,relativePath:input.workspaceRelativePath},argv:input.argv,timeoutMs:input.timeoutMs}},{signal:context.signal,expectedTarget})
    while(['admitted','running','cancel_pending'].includes(value.status)){
     await sleep(pollMs,undefined,{signal:context.signal});context.beforeRequest();value=await call(subject,reference,'operation_status',context.signal,{expectedTarget})
    }
    return receipt(value,reference)
   }catch(error){
    if(!requested||error.remoteDispatchNotSent===true){const outcome=context.signal.aborted?'cancelled':'failed',source='remote-dispatch-not-sent';return {outcome,summary:{source:'remote-command',status:outcome,code:code(error.code),notStarted:true,checkpointed,stopConfirmed:true,possiblyApplied:false,stopEvidence:source,stopProof:stopProof(source,reference,{operationId:reference.operationId,requested,checkpointed,code:code(error.code),dispatchNotSent:error.remoteDispatchNotSent===true})}}}
    if(context.signal.aborted){
     // Cancellation targets the original container and settles only through
     // its receipt: request the cancel, then observe the original operation
     // to its terminal state within a bounded window that tolerates a real
     // docker teardown. Anything less settles unknown, never a fake stop.
     try{
      const observation=scope(subject,input,true)
      const cancel=await call(subject,reference,'operation_cancel',AbortSignal.timeout(20000),{expectedTarget:observation})
      let value=cancel.operation,deadline=Date.now()+20000
      while(['admitted','running','cancel_pending'].includes(value.status)&&Date.now()<deadline){
       await sleep(pollMs)
       value=await call(subject,reference,'operation_status',AbortSignal.timeout(20000),{expectedTarget:observation})
      }
      const observed=receipt(value,reference)
      if((cancel.stopConfirmed===true||observed.summary.stopConfirmed===true)&&terminal.has(observed.outcome))return observed
     }catch{}
    }
    return {outcome:'unknown',summary:{code:code(error.code),operationId:reference.operationId,stopConfirmed:false,possiblyApplied:true}}
   }
  },
  async reconcile({reference,task,ownerBotId,signal}){
   if(reference?.kind!=='remote-operation'||reference.operationId!==task.operationId||reference.marker?.operationId!==task.operationId||reference.marker?.schemaVersion!==1||reference.marker?.taskId!==task.taskId||reference.marker?.attemptId!==task.attemptId||reference.marker?.targetHash!==task.input.targetHash||reference.tool!==tool)return {outcome:'unknown',reason:'REMOTE_REFERENCE_INVALID'}
   try{const subject=directory.forBot(ownerBotId),target=scope(subject,reference,true),value=await call(subject,reference,'operation_status',signal,{expectedTarget:target}),r=receipt(value,reference);return {outcome:r.outcome,referenceHash:taskHash(reference),evidenceHash:taskHash(value),...(r.outcome==='unknown'?{reason:r.summary.code}:{summary:r.summary}),evidence:{kind:'remote-operation',operationId:reference.operationId,machineId:reference.machineId,rootId:reference.rootId,tool,status:value.status}}}catch(e){return {outcome:'unknown',reason:code(e.code)}}
  },
 })
}
