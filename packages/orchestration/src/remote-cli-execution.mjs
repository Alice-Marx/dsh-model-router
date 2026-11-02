import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { createCliExecution } from './cli-execution.mjs'
import { parseRemoteTaskCli, taskHash } from './task-contract.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const terminal=new Set(['succeeded','failed','cancelled'])
const activeStatus=new Set(['admitted','running','cancel_pending'])
const HOST_NOT_STARTED=Symbol('host-not-started')
const validRef=value=>typeof value==='string'&&/^[-A-Za-z0-9_.]{1,128}$/.test(value)
const usageOf=value=>{
 const input=value?.inputTokens,output=value?.outputTokens,cached=value?.cachedInputTokens,write=value?.cacheWriteInputTokens
 const count=n=>Number.isSafeInteger(n)&&n>=0
 if(!count(input)||!count(output)||cached!==null&&cached!==undefined&&!count(cached)||write!==null&&write!==undefined&&!count(write)||count(cached)&&cached>input)return {usage:null,complete:false}
 return {usage:{inputTokens:count(cached)?input-cached:input,outputTokens:output,...(count(cached)?{cacheReadTokens:cached}:{}),...(count(write)?{cacheWriteTokens:write}:{})},complete:true}
}
const workspaceId=(input,profile)=>'remote_'+taskHash({rootId:input.rootId,workspaceRelativePath:input.workspaceRelativePath,profileId:profile.profileId,profileRevision:profile.profileRevision,entrySha256:profile.entry.sha256,entryVersion:profile.entry.version})

export function createRemoteCliReadBackend({machines,directory,store,authority,profiles,model,requestedModel,billing,pricing=null,estimatedCostUsd=null,
 dailyLimitUsd=1,monthlyLimitUsd=0,subscriptionMaxCalls=null,deadlineMs=120000,pollMs=2000,now=Date.now}={}){
 if(typeof machines!=='function'||typeof directory?.forBot!=='function'||!Array.isArray(profiles)||!profiles.length)fail('REMOTE_CLI_SERVICES_REQUIRED')
 const machineStore=()=>{const value=machines();if(!value)fail('MACHINE_DIRECTORY_CLOSED');return value}
 const inners=new Map()
 const profileFor=input=>{const matches=profiles.filter(p=>p.machineId===input.machineId&&p.rootId===input.rootId);if(matches.length!==1)fail('REMOTE_CLI_PROFILE_NOT_UNIQUE');return matches[0]}
 const targetFor=(subject,input)=>{
  const profile=profileFor(input),id=workspaceId(input,profile)
  const target=machineStore().taskTarget(subject,{machineId:input.machineId,rootId:input.rootId,tool:'cli_task_v1',profileId:profile.profileId,profileRevision:profile.profileRevision,entry:profile.entry,workspaceRelativePath:input.workspaceRelativePath,model})
  return {machineId:target.machineId,workspaceId:id,remoteMachineRevision:target.remoteMachineRevision,remoteBindingRevision:target.remoteBindingRevision}
 }
 const expectedTarget=(input,target)=>({machineId:input.machineId,rootId:input.rootId,remoteMachineRevision:target.remoteMachineRevision,remoteBindingRevision:target.remoteBindingRevision})
 const remoteIdentity=(input,target)=>{const profile=profileFor(input);return {input:structuredClone(input),profile:structuredClone(profile),target:structuredClone(target)}}
 const argsFor=(identity,requested)=>{
  const {input,profile}=identity
  return {rootId:input.rootId,workspaceRef:{kind:'remote',machineId:input.machineId,rootId:input.rootId,relativePath:input.workspaceRelativePath,workspaceId:identity.target.workspaceId},
   profileId:profile.profileId,profileRevision:profile.profileRevision,entry:{sha256:profile.entry.sha256,version:profile.entry.version},requestedModel,
   catalogProvider:model.provider,catalogModel:model.model,billing,deadlineMs}
 }
 const call=(subject,identity,context,tool,args,operationId,signal)=>machineStore().call(subject,{machineId:identity.input.machineId,rootId:identity.input.rootId,
  taskId:context.taskId,attemptId:context.attemptId,operationId,tool,args},{signal,expectedTarget:expectedTarget(identity.input,identity.target)})
 const notStartedSnapshot=(identity,botId,operationId,context)=>{
  const {input,profile}=identity
  return {[HOST_NOT_STARTED]:true,schemaVersion:1,source:'cli',toolId:'codex',botId,taskId:context.taskId,attemptId:context.attemptId,machineId:input.machineId,workspaceId:identity.target.workspaceId,location:'remote',operationId,
   entry:{path:null,sha256:profile.entry.sha256,version:profile.entry.version},remote:{rootId:input.rootId,workspaceRelativePath:input.workspaceRelativePath,profileId:profile.profileId,profileRevision:profile.profileRevision,workspaceIdentity:null},
   identity:{catalogProvider:model.provider,catalogModel:model.model,requestedCliModel:requestedModel,reportedCliModel:requestedModel,reportedProvider:'openai',actualResponseModel:null,verification:'not-dispatched',actualResponseModelVerified:false,reroutes:[]},
   usage:{inputTokens:null,outputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningOutputTokens:null,totalTokens:null,reported:false,status:'unknown'},billing:{kind:billing,amountUsd:null,amountStatus:billing==='subscription'?'not-applicable':'unknown'},
   terminal:'failed',finalText:'',cliTurnRequestsDispatched:0,actualProviderRequestCount:0,stopEvidence:{treeStopped:true,status:'not-started'}}
 }
 function snapshotValid(snapshot,identity,botId,operationId,context){
  if(!snapshot||snapshot.schemaVersion!==1||snapshot.source!=='cli'||snapshot.toolId!=='codex'||snapshot.botId!==botId
   ||snapshot.taskId!==context.taskId||snapshot.attemptId!==context.attemptId||snapshot.machineId!==identity.input.machineId
   ||snapshot.workspaceId!==identity.target.workspaceId||snapshot.location!=='remote'||snapshot.operationId!==operationId)return false
  const {input,profile}=identity,remote=snapshot.remote
  if(remote?.rootId!==input.rootId||remote.workspaceRelativePath!==input.workspaceRelativePath||remote.profileId!==profile.profileId||remote.profileRevision!==profile.profileRevision)return false
  if(snapshot.entry?.sha256!==profile.entry.sha256||snapshot.entry?.version!==profile.entry.version)return false
  if(snapshot[HOST_NOT_STARTED]===true)return snapshot.terminal==='failed'&&snapshot.cliTurnRequestsDispatched===0&&snapshot.stopEvidence?.treeStopped===true&&remote.workspaceIdentity===null
  const workspace=remote.workspaceIdentity
  if(!workspace||!/^[a-f0-9]{64}$/.test(workspace.key??'')||typeof workspace.path!=='string'||!workspace.path||workspace.path.length>4096||workspace.path.includes('\0')||!['win32','linux'].includes(workspace.platform))return false
  if(typeof snapshot.entry.path!=='string'||!snapshot.entry.path||snapshot.entry.path.length>4096||snapshot.entry.path.includes('\0'))return false
  const identityEvidence=snapshot.identity
  if(identityEvidence?.catalogProvider!==model.provider||identityEvidence.catalogModel!==model.model||identityEvidence.requestedCliModel!==requestedModel
   ||identityEvidence.actualResponseModel!==null||identityEvidence.actualResponseModelVerified!==false||!Array.isArray(identityEvidence.reroutes))return false
  if(!Number.isSafeInteger(snapshot.cliTurnRequestsDispatched)||snapshot.cliTurnRequestsDispatched<0||snapshot.cliTurnRequestsDispatched>1)return false
  if(!['unknown','partial','complete'].includes(snapshot.usage?.status)||typeof snapshot.usage?.reported!=='boolean')return false
  if(snapshot.usage.status==='complete'&&!usageOf(snapshot.usage).complete||snapshot.usage.status==='unknown'&&snapshot.usage.reported)return false
  return snapshot.stopEvidence&&typeof snapshot.stopEvidence.treeStopped==='boolean'
 }
 function operationSnapshot(value,identity,botId,operationId,context){
  if(value?.schemaVersion!==1||value.machineId!==identity.input.machineId||value.operationId!==operationId||value.tool!=='cli_task_v1'
   ||!['admitted','running','cancel_pending','unknown',...terminal].includes(value.status))fail('REMOTE_CLI_RECEIPT_INVALID')
  if(activeStatus.has(value.status)||value.status==='unknown'&&!value.result)return null
  const result=value.result
  if(result?.kind!=='remote-cli'||result.schemaVersion!==1||!snapshotValid(result.receipt,identity,botId,operationId,context))fail('REMOTE_CLI_RECEIPT_INVALID')
  if(result.stopConfirmed!==(result.receipt.stopEvidence?.treeStopped===true)||taskHash(result.stopEvidence)!==taskHash(result.receipt.stopEvidence))fail('REMOTE_CLI_STOP_UNCONFIRMED')
  if(value.status==='succeeded'&&(result.receipt.terminal!=='completed'||!result.stopConfirmed)||value.status==='cancelled'&&(result.receipt.terminal!=='interrupted'||!result.stopConfirmed))fail('REMOTE_CLI_RECEIPT_INVALID')
  return result.receipt
 }
 function remoteSession(identity,context,options,{resumeOnly=false}={}){
  const botId=authority.describe(context.subject).botId,operationId=context.operationId
  let operation=null,snapshot=null,requested=false,notSent=false,closed=false,closePromise=null
  const accept=value=>{operation=value;const next=operationSnapshot(value,identity,botId,operationId,context);if(next)snapshot=next;return value}
   // Only observation may retry after an authenticated rate limit. A task or
   // cancellation request is never redispatched by this loop. Each retry still
   // passes through current Host/Agent authorization and target revision checks.
   const status=async signal=>{
    for(let retries=0;;retries++){
     try{return await call(context.subject,identity,context,'operation_status',{operationId},operationId,signal)}
     catch(error){
      if(error?.code!=='AUTH_RATE_LIMIT'||!Number.isSafeInteger(error.retryAfterMs)||error.retryAfterMs<1||error.retryAfterMs>60000||retries>=2)throw error
      await sleep(error.retryAfterMs,undefined,{signal});options.onObserve?.()
     }
    }
   }
  const cancel=async()=>{
   if(!operation)return {treeStopped:requested&&!notSent?false:true,status:requested?'unconfirmed':'not-started'}
   if(snapshot&&terminal.has(operation?.status))return {...snapshot.stopEvidence,treeStopped:snapshot.stopEvidence?.treeStopped===true}
   try{
    const cancelled=await call(context.subject,identity,context,'operation_cancel',{operationId},operationId,AbortSignal.timeout(20000))
    accept(cancelled.operation)
    const deadline=Date.now()+20000
    while(operation&&activeStatus.has(operation.status)&&Date.now()<deadline){await sleep(pollMs);accept(await status(AbortSignal.timeout(20000)))}
    return {treeStopped:snapshot?.stopEvidence?.treeStopped===true&&cancelled.stopConfirmed===true||snapshot?.stopEvidence?.treeStopped===true&&terminal.has(operation?.status),...(snapshot?.stopEvidence??{})}
   }catch{return {treeStopped:false,status:'unconfirmed'}}
  }
  return {
   async run(task){
    try{
     if(!resumeOnly){
      await options.onBeforeRequest();requested=true
      try{accept(await call(context.subject,identity,context,'cli_task_v1',{...argsFor(identity,requestedModel),task},operationId,options.signal))}
      catch(error){if(error.remoteDispatchNotSent===true)notSent=true;throw error}
     }else accept(await status(options.signal))
     while(operation&&activeStatus.has(operation.status)){
      await sleep(pollMs,undefined,{signal:options.signal});options.onObserve?.();accept(await status(options.signal))
     }
     if(!snapshot)throw new Error('REMOTE_CLI_OUTCOME_UNKNOWN')
     return snapshot
    }catch(error){
     if(notSent||!requested&&!resumeOnly){error.cliDispatchNotSent=true;error.remoteDispatchNotSent=true;error.cliSnapshot=notStartedSnapshot(identity,botId,operationId,context)}
     throw error
    }
   },
   async close(){if(closed)return closePromise;closed=true;closePromise=cancel();return closePromise},
   snapshot(){return snapshot??notStartedSnapshot(identity,botId,operationId,context)},
  }
 }
 async function probe(subject,input){
  const parsed=parseRemoteTaskCli({...input,task:'probe'}),profile=profileFor(parsed),target=targetFor(subject,parsed),identity=remoteIdentity(parsed,target)
  const operationId=`probe-${randomUUID()}`,context={taskId:operationId,attemptId:`attempt-${randomUUID()}`,subject}
  const value=await call(subject,identity,context,'cli_probe_v1',argsFor(identity,requestedModel),operationId,AbortSignal.timeout(35000))
  const workspace=value?.workspaceIdentity
  if(value?.schemaVersion!==1||value.kind!=='remote-cli-probe'||value.status!=='available'||value.location!=='remote'||value.machineId!==parsed.machineId
   ||value.rootId!==parsed.rootId||value.workspaceId!==target.workspaceId||value.workspaceRelativePath!==parsed.workspaceRelativePath
   ||value.profileId!==profile.profileId||value.profileRevision!==profile.profileRevision||value.entry?.sha256!==profile.entry.sha256||value.entry?.version!==profile.entry.version
   ||value.requestedModel!==requestedModel||value.loginStatus!=='unknown'||!/^[a-f0-9]{64}$/.test(workspace?.key??''))fail('REMOTE_CLI_PROBE_INVALID')
  return {...value,toolId:'codex',configuredModel:requestedModel,actualResponseModelVerified:false,mode:'read-only'}
 }
 async function recover({subject,run,receipt,reference,signal}){
  const identity=reference.remote,context={subject,taskId:reference.marker.taskId,attemptId:reference.marker.attemptId,operationId:reference.marker.operationId}
  const observer=remoteSession(identity,context,{signal:signal??AbortSignal.timeout(20000)},{resumeOnly:true})
  let snapshot
  try{snapshot=await observer.run('')}catch{return null}
  const stopped=await observer.close()
  if(stopped.treeStopped!==true||snapshotValid(snapshot,identity,authority.describe(subject).botId,context.operationId,context)!==true)return null
  const outcome=snapshot.terminal==='completed'?'succeeded':snapshot.terminal==='failed'?'failed':snapshot.terminal==='interrupted'?'cancelled':'unknown'
  const observed=usageOf(snapshot.usage),inference=snapshot.cliTurnRequestsDispatched>0
  if(!terminal.has(outcome)||billing==='api'&&inference)return null
  const finishedAt=now(),item={id:'cli',provider:model.provider,model:model.model,toolId:'codex',channel:'official-cli',billing,ran:inference,ok:outcome==='succeeded',status:outcome,usage:observed.usage,usageIncomplete:!observed.complete,finishedAt,pricingSnapshot:pricing,
   costUsd:billing==='subscription'&&inference?0:null,costSource:!inference?'not-run':'subscription',actualModel:null}
  return {outcome,stopConfirmed:true,receipt:{finishedAt,usage:observed.usage,usageComplete:observed.complete,finishKind:snapshot.terminal,actualModel:null,reportedCostUsd:null},
   run:{status:outcome==='succeeded'?'completed':outcome,finishedAt,packages:[item]},cliExecution:{modelIdentity:snapshot.identity,cliTurnRequestsDispatched:snapshot.cliTurnRequestsDispatched,actualProviderRequestCount:snapshot.actualProviderRequestCount??null}}
 }
 function innerFor(subject,input,target){
  const identity=remoteIdentity(input,target),key=taskHash({botId:authority.describe(subject).botId,identity})
  if(inners.has(key))return inners.get(key)
  if(inners.size>=64)fail('REMOTE_CLI_BACKEND_LIMIT')
  const facade=createCliExecution({store,authority,directory,entry:profileFor(input).entry,runtimeRoot:null,workspace:null,machineId:input.machineId,workspaceId:target.workspaceId,
   model,requestedModel,billing,pricing,estimatedCostUsd,dailyLimitUsd,monthlyLimitUsd,subscriptionMaxCalls,deadlineMs,tools:[],handlers:[],now,
   location:'remote',referenceExtra:identity,remoteProbe:()=>probe(subject,input),stopSource:'remote-native-tree',
   snapshotValid:snapshot=>snapshotValid(snapshot,identity,authority.describe(subject).botId,snapshot?.operationId,{taskId:snapshot?.taskId,attemptId:snapshot?.attemptId}),
   sessionFactory:options=>remoteSession(identity,{subject,taskId:options.binding.taskId,attemptId:options.binding.attemptId,operationId:options.operationId},options),recover})
  const value={facade,input:structuredClone(input),target:structuredClone(target)};inners.set(key,value);return value
 }
 const compareTarget=(target,current)=>target&&current&&['machineId','workspaceId','remoteMachineRevision','remoteBindingRevision'].every(key=>target[key]===current[key])
 const backend={
  id:'remote-codex-read',version:'remote-cli-read-product-v1',effect:'read',location:'remote',atomicAdmission:true,requiresExecutionInput:true,
  machineId:'remote-target',workspaceId:'remote-root',capability:'remote/cli_task_v1',retryCapability:'remote/cli_task_v1',reconcileCapability:'remote/operation_status',model:Object.freeze(structuredClone(model)),
  parse:parseRemoteTaskCli,targetFor,
  canObserve(subject,target,input){try{return target.backend===backend.id&&target.version===backend.version&&target.effect==='read'&&target.location==='remote'&&compareTarget(target,targetFor(subject,parseRemoteTaskCli(input)))}catch{return false}},
  async run(context){
   const input=parseRemoteTaskCli(context.input),subject=directory.forBot(context.ownerBotId),current=targetFor(subject,input)
   if(!compareTarget(context.target,current))fail('MACHINE_GRANT_CHANGED')
   const inner=innerFor(subject,input,current),started=await inner.facade.start(subject,{task:input.task},context)
   if(started.outcome)return {outcome:started.outcome,summary:started.summary}
   return inner.facade.collect(subject,started.executionId)
  },
  async reconcile(context){
   const input=parseRemoteTaskCli(context.reference?.remote?.input),subject=directory.forBot(context.ownerBotId),current=targetFor(subject,input)
   if(!compareTarget(context.reference.remote.target,current))return {outcome:'unknown',reason:'MACHINE_GRANT_CHANGED'}
   return innerFor(subject,input,current).facade.reconcile(subject,context)
  },
  async probe(subject,input){return probe(subject,input)},
  async close(){await Promise.allSettled([...inners.values()].map(inner=>inner.facade.close()))},
 }
 return Object.freeze(backend)
}
