import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import Database from 'better-sqlite3'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'
import {createMigrationLedgerArchive,exportMigrationLedger} from '../packages/orchestration/src/migration-ledger-export.mjs'
import {restoreMigrationArchives} from '../packages/orchestration/src/migration-restore.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'

const ROOT=resolve(import.meta.dirname,'..'),parent=resolve('tmp/integration/migration-restore-crash');await mkdir(parent,{recursive:true})
const PRODUCT='@ljwei-stak/dsh-model-route-bot',json=value=>JSON.stringify(value)+'\n'
async function fixture(phase){
 const dir=await mkdtemp(join(parent,'case-')),home=join(dir,'home'),profile=join(home,'profiles','desktop'),bot=join(home,'bot'),sessions=join(home,'sessions')
 for(const path of [profile,bot,sessions])await mkdir(path,{recursive:true})
 async function bundle(folder,name,patch){const packageDir=join(dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.25.6-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),typeof patch==='string'?patch:json(patch));return{packageName:name,packageDir}}
 const base=await bundle('base','@fixture/base',[{insert:[{id:'web',name:'cordis:web-fixture',config:{searchProvider:'auto'}}]}]),mr=await bundle('old',PRODUCT,[{insert:[{id:'model-router-galgame',name:PRODUCT,config:{private:'SECRET-CONFIG'}}]}]),target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
 await writeFile(join(profile,'package.json'),json({dsh:{profile:{bundles:[base.packageName,mr.packageName]}}}))
 const team={version:1,mainBotIds:['bot-a'],bots:{'bot-a':{id:'bot-a',sessionId:'session-a',name:'A'}},rooms:{room:{id:'room',members:['bot-a'],sessions:{'bot-a':'room-a'},admin:'bot-a'}},agents:{}}
 await mkdir(join(bot,'memory'));await writeFile(join(bot,'state.json'),json(team));await writeFile(join(bot,'memory','saved.json'),json({owner:'bot-a',unknown:null}));await writeFile(join(sessions,'session-a.jsonl'),'PRIVATE-SESSION\n')
 const plan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:profile,orderedBundleLayers:[base,mr],launcherLayers:[],launchEnvironment:{},targetBundleLayer:target})
 assert.equal(plan.status,'ready')
 const inventory=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:sessions}]),dataArchive=join(dir,'data-archive'),ledgerArchive=join(dir,'ledger-archive')
 await createMigrationDataArchive({inventory,configurationPlan:plan,privateOutput:dataArchive})
 const ledgerFile=join(home,'orchestration.sqlite'),store=await openSqliteRouterState({Database,file:ledgerFile,legacyFile:join(home,'legacy.json')}),journal=store.openTaskJournal(),runner=journal.claimRunner('fixture',60000,0)
 const executionTarget={backend:'fixture',version:'v1',effect:'read',machineId:'local',workspaceId:'workspace',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:null}
 const submitted=journal.submit(runner,'bot-a','request-'+phase,'fixture',{backend:'fixture',input:{task:'original'},target:executionTarget,targetHash:'fixture-hash'},20000,1)
 const db=new Database(ledgerFile);db.prepare('INSERT INTO router_model_calls VALUES(?,?,?,?,?,?)').run('receipt-'+phase,'bot-a',submitted.taskId,'run-'+phase,'identity-'+phase,json({costUsd:null,subscriptionTokens:null,owner:'bot-a'}))
 const expected=exportMigrationLedger(db);await createMigrationLedgerArchive({Database,database:db,privateOutput:ledgerArchive});db.close();journal.close();await store.close()
 const restored=join(dir,'restored');await mkdir(restored)
 return {dir,bot,sessions,inventory,expected,dataArchive,ledgerArchive,operationDirectory:join(dir,'restore-operation'),targets:{domains:[{id:'bot',root:join(restored,'bot')},{id:'sessions',root:join(restored,'sessions')}],ledger:join(restored,'orchestration.sqlite')},phase}
}
async function crash(f){
 const request=join(f.dir,'crash-request.json');await writeFile(request,json({dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory,crashPhase:f.phase}))
 const child=spawn(process.execPath,[join(ROOT,'tests/fixtures/migration-restore-crash.mjs'),request],{cwd:ROOT,stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(30000)})
 const output=[];child.stdout.on('data',bytes=>output.push(bytes));child.stderr.on('data',bytes=>output.push(bytes))
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})
 assert.equal(code,86,Buffer.concat(output).toString('utf8'));await assert.rejects(stat(join(f.operationDirectory,'completed.json')),{code:'ENOENT'})
}
async function verify(f){
 const current=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:f.targets.domains[0].root},{id:'sessions',kind:'sessions',root:f.targets.domains[1].root}])
 assert.equal(reconcileMigrationInventories(f.inventory,current).equal,true)
 assert.deepEqual(await readFile(join(f.targets.domains[0].root,'state.json')),await readFile(join(f.bot,'state.json')))
 const db=new Database(f.targets.ledger,{readonly:true,fileMustExist:true})
 try{assert.deepEqual(exportMigrationLedger(db),f.expected);assert.equal(db.prepare('SELECT count(*) n FROM router_model_calls').get().n,1);assert.equal(db.prepare('SELECT bot_id FROM router_model_calls').get().bot_id,'bot-a')}finally{db.close()}
}

for(const phase of ['domain','ledger'])test(`migration restore crash: ${phase} publication boundary resumes in a fresh process without duplication`,async()=>{
 const f=await fixture(phase);await crash(f)
 if(phase==='domain'){
  assert.equal((await stat(f.targets.domains[0].root)).isDirectory(),true)
  await assert.rejects(stat(f.targets.domains[1].root),{code:'ENOENT'});await assert.rejects(stat(f.targets.ledger),{code:'ENOENT'})
 }
 const before=phase==='ledger'?await stat(f.targets.ledger):null
 const resumed=await restoreMigrationArchives({Database,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory})
 assert.equal(resumed.status,'restored');assert.equal(resumed.replayed,true);assert.equal(resumed.duplicateWrites,0);await verify(f)
 if(before)assert.equal((await stat(f.targets.ledger)).mtimeMs,before.mtimeMs)
 const replayed=await restoreMigrationArchives({Database,dataArchive:f.dataArchive,ledgerArchive:f.ledgerArchive,targets:f.targets,operationDirectory:f.operationDirectory})
 assert.equal(replayed.replayed,true);await verify(f)
})
