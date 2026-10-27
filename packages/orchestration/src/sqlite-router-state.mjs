import {createHash,randomUUID} from 'node:crypto'
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises'
import {basename,dirname,resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {createRouterStateAPI,initialRouterState,inspectRouterState,prepareRouterState,withRouterStateLock} from '../../../.dsh-plugin/shared/router-state.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const error=code=>Object.assign(new Error(code),{code})
const fail=code=>{throw error(code)}
const maxBytes=32*1024*1024
const serialize=value=>{const text=JSON.stringify(value)+'\n';if(Buffer.byteLength(text)>maxBytes)fail('ROUTER_STATE_INPUT_LIMIT');return text}
async function bytesOf(file){const handle=await open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maxBytes)fail('ROUTER_STATE_INPUT_LIMIT');const bytes=Buffer.alloc(stat.size+1);let size=0;while(size<bytes.length){const r=await handle.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead}if(size!==stat.size)fail('ROUTER_SOURCE_CHANGED');return bytes.subarray(0,size)}finally{await handle.close()}}
async function atomicFile(file,bytes){const temp=`${file}.${randomUUID()}.tmp`;let handle;try{handle=await open(temp,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temp,file)}finally{await handle?.close();await unlink(temp).catch(()=>{})}}

/** Normalized runs/holds and one metadata revision; no JSON money dual writer. */
export async function openSqliteRouterState({Database,file,legacyFile,now=Date.now,onStep=async()=>{},maxRuns=200,mode='activate',lockStaleMs=15000}) {
  file=resolve(file);legacyFile=resolve(legacyFile)
  await mkdir(dirname(file),{recursive:true})
  const db=new Database(file)
  try{
    // Startup DDL may race another process opening the same ledger. Runtime
    // CAS commits below use nonblocking acquisition so no await holds a lock.
    db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000')
    if(db.pragma('journal_mode=WAL',{simple:true})!=='wal')fail('ROUTER_WAL_REQUIRED')
    db.pragma('synchronous=FULL')
    if(![0,1,2].includes(db.pragma('user_version',{simple:true})))fail('ROUTER_DATABASE_VERSION_UNSUPPORTED')
    db.exec(`CREATE TABLE IF NOT EXISTS router_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_holds(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES router_runs(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS router_migration(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL,source TEXT NOT NULL,phase TEXT NOT NULL,source_hash TEXT NOT NULL,backup TEXT NOT NULL,rollback_payload TEXT);
      CREATE TABLE IF NOT EXISTS router_commits(revision INTEGER PRIMARY KEY,at_ms INTEGER NOT NULL,digest TEXT NOT NULL);`)
    const schema=db.prepare('SELECT schema_version FROM router_meta WHERE singleton=1').get()
    if(schema&&schema.schema_version!==1)fail('ROUTER_LEDGER_VERSION_UNSUPPORTED')
    db.pragma('busy_timeout=0')
  }catch(e){db.close();throw e}
  let closed=false,chain=Promise.resolve(),epoch
  const migration=()=>db.prepare('SELECT * FROM router_migration WHERE singleton=1').get()
  const transact=async work=>{
    const until=performance.now()+10_000
    while(true){
      try{db.exec('BEGIN IMMEDIATE');break}catch(e){if(e.code!=='SQLITE_BUSY'||performance.now()>=until)throw e;await sleep(10)}
    }
    try{const result=work();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}
  }
  const write=(value,revision)=>{
    const state=prepareRouterState(value,maxRuns),{runs,budgetReservations,...meta}=state
    const serialized=serialize(state)
    if(new Set(runs.map(run=>run.id)).size!==runs.length)fail('ROUTER_DUPLICATE_RUN_ID')
    if(Object.entries(budgetReservations).some(([id,hold])=>id!==hold.runId||!runs.some(run=>run.id===hold.runId)))fail('ROUTER_ORPHAN_RESERVATION')
    db.prepare('DELETE FROM router_holds').run();db.prepare('DELETE FROM router_runs').run()
    for(const run of runs)db.prepare('INSERT INTO router_runs VALUES(?,?)').run(run.id,serialize(run))
    for(const [id,hold] of Object.entries(budgetReservations))db.prepare('INSERT INTO router_holds VALUES(?,?,?)').run(id,hold.runId,serialize(hold))
    db.prepare('INSERT INTO router_meta VALUES(1,1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(revision,serialize(meta))
    db.prepare('INSERT INTO router_commits VALUES(?,?,?)').run(revision,now(),hash(serialized))
  }
  const snapshot=()=>db.transaction(()=>{
    const row=db.prepare('SELECT * FROM router_meta WHERE singleton=1').get(),m=migration()
    if(!row||row.schema_version!==1||m?.phase!=='active'||m.id!==epoch)fail('ROUTER_AUTHORITY_INACTIVE')
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
        write(state,revision)
        db.prepare('INSERT INTO router_migration VALUES(1,?,?,?,?,?,NULL) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id,source=excluded.source,phase=excluded.phase,source_hash=excluded.source_hash,backup=excluded.backup,rollback_payload=NULL').run(m.id,m.source,m.phase,m.source_hash,m.backup)
      })
      await onStep('prepared')
      await atomicFile(legacyFile,serialize(markerFor(m)));await onStep('marker-written')
    }
    await transact(()=>{const current=migration();if(current.id!==m.id||!['prepared','active'].includes(current.phase))fail('ROUTER_AUTHORITY_CHANGED');db.prepare("UPDATE router_migration SET phase='active' WHERE singleton=1").run()})
    epoch=m.id;await onStep('active')
  })}catch(e){db.close();closed=true;throw e}
  const update=(change,{retrySafe=false}={})=>{
    const next=chain.then(async()=>{
      for(let tries=0;tries<16;tries++){
        await checkMarker();const before=snapshot(),candidate=structuredClone(before.state)
        const result=await change(candidate),returned=result===undefined?undefined:structuredClone(result)
        try{
          await transact(()=>{
            const m=migration(),row=db.prepare('SELECT revision FROM router_meta WHERE singleton=1').get()
            if(m?.id!==epoch||m.phase!=='active')fail('ROUTER_AUTHORITY_INACTIVE')
            if(row.revision!==before.revision)fail('ROUTER_STATE_CONFLICT')
            write(candidate,row.revision+1)
          })
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
  return Object.freeze({...createRouterStateAPI({file,read,update,now}),kind:'sqlite-router-state',legacyFile,rollback,
    status:()=>{const m=migration();return {schemaVersion:1,phase:m.phase,migrationId:m.id,revision:db.prepare('SELECT revision FROM router_meta WHERE singleton=1').get().revision,sourceHash:m.source_hash}},
    close:async()=>{await chain;if(!closed){closed=true;db.close()}},
  })
}
