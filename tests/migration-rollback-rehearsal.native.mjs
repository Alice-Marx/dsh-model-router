import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import Database from 'better-sqlite3'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'
import {createMigrationLedgerArchive,exportMigrationLedger} from '../packages/orchestration/src/migration-ledger-export.mjs'
import {beginMigrationExclusive} from '../packages/orchestration/src/migration-fence.mjs'
import {rehearseMigrationRollback} from '../packages/orchestration/src/migration-rollback-rehearsal.mjs'
import {openRecoveryStore,recoveryRoot,makeSettled,insertReceipt,clock} from './fixtures/migration-recovery-audit-fixture.mjs'

const ROOT=resolve(import.meta.dirname,'..'),PRODUCT='@ljwei-stak/dsh-model-router',json=value=>JSON.stringify(value)+'\n'
await mkdir(recoveryRoot,{recursive:true})
async function fixture(t,phase){
 const f=await openRecoveryStore(t),home=join(f.dir,'home'),profile=join(home,'profiles','desktop'),bot=join(home,'bot'),sessions=join(home,'sessions')
 for(const path of [profile,bot,sessions])await mkdir(path,{recursive:true})
 async function bundle(folder,name,patch){const packageDir=join(f.dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.26.0-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),typeof patch==='string'?patch:json(patch));return{packageName:name,packageDir}}
 const base=await bundle('base','@fixture/base',[{insert:[{id:'web',name:'cordis:web-fixture',config:{}}]}]),old=await bundle('old',PRODUCT,[{insert:[{id:'model-router-galgame',name:PRODUCT,config:{private:'SECRET-CONFIG'}}]}]),target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
 await writeFile(join(profile,'package.json'),json({dsh:{profile:{bundles:[base.packageName,old.packageName]}}}))
 await mkdir(join(bot,'memory'));await writeFile(join(bot,'state.json'),json({version:1,mainBotIds:['bot-a'],bots:{'bot-a':{id:'bot-a',sessionId:'session-a'}},rooms:{},agents:{}}));await writeFile(join(bot,'memory','saved.json'),json({owner:'bot-a',latest:true}));await writeFile(join(sessions,'session-a.jsonl'),'PRIVATE-LATEST-SESSION\n')
 const configurationPlan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:profile,orderedBundleLayers:[base,old],launcherLayers:[],launchEnvironment:{},targetBundleLayer:target})
 const inventory=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:sessions}])
 makeSettled(f.journal,f.runner,'bot-a','rehearsal-crash-'+phase,clock())
 insertReceipt(f.db,{id:'receipt-'+phase,runId:'run-'+phase,state:'settled',extra:{costUsd:null,subscriptionTokens:null}})
 const dataArchive=join(f.dir,'data-archive'),ledgerArchive=join(f.dir,'ledger-archive')
 await createMigrationDataArchive({inventory,configurationPlan,privateOutput:dataArchive})
 const expected=exportMigrationLedger(f.db);await createMigrationLedgerArchive({Database,database:f.db,privateOutput:ledgerArchive})
 f.db.close();f.journal.close();await f.store.close()
 const restored=join(f.dir,'restored');await mkdir(restored)
 return {...f,phase,bot,sessions,inventory,expected,dataArchive,ledgerArchive,fenceHome:join(f.dir,'fence-home'),operationId:'rollback-rehearsal-'+phase,operationDirectory:join(f.dir,'rehearsal-operation'),targets:{domains:[{id:'bot',root:join(restored,'bot')},{id:'sessions',root:join(restored,'sessions')}],ledger:join(restored,'orchestration.sqlite')}}
}
async function crash(f){
 const request=join(f.dir,'crash-request.json');await writeFile(request,json({journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,fenceHome:f.fenceHome,operationId:f.operationId,crashPhase:f.phase}))
 const child=spawn(process.execPath,[join(ROOT,'tests/fixtures/migration-rollback-rehearsal-crash.mjs'),request],{cwd:ROOT,stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(30000)})
 const output=[];child.stdout.on('data',bytes=>output.push(bytes));child.stderr.on('data',bytes=>output.push(bytes))
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done)})
 assert.equal(code,86,Buffer.concat(output).toString('utf8'))
}
async function verify(f){
 const current=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:f.targets.domains[0].root},{id:'sessions',kind:'sessions',root:f.targets.domains[1].root}]);assert.equal(reconcileMigrationInventories(f.inventory,current).equal,true)
 assert.deepEqual(await readFile(join(f.targets.domains[0].root,'memory','saved.json')),await readFile(join(f.bot,'memory','saved.json')))
 const db=new Database(f.targets.ledger,{readonly:true,fileMustExist:true});try{assert.deepEqual(exportMigrationLedger(db),f.expected);assert.equal(db.prepare('SELECT count(*) n FROM router_model_calls').get().n,1)}finally{db.close()}
}

for(const phase of ['domain-0','domain-1','ledger','final'])test(`rollback rehearsal crash: ${phase} boundary resumes under a new fence owner without duplicate effects`,async t=>{
 const f=await fixture(t,phase);await crash(f)
 const completed=join(f.operationDirectory,'completed.json')
 assert.equal((await stat(f.targets.domains[0].root)).isDirectory(),true)
 if(phase.startsWith('domain'))await assert.rejects(stat(f.targets.ledger),{code:'ENOENT'});else assert.equal((await stat(f.targets.ledger)).isFile(),true)
 if(phase==='domain-0'){await assert.rejects(stat(f.targets.domains[1].root),{code:'ENOENT'});await assert.rejects(stat(completed),{code:'ENOENT'})}
 else{assert.equal((await stat(f.targets.domains[1].root)).isDirectory(),true);if(phase==='domain-1'||phase==='ledger')await assert.rejects(stat(completed),{code:'ENOENT'});else assert.equal((await stat(completed)).isFile(),true)}
 const before=phase.startsWith('domain')?null:await stat(f.targets.ledger),beforeDomain=phase==='domain-0'?await stat(join(f.targets.domains[0].root,'state.json')):phase==='domain-1'?await stat(join(f.targets.domains[1].root,'session-a.jsonl')):null
 const fence=await beginMigrationExclusive(f.fenceHome,{operationId:f.operationId,drainTimeoutMs:30000,pollMs:10});t.after(()=>fence.release().catch(()=>{}))
 const resumed=await rehearseMigrationRollback({Database,journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,assertExclusive:()=>fence.verify()})
 assert.equal(resumed.status,'rehearsed');assert.equal(resumed.replayed,true);assert.equal(resumed.duplicateWrites,0);await verify(f)
 if(before)assert.equal((await stat(f.targets.ledger)).mtimeMs,before.mtimeMs)
 if(beforeDomain){const path=phase==='domain-0'?join(f.targets.domains[0].root,'state.json'):join(f.targets.domains[1].root,'session-a.jsonl');assert.equal((await stat(path)).mtimeMs,beforeDomain.mtimeMs)}
 const replay=await rehearseMigrationRollback({Database,journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,assertExclusive:()=>fence.verify()})
 assert.equal(replay.replayed,true);assert.equal(replay.duplicateWrites,0);await verify(f)
})

test('rollback rehearsal refuses a stale real fence owner without publishing, then admits the current owner',async t=>{
 const f=await fixture(t,'stale-owner'),stale=await beginMigrationExclusive(f.fenceHome,{operationId:f.operationId}),current=await beginMigrationExclusive(f.fenceHome,{operationId:f.operationId})
 t.after(()=>current.release().catch(()=>{}))
 assert.equal(await stale.verify(),false);assert.equal(await current.verify(),true)
 await assert.rejects(rehearseMigrationRollback({Database,journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,assertExclusive:()=>stale.verify()}),{code:'MIGRATION_ROLLBACK_EXCLUSIVE_REQUIRED'})
 await assert.rejects(stat(f.operationDirectory),{code:'ENOENT'});for(const target of [...f.targets.domains.map(row=>row.root),f.targets.ledger])await assert.rejects(stat(target),{code:'ENOENT'})
 await assert.rejects(stale.release(),{code:'MIGRATION_FENCE_OWNER_LOST'})
 const result=await rehearseMigrationRollback({Database,journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,assertExclusive:()=>current.verify()})
 assert.equal(result.rehearsed,true);assert.equal(result.activated,false);assert.equal(result.rolledBack,false);assert.equal(result.stopWriteProvable,false);await verify(f)
})

test('rollback rehearsal crash resume rechecks preconditions and refuses source drift before later publication',async t=>{
 const f=await fixture(t,'domain-0');await crash(f)
 await writeFile(join(f.bot,'memory','saved.json'),json({owner:'bot-a',latest:false,driftAfterCrash:true}))
 const fence=await beginMigrationExclusive(f.fenceHome,{operationId:f.operationId,drainTimeoutMs:30000,pollMs:10});t.after(()=>fence.release().catch(()=>{}))
 await assert.rejects(rehearseMigrationRollback({Database,journalFile:f.file,routerFile:f.file,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,assertExclusive:()=>fence.verify()}),{code:'MIGRATION_ROLLBACK_SOURCE_CHANGED'})
 assert.equal((await stat(f.targets.domains[0].root)).isDirectory(),true);await assert.rejects(stat(f.targets.domains[1].root),{code:'ENOENT'});await assert.rejects(stat(f.targets.ledger),{code:'ENOENT'});await assert.rejects(stat(join(f.operationDirectory,'completed.json')),{code:'ENOENT'})
 assert.equal(JSON.parse(await readFile(join(f.bot,'memory','saved.json'),'utf8')).driftAfterCrash,true)
})
