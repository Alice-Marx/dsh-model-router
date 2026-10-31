import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {openRecoveryStore,exportLedger,clock,makeSettled,makeActive,makeWaitingBudget,makeNeedsReconciliation,makeBlocked,insertHold,insertReceipt,insertTombstone,insertReference,recoveryRoot} from './fixtures/migration-recovery-audit-fixture.mjs'
import {auditMigrationRecovery,summarizeMigrationRecovery,reconcileMigrationRecovery,migrationRecoveryDiagnosticCodes} from '../packages/orchestration/src/migration-recovery-audit.mjs'

await mkdir(recoveryRoot,{recursive:true})
const codes=result=>result.diagnostics.map(d=>d.code)
const FLAGS={applySupported:false,rollbackSupported:false,requiresStopProof:true,crossDomainConsistent:false}

test('recovery audit: settled tasks, an abstained block and a settled receipt never authorize rollback',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k-success',now,'succeeded')
  makeSettled(f.journal,f.runner,'bot-a','k-failed',now,'failed')
  makeBlocked(f.journal,f.runner,'bot-a','k-blocked',now)
  insertReceipt(f.db,{id:'receipt-settled',runId:'run-settled',state:'settled'})
  const exported=exportLedger(f.db)
  const r=auditMigrationRecovery({ledgerExport:exported})
  assert.equal(r.userVersion,5)
  assert.equal(r.recovery.authorityPresent,true)
  assert.equal(r.recovery.authorityPhase,'active')
  assert.equal(r.recovery.tasks.total,3)
  assert.equal(r.recovery.tasks.settled,2)
  assert.equal(r.recovery.tasks.abstained,1)
  assert.equal(r.recovery.tasks.active,0)
  assert.equal(r.recovery.tasks.notStartedIncomplete,0)
  assert.equal(r.recovery.receipts.settled,1)
  assert.equal(r.status,'needs-context')
  assert.deepEqual(codes(r).filter(c=>c!=='RECOVERY_DOMAIN_SCOPE_LEDGER_ONLY'),[])
  assert.deepEqual({applySupported:r.applySupported,rollbackSupported:r.rollbackSupported,requiresStopProof:r.requiresStopProof,crossDomainConsistent:r.crossDomainConsistent},FLAGS)
  // A round-tripped export re-derives the same digest, so the audit is stable.
  const round=auditMigrationRecovery({ledgerExport:JSON.parse(JSON.stringify(exported))})
  assert.equal(round.contentDigest,r.contentDigest)
  assert.equal(round.status,'needs-context')
})

test('recovery audit: an active task blocks, and finishing it makes the block retryable',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  const running=makeActive(f.journal,f.runner,'bot-a','k-running',now,'running')
  const blocked=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(blocked.status,'blocked')
  assert.ok(codes(blocked).includes('RECOVERY_ACTIVE_TASKS'))
  assert.equal(blocked.recovery.tasks.active,1)
  assert.equal(blocked.rollbackSupported,false)
  // blocked is retryable: resolve the underlying condition and re-audit.
  f.journal.finish(f.runner,'bot-a',running.taskId,running.attemptId,'succeeded',{},now())
  const cleared=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(cleared.recovery.tasks.active,0)
  assert.equal(cleared.recovery.tasks.settled,1)
  assert.ok(!codes(cleared).includes('RECOVERY_ACTIVE_TASKS'))
  assert.equal(cleared.status,'needs-context')
  assert.equal(cleared.rollbackSupported,false)
})

test('recovery audit: waiting-budget and needs-reconciliation tasks are unknown, never zero',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeWaitingBudget(f.journal,f.runner,'bot-a','k-wait',now)
  makeNeedsReconciliation(f.journal,f.runner,'bot-a','k-recon',now)
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.status,'blocked')
  assert.ok(codes(r).includes('RECOVERY_ACTIVE_TASKS'))
  assert.ok(codes(r).includes('RECOVERY_TASK_UNKNOWN'))
  assert.equal(r.recovery.tasks.active,1)
  assert.equal(r.recovery.tasks.unknown,1)
  assert.equal(r.rollbackSupported,false)
})

test('recovery audit: any hold blocks and unknown hold money is preserved, not zeroed',async t=>{
  const f=await openRecoveryStore(t)
  insertHold(f.db,{id:'hold-active',runId:'run-hold',status:'active',packages:[{id:'pkg',estimatedCostUsd:null,started:true}]})
  insertHold(f.db,{id:'hold-interrupted',runId:'run-hold-2',status:'interrupted',packages:[{id:'pkg',estimatedCostUsd:0.5,started:true}]})
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.status,'blocked')
  assert.ok(codes(r).includes('RECOVERY_UNRESOLVED_HOLDS'))
  assert.ok(codes(r).includes('RECOVERY_HOLD_MONEY_UNKNOWN'))
  assert.equal(r.recovery.holds.total,2)
  assert.equal(r.recovery.holds.active,1)
  assert.equal(r.recovery.holds.interrupted,1)
  assert.equal(r.recovery.holds.moneyUnknown,2)
  assert.equal(r.rollbackSupported,false)
})

test('recovery audit: unknown and in-flight receipts block and are never treated as zero',async t=>{
  const f=await openRecoveryStore(t)
  insertReceipt(f.db,{id:'r-unknown',runId:'run-unknown',state:'unknown'})
  insertReceipt(f.db,{id:'r-running',runId:'run-running',state:'running'})
  insertReceipt(f.db,{id:'r-settled',runId:'run-settled2',state:'settled'})
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.status,'blocked')
  assert.ok(codes(r).includes('RECOVERY_RECEIPT_UNKNOWN'))
  assert.ok(codes(r).includes('RECOVERY_RECEIPT_IN_FLIGHT'))
  assert.equal(r.recovery.receipts.total,3)
  assert.equal(r.recovery.receipts.unknown,1)
  assert.equal(r.recovery.receipts.inFlight,1)
  assert.equal(r.recovery.receipts.settled,1)
  assert.equal(r.rollbackSupported,false)
})

test('recovery audit: a blocked task that actually ran money is not a clean abstention',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  const blocked=makeBlocked(f.journal,f.runner,'bot-a','k-block-money',now)
  insertReceipt(f.db,{id:'r-money',runId:'run-money',operationId:blocked.operationId,state:'settled'})
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.status,'blocked')
  assert.ok(codes(r).includes('RECOVERY_NOT_STARTED_INCOMPLETE'))
  assert.equal(r.recovery.tasks.abstained,0)
  assert.equal(r.recovery.tasks.notStartedIncomplete,1)
  assert.equal(r.rollbackSupported,false)
})

test('recovery audit: a skipped task whose evidence is complete is only a diagnostic',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeBlocked(f.journal,f.runner,'bot-a','k-clean',now)
  // notStarted:true, started_ms null, no ref, no money, no tombstone, no unknown
  // reconciliation: a clean diagnostic, but still never a rollback clearance.
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.recovery.tasks.abstained,1)
  assert.equal(r.recovery.tasks.notStartedIncomplete,0)
  assert.equal(r.status,'needs-context')
  assert.equal(r.rollbackSupported,false)
})

test('recovery audit: a tombstone bound to a not-started block defeats the abstention',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  const blocked=makeBlocked(f.journal,f.runner,'bot-a','k-tomb',now)
  insertTombstone(f.db,{runId:'legacy-run-1',taskId:blocked.taskId,ownerBot:'bot-a'})
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.status,'blocked')
  assert.ok(codes(r).includes('RECOVERY_NOT_STARTED_INCOMPLETE'))
  assert.equal(r.recovery.tasks.notStartedIncomplete,1)
  assert.equal(r.recovery.tombstones,1)
  assert.equal(r.rollbackSupported,false)
})

test('recovery audit: an empty ledger has no blocker but still requires stop proof and review',async t=>{
  const f=await openRecoveryStore(t)
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(r.recovery.tasks.total,0)
  assert.equal(r.recovery.holds.total,0)
  assert.equal(r.recovery.receipts.total,0)
  assert.equal(r.status,'needs-context')
  assert.deepEqual(codes(r),['RECOVERY_DOMAIN_SCOPE_LEDGER_ONLY'])
  assert.deepEqual({applySupported:r.applySupported,rollbackSupported:r.rollbackSupported,requiresStopProof:r.requiresStopProof,crossDomainConsistent:r.crossDomainConsistent},FLAGS)
})

test('recovery audit: a tampered cell and a forged digest are both refused',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k',now,'succeeded')
  const exported=exportLedger(f.db)
  const tampered=JSON.parse(JSON.stringify(exported))
  tampered.tables.find(tb=>tb.rows.length>0).rows[0].values[0]={type:'text',value:'forged'}
  const tamperedResult=auditMigrationRecovery({ledgerExport:tampered})
  assert.equal(tamperedResult.status,'blocked')
  assert.ok(codes(tamperedResult).includes('RECOVERY_EXPORT_TAMPERED'))
  assert.equal(tamperedResult.rollbackSupported,false)
  const forgedDigest=JSON.parse(JSON.stringify(exported))
  forgedDigest.contentDigest='0'.repeat(64)
  const forgedResult=auditMigrationRecovery({ledgerExport:forgedDigest})
  assert.equal(forgedResult.status,'blocked')
  assert.ok(codes(forgedResult).includes('RECOVERY_EXPORT_TAMPERED'))
})

test('recovery audit: forged stop-write flags cannot become executable proof',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k',now,'succeeded')
  const exported=exportLedger(f.db)
  for(const mutate of [e=>{e.requiresStopProof=false},e=>{e.crossDomainConsistent=true},e=>{e.databaseConsistent=false},e=>{e.kind='forged'}]){
    const forged=JSON.parse(JSON.stringify(exported));mutate(forged)
    const r=auditMigrationRecovery({ledgerExport:forged})
    assert.equal(r.status,'blocked')
    assert.ok(codes(r).includes('RECOVERY_EXPORT_INVALID'))
    assert.deepEqual({applySupported:r.applySupported,rollbackSupported:r.rollbackSupported,requiresStopProof:r.requiresStopProof,crossDomainConsistent:r.crossDomainConsistent},FLAGS)
  }
})

test('recovery audit: a missing authority table and a missing task companion are refused',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k',now,'succeeded')
  f.db.prepare('DELETE FROM router_migration').run()
  const noAuthority=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  assert.equal(noAuthority.status,'blocked')
  assert.ok(codes(noAuthority).includes('RECOVERY_AUTHORITY_MISSING'))
  assert.equal(noAuthority.recovery.authorityPresent,false)

  // A schema5 export that carries tasks but drops a required companion table.
  const dir=await mkdtemp(join(recoveryRoot,'raw-')),file=join(dir,'ledger.sqlite')
  const raw=new Database(file);t.after(()=>raw.close())
  raw.pragma('user_version=5')
  raw.exec(`CREATE TABLE router_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE router_migration(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL,source TEXT NOT NULL,phase TEXT NOT NULL,source_hash TEXT NOT NULL,backup TEXT NOT NULL,rollback_payload TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY, owner_bot TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, deadline_ms INTEGER NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);`)
  raw.prepare('INSERT INTO router_meta VALUES(1,2,1,?)').run(JSON.stringify({version:4}))
  raw.prepare('INSERT INTO router_migration VALUES(1,?,?,?,?,?,NULL)').run('epoch-raw','/tmp/state.json','active','sourcehash','backup')
  raw.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)').run('task-1','bot-a','{}','succeeded',1,1,1)
  const missing=auditMigrationRecovery({ledgerExport:exportLedger(raw)})
  assert.equal(missing.status,'blocked')
  assert.ok(codes(missing).includes('RECOVERY_TABLE_MISSING'))
  for(const name of ['packages','attempts','operations'])assert.ok(missing.recovery.missingTables.includes(name),name)
  assert.equal(missing.rollbackSupported,false)
})

test('recovery audit: post-export writes are detectable through a fresh export and reconcile',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k-first',now,'succeeded')
  const before=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  makeActive(f.journal,f.runner,'bot-a','k-second',now,'running')
  const dirty=exportLedger(f.db)
  const after=auditMigrationRecovery({ledgerExport:dirty})
  assert.notEqual(before.contentDigest,after.contentDigest)
  const comparison=reconcileMigrationRecovery(before,after)
  assert.equal(comparison.equal,false)
  assert.ok(comparison.changes.includes('recovery'))
  assert.equal(comparison.readyToRollback,false)
  assert.equal(comparison.rollbackSupported,false)
  assert.equal(comparison.requiresStopProof,true)
  // Two audits of one unchanged export are equal; the digest is a point-in-time
  // check and makes no guarantee about concurrent writes after it.
  assert.equal(reconcileMigrationRecovery(after,auditMigrationRecovery({ledgerExport:dirty})).equal,true)
})

test('recovery audit: an altered report cannot forge a reconcile equality',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeActive(f.journal,f.runner,'bot-a','k',now,'running')
  const r=auditMigrationRecovery({ledgerExport:exportLedger(f.db)})
  const tampered=structuredClone(r)
  tampered.recovery.tasks.active=0
  assert.throws(()=>reconcileMigrationRecovery(r,tampered),{code:'RECOVERY_AUDIT_INVALID'})
})

test('recovery audit: public summaries harden injected values and never leak payloads, money or paths',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k',now,'succeeded')
  insertHold(f.db,{id:'hold-secret',runId:'run-secret',status:'active',packages:[{id:'pkg',estimatedCostUsd:null,started:true}]})
  insertReceipt(f.db,{id:'r-secret',runId:'run-secret-receipt',state:'unknown',extra:{private:'SECRET-RECEIPT-PAYLOAD',costUsd:9.99}})
  const exported=exportLedger(f.db)
  const r=auditMigrationRecovery({ledgerExport:exported})
  const summary=summarizeMigrationRecovery(r)
  const text=JSON.stringify(r)+JSON.stringify(summary)
  for(const secret of ['SECRET-RECEIPT-PAYLOAD','SECRET-HOLD-TOKEN','9.99','costUsd','ownerToken','estimatedCostUsd','ledger.sqlite',f.dir])assert.ok(!text.includes(secret),secret)
  assert.equal(summary.rollbackSupported,false)
  assert.equal(summary.applySupported,false)
  assert.equal(summary.requiresStopProof,true)
  assert.equal(summary.crossDomainConsistent,false)
  // Injected values are clamped to fixed codes and bounded counts.
  const injected=summarizeMigrationRecovery({status:'PRIVATE-PATH',recovery:{tasks:{total:Infinity,active:-3}},diagnostics:[{code:'SECRET',severity:'SECRET',message:'SECRET'}]})
  assert.equal(injected.status,'blocked')
  assert.equal(injected.tasks.total,0)
  assert.equal(injected.tasks.active,0)
  assert.deepEqual(injected.diagnostics,[{code:'UNKNOWN_DIAGNOSTIC',severity:'error'}])
  assert.ok(!JSON.stringify(injected).includes('SECRET'))
})

test('recovery audit: the four support flags are constant across every outcome',async t=>{
  const f=await openRecoveryStore(t),now=clock()
  makeSettled(f.journal,f.runner,'bot-a','k-ok',now,'succeeded')
  const clean=exportLedger(f.db)
  makeActive(f.journal,f.runner,'bot-a','k-active',now,'running')
  const dirty=exportLedger(f.db)
  const audits=[
    auditMigrationRecovery({ledgerExport:clean}),
    auditMigrationRecovery({ledgerExport:dirty}),
    auditMigrationRecovery({ledgerExport:null}),
    auditMigrationRecovery({ledgerExport:{}}),
  ]
  for(const r of audits)assert.deepEqual({applySupported:r.applySupported,rollbackSupported:r.rollbackSupported,requiresStopProof:r.requiresStopProof,crossDomainConsistent:r.crossDomainConsistent},FLAGS)
  assert.equal(audits[2].status,'needs-context')
  assert.ok(codes(audits[2]).includes('RECOVERY_LEDGER_REQUIRED'))
  assert.equal(audits[3].status,'blocked')
})

test('recovery audit: the diagnostic code catalog is a fixed string set',()=>{
  assert.ok(migrationRecoveryDiagnosticCodes instanceof Set)
  for(const code of ['RECOVERY_EXPORT_TAMPERED','RECOVERY_ACTIVE_TASKS','RECOVERY_UNRESOLVED_HOLDS','RECOVERY_UNKNOWN_WRITER','RECOVERY_DOMAIN_SCOPE_LEDGER_ONLY'])assert.ok(migrationRecoveryDiagnosticCodes.has(code),code)
})

test('recovery audit: private input getters and cycles are refused without execution',()=>{
  let calls=0
  const hostile={};Object.defineProperty(hostile,'ledgerExport',{enumerable:true,get(){calls++;return{schemaVersion:1}}})
  assert.throws(()=>auditMigrationRecovery(hostile),{code:'RECOVERY_INPUT_INVALID'})
  assert.equal(calls,0)
  const cyclic={};cyclic.ledgerExport=cyclic
  assert.throws(()=>auditMigrationRecovery(cyclic),{code:'RECOVERY_INPUT_INVALID'})
  // A getter buried inside the export object is never invoked during validation;
  // bounded() refuses it before the digest is read.
  let inner=0
  const exported={schemaVersion:1,kind:'private-sqlite-ledger-export',userVersion:5,tables:[],schema:[],pragmas:{},counts:{rows:0,tables:0,schemaItems:0},databaseConsistent:true,crossDomainConsistent:false,requiresStopProof:true}
  Object.defineProperty(exported,'contentDigest',{enumerable:true,get(){inner++;return 'x'}})
  assert.throws(()=>auditMigrationRecovery({ledgerExport:exported}),{code:'RECOVERY_INPUT_INVALID'})
  assert.equal(inner,0)
})
