import test from 'node:test'
import assert from 'node:assert/strict'
import {createDeferredRouterState} from '../packages/orchestration/src/deferred-router-state.mjs'

const asyncMethods=['read','update','completeOnboarding','saveHealth','saveQuota','saveAuthFailure','appendTerminalSession','appendRun','updateRun','dismissNotice','modelCalls','modelCall','recordModelReceipt','rollback','prepareExecutionFunding','close']
const syncMethods=['status','fundingTotals','fundingIdentity','fundingExecution','fundingSubscriptionUsage','countModelCalls']
function target(overrides={}){
  const value={kind:'sqlite-router-state',file:'ledger.sqlite'}
  for(const key of asyncMethods)value[key]=async(...args)=>({key,args})
  for(const key of syncMethods)value[key]=(...args)=>({key,args})
  return Object.freeze({...value,...overrides})
}

test('deferred router state: early async work waits for the funded authority and close delegates',async()=>{
  const deferred=createDeferredRouterState({file:'ledger.sqlite'}),state=deferred.state
  let finished=false
  const pending=state.read().then(value=>{finished=true;return value})
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(finished,false)
  const store=target();deferred.resolve(store)
  assert.deepEqual(await pending,{key:'read',args:[]})
  assert.deepEqual(await state.dismissNotice(7),{key:'dismissNotice',args:[7]})
  assert.deepEqual(await state.prepareExecutionFunding({run:1}),{key:'prepareExecutionFunding',args:[{run:1}]})
  assert.deepEqual(await state.close(),{key:'close',args:[]})
})

test('deferred router state: synchronous methods fail while starting and preserve startup rejection',async()=>{
  const deferred=createDeferredRouterState({file:'ledger.sqlite'}),cause=Object.assign(new Error('startup failed'),{code:'STARTUP_FAILED'})
  assert.throws(()=>deferred.state.fundingTotals({}),{code:'FINANCIAL_AUTHORITY_STARTING'})
  deferred.reject(cause)
  assert.throws(()=>deferred.state.fundingTotals({}),{code:'STARTUP_FAILED'})
  await assert.rejects(deferred.state.read(),{code:'STARTUP_FAILED'})
  await assert.rejects(deferred.state.close(),{code:'STARTUP_FAILED'})
  assert.throws(()=>deferred.reject(new Error('again')),{code:'FINANCIAL_AUTHORITY_CONFLICT'})
})

test('deferred router state: raw stores and incomplete adapters cannot become the authority',async()=>{
  const deferred=createDeferredRouterState({file:'ledger.sqlite'})
  assert.throws(()=>deferred.resolve({kind:'sqlite-router-state'}),{code:'FINANCIAL_AUTHORITY_INVALID'})
  assert.throws(()=>deferred.state.status(),{code:'FINANCIAL_AUTHORITY_STARTING'},'invalid resolve must not settle or partially install the facade')
  const store=target();deferred.resolve(store)
  assert.deepEqual(deferred.state.status(),{key:'status',args:[]})
  assert.throws(()=>deferred.resolve(store),{code:'FINANCIAL_AUTHORITY_CONFLICT'})
})

test('deferred router state: facade covers shared router operations and funding projections',async()=>{
  const deferred=createDeferredRouterState({file:'ledger.sqlite'}),store=target();deferred.resolve(store)
  for(const key of asyncMethods)assert.equal(typeof deferred.state[key],'function',key)
  for(const key of syncMethods)assert.equal(typeof deferred.state[key],'function',key)
  const change=()=>{},result=await deferred.state.updateRun('run',change)
  assert.equal(result.key,'updateRun');assert.equal(result.args[0],'run');assert.equal(result.args[1],change)
})
