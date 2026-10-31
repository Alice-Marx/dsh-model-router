import {createHash,randomUUID} from 'node:crypto'
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises'
import {basename,dirname,resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {createRouterStateAPI,initialRouterState,inspectRouterState,prepareRouterState,withRouterStateLock} from '../../../.dsh-plugin/shared/router-state.mjs'
import {normalizeModelReceipt,modelReceiptIdentity} from './model-receipt.mjs'
import {createFundingProjection} from './funding-projection.mjs'
import {taskRef} from './task-contract.mjs'
import {openTaskJournal} from './task-journal.mjs'
import {currentTaskAdmission,prepareTaskAdmission} from './task-admission.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const error=code=>Object.assign(new Error(code),{code})
const fail=code=>{throw error(code)}
const maxBytes=32*1024*1024
const serialize=value=>{const text=JSON.stringify(value)+'\n';if(Buffer.byteLength(text)>maxBytes)fail('ROUTER_STATE_INPUT_LIMIT');return text}
async function bytesOf(file){const handle=await open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maxBytes)fail('ROUTER_STATE_INPUT_LIMIT');const bytes=Buffer.alloc(stat.size+1);let size=0;while(size<bytes.length){const r=await handle.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead}if(size!==stat.size)fail('ROUTER_SOURCE_CHANGED');return bytes.subarray(0,size)}finally{await handle.close()}}
async function atomicFile(file,bytes){const temp=`${file}.${randomUUID()}.tmp`;let handle;try{handle=await open(temp,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temp,file)}finally{await handle?.close();await unlink(temp).catch(()=>{})}}

/** Normalized runs/holds and one metadata revision; no JSON money dual writer. */
export async function openSqliteRouterState({Database,file,legacyFile,now=Date.now,onStep=async()=>{},onAtomicStep=()=>{},maxRuns=200,mode='activate',lockStaleMs=15000}) {
  file=resolve(file);legacyFile=resolve(legacyFile)
  await mkdir(dirname(file),{recursive:true})
  const db=new Database(file)
  let funding
  try{
    // Startup DDL may race another process opening the same ledger. Runtime
    // CAS commits below use nonblocking acquisition so no await holds a lock.
    db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000')
    if(db.pragma('journal_mode=WAL',{simple:true})!=='wal')fail('ROUTER_WAL_REQUIRED')
    db.pragma('synchronous=FULL')
    if(![0,1,2,3,4,5].includes(db.pragma('user_version',{simple:true})))fail('ROUTER_DATABASE_VERSION_UNSUPPORTED')
    db.exec(`CREATE TABLE IF NOT EXISTS router_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_holds(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES router_runs(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_migration(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL,source TEXT NOT NULL,phase TEXT NOT NULL,source_hash TEXT NOT NULL,backup TEXT NOT NULL,rollback_payload TEXT);
      CREATE TABLE IF NOT EXISTS router_commits(revision INTEGER PRIMARY KEY,at_ms INTEGER NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_model_calls(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,task_id TEXT,run_id TEXT NOT NULL,identity_hash TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS router_model_calls_owner ON router_model_calls(bot_id,task_id);`)
    const schema=db.prepare('SELECT schema_version FROM router_meta WHERE singleton=1').get()
    if(schema&&![1,2].includes(schema.schema_version))fail('ROUTER_LEDGER_VERSION_UNSUPPORTED')
    if(schema?.schema_version===1)db.prepare('UPDATE router_meta SET schema_version=2 WHERE singleton=1').run()
    funding=createFundingProjection(db)
    db.pragma('busy_timeout=0')
  }catch(e){db.close();throw e}
  let closed=false,chain=Promise.resolve(),epoch
  const journals=new Set()
  const atomicStep=stage=>{const value=onAtomicStep(stage);if(value&&typeof value.then==='function')fail('ROUTER_SYNC_HOOK_REQUIRED')}
  const migration=()=>db.prepare('SELECT * FROM router_migration WHERE singleton=1').get()
  const transact=async work=>{
    const until=performance.now()+10_000
    while(true){
      try{db.exec('BEGIN IMMEDIATE');break}catch(e){if(e.code!=='SQLITE_BUSY'||performance.now()>=until)throw e;await sleep(10)}
    }
    try{const result=work();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}
  }
  const write=(value,revision,fundingEpoch=epoch)=>{
    // Capture each run before MAX_RUNS retention folds it into the global archive.
    // These are projections, never a second monetary writer.
    funding.project(value,fundingEpoch)
    const state=prepareRouterState(value,maxRuns),{runs,budgetReservations,...meta}=state
    const serialized=serialize(state)
    if(new Set(runs.map(run=>run.id)).size!==runs.length)fail('ROUTER_DUPLICATE_RUN_ID')
    if(Object.entries(budgetReservations).some(([id,hold])=>id!==hold.runId||!runs.some(run=>run.id===hold.runId)))fail('ROUTER_ORPHAN_RESERVATION')
    db.prepare('DELETE FROM router_holds').run();db.prepare('DELETE FROM router_runs').run()
    for(const run of runs)db.prepare('INSERT INTO router_runs VALUES(?,?)').run(run.id,serialize(run))
    for(const [id,hold] of Object.entries(budgetReservations))db.prepare('INSERT INTO router_holds VALUES(?,?,?)').run(id,hold.runId,serialize(hold))
    db.prepare('INSERT INTO router_meta VALUES(1,2,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(revision,serialize(meta))
    db.prepare('INSERT INTO router_commits VALUES(?,?,?)').run(revision,now(),hash(serialized))
  }
  const snapshot=()=>db.transaction(()=>{
    const row=db.prepare('SELECT * FROM router_meta WHERE singleton=1').get(),m=migration()
    if(!row||row.schema_version!==2||m?.phase!=='active'||m.id!==epoch)fail('ROUTER_AUTHORITY_INACTIVE')
    const value={...JSON.parse(row.payload),runs:db.prepare('SELECT payload FROM router_runs ORDER BY rowid').all().map(r=>JSON.parse(r.payload)),budgetReservations:Object.fromEntries(db.prepare('SELECT id,payload FROM router_holds').all().map(r=>[r.id,JSON.parse(r.payload)]))}
    return {revision:row.revision,state:inspectRouterState(value)}
  })()
  const markerFor=m=>({version:4,migration:{kind:'sqlite-router-ledger',id:m.id,sourceHash:m.source_hash,backup:basename(m.backup)}})
  const markerMatches=(parsed,m)=>parsed?.version===4&&parsed.migration?.kind==='sqlite-router-ledger'&&parsed.migration.id===m.id&&parsed.migration.sourceHash===m.source_hash&&parsed.migration.backup===basename(m.backup)
  const checkMarker=async()=>{
    if(closed)fail('ROUTER_STORE_CLOSED')
    const m=migration();if(m?.phase!=='active'||m.id!==epoch)fail('ROUTER_AUTHORITY_INACTIVE')
    let parsed;try{parsed=JSON.parse(await bytesOf(legacyFile))}catch{fail('ROUTER_AUTHORITY_MARKER_MISSING')}
    if(!markerMatches(parsed,m))fail('ROUTER_AUTHORITY_CHANGED')
  }
  const withLock=work=>withRouterStateLock(legacyFile,work,{staleMs:lockStaleMs,timeoutMs:Math.max(10000,lockStaleMs+5000)})
  try{await withLock(async()=>{
    let bytes
    try{bytes=await bytesOf(legacyFile)}catch(e){if(e.code!=='ENOENT')throw e;bytes=Buffer.from(serialize(initialRouterState()));await atomicFile(legacyFile,bytes)}
    const parsed=JSON.parse(bytes.toString('utf8'));let m=migration()
    if(mode==='resume-rollback'){
      if(!m||m.source!==legacyFile||!['rollback-prepared','rolled-back'].includes(m.phase))fail('ROUTER_ROLLBACK_NOT_PREPARED')
      if(m.phase==='rollback-prepared'){
        if(markerMatches(parsed,m))await atomicFile(legacyFile,m.rollback_payload)
        else if(hash(bytes)!==hash(m.rollback_payload))fail('ROUTER_ROLLBACK_SOURCE_CHANGED')
        await transact(()=>{db.prepare("UPDATE router_migration SET phase='rolled-back' WHERE singleton=1 AND id=?").run(m.id)})
      }
      epoch=m.id;return
    }
    if(mode!=='activate')fail('ROUTER_MIGRATION_MODE_INVALID')
    if(parsed.version===4){
      if(!m||m.source!==legacyFile||!markerMatches(parsed,m)||!['prepared','active'].includes(m.phase))fail('ROUTER_MIGRATION_MARKER_CONFLICT')
      if(hash(await bytesOf(m.backup))!==m.source_hash)fail('ROUTER_MIGRATION_BACKUP_CHANGED')
    }else{
      if(m&&!['prepared','rolled-back'].includes(m.phase))fail('ROUTER_AUTHORITY_CHANGED')
      const state=inspectRouterState(parsed)
      if(state.historyIncomplete||state.subscriptionUsageIncomplete)fail('ROUTER_MIGRATION_HISTORY_INCOMPLETE')
      if(Object.values(state.budgetReservations).some(hold=>hold.status==='active'))fail('ROUTER_MIGRATION_ACTIVE_EXECUTIONS')
      const sourceHash=hash(bytes),backup=`${legacyFile}.pre-sqlite-${sourceHash}.backup`
      let handle
      try{handle=await open(backup,'wx');await handle.writeFile(bytes);await handle.sync()}catch(e){if(e.code!=='EEXIST')throw e;if(hash(await bytesOf(backup))!==sourceHash)fail('ROUTER_MIGRATION_BACKUP_CHANGED')}finally{await handle?.close()}
      m={id:randomUUID(),source:legacyFile,source_hash:sourceHash,backup,phase:'prepared'}
      await transact(()=>{
        const current=migration();if(current&&!['prepared','rolled-back'].includes(current.phase))fail('ROUTER_AUTHORITY_CHANGED')
        const revision=(db.prepare('SELECT revision FROM router_meta WHERE singleton=1').get()?.revision??0)+1
        write(state,revision,m.id)
        db.prepare('INSERT INTO router_migration VALUES(1,?,?,?,?,?,NULL) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id,source=excluded.source,phase=excluded.phase,source_hash=excluded.source_hash,backup=excluded.backup,rollback_payload=NULL').run(m.id,m.source,m.phase,m.source_hash,m.backup)
      })
      await onStep('prepared')
      await atomicFile(legacyFile,serialize(markerFor(m)));await onStep('marker-written')
    }
    await transact(()=>{const current=migration();if(current.id!==m.id||!['prepared','active'].includes(current.phase))fail('ROUTER_AUTHORITY_CHANGED');db.prepare("UPDATE router_migration SET phase='active' WHERE singleton=1").run()})
    epoch=m.id;await onStep('active')
  })
    if(mode==='activate')await transact(()=>funding.project(snapshot().state,epoch))
  }catch(e){db.close();closed=true;throw e}
  const applyReceipt=value=>{
    const receipt=normalizeModelReceipt(value),identity=modelReceiptIdentity(receipt)
    const old=db.prepare('SELECT * FROM router_model_calls WHERE id=?').get(receipt.id)
    if(old){
      const previous=JSON.parse(old.payload)
      if(old.identity_hash!==identity)fail('MODEL_RECEIPT_IDENTITY_CONFLICT')
      if(['settled','unknown'].includes(previous.state)&&serialize(previous)!==serialize(receipt))fail('MODEL_RECEIPT_ALREADY_FINAL')
      const order={admitted:0,running:1,reported:2,settled:3,unknown:3}
      if(order[receipt.state]<order[previous.state])fail('MODEL_RECEIPT_STATE_REGRESSION')
    }else if(!['admitted','running'].includes(receipt.state))fail('MODEL_RECEIPT_ADMISSION_REQUIRED')
    funding.identity({id:receipt.runId,modelCall:{botId:receipt.botId,...(receipt.fundingScopeId?{fundingScopeId:receipt.fundingScopeId}:{}),...(receipt.fundingProjectId?{fundingProjectId:receipt.fundingProjectId}:{})}},epoch)
    db.prepare('INSERT INTO router_model_calls VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(receipt.id,receipt.botId,receipt.taskId,receipt.runId,identity,serialize(receipt))
  }
  const update=(change,{retrySafe=false,modelReceipt}={})=>{
    const admission=currentTaskAdmission()
    if(modelReceipt)modelReceipt=normalizeModelReceipt(modelReceipt)
    const next=chain.then(async()=>{
      for(let tries=0;tries<16;tries++){
        await checkMarker();const before=snapshot(),candidate=structuredClone(before.state)
        const result=await change(candidate),returned=result===undefined?undefined:structuredClone(result)
        try{
          const publish=await transact(()=>{
            const m=migration(),row=db.prepare('SELECT revision FROM router_meta WHERE singleton=1').get()
            if(m?.id!==epoch||m.phase!=='active')fail('ROUTER_AUTHORITY_INACTIVE')
            if(row.revision!==before.revision)fail('ROUTER_STATE_CONFLICT')
            if(modelReceipt&&result?.accepted!==false)applyReceipt(modelReceipt)
            const publish=prepareTaskAdmission(admission,db,candidate,result)
            if(publish)atomicStep('task-linked-before-money')
            write(candidate,row.revision+1)
            if(publish)atomicStep('money-written-before-commit')
            return publish
          })
          publish?.()
          if(publish)atomicStep('admission-committed')
          return returned
        }catch(e){if(e.code!=='ROUTER_STATE_CONFLICT'||!retrySafe||tries===15)throw e;await sleep(Math.min(25,tries+1))}
      }
    });chain=next.catch(()=>{});return next
  }
  const read=async()=>{await chain;await checkMarker();return structuredClone(snapshot().state)}
  const rollback=async()=>{
    await chain
    return withLock(async()=>{
      let m=migration(),bytes=await bytesOf(legacyFile)
      if(m.id!==epoch)fail('ROUTER_AUTHORITY_INACTIVE')
      if(m.phase==='rolled-back')return {status:'rolled-back',sourceHash:hash(bytes)}
      if(m.phase==='active'){
        if(!markerMatches(JSON.parse(bytes),m))fail('ROUTER_AUTHORITY_CHANGED')
        await transact(()=>{
          const current=snapshot().state
          if(Object.keys(current.budgetReservations).length)fail('ROUTER_ROLLBACK_UNRESOLVED_HOLDS')
          const tasks=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks'").get()
          if(tasks&&db.prepare("SELECT 1 FROM tasks WHERE state NOT IN ('succeeded','failed','cancelled') LIMIT 1").get())fail('ROUTER_ROLLBACK_ACTIVE_TASKS')
          db.prepare("UPDATE router_migration SET phase='rollback-prepared',rollback_payload=? WHERE singleton=1 AND id=?").run(serialize(current),epoch)
        });await onStep('rollback-prepared');m=migration()
      }
      if(m.phase!=='rollback-prepared')fail('ROUTER_AUTHORITY_INACTIVE')
      if(markerMatches(JSON.parse(bytes),m))await atomicFile(legacyFile,m.rollback_payload)
      else if(hash(bytes)!==hash(m.rollback_payload))fail('ROUTER_ROLLBACK_SOURCE_CHANGED')
      await onStep('rollback-file-written')
      await transact(()=>{db.prepare("UPDATE router_migration SET phase='rolled-back' WHERE singleton=1 AND id=? AND phase='rollback-prepared'").run(epoch)})
      return {status:'rolled-back',sourceHash:hash(m.rollback_payload)}
    })
  }
  const modelCalls=async({botId=null,taskId=null,after=0,limit=100}={})=>{
    await chain;await checkMarker()
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>512)fail('INVALID_RECEIPT_CURSOR')
    const rows=db.prepare('SELECT rowid AS sequence,payload FROM router_model_calls WHERE rowid>? AND (? IS NULL OR bot_id=?) AND (? IS NULL OR task_id=?) ORDER BY rowid LIMIT ?').all(after,botId,botId,taskId,taskId,limit)
    return {items:rows.map(row=>({...JSON.parse(row.payload),sequence:row.sequence})),next:rows.length===limit?rows.at(-1).sequence:null}
  }
  const activeAuthority=()=>{if(closed)fail('ROUTER_STORE_CLOSED');const m=migration();if(m?.phase!=='active'||m.id!==epoch)fail('ROUTER_AUTHORITY_INACTIVE')}
  return Object.freeze({...createRouterStateAPI({file,read,update,now}),kind:'sqlite-router-state',legacyFile,rollback,modelCalls,
    openTaskJournal(){
      activeAuthority()
      const journal=openTaskJournal(Database,file,{database:db,financialEpoch:()=>{activeAuthority();return epoch},onClose:()=>journals.delete(journal)})
      journals.add(journal);return journal
    },
    async modelCall(botId,id){await chain;await checkMarker();const row=db.prepare('SELECT payload FROM router_model_calls WHERE bot_id=? AND id=?').get(botId,id);return row?JSON.parse(row.payload):null},
    fundingTotals:query=>{activeAuthority();return funding.totals({...query,epoch})},
    fundingIdentity:run=>{activeAuthority();return funding.identity(run,epoch)},
    fundingExecution:runId=>{activeAuthority();return funding.execution(runId,epoch)},
    fundingSubscriptionUsage:query=>{activeAuthority();return funding.subscriptionTotals({...query,epoch})},
    // Synchronous inside a pure CAS callback: count durable source admissions,
    // including archived money runs, without deadlocking this store's queue.
    countModelCalls({botId=null,scopeId=null,projectId=null,source=null,funding,from,to}){
      if(closed||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<=from)fail('INVALID_RECEIPT_WINDOW')
      const m=migration();if(m.phase!=='active'||m.id!==epoch)fail('ROUTER_AUTHORITY_INACTIVE')
      return db.prepare("SELECT count(*) AS n FROM router_model_calls WHERE (? IS NULL OR bot_id=?) AND (? IS NULL OR json_extract(payload,'$.fundingScopeId')=? OR json_extract(payload,'$.fundingScopeId') IS NULL) AND (? IS NULL OR json_extract(payload,'$.fundingProjectId')=? OR json_extract(payload,'$.fundingProjectId') IS NULL) AND (? IS NULL OR json_extract(payload,'$.source')=?) AND json_extract(payload,'$.funding')=? AND json_extract(payload,'$.createdAt')>=? AND json_extract(payload,'$.createdAt')<? AND (json_extract(payload,'$.state')!='settled' OR json_extract(payload,'$.finishKind') IS NOT NULL)").get(botId,botId,scopeId,scopeId,projectId,projectId,source,source,funding,from,to).n
    },
    recordModelReceipt:receipt=>update(()=>{}, {retrySafe:true,modelReceipt:receipt}),
    // An unconfirmed package keeps its Bot and its account scope fail-closed.
    // Only an authenticated owner resolves it: attest a vendor-confirmed amount
    // or waive it. The resolution is recorded on the run itself, so the commit
    // digest chain is the audit trail and no second monetary writer exists.
    resolveUnknownPackage(request){
      const botId=taskRef(request?.botId),runId=taskRef(request?.runId),packageId=taskRef(request?.packageId)
      const kind=request?.kind
      if(!['attest','waive'].includes(kind))fail('INVALID_RESOLUTION_KIND')
      const note=typeof request?.note==='string'?request.note.trim():''
      if(!note||Buffer.byteLength(note)>2000)fail('RESOLUTION_NOTE_REQUIRED')
      const costUsd=kind==='attest'?request?.costUsd:0
      if(kind==='attest'&&(typeof costUsd!=='number'||!Number.isFinite(costUsd)||costUsd<0||costUsd>1_000_000_000))fail('RESOLUTION_AMOUNT_REQUIRED')
      const resolvedAt=now()
      return update(state=>{
        const run=state.runs.find(item=>item.id===runId)
        if(!run)fail('ROUTER_RUN_NOT_FOUND')
        const owners=new Set([run.modelCall,run.cliExecution,run.fundingExecution].filter(Boolean).map(value=>value.botId))
        if(!owners.has(botId))fail('ROUTER_RUN_OWNER_MISMATCH')
        const hold=Object.hasOwn(state.budgetReservations??{},runId)?state.budgetReservations[runId]:null
        // A live execution is never settled by a review; only an interrupted
        // hold is, because its owner already stopped without a receipt.
        if(hold&&hold.status!=='interrupted')fail('ROUTER_RESERVATION_ACTIVE')
        const item=[...(run.packages??[]),...(run.reviews??[])].find(value=>value.id===packageId)
        if(!item)fail('ROUTER_PACKAGE_NOT_FOUND')
        if(item.ownerResolution)fail('ROUTER_PACKAGE_ALREADY_RESOLVED')
        if(item.ran!==true||typeof item.costUsd==='number'&&Number.isFinite(item.costUsd)&&item.costUsd>=0)fail('ROUTER_PACKAGE_NOT_UNKNOWN')
        // The interrupted hold keeps its estimate and its unknown count until a
        // review decides the money, so it is settled in the same transaction.
        if(hold)delete state.budgetReservations[runId]
        item.costUsd=costUsd
        item.costSource=kind==='attest'?'owner-attested':'owner-waived'
        item.ownerResolution={schemaVersion:1,kind,costUsd,note,resolvedAt,botId,...(hold?{holdSettled:true}:{})}
        return {runId,packageId,botId,kind,costUsd,resolvedAt,holdSettled:Boolean(hold)}
      },{retrySafe:true})
    },
    status:()=>{const m=migration();return {schemaVersion:2,phase:m.phase,migrationId:m.id,revision:db.prepare('SELECT revision FROM router_meta WHERE singleton=1').get().revision,sourceHash:m.source_hash}},
    close:async()=>{await chain;if(!closed){if(journals.size)fail('ROUTER_ACTIVE_JOURNAL');closed=true;db.close()}},
  })
}
