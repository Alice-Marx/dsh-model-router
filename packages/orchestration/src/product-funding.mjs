import {openSqliteRouterState} from './sqlite-router-state.mjs'
import {createFundedRouterState} from './funded-router-state.mjs'

export async function openProductFunding({Database,file,legacyFile,policy,authority,pricingFor,now=Date.now}){
  const store=await openSqliteRouterState({Database,file,legacyFile,now})
  try{
    const funded=createFundedRouterState({store,policy,authority,pricingFor,now})
    return Object.freeze({store,funded,state:funded.state,close:()=>store.close()})
  }catch(error){
    await store.close().catch(()=>{})
    throw error
  }
}
