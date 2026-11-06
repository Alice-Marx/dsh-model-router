import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import Database from 'better-sqlite3'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'
import {createMigrationLedgerArchive,exportMigrationLedger} from '../packages/orchestration/src/migration-ledger-export.mjs'
import {restoreMigrationArchives} from '../packages/orchestration/src/migration-restore.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'

const ROOT=resolve(import.meta.dirname,'..'),parent=resolve('tmp/integration/migration-restore');await mkdir(parent,{recursive:true})
const PRODUCT='@ljwei-stak/dsh-model-route-bot',json=value=>JSON.stringify(value)+'\n'
async function fixture(){
 const dir=await mkdtemp(join(parent,'case-')),home=join(dir,'home'),profile=join(home,'profiles','desktop'),bot=join(home,'bot'),sessions=join(home,'sessions')
 for(const path of [profile,bot,sessions])await mkdir(path,{recursive:true})
 async function bundle(folder,name,patch){const packageDir=join(dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.25.6-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),typeof patch==='string'?patch:json(patch));return{packageName:name,packageDir}}
 const base=await bundle('base','@fixture/base',[{insert:[{id:'web',name:'cordis:web-fixture',config:{}}]}]),mr=await bundle('old',PRODUCT,[{insert:[{id:'model-router-galgame',name:PRODUCT,config:{private:'SECRET-CONFIG'}}]}]),target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
 await writeFile(join(profile,'package.json'),json({dsh:{profile:{bundles:[base.packageName,mr.packageName]}}}))
 const team={version:1,mainBotIds:['bot-a'],bots:{'bot-a':{id:'bot-a',sessionId:'session-a',name:'A'},'bot-b':{id:'bot-b',sessionId:'session-b',name:'B'}},rooms:{room:{id:'room',members:['bot-a','bot-b'],sessions:{'bot-a':'room-a'},admin:'bot-a'}},agents:{}}
 await mkdir(join(bot,'memory'));await writeFile(join(bot,'state.json'),json(team));await writeFile(join(bot,'memory','saved.json'),json({owner:'bot-a',unknown:null}));await writeFile(join(sessions,'session-a.jsonl'),'PRIVATE-SESSION-A\n');await writeFile(join(sessions,'session-b.jsonl'),'PRIVATE-SESSION-B\n')
 const plan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:profile,orderedBundleLayers:[base,mr],launcherLayers:[],launchEnvironment:{},targetBundleLayer:target})
 const inventory=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:sessions}])
 await createMigrationDataArchive({inventory,configurationPlan:plan,privateOutput:join(dir,'data-archive')})
 const ledgerFile=join(home,'orchestration.sqlite'),store=await openSqliteRouterState({Database,file:ledgerFile,legacyFile:join(home,'legacy.json')}),journal=store.openTaskJournal(),runner=journal.claimRunner('fixture',60000,0)
 const executionTarget={backend:'fixture',version:'v1',effect:'read',machineId:'local',workspaceId:'workspace',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:null}
 const submitted=journal.submit(runner,'bot-a','request-a','fixture',{backend:'fixture',input:{task:'original'},target:executionTarget,targetHash:'fixture-hash'},20000,1)
 const db=new Database(ledgerFile)
 db.prepare('INSERT INTO router_model_calls VALUES(?,?,?,?,?,?)').run('receipt-a','bot-a',submitted.taskId,'run-a','identity-a',json({costUsd:null,subscriptionTokens:null,owner:'bot-a'}))
 const expected=exportMigrationLedger(db)
 await createMigrationLedgerArchive({Database,database:db,privateOutput:join(dir,'ledger-archive')})
 db.close();journal.close();await store.close()
 return {dir,home,bot,sessions,inventory,expected,submitted,dataArchive:join(dir,'data-archive'),ledgerArchive:join(dir,'ledger-archive'),operationDirectory:join(dir,'restore-operation')}
}
function destinations(f,suffix='restored'){
 const root=join(f.dir,suffix);return mkdir(root,{recursive:true}).then(()=>({root,targets:{domains:[{id:'bot',root:join(root,'bot')},{id:'sessions',root:join(root,'sessions')}],ledger:join(root,'orchestration.sqlite')}}))
}
const restore=(f,d,extra={})=>restoreMigrationArchives({Database,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:d.targets,operationDirectory:f.operationDirectory,...extra})
async function assertRestored(f,d){
 assert.deepEqual(await readFile(join(d.root,'bot','state.json')),await readFile(join(f.bot,'state.json')))
 assert.deepEqual(await readFile(join(d.root,'sessions','session-b.jsonl')),await readFile(join(f.sessions,'session-b.jsonl')))
 const current=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:join(d.root,'bot')},{id:'sessions',kind:'sessions',root:join(d.root,'sessions')}])
 assert.equal(reconcileMigrationInventories(f.inventory,current).equal,true)
 const db=new Database(join(d.root,'orchestration.sqlite'),{readonly:true,fileMustExist:true})
 try{assert.deepEqual(exportMigrationLedger(db),f.expected);assert.equal(db.prepare('SELECT count(*) n FROM router_model_calls').get().n,1);assert.equal(db.prepare('SELECT bot_id FROM router_model_calls').get().bot_id,'bot-a')}finally{db.close()}
}

test('migration restore: complete domain and ledger restoration is byte/logically identical and repeat imports do not duplicate',async()=>{
 const f=await fixture(),d=await destinations(f),first=await restore(f,d)
 assert.equal(first.status,'restored');assert.equal(first.replayed,false);assert.equal(first.duplicateWrites,0);assert.equal(first.activated,false);await assertRestored(f,d)
 const before=await stat(join(d.root,'bot','state.json')),replayed=await restore(f,d)
 assert.equal(replayed.replayed,true);assert.equal((await stat(join(d.root,'bot','state.json'))).mtimeMs,before.mtimeMs)
 const independent=await destinations(f,'second-import'),second=await restore(f,independent,{operationDirectory:join(f.dir,'second-operation')})
 assert.equal(second.replayed,false);await assertRestored(f,independent)
 const db=new Database(join(independent.root,'orchestration.sqlite'),{readonly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM router_model_calls').get().n,1)}finally{db.close()}
})

test('migration restore: interruption after a published domain resumes without rewriting it or losing later domains',async()=>{
 const f=await fixture(),d=await destinations(f)
 await assert.rejects(restore(f,d,{onBoundary:async boundary=>{if(boundary.phase==='domain-restored'&&boundary.index===0)throw new Error('fixture interruption')}}),/fixture interruption/)
 assert.equal((await stat(join(d.root,'bot'))).isDirectory(),true);await assert.rejects(stat(join(d.root,'sessions')),{code:'ENOENT'})
 const resumed=await restore(f,d);assert.equal(resumed.replayed,true);await assertRestored(f,d)
})

test('migration restore: interruption after ledger publication completes its journal on resume without another receipt',async()=>{
 const f=await fixture(),d=await destinations(f)
 await assert.rejects(restore(f,d,{onBoundary:async boundary=>{if(boundary.phase==='ledger-restored')throw new Error('ledger interruption')}}),/ledger interruption/)
 const before=await stat(join(d.root,'orchestration.sqlite')),resumed=await restore(f,d)
 assert.equal(resumed.replayed,true);assert.equal((await stat(join(d.root,'orchestration.sqlite'))).mtimeMs,before.mtimeMs);await assertRestored(f,d)
})

test('migration restore: any conflicting old target remains untouched and no other domain is published first',async()=>{
 const f=await fixture(),d=await destinations(f);await mkdir(join(d.root,'bot'));await writeFile(join(d.root,'bot','old.json'),'OLD-USER-DATA')
 await assert.rejects(restore(f,d),{code:'MIGRATION_RESTORE_TARGET_CONFLICT'})
 assert.equal(await readFile(join(d.root,'bot','old.json'),'utf8'),'OLD-USER-DATA');await assert.rejects(stat(join(d.root,'sessions')),{code:'ENOENT'});await assert.rejects(stat(join(d.root,'orchestration.sqlite')),{code:'ENOENT'})
})

test('migration restore: operation identity, archive integrity and target overlap fail before unintended writes',async()=>{
 const f=await fixture(),d=await destinations(f)
 await assert.rejects(restoreMigrationArchives({Database,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:{domains:[{id:'bot',root:d.root},{id:'sessions',root:join(d.root,'nested')}],ledger:join(d.root,'ledger.sqlite')},operationDirectory:f.operationDirectory}),{code:'MIGRATION_RESTORE_TARGET_OVERLAP'})
 await restore(f,d)
 const other=await destinations(f,'other-target');await assert.rejects(restore(f,{...other,operationDirectory:f.operationDirectory}),{code:'MIGRATION_RESTORE_OPERATION_MISMATCH'})
 const corrupted=await fixture();await writeFile(join(corrupted.dataArchive,'data/domain-0000/state.json'),'tampered')
 const bad=await destinations(corrupted);await assert.rejects(restore(corrupted,bad),error=>error.code.startsWith('MIGRATION_'));await assert.rejects(stat(bad.targets.domains[0].root),{code:'ENOENT'})
})

test('migration restore: invalid inputs and pre-cancellation have no target or journal effects',async()=>{
 const f=await fixture(),d=await destinations(f),controller=new AbortController();controller.abort()
 await assert.rejects(restore(f,d,{signal:controller.signal}),{code:'MIGRATION_RESTORE_CANCELLED'})
 await assert.rejects(restoreMigrationArchives({dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:d.targets,operationDirectory:f.operationDirectory}),{code:'MIGRATION_RESTORE_DRIVER_REQUIRED'})
 await assert.rejects(stat(f.operationDirectory),{code:'ENOENT'});await assert.rejects(stat(d.targets.domains[0].root),{code:'ENOENT'})
})
