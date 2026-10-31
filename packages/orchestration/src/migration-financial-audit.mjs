import {createHash} from 'node:crypto'
import {inspectRouterState} from '../../../.dsh-plugin/shared/router-state.mjs'
import {spending,dayKey,monthKey} from '../../../.dsh-plugin/shared/run-ledger.mjs'
import {subscriptionUsage} from '../../../.dsh-plugin/shared/subscription-usage.mjs'
import {reservationSpending} from '../../../.dsh-plugin/shared/budget-reservations.mjs'

const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const stable=x=>Array.isArray(x)?x.map(stable):record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x
const hash=x=>digest(stable(x))
const fail=code=>{throw Object.assign(new Error(code),{code})}
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\0-\x1f\x7f]/.test(x)
const codes=new Set(['ROUTER_INPUT_REQUIRED','ROUTER_STATE_INVALID','DUPLICATE_MONEY_RUN','MONEY_HISTORY_INCOMPLETE','SUBSCRIPTION_HISTORY_INCOMPLETE','ACTIVE_OR_INTERRUPTED_HOLDS','ROUTER_MARKER_MISMATCH','LEDGER_EXPORT_REQUIRED','LEDGER_EXPORT_INVALID','LEDGER_AUTHORITY_INACTIVE','USAGE_EXPORT_INVALID','USAGE_EXPORT_REQUIRED','TIMEZONE_CONTEXT_REQUIRED','BUDGET_INPUT_INVALID','MONEY_ATTRIBUTION_CONFLICT'])
const limits={maxBytes:64*1024**2,maxRows:100000,maxDepth:64,maxNodes:500000}
function bounded(value){
 let nodes=0;const active=new Set()
 function visit(v,depth){
  if(++nodes>limits.maxNodes||depth>limits.maxDepth)fail('MIGRATION_FINANCE_LIMIT')
  if(v===null||['string','boolean'].includes(typeof v))return
  if(typeof v==='number'){if(!Number.isFinite(v))fail('MIGRATION_FINANCE_INPUT_INVALID');return}
  if(typeof v!=='object'||active.has(v))fail('MIGRATION_FINANCE_INPUT_INVALID')
  active.add(v)
  for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))){if(!Object.hasOwn(descriptor,'value'))fail('MIGRATION_FINANCE_INPUT_INVALID');if(Array.isArray(v)&&key==='length')continue;visit(descriptor.value,depth+1)}
  active.delete(v)
 }
 visit(value,0)
 if(Buffer.byteLength(JSON.stringify(value))>limits.maxBytes)fail('MIGRATION_FINANCE_LIMIT')
}
function ledger(exported){
 if(exported?.schemaVersion!==1||exported.kind!=='private-sqlite-ledger-export'||exported.databaseConsistent!==true||exported.crossDomainConsistent!==false||exported.requiresStopProof!==true||!Array.isArray(exported.tables)||!Array.isArray(exported.schema)||![0,1,2,3,4,5].includes(exported.userVersion))fail('LEDGER_EXPORT_INVALID')
 const {schemaVersion,kind,userVersion,pragmas,schema,tables}=exported
 if(digest({schemaVersion,kind,userVersion,pragmas,schema,tables})!==exported.contentDigest)fail('LEDGER_EXPORT_INVALID')
 const map=new Map();let n=0
 for(const table of tables){
  if(!validId(table.name)||map.has(table.name)||!Array.isArray(table.columns)||!Array.isArray(table.rows)||new Set(table.columns.map(c=>c.name)).size!==table.columns.length)fail('LEDGER_EXPORT_INVALID')
  const rows=[]
  for(const row of table.rows){
   if(++n>limits.maxRows||!Array.isArray(row.values)||row.values.length!==table.columns.length)fail('LEDGER_EXPORT_INVALID')
   const out=Object.create(null)
   row.values.forEach((cell,i)=>{
    if(!record(cell))fail('LEDGER_EXPORT_INVALID')
    let value
    if(cell.type==='null'&&Object.keys(cell).length===1)value=null
    else if(cell.type==='text'&&typeof cell.value==='string')value=cell.value
    else if(cell.type==='integer'&&typeof cell.value==='string'&&/^-?(?:0|[1-9]\d*)$/.test(cell.value)){value=BigInt(cell.value);if(value<-(2n**63n)||value>2n**63n-1n)fail('LEDGER_EXPORT_INVALID')}
    else if(cell.type==='real'&&typeof cell.value==='string'&&!Number.isNaN(Number(cell.value)))value=Number(cell.value)
    else if(cell.type==='blob'&&typeof cell.value==='string'&&Buffer.from(cell.value,'base64').toString('base64')===cell.value)value=Buffer.from(cell.value,'base64')
    else fail('LEDGER_EXPORT_INVALID')
    Object.defineProperty(out,table.columns[i].name,{enumerable:true,value})
   });rows.push(out)
  }
  map.set(table.name,{rows,digest:hash(table)})
 }
 if(exported.counts?.rows!==n||exported.counts?.tables!==tables.length||exported.counts?.schemaItems!==schema.length)fail('LEDGER_EXPORT_INVALID')
 return {tables:map,rows:n,contentDigest:exported.contentDigest,userVersion}
}
function required(data,name){const rows=data.tables.get(name)?.rows;if(!rows)fail('LEDGER_EXPORT_INVALID');return rows}
function jsonPayload(value){if(typeof value!=='string')fail('LEDGER_EXPORT_INVALID');try{return JSON.parse(value)}catch{fail('LEDGER_EXPORT_INVALID')}}
function routerFromLedger(data,marker){
 const rows=required(data,'router_meta'),m=required(data,'router_migration')
 if(rows.length!==1||m.length!==1||![1n,2n].includes(rows[0].schema_version))fail('LEDGER_EXPORT_INVALID')
 if(m[0].phase!=='active')fail('LEDGER_AUTHORITY_INACTIVE')
 const x=m[0]
 data.epoch=x.id
 if(marker?.version!==4||marker.migration?.kind!=='sqlite-router-ledger'||marker.migration.id!==x.id||marker.migration.sourceHash!==x.source_hash||marker.migration.backup!==x.backup?.split(/[\\/]/).at(-1))fail('ROUTER_MARKER_MISMATCH')
 const runs=required(data,'router_runs').map(row=>{const value=jsonPayload(row.payload);if(value?.id!==row.id)fail('LEDGER_EXPORT_INVALID');return value})
 const holds=required(data,'router_holds').map(row=>{const value=jsonPayload(row.payload);if(value?.id!==row.id||value.runId!==row.run_id)fail('LEDGER_EXPORT_INVALID');return[row.id,value]})
 return {...jsonPayload(rows[0].payload),runs,budgetReservations:Object.fromEntries(holds)}
}

export function classifyLegacyGlobalBudget(value,present=true){
 if(!present)return {kind:'unconfigured',scope:'shared-global'}
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('BUDGET_INPUT_INVALID')
 return value===0?{kind:'unbounded',scope:'shared-global'}:{kind:'amount',amountUsd:value,scope:'shared-global'}
}

/** PRIVATE only; inputs must be decoded JSON, no paths/SQL/connection or writes. */
export function auditMigrationFinance(input={}){
 bounded(input)
 const diagnostics=[],add=(code,severity='error')=>diagnostics.push({code,severity})
 const result={schemaVersion:1,kind:'private-migration-financial-audit',status:'blocked',diagnostics,router:null,usage:null,ledger:null,budgets:null,timeZone:typeof input.timeZone==='string'?input.timeZone:null,applySupported:false,requiresStopProof:true}
 if(result.timeZone!==Intl.DateTimeFormat().resolvedOptions().timeZone)add('TIMEZONE_CONTEXT_REQUIRED','needs-context')
 try{if(input.budgetConfig!==undefined&&!record(input.budgetConfig))fail('BUDGET_INPUT_INVALID');result.budgets=Object.fromEntries(['dailyBudgetUsd','monthlyBudgetUsd'].map(k=>[k,classifyLegacyGlobalBudget(input.budgetConfig?.[k],Object.hasOwn(input.budgetConfig??{},k))]))}catch{add('BUDGET_INPUT_INVALID')}
 let original=input.routerState,data
 if(input.ledgerExport!==undefined){
  try{data=ledger(input.ledgerExport);original=routerFromLedger(data,original);result.ledger={contentDigest:data.contentDigest,tables:[...data.tables].map(([name,value])=>({name,rows:value.rows.length,digest:value.digest})),rows:data.rows}}catch(e){add(codes.has(e.code)?e.code:'LEDGER_EXPORT_INVALID')}
 }else if(original?.version===4)add('LEDGER_EXPORT_REQUIRED','needs-context')
 if(original!==undefined&&original!==null&&original?.version!==4){
  try{
   const normalized=inspectRouterState(original),runs=new Map()
   for(const run of original.runs){if(!validId(run?.id)||runs.has(run.id))fail('DUPLICATE_MONEY_RUN');runs.set(run.id,hash(run))}
   if(normalized.historyIncomplete)add('MONEY_HISTORY_INCOMPLETE')
   if(normalized.subscriptionUsageIncomplete)add('SUBSCRIPTION_HISTORY_INCOMPLETE')
   const holds=Object.entries(original.budgetReservations??{}).map(([id,value])=>({id,digest:hash(value)}))
   if(Object.keys(normalized.budgetReservations).length)add('ACTIVE_OR_INTERRUPTED_HOLDS','needs-context')
   const dates=new Map(),addAt=at=>{if(typeof at==='number'&&Number.isFinite(new Date(at).getTime())){dates.set(dayKey(at),at);if(dates.size>1024)fail('MIGRATION_FINANCE_LIMIT')}}
   for(const key of Object.keys(normalized.archivedSpending.days))addAt(new Date(key+'T12:00:00').getTime())
   for(const key of Object.keys(normalized.archivedSpending.months))addAt(new Date(key+'-01T12:00:00').getTime())
   for(const key of Object.keys(normalized.archivedSubscriptionUsage.days))addAt(new Date(key+'T12:00:00').getTime())
   for(const key of Object.keys(normalized.archivedSubscriptionUsage.months))addAt(new Date(key+'-01T12:00:00').getTime())
   let unassigned=0;const attribution=[],recordedOwners=new Map()
   const appendOwner=(id,owner)=>{const list=recordedOwners.get(id)??[];list.push(owner);recordedOwners.set(id,list)}
   for(const receipt of data?.tables.get('router_model_calls')?.rows??[]){const payload=jsonPayload(receipt.payload);appendOwner(receipt.run_id,{botId:receipt.bot_id,fundingScopeId:payload.fundingScopeId,fundingProjectId:payload.fundingProjectId})}
   for(const row of data?.tables.get('router_funding_runs')?.rows??[])if(row.epoch===data.epoch)appendOwner(row.run_id,{botId:row.bot_id,fundingScopeId:row.scope_id,fundingProjectId:row.project_id})
   for(const run of normalized.runs){
    addAt(run.createdAt);for(const item of [...(run.packages??[]),...(run.reviews??[])])addAt(item.finishedAt??run.createdAt)
    for(const key of Object.keys(run.priorAttemptSpending?.days??{}))addAt(new Date(key+'T12:00:00').getTime())
    for(const key of Object.keys(run.priorAttemptSubscriptionUsage?.days??{}))addAt(new Date(key+'T12:00:00').getTime())
    for(const key of Object.keys(run.priorAttemptSpending?.months??{}))addAt(new Date(key+'-01T12:00:00').getTime())
    for(const key of Object.keys(run.priorAttemptSubscriptionUsage?.months??{}))addAt(new Date(key+'-01T12:00:00').getTime())
    const metadata=[run.modelCall,run.cliExecution,run.fundingExecution,...(recordedOwners.get(run.id)??[])].filter(record)
    const ids=field=>[...new Set(metadata.map(x=>x[field]).filter(x=>x!==null&&x!==undefined))].sort()
    const bot=ids('botId'),scope=ids('fundingScopeId'),project=ids('fundingProjectId')
    if(bot.length>1||scope.length>1||project.length>1)add('MONEY_ATTRIBUTION_CONFLICT')
    if(!bot.length)unassigned++
    attribution.push({runId:run.id,botIds:bot,scopeIds:scope,projectIds:project})
   }
   const calendar=[...dates].sort(([a],[b])=>a.localeCompare(b)).map(([day,at])=>({day,month:monthKey(at),money:spending(normalized.runs,at,normalized.archivedSpending),subscription:subscriptionUsage(normalized.runs,at,normalized.archivedSubscriptionUsage)}))
   const known=new Set(['version','runs','budgetReservations','historyIncomplete','subscriptionUsageIncomplete','onboarding','health','quota','authFailures','dynamicData','archivedSpending','archivedSubscriptionUsage','notices','terminalSessions'])
   const rawArchives=Object.fromEntries(['archivedSpending','archivedSubscriptionUsage'].map(k=>[k,Object.hasOwn(original,k)?original[k]:normalized[k]]))
   result.router={runCount:runs.size,holdCount:holds.length,unassignedRunCount:unassigned,runs:[...runs].sort(([a],[b])=>a.localeCompare(b)),holds:holds.sort((a,b)=>a.id.localeCompare(b.id)),attribution,calendar,reservations:reservationSpending(normalized),normalizedDigest:hash(normalized),rawArchiveDigest:hash(rawArchives),extensionDigest:hash(Object.fromEntries(Object.entries(original).filter(([k])=>!known.has(k)))),historyIncomplete:normalized.historyIncomplete,subscriptionUsageIncomplete:normalized.subscriptionUsageIncomplete}
  }catch(e){add(e.code==='DUPLICATE_MONEY_RUN'?e.code:'ROUTER_STATE_INVALID')}
 }else if(original===undefined)add('ROUTER_INPUT_REQUIRED','needs-context')
 if(input.usageExport!==undefined&&input.usageExport!==null){
  try{
   const usage=ledger(input.usageExport);if(usage.userVersion!==2)fail('USAGE_EXPORT_INVALID')
   const calls=required(usage,'calls'),owners=required(usage,'owners'),marks=required(usage,'marks'),kinds=required(usage,'kinds'),totals={input:0n,cache_read:0n,cache_write:0n,output:0n};let metered=0
   const keys=new Set()
   for(const call of calls){if(!validId(call.key)||keys.has(call.key)||typeof call.session!=='string'||![0n,1n].includes(call.live))fail('USAGE_EXPORT_INVALID');keys.add(call.key);if(call.live===1n)metered++;for(const key of Object.keys(totals)){if(typeof call[key]!=='bigint'||call[key]<0n)fail('USAGE_EXPORT_INVALID');totals[key]+=call[key]}}
   result.usage={contentDigest:usage.contentDigest,calls:calls.length,meteredCalls:metered,owners:owners.length,marks:marks.length,kinds:kinds.length,tokenTotals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,String(v)])),rows:usage.rows,accountingMeaning:'preserved-token-observations-not-USD-receipts'}
  }catch{add('USAGE_EXPORT_INVALID')}
 }else if(input.usageExport!==null)add('USAGE_EXPORT_REQUIRED','needs-context')
 result.status=diagnostics.some(x=>x.severity==='error')?'blocked':diagnostics.some(x=>x.severity==='needs-context')?'needs-context':'audited'
 result.fingerprint=hash({router:result.router,usage:result.usage,ledger:result.ledger,budgets:result.budgets,timeZone:result.timeZone})
 return result
}

export function reconcileMigrationFinance(before,after){
 for(const item of [before,after])if(item?.schemaVersion!==1||item.kind!=='private-migration-financial-audit'||item.fingerprint!==hash({router:item.router,usage:item.usage,ledger:item.ledger,budgets:item.budgets,timeZone:item.timeZone}))fail('MIGRATION_FINANCE_AUDIT_INVALID')
 const changes=['router','usage','ledger','budgets','timeZone'].filter(k=>hash(before[k])!==hash(after[k]))
 return {equal:changes.length===0,moneyEqual:changes.every(k=>k==='ledger'),changes,readyToApply:false,requiresStopProof:true}
}

export function summarizeMigrationFinance(result){
 const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=limits.maxRows?n:0
 return {schemaVersion:1,status:['audited','blocked','needs-context'].includes(result?.status)?result.status:'blocked',runs:count(result?.router?.runCount),holds:count(result?.router?.holdCount),unassignedRuns:count(result?.router?.unassignedRunCount),usageCalls:count(result?.usage?.calls),meteredUsageCalls:count(result?.usage?.meteredCalls),diagnostics:(Array.isArray(result?.diagnostics)?result.diagnostics:[]).slice(0,256).map(d=>({code:codes.has(d?.code)?d.code:'UNKNOWN_DIAGNOSTIC',severity:['error','warning','needs-context'].includes(d?.severity)?d.severity:'error'})),applySupported:false,requiresStopProof:true}
}
