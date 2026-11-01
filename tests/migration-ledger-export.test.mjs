import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,stat,symlink,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import Database from 'better-sqlite3'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {createBudgetReservations} from '../.dsh-plugin/shared/budget-reservations.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {withinTaskAdmission} from '../packages/orchestration/src/task-admission.mjs'
import {taskHash} from '../packages/orchestration/src/task-contract.mjs'
import {exportMigrationLedger,createMigrationLedgerArchive,verifyMigrationLedgerArchive,summarizeMigrationLedgerArchive} from '../packages/orchestration/src/migration-ledger-export.mjs'

const root=resolve('tmp/integration/migration-ledger-export');await mkdir(root,{recursive:true})
const quote=s=>'"'+s.replaceAll('"','""')+'"'
async function fixture(t){
 const dir=await mkdtemp(join(root,'case-')),source=join(dir,'source');await mkdir(source)
 const file=join(source,'ledger.sqlite'),legacyFile=join(source,'state.json');await createRouterState({file:legacyFile}).saveHealth(null)
 const store=await openSqliteRouterState({Database,file,legacyFile}),journal=store.openTaskJournal(),db=new Database(file)
 t.after(async()=>{db.close();journal.close();await store.close()})
 return {dir,file,legacyFile,source,store,journal,db,output:join(dir,'archive')}
}
const capture=f=>createMigrationLedgerArchive({Database,database:f.db,privateOutput:f.output})
const readJson=async p=>JSON.parse(await readFile(p,'utf8'))
const decode=cell=>cell.type==='null'?null:cell.type==='integer'?BigInt(cell.value):cell.type==='real'?Number(cell.value):cell.type==='blob'?Buffer.from(cell.value,'base64'):cell.value
function rawRows(db,name){return db.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).safeIntegers(true).raw(true).all()}

test('ledger archive: actual schema5 preserves complete plans, attempts, outbox, dedup, refs, raw money/receipts and sequences',async t=>{
 const f=await fixture(t),j=f.journal,runner=j.claimRunner('fixture-runner',60000,0)
 const target={backend:'fixture',version:'v1',effect:'read',machineId:'machine-a',workspaceId:'workspace-a',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:null}
 const input={backend:'fixture',input:{task:'fixture'},target,targetHash:taskHash(target)}
 const a=j.submit(runner,'bot-a','request-a','fixture',input,20000,1),running=j.claim(runner,'bot-a',a.taskId,2,{atomic:true})
 const reference={kind:'mr-run',runId:'run-a',marker:{schemaVersion:1,taskId:a.taskId,attemptId:a.attemptId,operationId:a.operationId,targetHash:input.targetHash}}
 const frame=j.createAdmission(runner,'bot-a',a.taskId,a.attemptId,()=>3);frame.checkpoint(reference)
 const run={id:'run-a',createdAt:Date.now(),status:'running',managedExecution:reference.marker,packages:[],reviews:[]}
 assert.equal((await withinTaskAdmission(frame,()=>createBudgetReservations({state:f.store}).beginExecution({run,packageEstimates:[{id:'direct',estimatedCostUsd:0.125}],dailyLimitUsd:1}))).accepted,true)
 // Valid rows deliberately retain unknown quantities, raw evidence and dedup
 // tombstones. Export must preserve them, not settle or reinterpret them.
 assert.equal(f.db.prepare('SELECT task_id FROM legacy_task_runs WHERE run_id=?').get('run-a').task_id,a.taskId)
 f.db.prepare('INSERT INTO task_reconciliations(attempt_id,at_ms,outcome,evidence) VALUES(?,?,?,?)').run(a.attemptId,4,'unknown','{"vendorReceipt":null,"private":"SECRET-EVIDENCE"}')
 f.db.prepare('INSERT INTO task_workspace_locks VALUES(?,?,?,?)').run('machine-a','workspace-a',a.taskId,a.attemptId)
 f.db.prepare('INSERT INTO router_model_calls VALUES(?,?,?,?,?,?)').run('receipt-a','bot-a',a.taskId,'run-a','identity-a','{"costUsd":null,"subscriptionTokens":null,"private":"SECRET-RECEIPT"}')
 f.db.prepare('INSERT INTO task_plans VALUES(?,?,?,?,?,?,?,?,?,?)').run('plan-a','bot-a','plan-request','hash','{"id":"plan-a"}','running',0,20000,1,4)
 f.db.prepare('INSERT INTO task_plan_packages VALUES(?,?,?,?)').run('plan-a','a',a.taskId,a.packageId)
 const b=j.submit(runner,'bot-b','request-b','fixture',input,20000,5)
 f.db.prepare('INSERT INTO task_plan_packages VALUES(?,?,?,?)').run('plan-a','b',b.taskId,b.packageId)
 f.db.prepare('INSERT INTO task_package_deps VALUES(?,?)').run(b.packageId,a.packageId)
 const before=await f.store.read(),marker=await readFile(f.legacyFile),sourceExport=exportMigrationLedger(f.db),result=await capture(f)
 assert.equal(result.status,'complete');assert.equal(result.databaseConsistent,true);assert.equal(result.crossDomainConsistent,false);assert.equal(result.requiresStopProof,true);assert.equal(result.applySupported,false)
 const saved=await readJson(join(f.output,'ledger-export.private.json'))
 assert.deepEqual(saved,sourceExport)
 for(const table of saved.tables){const values=table.rows.map(r=>r.values.map(decode));assert.deepEqual(values,rawRows(f.db,table.name),table.name)}
 for(const name of ['task_plans','task_plan_packages','task_package_deps','task_commands','task_execution_refs','task_reconciliations','task_admission_intents','router_model_calls','router_holds','router_funding_epochs','router_funding_runs','sqlite_sequence'])assert.ok(saved.tables.find(t=>t.name===name)?.rows.length,name)
 assert.ok(JSON.stringify(saved).includes('SECRET-RECEIPT'));assert.equal(saved.userVersion,5)
 assert.deepEqual(await f.store.read(),before);assert.deepEqual(await readFile(f.legacyFile),marker);assert.equal(f.db.open,true);assert.equal(f.db.inTransaction,false)
 assert.deepEqual(await verifyMigrationLedgerArchive({Database,privateOutput:f.output}),result)
 assert.equal(j.get('bot-a',a.taskId).state,running.state==='admitting'?'running':running.state)
})

test('ledger archive: committed WAL-only rows survive and uncommitted writes are excluded',async t=>{
 const f=await fixture(t);f.db.pragma('wal_autocheckpoint=0');f.db.exec('CREATE TABLE wal_rows(id INTEGER PRIMARY KEY,value TEXT)');f.db.prepare('INSERT INTO wal_rows VALUES(?,?)').run(1,'committed')
 assert.ok((await stat(f.file+'-wal')).size>0)
 const writer=new Database(f.file);t.after(()=>writer.close());writer.exec('BEGIN IMMEDIATE');writer.prepare('INSERT INTO wal_rows VALUES(?,?)').run(2,'uncommitted')
 try{await capture(f)}finally{writer.exec('ROLLBACK')}
 const backup=new Database(join(f.output,'ledger.sqlite'),{readonly:true});t.after(()=>backup.close());assert.deepEqual(backup.prepare('SELECT * FROM wal_rows').all(),[{id:1,value:'committed'}])
 assert.equal(backup.pragma('integrity_check',{simple:true}),'ok')
 const detached=join(f.dir,'detached.sqlite');await copyFile(join(f.output,'ledger.sqlite'),detached)
 const standalone=new Database(detached,{readonly:true,fileMustExist:true});try{assert.deepEqual(standalone.prepare('SELECT * FROM wal_rows').all(),[{id:1,value:'committed'}])}finally{standalone.close()}
})

test('ledger export: int64, binary blobs, nulls, reals, quoted names, generated and WITHOUT ROWID columns are lossless',async t=>{
 const f=await fixture(t)
 f.db.exec('CREATE TABLE "odd"" name"(id INTEGER PRIMARY KEY,v BLOB,t TEXT,n INTEGER,r REAL,empty TEXT,g TEXT GENERATED ALWAYS AS (t || \'!\') STORED); CREATE TABLE pair(a TEXT,b INTEGER,v TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID')
 f.db.prepare('INSERT INTO "odd"" name"(id,v,t,n,r,empty) VALUES(?,?,?,?,?,?)').run(9223372036854775807n,Buffer.from([0,255,1]),'中文',-9223372036854775808n,1.25,null)
 f.db.prepare('INSERT INTO pair VALUES(?,?,?)').run('a',9,'first')
 const exported=exportMigrationLedger(f.db),table=exported.tables.find(t=>t.name==='odd" name'),pair=exported.tables.find(t=>t.name==='pair')
 assert.equal(table.rows[0].rowid,'9223372036854775807');assert.deepEqual(table.rows[0].values.map(decode),rawRows(f.db,'odd" name')[0]);assert.equal(pair.withoutRowid,true);assert.equal(pair.rows[0].rowid,null)
 await capture(f);assert.equal((await verifyMigrationLedgerArchive({Database,privateOutput:f.output})).status,'complete')
})

test('ledger archive: a fresh capture includes later commits without changing an earlier archive',async t=>{
 const f=await fixture(t);await capture(f);const first=await readFile(join(f.output,'ledger-export.private.json'))
 f.db.exec('CREATE TABLE later(id TEXT PRIMARY KEY,value TEXT)');f.db.prepare('INSERT INTO later VALUES(?,?)').run('new','new receipt')
 const second=join(f.dir,'second');await createMigrationLedgerArchive({Database,database:f.db,privateOutput:second})
 assert.deepEqual(await readFile(join(f.output,'ledger-export.private.json')),first);assert.ok((await readJson(join(second,'ledger-export.private.json'))).tables.find(t=>t.name==='later')?.rows.length)
})

test('ledger archive: future versions, borrowed transactions and missing driver fail before creating output',async t=>{
 const f=await fixture(t);f.db.pragma('user_version=6');await assert.rejects(capture(f),{code:'MIGRATION_LEDGER_SCHEMA_UNSUPPORTED'});await assert.rejects(stat(f.output),{code:'ENOENT'});f.db.pragma('user_version=5')
 f.db.exec('BEGIN');try{assert.throws(()=>exportMigrationLedger(f.db),{code:'MIGRATION_LEDGER_CONNECTION_UNAVAILABLE'});await assert.rejects(capture(f),{code:'MIGRATION_LEDGER_CONNECTION_UNAVAILABLE'});assert.equal(f.db.inTransaction,true)}finally{f.db.exec('ROLLBACK')}
 await assert.rejects(createMigrationLedgerArchive({database:f.db,privateOutput:f.output}),{code:'MIGRATION_LEDGER_DRIVER_REQUIRED'})
})

test('ledger archive: output cannot modify the source tree, follow a junction into it or overwrite an existing directory',async t=>{
 const f=await fixture(t),before=await readFile(f.legacyFile)
 for(const output of [join(f.source,'new'),f.source])await assert.rejects(createMigrationLedgerArchive({Database,database:f.db,privateOutput:output}),{code:'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE'})
 const alias=join(f.dir,'alias');await symlink(f.source,alias,process.platform==='win32'?'junction':'dir')
 await assert.rejects(createMigrationLedgerArchive({Database,database:f.db,privateOutput:join(alias,'new')}),{code:'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE'})
 await mkdir(f.output);await writeFile(join(f.output,'keep'),'untouched');await assert.rejects(capture(f),{code:'EEXIST'});assert.equal(await readFile(join(f.output,'keep'),'utf8'),'untouched');assert.deepEqual(await readFile(f.legacyFile),before)
})

test('ledger export: rows, values, schema and total bytes have independent enforced bounds',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TABLE bounds(v TEXT)');f.db.prepare('INSERT INTO bounds VALUES(?)').run('x'.repeat(10000))
 for(const [limits,code] of [[{maxRows:1},'MIGRATION_LEDGER_ROW_LIMIT'],[{maxValueBytes:1024},'MIGRATION_LEDGER_VALUE_LIMIT'],[{maxSchemaItems:1},'MIGRATION_LEDGER_SCHEMA_LIMIT'],[{maxExportBytes:100},'MIGRATION_LEDGER_EXPORT_LIMIT']])assert.throws(()=>exportMigrationLedger(f.db,{limits}),{code})
 for(const limits of [null,[],{maxRows:0},{maxRows:100001},{secret:'PRIVATE'}])assert.throws(()=>exportMigrationLedger(f.db,{limits}),{code:'MIGRATION_LEDGER_LIMIT_INVALID'})
 assert.equal(f.db.inTransaction,false)
})

test('ledger archive: size/cancellation failures never produce a completed manifest',async t=>{
 const f=await fixture(t);await assert.rejects(createMigrationLedgerArchive({Database,database:f.db,privateOutput:f.output,limits:{maxDatabaseBytes:1}}),{code:'MIGRATION_LEDGER_DATABASE_LIMIT'});await assert.rejects(stat(f.output),{code:'ENOENT'})
 const controller=new AbortController();controller.abort();await assert.rejects(createMigrationLedgerArchive({Database,database:f.db,privateOutput:f.output,signal:controller.signal}),{code:'MIGRATION_LEDGER_CANCELLED'})
 await assert.rejects(createMigrationLedgerArchive({Database,database:f.db,privateOutput:f.output,limits:{maxSchemaItems:1}}),{code:'MIGRATION_LEDGER_SCHEMA_LIMIT'});await assert.rejects(stat(join(f.output,'archive.private.json')),{code:'ENOENT'});assert.equal(f.db.open,true)
})

test('ledger archive: foreign-key violations remain in an incomplete archive and are never called verified',async t=>{
 const f=await fixture(t);f.db.pragma('foreign_keys=OFF');f.db.prepare('INSERT INTO task_package_deps VALUES(?,?)').run('missing-a','missing-b')
 await assert.rejects(capture(f),{code:'MIGRATION_LEDGER_REFERENCES_INVALID'});await assert.rejects(stat(join(f.output,'archive.private.json')),{code:'ENOENT'})
})

test('ledger archive: binary, logical and manifest tampering and linked members are refused',async t=>{
 for(const member of ['ledger.sqlite','ledger-export.private.json','archive.private.json']){
  const f=await fixture(t);await capture(f);await writeFile(join(f.output,member),'tampered')
  await assert.rejects(verifyMigrationLedgerArchive({Database,privateOutput:f.output}),e=>/^MIGRATION_/.test(e.code))
 }
 const f=await fixture(t);await capture(f);const {rename}=await import('node:fs/promises'),original=join(f.dir,'outside-json');await rename(join(f.output,'ledger-export.private.json'),original)
 try{await symlink(original,join(f.output,'ledger-export.private.json'),'file')}catch(e){if(e.code==='EPERM'){t.skip('File symlink permission unavailable; other tampering checks executed');return}throw e}
 await assert.rejects(verifyMigrationLedgerArchive({Database,privateOutput:f.output}),{code:'MIGRATION_PRIVATE_FILE_INVALID'})
})

test('ledger archive: owner-only artifacts and public summary never expose SQL, data, paths or digests',async t=>{
 const f=await fixture(t);const result=await capture(f),text=JSON.stringify(result)
 for(const v of [f.dir,'ledger.sqlite','sqlite','router_meta','contentDigest'])assert.ok(!text.includes(v))
 assert.deepEqual(summarizeMigrationLedgerArchive({status:'SECRET',counts:{tables:'SECRET',rows:-1},databaseConsistent:false,path:f.dir,sql:'secret'}),{schemaVersion:1,kind:'ledger-archive',status:'incomplete',tables:0,rows:0,databaseConsistent:false,crossDomainConsistent:false,requiresStopProof:true,applySupported:false})
 if(process.platform!=='win32')for(const path of [f.output,join(f.output,'ledger.sqlite'),join(f.output,'ledger-export.private.json'),join(f.output,'archive.private.json')])assert.equal((await stat(path)).mode&0o077,0)
 else{
  const probe=join(f.dir,'permissions.ps1');await writeFile(probe,'param([string]$Directory)\n$ErrorActionPreference="Stop"\n$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$paths=@($Directory)+@([IO.Directory]::GetFiles($Directory))\nforeach($p in $paths){$acl=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}; $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); if(@($rules | Where-Object {$_.AccessControlType -eq "Allow" -and $_.IdentityReference.Value -ne $sid}).Count -ne 0){throw ("Non-owner allow: "+(@($rules|Where-Object {$_.AccessControlType -eq "Allow" -and $_.IdentityReference.Value -ne $sid}|ForEach-Object {$_.IdentityReference.Value}) -join ","))};if(@($rules | Where-Object {$_.AccessControlType -eq "Allow" -and $_.IdentityReference.Value -eq $sid}).Count -ne 1){throw "Owner access missing"}}\n"owner-only"\n')
  assert.equal(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-File',probe,f.output],{encoding:'utf8',windowsHide:true}).trim(),'owner-only')
 }
})

test('ledger archive: changed logical data cannot be accepted by refreshing its manifest file hash',async t=>{
 const f=await fixture(t);await capture(f)
 const path=join(f.output,'ledger-export.private.json'),saved=await readJson(path);saved.tables.find(t=>t.rows.length).rows[0].values[0]={type:'text',value:'forged'}
 const bytes=Buffer.from(JSON.stringify(saved)+'\n');await writeFile(path,bytes)
 const manifest=await readJson(join(f.output,'archive.private.json'));manifest.files['ledger-export.private.json']={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};await writeFile(join(f.output,'archive.private.json'),JSON.stringify(manifest))
 await assert.rejects(verifyMigrationLedgerArchive({Database,privateOutput:f.output}),{code:'MIGRATION_LEDGER_ARCHIVE_CHANGED'})
})

test('ledger export: unsupported virtual tables and unaddressable rowids fail instead of losing hidden data',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TABLE shadow(rowid TEXT,_rowid_ TEXT,oid TEXT)')
 assert.throws(()=>exportMigrationLedger(f.db),{code:'MIGRATION_LEDGER_ROWID_UNSUPPORTED'});f.db.exec('DROP TABLE shadow; CREATE VIRTUAL TABLE search USING fts5(body)')
 assert.throws(()=>exportMigrationLedger(f.db),{code:'MIGRATION_LEDGER_VIRTUAL_UNSUPPORTED'})
})

test('ledger archive: cancellation during the actual SQLite online backup leaves no complete manifest',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TABLE bulk(value BLOB); INSERT INTO bulk VALUES(zeroblob(2097152))')
 const controller=new AbortController(),original=f.db.backup.bind(f.db);let progressed=false
 f.db.backup=(file,options)=>original(file,{progress:state=>{progressed=true;controller.abort();return options.progress(state)}})
 await assert.rejects(createMigrationLedgerArchive({Database,database:f.db,privateOutput:f.output,signal:controller.signal}),{code:'MIGRATION_LEDGER_CANCELLED'})
 assert.equal(progressed,true);await assert.rejects(stat(join(f.output,'archive.private.json')),{code:'ENOENT'});assert.equal(f.db.open,true)
})
