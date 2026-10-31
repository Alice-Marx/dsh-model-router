import {setTimeout as sleep} from 'node:timers/promises'
import {createHash} from 'node:crypto'
import {parseRemoteTaskWrite,taskHash} from './task-contract.mjs'
const fail=code=>{throw Object.assign(new Error(code),{code})},sha=content=>createHash('sha256').update(content).digest('hex')
const terminal=new Set(['succeeded','failed','cancelled'])
const code=value=>/^[A-Z][A-Z0-9_]{0,80}$/.test(value??'')?value:'REMOTE_RECEIPT_UNAVAILABLE'

/** Fixed file IO only; no shell, executable, credential or alternate endpoint. */
export function createRemoteWriteBackend({machines,directory,pollMs=100}={}){
 if(typeof machines!=='function'||typeof directory?.forBot!=='function'||!Number.isSafeInteger(pollMs)||pollMs<5||pollMs>1000)fail('REMOTE_TASK_SERVICES_REQUIRED')
 const machineStore=()=>{const value=machines();if(!value)fail('MACHINE_DIRECTORY_CLOSED');return value}
 const scope=(subject,input,observe=false)=>machineStore().taskTarget(subject,{machineId:input.machineId,rootId:input.rootId},{observe})
  const descriptor=(subject,input)=>{const t=scope(subject,input);return {machineId:t.machineId,workspaceId:'remote_'+taskHash({rootId:t.rootId}),remoteMachineRevision:t.remoteMachineRevision,remoteBindingRevision:t.remoteBindingRevision}}
  const stopProof=(source,reference,evidence)=>({schemaVersion:1,source,...reference.marker,referenceHash:taskHash(reference),evidenceHash:taskHash(evidence)})
  const agentStopped=(value,reference)=>{
   const {stopProof:proof,...operation}=value,marker=reference.marker
   return proof?.schemaVersion===1&&proof.kind==='agent-stop-receipt'&&proof.source==='in-process-write'&&proof.machineId===reference.machineId&&proof.taskId===marker.taskId&&proof.attemptId===marker.attemptId&&proof.operationId===reference.operationId&&proof.tool==='fs_write'&&proof.status===value.status&&proof.receiptHash===taskHash(operation)&&terminal.has(value.status)
  }
  function receipt(value,reference){
  if(value?.schemaVersion!==1||value.machineId!==reference.machineId||value.operationId!==reference.operationId||value.tool!=='fs_write'||!['admitted','running','cancel_pending','unknown',...terminal].includes(value.status))return {outcome:'unknown',summary:{code:'REMOTE_RECEIPT_INVALID'}}
   const stopped=agentStopped(value,reference)
   const source=value.status==='succeeded'?'agent-write-completed':'agent-stop-receipt'
   const summary={source:'remote-file',operationId:value.operationId,machineId:value.machineId,status:value.status,stopConfirmed:stopped,possiblyApplied:!stopped||value.result?.possiblyApplied!==false,...(stopped?{stopEvidence:source,stopProof:stopProof(source,reference,value)}:{})}
  if(value.status==='succeeded'){
   if(value.result?.sha256!==reference.expectedOutputHash||value.result?.size!==reference.expectedOutputBytes)return {outcome:'unknown',summary:{...summary,code:'REMOTE_RECEIPT_INVALID',stopConfirmed:false}}
    // Agent success is returned only after the synchronous write and cleanup
    // have completed; also verify the result is the requested content.
    if(!stopped)return {outcome:'unknown',summary:{...summary,code:'REMOTE_STOP_UNCONFIRMED'}}
    return {outcome:'succeeded',summary:{...summary,sha256:value.result.sha256,bytes:value.result.size}}
  }
   if(terminal.has(value.status)&&stopped)return {outcome:value.status,summary:{...summary,...(value.error?{code:code(value.error.code)}:{})}}
   if(terminal.has(value.status))return {outcome:'unknown',summary:{...summary,code:'REMOTE_STOP_UNCONFIRMED'}}
  return {outcome:'unknown',summary:{...summary,code:value.status==='unknown'?'REMOTE_OUTCOME_UNKNOWN':'REMOTE_OPERATION_ACTIVE'}}
 }
 const call=(subject,reference,tool,signal,{expectedTarget}={})=>machineStore().call(subject,{machineId:reference.machineId,rootId:reference.rootId,taskId:reference.marker.taskId,attemptId:reference.marker.attemptId,operationId:reference.operationId,tool,args:{operationId:reference.operationId}},{signal,expectedTarget})
 return Object.freeze({id:'remote-write',version:'remote-file-v1',writeContract:'scoped-remote-file-v1',requiresExecutionInput:true,effect:'workspace-write',location:'remote',machineId:'remote-target',workspaceId:'remote-root',capability:'remote/fs_write',retryCapability:'remote/fs_write',reconcileCapability:'remote/operation_status',parse:parseRemoteTaskWrite,targetFor:descriptor,
  canObserve(subject,target,input){try{const current=scope(subject,input,true);return target.backend==='remote-write'&&target.version==='remote-file-v1'&&target.effect==='workspace-write'&&target.machineId===current.machineId&&target.workspaceId==='remote_'+taskHash({rootId:current.rootId})}catch{return false}},
  async run(context){
   const input=parseRemoteTaskWrite(context.input),subject=directory.forBot(context.ownerBotId),target=context.target
   const reference={kind:'remote-operation',machineId:input.machineId,rootId:input.rootId,tool:'fs_write',operationId:context.operationId,inputHash:taskHash(input),expectedOutputHash:sha(input.content),expectedOutputBytes:Buffer.byteLength(input.content),marker:{schemaVersion:1,taskId:context.binding.taskId,attemptId:context.binding.attemptId,operationId:context.operationId,targetHash:context.targetHash}}
   let requested=false,checkpointed=false
   try{
    context.signal.throwIfAborted();const prepared=descriptor(subject,input);if(taskHash(prepared)!==taskHash({machineId:target.machineId,workspaceId:target.workspaceId,remoteMachineRevision:target.remoteMachineRevision,remoteBindingRevision:target.remoteBindingRevision}))fail('MACHINE_GRANT_CHANGED')
    await context.checkpoint(reference);checkpointed=true;context.beforeRequest();context.signal.throwIfAborted()
    requested=true
    const expectedTarget={machineId:input.machineId,rootId:input.rootId,remoteMachineRevision:target.remoteMachineRevision,remoteBindingRevision:target.remoteBindingRevision}
    let value=await machineStore().call(subject,{machineId:input.machineId,rootId:input.rootId,taskId:context.binding.taskId,attemptId:context.binding.attemptId,operationId:context.operationId,tool:'fs_write',args:{rootId:input.rootId,relativePath:input.relativePath,content:input.content,encoding:'utf8',expectedHash:input.expectedHash}},{signal:context.signal,expectedTarget})
    while(['admitted','running','cancel_pending'].includes(value.status)){
     await sleep(pollMs,undefined,{signal:context.signal});context.beforeRequest();value=await call(subject,reference,'operation_status',context.signal,{expectedTarget})
    }
    return receipt(value,reference)
   }catch(error){
    if(!requested||error.remoteDispatchNotSent===true){const outcome=context.signal.aborted?'cancelled':'failed',source='remote-dispatch-not-sent';return {outcome,summary:{source:'remote-file',status:outcome,code:code(error.code),notStarted:true,checkpointed,stopConfirmed:true,possiblyApplied:false,stopEvidence:source,stopProof:stopProof(source,reference,{operationId:reference.operationId,requested,checkpointed,code:code(error.code),dispatchNotSent:error.remoteDispatchNotSent===true})}}}
    if(context.signal.aborted){
     try{const observation=scope(subject,input,true),cancel=await call(subject,reference,'operation_cancel',AbortSignal.timeout(5000),{expectedTarget:observation});const observed=receipt(cancel.operation,reference);if(cancel.stopConfirmed===true&&terminal.has(observed.outcome))return observed}catch{}
    }
    return {outcome:'unknown',summary:{code:code(error.code),operationId:reference.operationId,stopConfirmed:false,possiblyApplied:true}}
   }
  },
  async reconcile({reference,task,ownerBotId,signal}){
   if(reference?.kind!=='remote-operation'||reference.operationId!==task.operationId||reference.marker?.operationId!==task.operationId||reference.marker?.schemaVersion!==1||reference.marker?.taskId!==task.taskId||reference.marker?.attemptId!==task.attemptId||reference.marker?.targetHash!==task.input.targetHash||reference.tool!=='fs_write')return {outcome:'unknown',reason:'REMOTE_REFERENCE_INVALID'}
   try{const subject=directory.forBot(ownerBotId),target=scope(subject,reference,true),value=await call(subject,reference,'operation_status',signal,{expectedTarget:target}),r=receipt(value,reference);return {outcome:r.outcome,referenceHash:taskHash(reference),evidenceHash:taskHash(value),...(r.outcome==='unknown'?{reason:r.summary.code}:{summary:r.summary}),evidence:{kind:'remote-operation',operationId:reference.operationId,machineId:reference.machineId,rootId:reference.rootId,tool:'fs_write',status:value.status}}}catch(e){return {outcome:'unknown',reason:code(e.code)}}
  },
 })
}
