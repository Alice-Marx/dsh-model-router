import {randomUUID} from 'node:crypto'
import {taskHash} from './task-contract.mjs'
import {assessFundingAdmission} from './funding-admission.mjs'
import {markManagedModelRequest,managedModelRequest} from './model-receipt.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const positive=value=>Number.isSafeInteger(value)&&value>0

/** Host-only adapter: MR retains its original one invoice and durable hold. */
export function createFundedRouterState({store,policy,authority,pricingFor,now=Date.now}){
  if(store?.kind!=='sqlite-router-state'||typeof policy?.activeIdentity!=='function'||typeof pricingFor!=='function')fail('FUNDING_SERVICES_REQUIRED')
  const configuration=async(execution=true)=>{
    const identity=policy.activeIdentity()
    if(!identity)return null
    if(identity.owner){if(execution)fail('OWNER_EXECUTION_FACADE_REQUIRED');return null}
    const config=structuredClone(await pricingFor({botId:identity.botId}))
    if(!config?.route?.provider||!config.route.model||config.funding!=='api'||!config.pricing||!positive(config.maxInputTokens)||!positive(config.maxOutputTokens))fail('MR_API_FUNDING_REQUIRED')
    for(const field of ['input','output','cacheRead','cacheWrite'])if(config.pricing[field]!==undefined&&(!Number.isFinite(config.pricing[field])||config.pricing[field]<0))fail('MODEL_PRICE_REQUIRED')
    if(config.pricing.input===undefined||config.pricing.output===undefined)fail('MODEL_PRICE_REQUIRED')
    authority.assertModel(identity.subject,config.route.provider,config.route.model);authority.assertTool(identity.subject,'model/infer')
    return{identity,config,hash:taskHash(config)}
  }
  const prepareOfficialFunding=async({packageEstimates,managedExecution,officialExecution})=>{
    // This descriptor is constructed by Host runner code, never parsed from
    // model arguments. Its admission callback cannot cross a JSON/RPC boundary.
    if(typeof officialExecution?.authorize!=='function'||!Array.isArray(officialExecution.requests)||!officialExecution.requests.length)fail('OFFICIAL_FUNDING_ADMISSION_REQUIRED')
    const identity=policy.activeIdentity()
    if(!identity?.subject||!identity.botId)fail('OFFICIAL_CALL_CONTEXT_REQUIRED')
    const requests=structuredClone(officialExecution.requests)
    const packageIds=new Set(requests.map(request=>request.packageId))
    if(packageIds.size!==requests.length||packageEstimates.some(item=>!packageIds.has(item.id)))fail('OFFICIAL_FUNDING_PACKAGES_INVALID')
    for(const request of requests){
      const {packageId,...selection}=request
      if(typeof packageId!=='string'||!packageId||typeof selection.toolId!=='string'||!selection.toolId)fail('OFFICIAL_FUNDING_PACKAGES_INVALID')
      await officialExecution.authorize(selection)
    }
    const latest=policy.activeIdentity()
    if(latest?.subject!==identity.subject||latest.botId!==identity.botId||latest.owner!==identity.owner)fail('OFFICIAL_SUBJECT_CHANGED')
    const toolIds=[...new Set(requests.map(request=>request.toolId))].sort()
    const task=managedExecution?.binding
    const marker={schemaVersion:1,source:'official-cli',botId:identity.botId,
      attemptId:task?.attemptId??`official-${randomUUID()}`,operationId:task?.operationId??`operation-${randomUUID()}`,
      fundingScopeId:`official-cli-${toolIds.length===1?toolIds[0]:'team'}`,toolIds,policyHash:taskHash(requests)}
    const assert=()=>authority.assertTool(identity.subject,identity.owner?'remote/startRun':'tool/model_router_tool_run')
    assert()
    const adapted={...store,checkExecutionFunding:({run,packages})=>{
      assert()
      if(taskHash(run?.fundingExecution??null)!==taskHash(marker))fail('FUNDING_RUN_IDENTITY_CONFLICT')
      if(packages.some(item=>!packageIds.has(item.id))||run.packages.some(item=>item.ran&&item.channel!=='official-cli'))fail('OFFICIAL_FUNDING_PACKAGES_INVALID')
      // Original global budget checks still run in the reservation manager.
      // There is no chat provider invoice, price substitution or subscription
      // call charge here: each CLI uses its own account and observed receipt.
      return {accepted:true,scopes:['official-cli']}
    }}
    return {state:adapted,packageEstimates,stamp(run){run.fundingExecution={...marker};return run},bind(){}}
  }
  const prepareExecutionFunding=async({packageEstimates,managedExecution,officialExecution})=>{
    if(officialExecution)return prepareOfficialFunding({packageEstimates,managedExecution,officialExecution})
    const prepared=await configuration()
    if(!prepared)return null
    if(policy.financialRunActive())fail('FINANCIAL_CALL_ALREADY_ACTIVE')
    if(packageEstimates.length!==1||packageEstimates[0].billing==='subscription')fail('FUNDING_SINGLE_API_PACKAGE_REQUIRED')
    const {identity,config,hash}=prepared,task=managedExecution?.binding
    const marker={schemaVersion:1,botId:identity.botId,attemptId:task?.attemptId??`funding-${randomUUID()}`,operationId:task?.operationId??`operation-${randomUUID()}`,policyHash:hash,
      ...(config.scopeId?{fundingScopeId:config.scopeId}:{}),...(config.projectId?{fundingProjectId:config.projectId}:{})}
    const estimate=(config.maxInputTokens*config.pricing.input+config.maxOutputTokens*config.pricing.output)/1e6
    if(!Number.isFinite(estimate))fail('MODEL_ESTIMATE_REQUIRED')
    const adapted={...store,checkExecutionFunding:({current,run,packages,excludeRunId=null,previousRun=null})=>{
      authority.assertTool(identity.subject,'model/infer');authority.assertModel(identity.subject,config.route.provider,config.route.model)
      if(taskHash(run?.fundingExecution??null)!==taskHash(marker))fail('FUNDING_RUN_IDENTITY_CONFLICT')
      const total=packages.reduce((sum,item)=>sum+(item.estimatedCostUsd??NaN),0)
      return assessFundingAdmission({store,state:current,botId:identity.botId,scopeId:config.scopeId,projectId:config.projectId,policy:config,estimatedCostUsd:total,excludeRunId,previousRun,prospectiveRun:run,now:now()})
    }}
    return{state:adapted,packageEstimates:[{...packageEstimates[0],billing:'api',estimatedCostUsd:estimate}],
      stamp(run){run.fundingExecution={...marker};return run},
      bind(binding){policy.bindFinancialRun({...binding,...marker,taskId:task?.taskId??null,config})},
    }
  }
  const routeProfiles=async routes=>{
    const prepared=await configuration(false)
    if(!prepared)return routes
    const {config}=prepared
    return routes.map(route=>route.provider===config.route.provider&&route.model===config.route.model?
      {...route,pricing:{...config.pricing},pricingSource:'bot-binding',execution:'api',billing:'api-only',subscription:'none',apiRoute:undefined}:route)
  }
  const bindModelRequest=(request,{agentLoop=false,ownRequest=false}={})=>{
    // Background DS memory/summary calls have their own invoice. Only a direct
    // MR call in this exact admitted tool frame may reference the MR invoice.
    if(agentLoop||ownRequest||managedModelRequest(request))return false
    const binding=policy.financialRun()
    if(!binding)return false
    if(request.provider!==binding.config.route.provider||request.model!==binding.config.route.model)fail('MODEL_MANAGED_OWNER_MISMATCH')
    markManagedModelRequest(request,{botId:binding.botId,taskId:binding.taskId,attemptId:binding.attemptId,operationId:binding.operationId,policyHash:binding.policyHash,
      runId:binding.runId,packageId:binding.packageId,provider:request.provider,model:request.model,source:'mr-api'})
    return true
  }
  return Object.freeze({state:Object.freeze({...store,prepareExecutionFunding}),routeProfiles,bindModelRequest})
}
