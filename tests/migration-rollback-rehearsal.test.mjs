import test from 'node:test'
import assert from 'node:assert/strict'
import {link,mkdir,mkdtemp,readFile,stat,symlink,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import Database from 'better-sqlite3'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'
import {createMigrationLedgerArchive,exportMigrationLedger} from '../packages/orchestration/src/migration-ledger-export.mjs'
import {rehearseMigrationRollback} from '../packages/orchestration/src/migration-rollback-rehearsal.mjs'
import {openRecoveryStore,recoveryRoot,makeSettled,makeActive,makeWaitingBudget,makeNeedsReconciliation,makeBlocked,insertReceipt,insertHold,clock} from './fixtures/migration-recovery-audit-fixture.mjs'

const ROOT=resolve(import.meta.dirname,'..'),PRODUCT='@ljwei-stak/dsh-model-route-bot',json=value=>JSON.stringify(value)+'\n'
await mkdir(recoveryRoot,{recursive:true})
async function fixture(t,{prepare}={}){
 const f=await openRecoveryStore(t),home=join(f.dir,'home'),profile=join(home,'profiles','desktop'),bot=join(home,'bot'),sessions=join(home,'sessions')
 for(const path of [profile,bot,sessions])await mkdir(path,{recursive:true})
 async function bundle(folder,name,patch){const packageDir=join(f.dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.26.0-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),typeof patch==='string'?patch:json(patch));return{packageName:name,packageDir}}
 const base=await bundle('base','@fixture/base',[{insert:[{id:'web',name:'cordis:web-fixture',config:{}}]}]),old=await bundle('old',PRODUCT,[{insert:[{id:'model-router-galgame',name:PRODUCT,config:{private:'SECRET-CONFIG'}}]}]),target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
 await writeFile(join(profile,'package.json'),json({dsh:{profile:{bundles:[base.packageName,old.packageName]}}}))
 await mkdir(join(bot,'memory'));await writeFile(join(bot,'state.json'),json({version:1,mainBotIds:['bot-a'],bots:{'bot-a':{id:'bot-a',sessionId:'session-a'}},rooms:{},agents:{}}));await writeFile(join(bot,'memory','saved.json'),json({owner:'bot-a',latest:true}));await writeFile(join(sessions,'session-a.jsonl'),'PRIVATE-LATEST-SESSION\n')
 const configurationPlan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:profile,orderedBundleLayers:[base,old],launcherLayers:[],launchEnvironment:{},targetBundleLayer:target})
 const inventory=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:sessions}])
 makeSettled(f.journal,f.runner,'bot-a','rehearsal-task',clock())
 insertReceipt(f.db,{id:'rehearsal-receipt',runId:'rehearsal-run',state:'settled',extra:{costUsd:null,subscriptionTokens:null}})
 await prepare?.(f)
 const dataArchive=join(f.dir,'data-archive'),ledgerArchive=join(f.dir,'ledger-archive')
 await createMigrationDataArchive({inventory,configurationPlan,privateOutput:dataArchive})
 const expected=exportMigrationLedger(f.db);await createMigrationLedgerArchive({Database,database:f.db,privateOutput:ledgerArchive})
 f.db.close();f.journal.close();await f.store.close()
 const restored=join(f.dir,'restored');await mkdir(restored)
 return {...f,home,bot,sessions,inventory,expected,dataArchive,ledgerArchive,operationDirectory:join(f.dir,'rehearsal-operation'),targets:{domains:[{id:'bot',root:join(restored,'bot')},{id:'sessions',root:join(restored,'sessions')}],ledger:join(restored,'orchestration.sqlite')}}
}
const rehearse=(f,extra={})=>rehearseMigrationRollback({Database,journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,assertExclusive:async()=>true,...extra})
async function noEffects(f){await assert.rejects(stat(f.operationDirectory),{code:'ENOENT'});for(const target of [...f.targets.domains.map(row=>row.root),f.targets.ledger])await assert.rejects(stat(target),{code:'ENOENT'})}

test('rollback rehearsal restores current data to isolated targets and reconciles live, archives and restored copies',async t=>{
 const f=await fixture(t),result=await rehearse(f)
 assert.deepEqual(result,{schemaVersion:1,kind:'migration-rollback-rehearsal',status:'rehearsed',rehearsed:true,domains:2,duplicateWrites:0,replayed:false,activated:false,rolledBack:false,authoritySwitched:false,crossDomainConsistent:false,domainCompletenessProven:false,activationSupported:false,postActivationRollbackSupported:false,stopWriteProvable:false})
 assert.equal(JSON.stringify(result).includes(f.dir),false);assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false)
 assert.deepEqual(await readFile(join(f.targets.domains[0].root,'memory','saved.json')),await readFile(join(f.bot,'memory','saved.json')))
 assert.deepEqual(await readFile(join(f.targets.domains[1].root,'session-a.jsonl')),await readFile(join(f.sessions,'session-a.jsonl')))
 const current=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:f.targets.domains[0].root},{id:'sessions',kind:'sessions',root:f.targets.domains[1].root}])
 assert.equal(reconcileMigrationInventories(f.inventory,current).equal,true)
 const db=new Database(f.targets.ledger,{readonly:true,fileMustExist:true})
 try{assert.deepEqual(exportMigrationLedger(db),f.expected);assert.equal(db.prepare('SELECT count(*) n FROM router_model_calls').get().n,1);assert.equal(db.prepare('SELECT bot_id FROM router_model_calls').get().bot_id,'bot-a');assert.equal(JSON.parse(db.prepare('SELECT payload FROM router_model_calls').get().payload).costUsd,null)}finally{db.close()}
 const live=new Database(f.file,{readonly:true,fileMustExist:true});try{assert.deepEqual(exportMigrationLedger(live),f.expected)}finally{live.close()}
})

test('rollback rehearsal replays one operation and supports a second independent import without duplicate receipts or rewrites',async t=>{
 const f=await fixture(t),first=await rehearse(f);assert.equal(first.replayed,false)
 const state=join(f.targets.domains[0].root,'state.json'),beforeState=await stat(state),beforeLedger=await stat(f.targets.ledger)
 const replay=await rehearse(f);assert.equal(replay.replayed,true);assert.equal(replay.duplicateWrites,0)
 assert.equal((await stat(state)).mtimeMs,beforeState.mtimeMs);assert.equal((await stat(f.targets.ledger)).mtimeMs,beforeLedger.mtimeMs)
 const root=join(f.dir,'second-restored');await mkdir(root)
 const second=await rehearse(f,{operationDirectory:join(f.dir,'second-operation'),targets:{domains:[{id:'bot',root:join(root,'bot')},{id:'sessions',root:join(root,'sessions')}],ledger:join(root,'orchestration.sqlite')}})
 assert.equal(second.replayed,false);assert.equal(second.rehearsed,true)
 for(const file of [f.targets.ledger,join(root,'orchestration.sqlite')]){const db=new Database(file,{readonly:true,fileMustExist:true});try{assert.deepEqual(exportMigrationLedger(db),f.expected);assert.equal(db.prepare('SELECT count(*) n FROM router_model_calls').get().n,1)}finally{db.close()}}
})

test('rollback rehearsal requires exclusive ownership and one canonical schema5 database',async t=>{
 const f=await fixture(t)
 await assert.rejects(rehearse(f,{assertExclusive:async()=>false}),{code:'MIGRATION_ROLLBACK_EXCLUSIVE_REQUIRED'});await noEffects(f)
 await assert.rejects(rehearse(f,{assertExclusive:async()=>{throw new Error('owner lost')}}),{code:'MIGRATION_ROLLBACK_EXCLUSIVE_REQUIRED'});await noEffects(f)
 const other=join(f.dir,'other.sqlite');new Database(other).close()
 await assert.rejects(rehearse(f,{journalFile:other}),{code:'MIGRATION_ROLLBACK_LEDGER_SCOPE_UNSUPPORTED'});await noEffects(f)
 for(const version of [4,6]){
  const db=new Database(f.file);db.pragma(`user_version=${version}`);db.close()
  await assert.rejects(rehearse(f),{code:version===4?'MIGRATION_ROLLBACK_SCHEMA_REQUIRED':'MIGRATION_LEDGER_SCHEMA_UNSUPPORTED'});await noEffects(f)
  const restore=new Database(f.file);restore.pragma('user_version=5');restore.close()
 }
})

test('rollback rehearsal combines readiness with receipt, hold and terminal-task recovery guards',async t=>{
 for(const [name,prepare,code] of [
  ['unknown receipt',f=>insertReceipt(f.db,{id:'unknown-receipt',state:'unknown'}),'RECOVERY_RECEIPT_UNKNOWN'],
  ['running receipt',f=>insertReceipt(f.db,{id:'running-receipt',state:'running'}),'RECOVERY_RECEIPT_IN_FLIGHT'],
  ['admitted receipt',f=>insertReceipt(f.db,{id:'admitted-receipt',state:'admitted'}),'RECOVERY_RECEIPT_IN_FLIGHT'],
  ['unparseable receipt',f=>f.db.prepare("UPDATE router_model_calls SET payload='not-json' WHERE id='rehearsal-receipt'").run(),'RECOVERY_RECEIPT_UNPARSEABLE'],
  ['open hold',f=>insertHold(f.db,{id:'open-hold',runId:'run-open-hold'}),'OPEN_HOLD'],
  ['interrupted hold',f=>insertHold(f.db,{id:'interrupted-hold',runId:'run-interrupted-hold',status:'interrupted'}),'OPEN_HOLD'],
  ['active task',f=>makeActive(f.journal,f.runner,'bot-a','active-task',clock()),'ACTIVE_TASK'],
  ['waiting-budget task',f=>makeWaitingBudget(f.journal,f.runner,'bot-a','waiting-task',clock()),'ACTIVE_TASK'],
  ['needs-reconciliation task',f=>makeNeedsReconciliation(f.journal,f.runner,'bot-a','unknown-task',clock()),'UNKNOWN_TASK_OUTCOME'],
  ['started skipped',f=>{const task=makeSettled(f.journal,f.runner,'bot-a','started-skipped-task',clock());f.db.prepare("UPDATE tasks SET state='skipped' WHERE id=?").run(task.taskId)},'SKIPPED_WITH_STARTED_ATTEMPT'],
  ['unsettled operation',f=>{const task=makeSettled(f.journal,f.runner,'bot-a','unsettled-operation-task',clock());f.db.prepare("UPDATE operations SET state='running',finished_ms=NULL WHERE id=?").run(task.operationId)},'UNSETTLED_OPERATION'],
  ['undelivered outbox',f=>{const task=makeSettled(f.journal,f.runner,'bot-a','undelivered-outbox-task',clock());f.db.prepare("UPDATE task_outbox SET delivered_ms=NULL WHERE operation_id=?").run(task.operationId)},'UNDELIVERED_OUTBOX'],
  ['not-started blocked',f=>makeBlocked(f.journal,f.runner,'bot-a','blocked-task',clock()),'ABSTAINED_TASK'],
  ['not-started skipped',f=>{const task=makeSettled(f.journal,f.runner,'bot-a','not-started-skipped-task',clock());f.db.prepare("UPDATE tasks SET state='skipped' WHERE id=?").run(task.taskId);f.db.prepare("UPDATE attempts SET started_ms=NULL,result=? WHERE id=?").run(json({notStarted:true}),task.attemptId)},'ABSTAINED_TASK'],
 ]){
  const f=await fixture(t,{prepare})
  await assert.rejects(rehearse(f),error=>{assert.equal(error.code,'MIGRATION_ROLLBACK_PRECONDITION_BLOCKED',name);assert.ok([...error.details.readinessBlockers,...error.details.recoveryBlockers,code==='ABSTAINED_TASK'?'ABSTAINED_TASK':null].includes(code),name);if(code==='ABSTAINED_TASK')assert.equal(error.details.abstainedTasks,1);return true})
  await noEffects(f)
 }
})

test('rollback rehearsal stops at a publication boundary when the owner guard is lost and resumes only with a valid guard',async t=>{
 const f=await fixture(t);let held=true
 await assert.rejects(rehearse(f,{assertExclusive:async()=>held,onBoundary:async boundary=>{if(boundary.phase==='domain-restored'&&boundary.index===0)held=false}}),{code:'MIGRATION_ROLLBACK_EXCLUSIVE_REQUIRED'})
 assert.equal((await stat(f.targets.domains[0].root)).isDirectory(),true);await assert.rejects(stat(f.targets.domains[1].root),{code:'ENOENT'});await assert.rejects(stat(f.targets.ledger),{code:'ENOENT'})
 held=true;const resumed=await rehearse(f);assert.equal(resumed.replayed,true);assert.equal(resumed.rehearsed,true)
})

test('rollback rehearsal detects non-participating source and ledger drift after publication and preserves existing effects',async t=>{
 for(const drift of ['source','ledger','final-ledger']){
  const f=await fixture(t)
  await assert.rejects(rehearse(f,{onBoundary:async boundary=>{
   if(drift==='final-ledger'&&boundary.phase!=='before-final-recheck')return
   if(drift!=='final-ledger'&&!(boundary.phase==='domain-restored'&&boundary.index===0))return
   if(drift==='source')await writeFile(join(f.bot,'memory','saved.json'),json({owner:'bot-a',latest:false,drift:true}))
   else{const db=new Database(f.file);insertReceipt(db,{id:'drift-'+drift,runId:'run-drift-'+drift,state:'settled'});db.close()}
  }}),{code:'MIGRATION_ROLLBACK_SOURCE_CHANGED'})
  assert.equal((await stat(f.targets.domains[0].root)).isDirectory(),true)
  if(drift==='final-ledger'){assert.equal((await stat(f.targets.domains[1].root)).isDirectory(),true);assert.equal((await stat(f.targets.ledger)).isFile(),true)}
  else{await assert.rejects(stat(f.targets.domains[1].root),{code:'ENOENT'});await assert.rejects(stat(f.targets.ledger),{code:'ENOENT'})}
  if(drift==='source')assert.equal(JSON.parse(await readFile(join(f.bot,'memory','saved.json'),'utf8')).drift,true)
 }
})

test('rollback rehearsal rejects live target overlap before any publication',async t=>{
 const f=await fixture(t)
 await assert.rejects(rehearse(f,{targets:{...f.targets,domains:[{id:'bot',root:join(f.bot,'nested')},f.targets.domains[1]]}}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
 await assert.rejects(rehearse(f,{targets:{...f.targets,ledger:f.file}}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
 await assert.rejects(rehearse(f,{operationDirectory:join(f.sessions,'operation')}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
})

test('rollback rehearsal rejects linked target aliases before any publication',async t=>{
 const f=await fixture(t),alias=join(f.dir,'bot-target-alias'),hardlink=join(f.dir,'ledger-target-hardlink.sqlite')
 await symlink(f.bot,alias,process.platform==='win32'?'junction':'dir')
 await assert.rejects(rehearse(f,{targets:{...f.targets,domains:[{id:'bot',root:alias},f.targets.domains[1]]}}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
 await link(f.file,hardlink)
 await assert.rejects(rehearse(f,{targets:{...f.targets,ledger:hardlink}}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
 const liveFileAlias=join(f.dir,'live-file-target-hardlink.json')
 await link(join(f.bot,'state.json'),liveFileAlias)
 await assert.rejects(rehearse(f,{targets:{...f.targets,ledger:liveFileAlias}}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
 const archiveFileAlias=join(f.dir,'archive-target-hardlink.sqlite')
 await link(join(f.ledgerArchive,'ledger.sqlite'),archiveFileAlias)
 await assert.rejects(rehearse(f,{targets:{...f.targets,ledger:archiveFileAlias}}),{code:'MIGRATION_ROLLBACK_TARGET_CONFLICT'})
 await noEffects(f)
})

test('rollback rehearsal refuses archive tampering and operation request changes without overwriting prior effects',async t=>{
 const tampered=await fixture(t)
 await writeFile(join(tampered.dataArchive,'data','domain-0000','state.json'),json({tampered:true}))
 await assert.rejects(rehearse(tampered),error=>{assert.match(error.code,/^MIGRATION_CAPTURE_/);return true})
 await noEffects(tampered)

 const f=await fixture(t);await rehearse(f)
 const second=join(f.dir,'different-target');await mkdir(second)
 await assert.rejects(rehearse(f,{targets:{domains:[{id:'bot',root:join(second,'bot')},{id:'sessions',root:join(second,'sessions')}],ledger:join(second,'orchestration.sqlite')}}),{code:'MIGRATION_RESTORE_OPERATION_MISMATCH'})
 assert.equal((await stat(f.targets.domains[0].root)).isDirectory(),true)
 assert.equal((await stat(f.targets.domains[1].root)).isDirectory(),true)
 assert.equal((await stat(f.targets.ledger)).isFile(),true)
 await assert.rejects(stat(join(second,'bot')),{code:'ENOENT'});await assert.rejects(stat(join(second,'sessions')),{code:'ENOENT'});await assert.rejects(stat(join(second,'orchestration.sqlite')),{code:'ENOENT'})
})
