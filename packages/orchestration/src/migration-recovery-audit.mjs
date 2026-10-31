import {createHash} from 'node:crypto'

// PRIVATE, read-only migration / rollback readiness diagnostic.
//
// This component NEVER migrates, rolls back, writes user data, stops a process
// or activates anything. It consumes one complete ledger export (the structure
// produced by exportMigrationLedger) and reports whether that single snapshot
// shows any definite rollback blocker, plus minimal structural diagnostics.
//
// Hard invariants, independent of any caller-supplied field:
//  * A per-database consistent backup is NOT a globally consistent snapshot and
//    is NOT proof that every Host stopped writing. One SQLite export cannot
//    establish a trusted cross-Host fence, so crossDomainConsistent is always
//    false and requiresStopProof is always true.
//  * Caller flags, a forged contentDigest or a forged timestamp can never become
//    an executable stop-write / rollback proof. The output flags are constants;
//    the export's own requiresStopProof / crossDomainConsistent are validated as
//    well-formed input only, and a forged value is rejected, never honored.
//  * applySupported and rollbackSupported are always false. The best possible
//    outcome is needs-context (a human still owns the decision), never a
//    clearance to roll back.
//  * Financial unknown or failure is never collapsed to zero: unknown holds and
//    unknown / in-flight receipts are counted and flagged, never summed away.
//  * No SQL, labels, paths, ids, user payloads, money amounts or secrets cross
//    the public summary boundary; only bounded aggregate counts, structural
//    table names and fixed diagnostic codes are emitted.

const fail=code=>{throw Object.assign(new Error(code),{code})}
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const stable=x=>Array.isArray(x)?x.map(stable):record(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x
const hash=x=>digest(stable(x))
const abort=signal=>{if(signal?.aborted)fail('RECOVERY_CANCELLED')}
const safeJson=text=>{if(typeof text!=='string')return null;try{return JSON.parse(text)}catch{return null}}
const resultNotStarted=text=>{if(typeof text!=='string')return false;try{const v=JSON.parse(text);return record(v)&&v.notStarted===true}catch{return false}}

const limits=Object.freeze({maxBytes:64*1024**2,maxRows:100000,maxDepth:64,maxNodes:500000,maxDiagnostics:256})

// Codes that abort the whole audit (hostile JS input, unbounded size, cancel)
// are re-thrown; codes describing a corrupt or problem-bearing export become a
// blocked diagnostic so every failure is observable in the returned result.
const hardCodes=new Set(['RECOVERY_INPUT_INVALID','RECOVERY_LIMIT','RECOVERY_CANCELLED'])
const diagnosticCodes=new Set([
  'RECOVERY_INPUT_INVALID','RECOVERY_LIMIT','RECOVERY_CANCELLED',
  'RECOVERY_LEDGER_REQUIRED','RECOVERY_EXPORT_INVALID','RECOVERY_EXPORT_TAMPERED',
  'RECOVERY_AUTHORITY_MISSING','RECOVERY_AUTHORITY_AMBIGUOUS','RECOVERY_NOT_ACTIVATED',
  'RECOVERY_TABLE_MISSING','RECOVERY_DOMAIN_INCOMPLETE','RECOVERY_TASK_DOMAIN_ABSENT',
  'RECOVERY_UNRESOLVED_HOLDS','RECOVERY_HOLD_MONEY_UNKNOWN','RECOVERY_HOLD_INVALID',
  'RECOVERY_ACTIVE_TASKS','RECOVERY_TASK_UNKNOWN','RECOVERY_NOT_STARTED_INCOMPLETE',
  'RECOVERY_RECEIPT_IN_FLIGHT','RECOVERY_RECEIPT_UNKNOWN','RECOVERY_RECEIPT_UNPARSEABLE',
  'RECOVERY_UNKNOWN_WRITER','RECOVERY_SNAPSHOT_BINDING_MISSING',
  'RECOVERY_DOMAIN_SCOPE_LEDGER_ONLY',
])
export const migrationRecoveryDiagnosticCodes=new Set(diagnosticCodes)

const ACTIVE_TASK_STATES=new Set(['ready','admitting','running','cancelling','waiting-budget'])
const SETTLED_TASK_STATES=new Set(['succeeded','failed','cancelled'])
const ABSTAINABLE_TASK_STATES=new Set(['skipped','blocked'])
const IN_FLIGHT_RECEIPT_STATES=new Set(['admitted','running'])
const KNOWN_PHASES=new Set(['prepared','active','rollback-prepared','rolled-back'])

const emptyRecovery=()=>({
  authorityPresent:false,
  authorityPhase:null,
  tasks:{total:0,settled:0,abstained:0,active:0,unknown:0,notStartedIncomplete:0},
  holds:{total:0,active:0,interrupted:0,moneyUnknown:0,invalid:0},
  receipts:{total:0,inFlight:0,unknown:0,reported:0,settled:0,unparseable:0},
  attempts:{total:0,started:0,notStarted:0},
  tombstones:0,
  unknownWriter:0,
  missingTables:[],
})

// Reject private getters, cycles and oversized trees before any field is read,
// mirroring the migration-financial-audit input guard.
function bounded(value){
  let nodes=0;const active=new Set()
  function visit(v,depth){
    if(++nodes>limits.maxNodes||depth>limits.maxDepth)fail('RECOVERY_LIMIT')
    if(v===null||['string','boolean'].includes(typeof v))return
    if(typeof v==='number'){if(!Number.isFinite(v))fail('RECOVERY_INPUT_INVALID');return}
    if(typeof v!=='object'||active.has(v))fail('RECOVERY_INPUT_INVALID')
    active.add(v)
    for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))){
      if(!Object.hasOwn(descriptor,'value'))fail('RECOVERY_INPUT_INVALID')
      if(Array.isArray(v)&&key==='length')continue
      visit(descriptor.value,depth+1)
    }
    active.delete(v)
  }
  visit(value,0)
  if(Buffer.byteLength(JSON.stringify(value))>limits.maxBytes)fail('RECOVERY_LIMIT')
}

// Strictly re-derive the export contract. The content digest is recomputed over
// the canonical {schemaVersion,kind,userVersion,pragmas,schema,tables} tuple, so
// a tampered table, a mutated cell or a forged digest is refused; malformed or
// unrecognized structure is refused; the caller's stop-write flags are validated
// as well-formed only and can never be honored as authority.
function decodeRecoveryExport(exported){
  // Reject private getters, cycles and oversized trees before reading any field,
  // so hostile input is never executed while validating the digest or structure.
  bounded(exported)
  if(!record(exported)
    ||exported.schemaVersion!==1
    ||exported.kind!=='private-sqlite-ledger-export'
    ||exported.databaseConsistent!==true
    ||exported.crossDomainConsistent!==false
    ||exported.requiresStopProof!==true
    ||!Array.isArray(exported.tables)
    ||!Array.isArray(exported.schema)
    ||![0,1,2,3,4,5].includes(exported.userVersion))fail('RECOVERY_EXPORT_INVALID')
  const {schemaVersion,kind,userVersion,pragmas,schema,tables}=exported
  if(digest({schemaVersion,kind,userVersion,pragmas,schema,tables})!==exported.contentDigest)fail('RECOVERY_EXPORT_TAMPERED')
  const map=new Map();let n=0
  for(const table of tables){
    if(!record(table)||typeof table.name!=='string'||map.has(table.name)||!Array.isArray(table.columns)||!Array.isArray(table.rows))fail('RECOVERY_EXPORT_INVALID')
    const names=table.columns.map(c=>c?.name)
    if(names.some(name=>typeof name!=='string')||new Set(names).size!==names.length)fail('RECOVERY_EXPORT_INVALID')
    const rows=[]
    for(const row of table.rows){
      if(++n>limits.maxRows||!record(row)||!Array.isArray(row.values)||row.values.length!==names.length)fail('RECOVERY_EXPORT_INVALID')
      const out=Object.create(null)
      row.values.forEach((cell,i)=>{
        if(!record(cell))fail('RECOVERY_EXPORT_INVALID')
        let value
        if(cell.type==='null'&&Object.keys(cell).length===1)value=null
        else if(cell.type==='text'&&typeof cell.value==='string')value=cell.value
        else if(cell.type==='integer'&&typeof cell.value==='string'&&/^-?(?:0|[1-9]\d*)$/.test(cell.value)){value=BigInt(cell.value);if(value<-(2n**63n)||value>2n**63n-1n)fail('RECOVERY_EXPORT_INVALID')}
        else if(cell.type==='real'&&typeof cell.value==='string'&&!Number.isNaN(Number(cell.value)))value=Number(cell.value)
        else if(cell.type==='blob'&&typeof cell.value==='string'&&Buffer.from(cell.value,'base64').toString('base64')===cell.value)value=Buffer.from(cell.value,'base64')
        else fail('RECOVERY_EXPORT_INVALID')
        Object.defineProperty(out,names[i],{enumerable:true,value})
      })
      rows.push(out)
    }
    map.set(table.name,{rows,columns:names})
  }
  if(exported.counts?.rows!==n||exported.counts?.tables!==tables.length||exported.counts?.schemaItems!==schema.length)fail('RECOVERY_EXPORT_INVALID')
  return {tables:map,rows:n,contentDigest:exported.contentDigest,userVersion}
}

function analyze(tables,userVersion,add){
  const r=emptyRecovery()
  const get=name=>tables.get(name)
  let authorityAmbiguous=false,notActivated=false,snapshotBindingMissing=false,domainIncomplete=false,taskDomainAbsent=false

  // Authority / snapshot binding.
  const migration=get('router_migration')
  let migrationId=null
  if(!migration||migration.rows.length===0){r.authorityPresent=false}
  else if(migration.rows.length!==1){r.authorityPresent=true;authorityAmbiguous=true}
  else{
    r.authorityPresent=true
    const m=migration.rows[0]
    r.authorityPhase=typeof m.phase==='string'?m.phase:null
    migrationId=typeof m.id==='string'?m.id:null
    if(r.authorityPhase!=='active')notActivated=true
    if(m.source==null||m.source_hash==null)snapshotBindingMissing=true
  }
  if(!tables.has('router_meta'))r.missingTables.push('router_meta')

  // Index the schema5 task journal.
  const packagesByTask=new Map()
  const packages=get('packages')
  if(packages)for(const p of packages.rows)packagesByTask.set(p.task_id,p)
  const attemptsById=new Map()
  const attempts=get('attempts')
  if(attempts)for(const a of attempts.rows)attemptsById.set(a.id,a)
  const operationByAttempt=new Map()
  const operations=get('operations')
  if(operations)for(const o of operations.rows)operationByAttempt.set(o.attempt_id,o.id)
  const refAttempts=new Set()
  const refs=get('task_execution_refs')
  if(refs)for(const x of refs.rows)refAttempts.add(x.attempt_id)
  const reconByAttempt=new Map()
  const recons=get('task_reconciliations')
  if(recons)for(const x of recons.rows){const list=reconByAttempt.get(x.attempt_id)??[];list.push(x.outcome);reconByAttempt.set(x.attempt_id,list)}
  const tombstoneTasks=new Set()
  const tombstones=get('legacy_task_runs')
  if(tombstones)for(const x of tombstones.rows)tombstoneTasks.add(x.task_id)
  r.tombstones=tombstones?tombstones.rows.length:0

  // Money domain: which operations actually ran money, and receipt health.
  const runIds=new Set(),moneyOperations=new Set()
  const runs=get('router_runs')
  if(runs)for(const x of runs.rows){
    runIds.add(x.id)
    const p=safeJson(x.payload)
    if(p&&record(p.managedExecution)&&typeof p.managedExecution.operationId==='string')moneyOperations.add(p.managedExecution.operationId)
  }
  const receipts=get('router_model_calls')
  if(receipts)for(const row of receipts.rows){
    r.receipts.total++
    const payload=safeJson(row.payload)
    if(payload===null){r.receipts.unparseable++}
    else{
      if(typeof payload.operationId==='string')moneyOperations.add(payload.operationId)
      const state=typeof payload.state==='string'?payload.state:null
      if(IN_FLIGHT_RECEIPT_STATES.has(state))r.receipts.inFlight++
      else if(state==='unknown')r.receipts.unknown++
      else if(state==='reported')r.receipts.reported++
      else if(state==='settled')r.receipts.settled++
      else r.receipts.unparseable++
    }
    if(row.run_id!=null&&!runIds.has(row.run_id))r.unknownWriter++
  }

  // Holds: any hold blocks rollback; unknown/interrupted money is never zero.
  const holds=get('router_holds')
  if(holds)for(const h of holds.rows){
    r.holds.total++
    const payload=safeJson(h.payload)
    if(!record(payload)){r.holds.invalid++;continue}
    const status=payload.status
    if(status==='active')r.holds.active++
    else if(status==='interrupted')r.holds.interrupted++
    else r.holds.invalid++
    const list=Array.isArray(payload.packages)?payload.packages:[]
    const moneyUnknown=list.some(p=>!record(p)||p.estimatedCostUsd===null)||(status==='interrupted'&&list.some(p=>record(p)&&p.started===true))
    if(moneyUnknown)r.holds.moneyUnknown++
    if(h.run_id!=null&&!runIds.has(h.run_id))r.unknownWriter++
  }

  // Admission from a different migration epoch is an unattributable writer.
  if(migrationId!=null){
    const intents=get('task_admission_intents')
    if(intents)for(const x of intents.rows)if(x.epoch!==migrationId)r.unknownWriter++
  }

  // The ledger carries money but never projected it into the funding domain.
  if((r.receipts.total>0||r.holds.total>0)&&!tables.has('router_funding_epochs'))domainIncomplete=true

  // Classify each task. The rollback guard only permits succeeded/failed/cancelled
  // tasks and refuses on any hold; skipped/blocked is only a clean diagnostic when
  // the original attempt is explicitly notStarted with no money, ref or tombstone.
  const tasks=get('tasks')
  if(tasks){
    for(const task of tasks.rows){
      r.tasks.total++
      const pkg=packagesByTask.get(task.id)
      const attempt=pkg&&pkg.current_attempt!=null?attemptsById.get(pkg.current_attempt):null
      const operationId=attempt?operationByAttempt.get(attempt.id):null
      const hasRef=attempt?refAttempts.has(attempt.id):false
      const hasTombstone=tombstoneTasks.has(task.id)
      const hasMoney=operationId!=null&&moneyOperations.has(operationId)
      const reconOutcomes=attempt?(reconByAttempt.get(attempt.id)??[]):[]
      const hasUnknownRecon=reconOutcomes.includes('unknown')
      if(SETTLED_TASK_STATES.has(task.state)){r.tasks.settled++;continue}
      if(ACTIVE_TASK_STATES.has(task.state)){r.tasks.active++;continue}
      if(task.state==='needs-reconciliation'){r.tasks.unknown++;continue}
      if(ABSTAINABLE_TASK_STATES.has(task.state)){
        const notStarted=attempt!=null&&attempt.started_ms==null&&resultNotStarted(attempt.result)&&!hasRef&&!hasMoney&&!hasTombstone&&!hasUnknownRecon
        if(notStarted){r.tasks.abstained++;continue}
        r.tasks.notStartedIncomplete++;continue
      }
      r.tasks.unknown++
    }
  }else if(userVersion===5){
    taskDomainAbsent=true
  }

  // A schema5 ledger that carries a task journal must carry its companions.
  if(tables.has('tasks'))for(const name of ['packages','attempts','operations'])if(!tables.has(name)&&!r.missingTables.includes(name))r.missingTables.push(name)

  if(attempts)for(const a of attempts.rows){
    r.attempts.total++
    if(a.started_ms!=null)r.attempts.started++
    else r.attempts.notStarted++
  }

  // Aggregate diagnostics: one code covers a whole class, never per-row.
  if(!r.authorityPresent)add('RECOVERY_AUTHORITY_MISSING','error')
  if(authorityAmbiguous)add('RECOVERY_AUTHORITY_AMBIGUOUS','error')
  if(notActivated)add('RECOVERY_NOT_ACTIVATED','needs-context')
  if(r.missingTables.length)add('RECOVERY_TABLE_MISSING','error')
  if(r.tasks.active>0)add('RECOVERY_ACTIVE_TASKS','error')
  if(r.tasks.unknown>0)add('RECOVERY_TASK_UNKNOWN','error')
  if(r.tasks.notStartedIncomplete>0)add('RECOVERY_NOT_STARTED_INCOMPLETE','error')
  if(taskDomainAbsent)add('RECOVERY_TASK_DOMAIN_ABSENT','needs-context')
  if(r.holds.total>0)add('RECOVERY_UNRESOLVED_HOLDS','error')
  if(r.holds.moneyUnknown>0)add('RECOVERY_HOLD_MONEY_UNKNOWN','error')
  if(r.holds.invalid>0)add('RECOVERY_HOLD_INVALID','error')
  if(r.receipts.inFlight>0)add('RECOVERY_RECEIPT_IN_FLIGHT','needs-context')
  if(r.receipts.unknown>0)add('RECOVERY_RECEIPT_UNKNOWN','error')
  if(r.receipts.unparseable>0)add('RECOVERY_RECEIPT_UNPARSEABLE','error')
  if(r.unknownWriter>0)add('RECOVERY_UNKNOWN_WRITER','needs-context')
  if(snapshotBindingMissing)add('RECOVERY_SNAPSHOT_BINDING_MISSING','needs-context')
  if(domainIncomplete)add('RECOVERY_DOMAIN_INCOMPLETE','needs-context')
  return r
}

/** PRIVATE only. Input is a decoded ledger export; nothing is written or executed. */
export function auditMigrationRecovery(input={}){
  if(!record(input))fail('RECOVERY_INPUT_INVALID')
  // Read the data and signal fields through their descriptors so a getter placed
  // on either is refused before it can run; getOwnPropertyDescriptor never
  // invokes an accessor. Getters buried inside the export are caught by bounded()
  // inside decodeRecoveryExport, also without execution.
  const own=key=>{const d=Object.getOwnPropertyDescriptor(input,key);return d&&Object.hasOwn(d,'value')?d.value:undefined}
  const accessor=key=>{const d=Object.getOwnPropertyDescriptor(input,key);return Boolean(d)&&!Object.hasOwn(d,'value')}
  if(accessor('ledgerExport')||accessor('signal'))fail('RECOVERY_INPUT_INVALID')
  const signal=own('signal'),ledgerExport=own('ledgerExport')
  const diagnostics=[]
  const add=(code,severity='error')=>{if(diagnostics.length<limits.maxDiagnostics)diagnostics.push({code,severity})}
  let recovery=emptyRecovery(),contentDigest=null,userVersion=null
  if(ledgerExport===undefined||ledgerExport===null){
    add('RECOVERY_LEDGER_REQUIRED','needs-context')
  }else{
    try{
      abort(signal)
      const decoded=decodeRecoveryExport(ledgerExport)
      contentDigest=decoded.contentDigest
      userVersion=decoded.userVersion
      recovery=analyze(decoded.tables,decoded.userVersion,add)
    }catch(e){
      if(hardCodes.has(e.code))throw e
      add(diagnosticCodes.has(e.code)?e.code:'RECOVERY_EXPORT_INVALID','error')
    }
  }
  // A single ledger export can never attest the other migration domains or a
  // cross-Host stop-write fence; this is permanent, so the best status is
  // needs-context, never a clearance.
  add('RECOVERY_DOMAIN_SCOPE_LEDGER_ONLY','needs-context')
  const status=diagnostics.some(d=>d.severity==='error')?'blocked':diagnostics.some(d=>d.severity==='needs-context')?'needs-context':'audited'
  const result={schemaVersion:1,kind:'private-migration-recovery-audit',status,diagnostics,recovery,userVersion,contentDigest,
    applySupported:false,rollbackSupported:false,requiresStopProof:true,crossDomainConsistent:false}
  result.fingerprint=hash({recovery,contentDigest,userVersion})
  return result
}

/** Public boundary: fixed codes and bounded counts only, never a digest, path or id. */
export function summarizeMigrationRecovery(result){
  const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=limits.maxRows?n:0
  const r=record(result?.recovery)?result.recovery:{}
  const bucket=b=>({total:count(b?.total),settled:count(b?.settled),abstained:count(b?.abstained),active:count(b?.active),unknown:count(b?.unknown),notStartedIncomplete:count(b?.notStartedIncomplete)})
  return {
    schemaVersion:1,
    kind:'migration-recovery-audit',
    status:['blocked','needs-context','audited'].includes(result?.status)?result.status:'blocked',
    authorityPresent:r.authorityPresent===true,
    authorityPhase:KNOWN_PHASES.has(r.authorityPhase)?r.authorityPhase:null,
    tasks:bucket(r.tasks),
    holds:{total:count(r.holds?.total),active:count(r.holds?.active),interrupted:count(r.holds?.interrupted),moneyUnknown:count(r.holds?.moneyUnknown),invalid:count(r.holds?.invalid)},
    receipts:{total:count(r.receipts?.total),inFlight:count(r.receipts?.inFlight),unknown:count(r.receipts?.unknown),reported:count(r.receipts?.reported),settled:count(r.receipts?.settled),unparseable:count(r.receipts?.unparseable)},
    attempts:{total:count(r.attempts?.total),started:count(r.attempts?.started),notStarted:count(r.attempts?.notStarted)},
    tombstones:count(r.tombstones),
    missingTables:(Array.isArray(r.missingTables)?r.missingTables:[]).filter(t=>typeof t==='string').slice(0,64),
    diagnostics:(Array.isArray(result?.diagnostics)?result.diagnostics:[]).slice(0,limits.maxDiagnostics).map(d=>({code:diagnosticCodes.has(d?.code)?d.code:'UNKNOWN_DIAGNOSTIC',severity:['error','warning','needs-context'].includes(d?.severity)?d.severity:'error'})),
    applySupported:false,rollbackSupported:false,requiresStopProof:true,crossDomainConsistent:false,
  }
}

/** Detect readiness drift between two audits; an altered report cannot forge equality. */
export function reconcileMigrationRecovery(before,after){
  for(const item of [before,after])if(item?.schemaVersion!==1||item.kind!=='private-migration-recovery-audit'||item.fingerprint!==hash({recovery:item.recovery,contentDigest:item.contentDigest,userVersion:item.userVersion}))fail('RECOVERY_AUDIT_INVALID')
  const changes=['recovery','contentDigest','userVersion'].filter(k=>hash(before[k])!==hash(after[k]))
  return {equal:changes.length===0,changes,readyToRollback:false,applySupported:false,rollbackSupported:false,requiresStopProof:true,crossDomainConsistent:false}
}
