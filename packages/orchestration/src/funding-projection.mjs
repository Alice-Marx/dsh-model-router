import {createHash} from 'node:crypto'
import {archiveSpending,dayKey,monthKey} from '../../../.dsh-plugin/shared/run-ledger.mjs'
import {archiveSubscriptionUsage,sanitizeArchivedSubscriptionUsage} from '../../../.dsh-plugin/shared/subscription-usage.mjs'
import {taskRef} from './task-contract.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const digest=text=>createHash('sha256').update(text).digest('hex')
const timezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone
const encode=value=>{const text=JSON.stringify(value);if(Buffer.byteLength(text)>2*1024*1024)fail('FUNDING_PROJECTION_LIMIT');return text}
const checked=row=>{if(!row||digest(row.payload)!==row.digest)fail('FUNDING_PROJECTION_CORRUPT');return JSON.parse(row.payload)}
const quantities=value=>Object.fromEntries(['days','months'].map(period=>[period,Object.fromEntries(Object.entries(value[period]).map(([key,bucket])=>[key,bucket.total.calls]))]))

/** Derived in the very same transaction as the single MR financial writer. */
export function createFundingProjection(db){
  db.exec(`CREATE TABLE IF NOT EXISTS router_funding_epochs(epoch TEXT PRIMARY KEY,timezone TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS router_funding_runs(epoch TEXT NOT NULL,run_id TEXT NOT NULL,bot_id TEXT,scope_id TEXT,project_id TEXT,payload TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(epoch,run_id));
    CREATE INDEX IF NOT EXISTS router_funding_owner ON router_funding_runs(epoch,bot_id,scope_id);`)
  if(!db.pragma('table_info(router_funding_runs)').some(column=>column.name==='project_id'))db.exec('ALTER TABLE router_funding_runs ADD COLUMN project_id TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS router_funding_project ON router_funding_runs(epoch,project_id)')
  const identity=(run,epoch)=>{
    const prior=db.prepare('SELECT bot_id,scope_id,project_id FROM router_funding_runs WHERE epoch=? AND run_id=?').get(epoch,run.id)
    const metadata=[run.modelCall,run.cliExecution,run.fundingExecution].filter(Boolean)
    const botIds=new Set(metadata.map(value=>value.botId).filter(value=>value!==null&&value!==undefined))
    const scopes=new Set(metadata.map(value=>value.fundingScopeId).filter(value=>value!==null&&value!==undefined))
    const projects=new Set(metadata.map(value=>value.fundingProjectId).filter(value=>value!==null&&value!==undefined))
    for(const row of db.prepare('SELECT bot_id,payload FROM router_model_calls WHERE run_id=?').all(run.id)){
      const receipt=JSON.parse(row.payload);botIds.add(row.bot_id);if(receipt.fundingScopeId)scopes.add(receipt.fundingScopeId);if(receipt.fundingProjectId)projects.add(receipt.fundingProjectId)
    }
    if(prior?.bot_id)botIds.add(prior.bot_id)
    if(prior?.scope_id)scopes.add(prior.scope_id)
    if(prior?.project_id)projects.add(prior.project_id)
    if(botIds.size>1||scopes.size>1||projects.size>1)fail('FUNDING_RUN_IDENTITY_CONFLICT')
    const botId=[...botIds][0]??null,scopeId=[...scopes][0]??null
    if(botId!==null)taskRef(botId);if(scopeId!==null)taskRef(scopeId)
    const projectId=[...projects][0]??null;if(projectId!==null)taskRef(projectId)
    return {botId,scopeId,projectId}
  }
  const project=(state,epoch)=>{
    const previous=db.prepare('SELECT * FROM router_funding_epochs WHERE epoch=?').get(epoch)
    if(previous){checked(previous);if(previous.timezone!==timezone())fail('FUNDING_TIMEZONE_CHANGED')}
    else{
      // The old archive has no reliable Bot/account attribution. Keep it once,
      // separately, and conservatively include it in every limited scope.
      const spending=archiveSpending([],state.archivedSpending),legacySubscription=quantities(sanitizeArchivedSubscriptionUsage(state.archivedSubscriptionUsage,{legacySpending:state.archivedSpending}))
      // Some old profiles contain an empty quantity archive alongside monetary
      // subscription markers. Their evidence is a conservative quota floor.
      for(const period of ['days','months'])for(const [key,value] of Object.entries(spending[period]))legacySubscription[period][key]=Math.max(legacySubscription[period][key]??0,value.subscriptionRuns??0)
      const payload=encode({...spending,legacySubscription})
      db.prepare('INSERT INTO router_funding_epochs VALUES(?,?,?,?)').run(epoch,timezone(),payload,digest(payload))
    }
    for(const run of state.runs){
      const prior=db.prepare('SELECT * FROM router_funding_runs WHERE epoch=? AND run_id=?').get(epoch,run.id)
      if(prior&&!db.prepare('SELECT 1 FROM router_runs WHERE id=?').get(run.id))fail('ROUTER_ARCHIVED_RUN_REPLAY')
      let boundedSum=0
      for(const item of [...(run.packages??[]),...(run.reviews??[])])for(const field of ['costUsd','knownCostUsd','referenceCostUsd']){
        if(typeof item[field]==='number'){boundedSum+=item[field];if(!Number.isFinite(boundedSum))fail('FUNDING_AMOUNT_OVERFLOW')}
      }
      const {botId,scopeId,projectId}=identity(run,epoch),payload=encode(archiveSpending([run]))
      // Retain only the CLI's compact execution proof after the UI run list is
      // pruned. No prompt, answer, raw output or credential is archived here.
      const execution=run.cliExecution?{id:run.id,status:run.status,createdAt:run.createdAt,finishedAt:run.finishedAt??null,managedExecution:run.managedExecution,cliExecution:run.cliExecution}:null
      // Source receipts cover their exact run/package. Preserve uninstrumented
      // legacy packages and prior attempts separately so migration/pruning never
      // resets a quota or counts one instrumented package twice.
      const covered=new Set(db.prepare("SELECT json_extract(payload,'$.packageId') AS id FROM router_model_calls WHERE run_id=? AND json_extract(payload,'$.funding')='subscription'").all(run.id).map(row=>row.id))
      const untracked=quantities(archiveSubscriptionUsage([{...run,packages:(run.packages??[]).filter(item=>!covered.has(item.id)),reviews:(run.reviews??[]).filter(item=>!covered.has(item.id))}]))
      const wrapped=encode({botId,scopeId,projectId,spending:JSON.parse(payload),execution,untrackedSubscription:untracked})
      db.prepare('INSERT INTO router_funding_runs(epoch,run_id,bot_id,scope_id,project_id,payload,digest) VALUES(?,?,?,?,?,?,?) ON CONFLICT(epoch,run_id) DO UPDATE SET bot_id=excluded.bot_id,scope_id=excluded.scope_id,project_id=excluded.project_id,payload=excluded.payload,digest=excluded.digest')
        .run(epoch,run.id,botId,scopeId,projectId,wrapped,digest(wrapped))
    }
  }
  const totals=({epoch,botId=null,scopeId=null,projectId=null,at=Date.now(),includeUnassigned=true})=>{
    if(botId!==null)taskRef(botId);if(scopeId!==null)taskRef(scopeId)
    if(projectId!==null)taskRef(projectId)
    if(!Number.isSafeInteger(at)||at<0||typeof includeUnassigned!=='boolean')fail('INVALID_FUNDING_QUERY')
    const baseline=db.prepare('SELECT * FROM router_funding_epochs WHERE epoch=?').get(epoch)
    if(!baseline)fail('FUNDING_PROJECTION_NOT_READY')
    if(baseline.timezone!==timezone())fail('FUNDING_TIMEZONE_CHANGED')
    const legacy=includeUnassigned?checked(baseline):archiveSpending([]),merged=archiveSpending([],legacy),unassigned=archiveSpending([],legacy)
    const add=(target,value)=>{
      for(const period of ['days','months'])for(const [key,entry] of Object.entries(value[period])){
        const row=target[period][key]??={costUsd:0,unknown:0,subscriptionUsd:0,subscriptionRuns:0}
        for(const field of Object.keys(row)){row[field]+=entry[field]??0;if(!Number.isFinite(row[field])||row[field]<0)fail('FUNDING_PROJECTION_CORRUPT')}
      }
    }
    const rows=db.prepare('SELECT * FROM router_funding_runs WHERE epoch=? AND (? IS NULL OR bot_id=? OR (?=1 AND bot_id IS NULL)) AND (? IS NULL OR scope_id=? OR (?=1 AND scope_id IS NULL)) AND (? IS NULL OR project_id=? OR (?=1 AND project_id IS NULL))')
      .all(epoch,botId,botId,includeUnassigned?1:0,scopeId,scopeId,includeUnassigned?1:0,projectId,projectId,includeUnassigned?1:0)
    for(const row of rows){
      const value=checked(row)
      if(value.botId!==row.bot_id||value.scopeId!==row.scope_id||(value.projectId??null)!==row.project_id)fail('FUNDING_PROJECTION_CORRUPT')
      add(merged,value.spending)
      if(row.bot_id===null||row.scope_id===null||projectId!==null&&row.project_id===null)add(unassigned,value.spending)
    }
    // The live query must not reapply the old global archive's retention limit:
    // many other dates must never prune the specific budget period being queried.
    const summarize=value=>{
      const day=value.days[dayKey(at)]??{},month=value.months[monthKey(at)]??{}
      return {today:day.costUsd??0,month:month.costUsd??0,unknownToday:day.unknown??0,unknownMonth:month.unknown??0,
        subscriptionToday:day.subscriptionUsd??0,subscriptionMonth:month.subscriptionUsd??0,subscriptionRunsToday:day.subscriptionRuns??0,subscriptionRunsMonth:month.subscriptionRuns??0}
    }
    return {...summarize(merged),unassigned:summarize(unassigned),timezone:baseline.timezone,includesUnassigned:includeUnassigned}
  }
  const execution=(runId,epoch)=>{
    const row=db.prepare('SELECT * FROM router_funding_runs WHERE epoch=? AND run_id=?').get(epoch,taskRef(runId))
    return row?checked(row).execution??null:null
  }
  const subscriptionTotals=({epoch,botId=null,scopeId=null,projectId=null,at=Date.now()})=>{
    // Validate identity, calendar and projection integrity through the same query.
    totals({epoch,botId,scopeId,projectId,at,includeUnassigned:true})
    const date=new Date(at),windows={days:[new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime(),new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime()],months:[new Date(date.getFullYear(),date.getMonth(),1).getTime(),new Date(date.getFullYear(),date.getMonth()+1,1).getTime()]}
    const baseline=checked(db.prepare('SELECT * FROM router_funding_epochs WHERE epoch=?').get(epoch)),keys={days:dayKey(at),months:monthKey(at)},result={}
    const rows=db.prepare('SELECT * FROM router_funding_runs WHERE epoch=? AND (? IS NULL OR bot_id=? OR bot_id IS NULL) AND (? IS NULL OR scope_id=? OR scope_id IS NULL) AND (? IS NULL OR project_id=? OR project_id IS NULL)').all(epoch,botId,botId,scopeId,scopeId,projectId,projectId)
    for(const [period,[from,to]] of Object.entries(windows)){
      const key=keys[period],fallback=value=>value[period]?.[key]?.subscriptionRuns??0
      let legacy=baseline.legacySubscription?(baseline.legacySubscription[period]?.[key]??0):fallback(baseline)
      for(const row of rows){const value=checked(row);legacy+=value.untrackedSubscription?(value.untrackedSubscription[period]?.[key]??0):fallback(value.spending)}
      const sourced=db.prepare("SELECT count(*) AS n FROM router_model_calls WHERE (? IS NULL OR bot_id=?) AND (? IS NULL OR json_extract(payload,'$.fundingScopeId')=? OR json_extract(payload,'$.fundingScopeId') IS NULL) AND (? IS NULL OR json_extract(payload,'$.fundingProjectId')=? OR json_extract(payload,'$.fundingProjectId') IS NULL) AND json_extract(payload,'$.funding')='subscription' AND json_extract(payload,'$.createdAt')>=? AND json_extract(payload,'$.createdAt')<? AND (json_extract(payload,'$.state')!='settled' OR json_extract(payload,'$.finishKind') IS NOT NULL)").get(botId,botId,scopeId,scopeId,projectId,projectId,from,to).n
      if(!Number.isSafeInteger(legacy)||legacy<0||!Number.isSafeInteger(legacy+sourced))fail('FUNDING_PROJECTION_CORRUPT')
      result[period==='days'?'today':'month']={calls:legacy+sourced,sourceCalls:sourced,legacyCalls:legacy}
    }
    return {...result,timezone:timezone()}
  }
  return Object.freeze({project,totals,identity,execution,subscriptionTotals})
}
