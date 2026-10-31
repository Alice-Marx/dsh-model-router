import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,readdir,stat,rename,link,symlink} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createMigrationDataArchive,verifyMigrationDataArchive,summarizeMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'

const ROOT=resolve(import.meta.dirname,'..'),parent=resolve('tmp/integration/migration-data-archive');await mkdir(parent,{recursive:true})
const PRODUCT='@ljwei-stak/dsh-model-router',json=v=>JSON.stringify(v)+'\n'
async function fixture(){
 const dir=await mkdtemp(join(parent,'case-')),home=join(dir,'home'),profile=join(home,'profiles','desktop'),bot=join(home,'bot'),sessions=join(home,'sessions')
 for(const path of [profile,bot,sessions])await mkdir(path,{recursive:true})
 async function bundle(folder,name,patch){const packageDir=join(dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.25.6-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),typeof patch==='string'?patch:json(patch));return{packageName:name,packageDir}}
 const base=await bundle('base','@fixture/base',[{insert:[{id:'web',name:'cordis:web-fixture',config:{searchProvider:'auto'}}]}]),mr=await bundle('old',PRODUCT,[{insert:[{id:'model-router-galgame',name:PRODUCT,config:{private:'SECRET-CONFIG'}}]}]),target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
 await writeFile(join(profile,'package.json'),json({dsh:{profile:{bundles:[base.packageName,mr.packageName]}}}))
 await mkdir(join(bot,'empty'));await mkdir(join(bot,'nested'));await writeFile(join(bot,'state.json'),json({id:'bot-stable',secret:'SECRET-DATA',sessionId:'session-stable'}));await writeFile(join(bot,'nested','opaque.bin'),Buffer.from(Array.from({length:200000},(_,i)=>i%256)))
 await writeFile(join(bot,'usage.sqlite'),Buffer.concat([Buffer.from('SQLite format 3\0'),Buffer.alloc(64)]));await writeFile(join(bot,'usage.sqlite-wal'),'raw WAL is preserved, not certified consistent');await writeFile(join(sessions,'session-stable.jsonl'),'PRIVATE-SESSION\n')
 const plan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:profile,orderedBundleLayers:[base,mr],launcherLayers:[],launchEnvironment:{},targetBundleLayer:target})
 assert.equal(plan.status,'ready')
 const inventory=await inspectMigrationSources([{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:sessions}])
 return {dir,home,profile,bot,sessions,target,plan,inventory,output:join(dir,'archive')}
}
const capture=f=>createMigrationDataArchive({inventory:f.inventory,configurationPlan:f.plan,privateOutput:f.output})

test('data capture: every selected byte, private-looking name, empty directory and configuration source is preserved',async()=>{
 const f=await fixture(),result=await capture(f)
 assert.equal(result.status,'complete');assert.equal(result.sources,2);assert.equal(result.files,5);assert.equal(result.rawSqliteFiles,1)
 assert.equal(result.crossDomainConsistent,false);assert.equal(result.databaseConsistent,false);assert.equal(result.requiresStopProof,true);assert.equal(result.applySupported,false);assert.equal(result.permissionsRestored,false)
 for(const path of ['state.json','nested/opaque.bin','usage.sqlite','usage.sqlite-wal'])assert.deepEqual(await readFile(join(f.bot,path)),await readFile(join(f.output,'data/domain-0000',path)))
 assert.ok((await stat(join(f.output,'data/domain-0000/empty'))).isDirectory())
 const plan=JSON.parse(await readFile(join(f.output,'profile-plan.private.json'),'utf8'));assert.deepEqual(plan,f.plan);assert.ok(JSON.stringify(plan).includes('SECRET-CONFIG'))
 assert.deepEqual(await verifyMigrationDataArchive({privateOutput:f.output}),result)
})
test('data capture: original source paths may disappear after a verified capture',async()=>{
 const f=await fixture(),result=await capture(f);await rename(f.home,join(f.dir,'old-home'))
 assert.deepEqual(await verifyMigrationDataArchive({privateOutput:f.output}),result)
})
test('data capture: edited data or config after preview fails before writing output',async()=>{
 for(const change of ['data','config']){
  const f=await fixture();await writeFile(change==='data'?join(f.bot,'state.json'):join(f.profile,'package.json'),'changed')
  await assert.rejects(capture(f),e=>/^MIGRATION_/.test(e.code));await assert.rejects(stat(f.output),{code:'ENOENT'})
 }
})
test('data capture: existing destinations and source/home/bundle overlaps are refused without changing them',async()=>{
 const f=await fixture(),before=await readFile(join(f.bot,'state.json'))
 for(const root of [f.bot,f.home,f.profile,f.target.packageDir])await assert.rejects(createMigrationDataArchive({inventory:f.inventory,configurationPlan:f.plan,privateOutput:join(root,'archive')}),{code:'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE'})
 await mkdir(f.output);await writeFile(join(f.output,'keep'),'unchanged');await assert.rejects(capture(f),{code:'EEXIST'});assert.equal(await readFile(join(f.output,'keep'),'utf8'),'unchanged');assert.deepEqual(await readFile(join(f.bot,'state.json')),before)
})
test('data capture: junction destinations into any selected source are refused',async()=>{
 const f=await fixture(),alias=join(f.dir,'alias');await symlink(f.bot,alias,process.platform==='win32'?'junction':'dir')
 await assert.rejects(createMigrationDataArchive({inventory:f.inventory,configurationPlan:f.plan,privateOutput:join(alias,'archive')}),{code:'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE'})
})
test('data capture: source hardlinks are not silently flattened into independent writable files',async()=>{
 const f=await fixture();await link(join(f.bot,'state.json'),join(f.bot,'state-alias.json'));f.inventory=await inspectMigrationSources(f.inventory.sources)
 await assert.rejects(capture(f),{code:'MIGRATION_CAPTURE_HARDLINK_UNSUPPORTED'});await assert.rejects(stat(join(f.output,'capture.private.json')),{code:'ENOENT'});assert.equal((await stat(join(f.bot,'state.json'))).nlink,2)
})
test('data capture: malformed plan, invalid path, altered inventory and pre-cancellation have no output',async()=>{
 const f=await fixture(),controller=new AbortController();controller.abort()
 await assert.rejects(createMigrationDataArchive({inventory:f.inventory,configurationPlan:{status:'blocked'},privateOutput:f.output}),{code:'MIGRATION_CAPTURE_READY_PLAN_REQUIRED'})
 await assert.rejects(createMigrationDataArchive({inventory:f.inventory,configurationPlan:f.plan,privateOutput:'relative'}),{code:'MIGRATION_PRIVATE_OUTPUT_ABSOLUTE_REQUIRED'})
 await assert.rejects(createMigrationDataArchive({inventory:f.inventory,configurationPlan:f.plan,privateOutput:f.output,signal:controller.signal}),{code:'MIGRATION_CAPTURE_CANCELLED'})
 const altered=structuredClone(f.inventory);altered.sources[0].entries[0].path='../escape';await assert.rejects(createMigrationDataArchive({inventory:altered,configurationPlan:f.plan,privateOutput:f.output}),{code:'MIGRATION_INVENTORY_CHANGED'})
 await assert.rejects(stat(f.output),{code:'ENOENT'})
})
test('data capture: cancellation after exclusive destination file creation leaves no completed manifest',async()=>{
 const f=await fixture(),controller=new AbortController()
 // Feed cancellation at a deterministic I/O boundary while using a real
 // AbortController, avoiding timing races on fast disks.
 const signal={get aborted(){if(existsSync(join(f.output,'data/domain-0000/nested/opaque.bin')))controller.abort();return controller.signal.aborted}}
 await assert.rejects(createMigrationDataArchive({inventory:f.inventory,configurationPlan:f.plan,privateOutput:f.output,signal}),{code:'MIGRATION_CAPTURE_CANCELLED'})
 await assert.rejects(stat(join(f.output,'capture.private.json')),{code:'ENOENT'});assert.equal((await readFile(join(f.bot,'nested','opaque.bin'))).length,200000)
})
test('data capture: changed, missing, extra and redirected copied content are refused',async()=>{
 for(const change of ['changed','missing','extra','domain']){
  const f=await fixture();await capture(f)
  if(change==='changed')await writeFile(join(f.output,'data/domain-0000/state.json'),'changed')
  if(change==='missing')await rename(join(f.output,'data/domain-0000/empty'),join(f.output,'removed-empty'))
  if(change==='extra')await writeFile(join(f.output,'data/domain-0000/extra'),'extra')
  if(change==='domain')await mkdir(join(f.output,'data/domain-9999'))
  await assert.rejects(verifyMigrationDataArchive({privateOutput:f.output}),e=>/^MIGRATION_/.test(e.code))
 }
 const f=await fixture();await capture(f);await rename(join(f.output,'data'),join(f.dir,'elsewhere'));await symlink(join(f.dir,'elsewhere'),join(f.output,'data'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(verifyMigrationDataArchive({privateOutput:f.output}),{code:'MIGRATION_CAPTURE_INVALID'})
})
test('data capture: config, manifest and counters are verified as private artifacts',async()=>{
 for(const member of ['profile-plan.private.json','capture.private.json']){
  const f=await fixture();await capture(f);await writeFile(join(f.output,member),'{}')
  await assert.rejects(verifyMigrationDataArchive({privateOutput:f.output}),e=>/^MIGRATION_/.test(e.code))
 }
 const f=await fixture();await capture(f);const path=join(f.output,'capture.private.json'),m=JSON.parse(await readFile(path));m.counts.files++;await writeFile(path,json(m));await assert.rejects(verifyMigrationDataArchive({privateOutput:f.output}),{code:'MIGRATION_CAPTURE_CHANGED'})
})
test('data capture: subsequent legitimate source changes stay separate from the earlier archive',async()=>{
 const f=await fixture(),original=await capture(f);await writeFile(join(f.bot,'new-memory'),'later')
 assert.deepEqual(await verifyMigrationDataArchive({privateOutput:f.output}),original)
 const next=join(f.dir,'next'),inventory=await inspectMigrationSources(f.inventory.sources),latest=await createMigrationDataArchive({inventory,configurationPlan:f.plan,privateOutput:next})
 assert.equal(latest.files,original.files+1);assert.deepEqual(await verifyMigrationDataArchive({privateOutput:f.output}),original)
})
test('data capture: archive permissions are private and public summary cannot reflect private strings',async()=>{
 const f=await fixture(),result=await capture(f),text=JSON.stringify(result)
 for(const v of [f.dir,'SECRET','state.json','PRIVATE-SESSION','sourceInventory'])assert.ok(!text.includes(v))
 assert.deepEqual(summarizeMigrationDataArchive({status:'SECRET',counts:{sources:'SECRET',files:-1,totalBytes:Infinity}}),{schemaVersion:1,kind:'selected-data-capture',status:'incomplete',sources:0,files:0,directories:0,totalBytes:0,rawSqliteFiles:0,crossDomainConsistent:false,databaseConsistent:false,requiresStopProof:true,applySupported:false,permissionsRestored:false})
 if(process.platform!=='win32'){
  async function check(path){const s=await stat(path);assert.equal(s.mode&0o077,0);if(s.isDirectory())for(const name of await readdir(path))await check(join(path,name))}await check(f.output)
 }else{
  const probe=join(f.dir,'permissions.ps1');await writeFile(probe,'param([string]$Directory)\n$ErrorActionPreference="Stop"\n$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n$paths=@($Directory)+@([IO.Directory]::GetFileSystemEntries($Directory,"*",[IO.SearchOption]::AllDirectories))\nforeach($p in $paths){$acl=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}; $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));if(@($rules | Where-Object {$_.AccessControlType -eq "Allow" -and $_.IdentityReference.Value -ne $sid}).Count -ne 0){throw "Non-owner allow"};if(@($rules | Where-Object {$_.AccessControlType -eq "Allow" -and $_.IdentityReference.Value -eq $sid}).Count -ne 1){throw "Owner access missing"}}\n"owner-only"\n')
  assert.equal(execFileSync('powershell.exe',['-NoLogo','-NoProfile','-File',probe,f.output],{encoding:'utf8',windowsHide:true}).trim(),'owner-only')
 }
})
