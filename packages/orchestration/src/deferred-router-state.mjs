/** Install the sole authority synchronously; early MR work waits for its startup. */
export function createDeferredRouterState({file}){
  let ready,reject,store,error
  const promise=new Promise((resolve,refuse)=>{ready=resolve;reject=refuse});promise.catch(()=>{})
  const asyncMethods=['read','update','completeOnboarding','saveHealth','saveQuota','saveAuthFailure','appendTerminalSession','appendRun','updateRun','dismissNotice','modelCalls','modelCall','recordModelReceipt','rollback','prepareExecutionFunding','close']
  const syncMethods=['status','fundingTotals','fundingIdentity','fundingExecution','fundingSubscriptionUsage','countModelCalls']
  const facade={kind:'sqlite-router-state',file}
  const fail=(code,cause)=>Object.assign(new Error(code),{code,...(cause?{cause}:{})})
  for(const key of asyncMethods)facade[key]=async(...args)=>{const target=await promise;return target[key](...args)}
  for(const key of syncMethods)facade[key]=(...args)=>{if(!store)throw error??fail('FINANCIAL_AUTHORITY_STARTING');return store[key](...args)}
  return Object.freeze({state:Object.freeze(facade),
    resolve(value){
      if(store||error)throw fail('FINANCIAL_AUTHORITY_CONFLICT')
      if(value?.kind!=='sqlite-router-state'||[...asyncMethods,...syncMethods].some(key=>typeof value[key]!=='function'))throw fail('FINANCIAL_AUTHORITY_INVALID')
      store=value;ready(value)
    },
    reject(cause){if(store||error)throw fail('FINANCIAL_AUTHORITY_CONFLICT');error=cause;reject(cause)},
  })
}
