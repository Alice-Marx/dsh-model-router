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
  const prepareExecutionFunding=async({packageEstimates,managedExecution})=>{
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
