import {canonicalTaskJson,taskHash,taskRef} from './task-contract.mjs'

const sources=new Set(['bot','aux','mr-api','cli','review'])
const states=new Set(['admitted','running','reported','settled','unknown'])
const immutable=['schemaVersion','id','runId','packageId','botId','sessionId','taskId','attemptId','operationId','source','provider','model','funding','pricing','requestHash','createdAt','ownerPid','fundingScopeId','fundingProjectId']
const keys=[...immutable,'state','finishedAt','usage','usageComplete','actualModel','reportedCostUsd','finishKind','outcome']
const fail=()=>{throw new Error('INVALID_MODEL_RECEIPT')}
export function normalizeModelReceipt(value){
  const r=JSON.parse(canonicalTaskJson(value))
  if(!r||Object.keys(r).some(k=>!keys.includes(k))||r.schemaVersion!==1||!sources.has(r.source)||!states.has(r.state)||!['api','subscription'].includes(r.funding))fail()
  for(const key of ['id','runId','packageId','botId','attemptId','operationId'])taskRef(r[key])
  for(const key of ['sessionId','taskId'])if(r[key]!==null)taskRef(r[key])
  for(const key of ['fundingScopeId','fundingProjectId'])if(Object.hasOwn(r,key)&&r[key]!==null)taskRef(r[key])
  for(const key of ['provider','model'])if(typeof r[key]!=='string'||!r[key]||r[key].length>512||/[\u0000-\u001f\u007f]/.test(r[key]))fail()
  if(!/^[a-f0-9]{64}$/.test(r.requestHash)||!Number.isSafeInteger(r.createdAt)||r.createdAt<0||!Number.isSafeInteger(r.ownerPid)||r.ownerPid<1||typeof r.usageComplete!=='boolean')fail()
  if(r.finishedAt!==null&&(!Number.isSafeInteger(r.finishedAt)||r.finishedAt<r.createdAt))fail()
  if(r.actualModel!==null&&(typeof r.actualModel!=='string'||r.actualModel.length>512))fail()
  if(r.reportedCostUsd!==null&&(!Number.isFinite(r.reportedCostUsd)||r.reportedCostUsd<0))fail()
  if(r.finishKind!==null&&(typeof r.finishKind!=='string'||r.finishKind.length>128))fail()
  if(![null,'succeeded','failed','cancelled','unknown'].includes(r.outcome))fail()
  if(r.usage!==null){if(typeof r.usage!=='object'||Array.isArray(r.usage)||Object.keys(r.usage).some(k=>!['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'].includes(k)||r.usage[k]!==null&&(!Number.isSafeInteger(r.usage[k])||r.usage[k]<0)))fail()}
  if(r.usageComplete&&(!r.usage||!['inputTokens','outputTokens'].every(k=>Number.isSafeInteger(r.usage[k])&&r.usage[k]>=0)))fail()
  if(r.pricing!==null){if(typeof r.pricing!=='object'||Array.isArray(r.pricing)||Object.keys(r.pricing).some(k=>!['input','output','cacheRead','cacheWrite'].includes(k)||!Number.isFinite(r.pricing[k])||r.pricing[k]<0))fail()}
  return r
}
// The scope field is additive: v1 receipts without it retain their original identity hash.
export const modelReceiptIdentity=receipt=>taskHash(Object.fromEntries(immutable.filter(k=>!['fundingScopeId','fundingProjectId'].includes(k)||Object.hasOwn(receipt,k)).map(k=>[k,receipt[k]])))

// A wire object cannot create this identity relationship. SDK stream middleware
// receives the original request object, even across deferred iterator pulls.
const managed=new WeakMap()
export function markManagedModelRequest(request,context){
  if(!request||typeof request!=='object'||managed.has(request))throw new Error('MODEL_REQUEST_ALREADY_BOUND')
  managed.set(request,Object.freeze({...context}))
}
export const managedModelRequest=request=>managed.get(request)
