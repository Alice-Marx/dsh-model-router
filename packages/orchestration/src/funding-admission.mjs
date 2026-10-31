import {reservationSpending} from '../../../.dsh-plugin/shared/budget-reservations.mjs'
import {spending} from '../../../.dsh-plugin/shared/run-ledger.mjs'

const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0
const fail=code=>{throw Object.assign(new Error(code),{code})}

/** Read-only inside the financial store's pure CAS callback. Zero is a real cap. */
export function assessFundingAdmission({store,state,botId,scopeId=null,projectId=null,policy,estimatedCostUsd,excludeRunId=null,previousRun=null,prospectiveRun=null,now=Date.now()}){
  if(!valid(estimatedCostUsd))return {accepted:false,reason:'funding-estimate-unknown'}
  const definitions=[
    {name:'bot',query:{botId},daily:policy.botDailyLimitUsd,monthly:policy.botMonthlyLimitUsd,match:owner=>owner.botId===null||owner.botId===botId},
    {name:'account',query:{scopeId},daily:policy.accountDailyLimitUsd,monthly:policy.accountMonthlyLimitUsd,match:owner=>owner.scopeId===null||owner.scopeId===scopeId},
    {name:'project',query:{projectId},daily:policy.projectDailyLimitUsd,monthly:policy.projectMonthlyLimitUsd,match:owner=>owner.projectId===null||owner.projectId===projectId},
  ]
  const checked=[]
  const old=previousRun?spending([previousRun],now):null,next=previousRun&&prospectiveRun?spending([prospectiveRun],now):null
  for(const entry of definitions){
    const limits=[['today','daily',entry.daily],['month','monthly',entry.monthly]].filter(([, ,value])=>value!==undefined&&value!==null)
    if(!limits.length)continue
    if(limits.some(([, ,value])=>!valid(value))||entry.name==='account'&&!scopeId||entry.name==='project'&&!projectId)fail('INVALID_FUNDING_POLICY')
    const totals=store.fundingTotals({...entry.query,at:now,includeUnassigned:true})
    const holds=Object.fromEntries(Object.entries(state.budgetReservations??{}).filter(([id,hold])=>{
      if(id===excludeRunId)return false
      const run=state.runs.find(value=>value.id===hold.runId)
      return !run||entry.match(store.fundingIdentity(run))
    }))
    const reserved=reservationSpending({budgetReservations:holds})
    for(const [period,label,limit] of limits){
      const unknownKey=period==='today'?'unknownToday':'unknownMonth'
      const unknown=totals[unknownKey]+(next?next[unknownKey]-old[unknownKey]:0)
      if(unknown>0||reserved[unknownKey]>0)return {accepted:false,reason:`${entry.name}-${label}-usage-unknown`,scope:entry.name}
      const spent=totals[period]+(next?next[period]-old[period]:0),required=spent+reserved[period]+estimatedCostUsd
      // No absolute epsilon: it would turn a zero cap into a small paid budget.
      if(!Number.isFinite(required)||required<0||required>limit)return {accepted:false,reason:`${entry.name}-${label}-limit`,scope:entry.name,limitUsd:limit,spentUsd:spent,reservedUsd:reserved[period]}
    }
    checked.push(entry.name)
  }
  return {accepted:true,scopes:checked}
}
