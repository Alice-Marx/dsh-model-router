import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,symlink,link,cp,utimes,stat,unlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {inspectMigrationSources,verifyMigrationInventory,reconcileMigrationInventories,summarizeMigrationInventory} from '../packages/orchestration/src/migration-snapshot.mjs'
await mkdir(resolve('tmp/integration/migration-snapshot'),{recursive:true})
async function fixture(){const dir=await mkdtemp(resolve('tmp/integration/migration-snapshot/case-')),root=join(dir,'用户 数据');await mkdir(root);await mkdir(join(root,'空目录'));await writeFile(join(root,'state.json'),'{"botId":"stable","costUsd":null}\n');await writeFile(join(root,'unknown-extension.bin'),Buffer.from([0,255,128,1]));return{dir,root,sources:[{id:'privateLabel',kind:'bot-data',root}]}}
const code=expected=>e=>e.code===expected
test('migration inventory: preserves all selected files, unknown bytes and empty directories deterministically',async()=>{
  const f=await fixture(),before=await readFile(join(f.root,'state.json')),a=await inspectMigrationSources(f.sources),b=await inspectMigrationSources(f.sources)
  assert.deepEqual(a,b);assert.deepEqual(a.counts,{sources:1,files:2,directories:2,totalBytes:before.length+4})
  assert.deepEqual(a.sources[0].entries.map(e=>e.path),['','state.json','unknown-extension.bin','空目录'])
  assert.equal(a.sources[0].entries[1].sha256.length,64)
  assert.deepEqual(await readFile(join(f.root,'state.json')),before)
  assert.deepEqual(await verifyMigrationInventory(a),{unchanged:true,consistentSnapshot:false,requiresStopProof:true})
})
test('migration inventory: public diagnostics whitelist aggregate facts and discard labels and paths',async()=>{
  const f=await fixture(),inventory=await inspectMigrationSources(f.sources),summary=summarizeMigrationInventory({...inventory,secret:'must never leak'})
  assert.deepEqual(Object.keys(summary).sort(),['consistentSnapshot','directories','files','requiresStopProof','schemaVersion','scope','sources','totalBytes'].sort())
  for(const secret of [f.dir,'privateLabel','state.json','stable','costUsd','sha256'])assert.ok(!JSON.stringify(summary).includes(secret))
  assert.equal(summary.consistentSnapshot,false);assert.equal(summary.requiresStopProof,true)
})
test('migration inventory: same-size source edits are rejected even with restored modification time',async()=>{
  const f=await fixture(),file=join(f.root,'unknown-extension.bin'),before=await stat(file),inventory=await inspectMigrationSources(f.sources)
  await writeFile(file,Buffer.from([4,3,2,1]));await utimes(file,before.atime,before.mtime)
  await assert.rejects(verifyMigrationInventory(inventory),code('MIGRATION_SOURCE_CHANGED'))
})
test('migration inventory: added and deleted entries are not silently omitted',async()=>{
  for(const kind of ['add','delete']){
    const f=await fixture(),inventory=await inspectMigrationSources(f.sources)
    if(kind==='add')await writeFile(join(f.root,'later'),'late');else await unlink(join(f.root,'state.json'))
    await assert.rejects(verifyMigrationInventory(inventory),code('MIGRATION_SOURCE_CHANGED'))
  }
})
test('migration inventory: copied trees reconcile content while retaining distinct file identities',async()=>{
  const f=await fixture(),target=join(f.dir,'copied');await cp(f.root,target,{recursive:true,errorOnExist:true,force:false})
  const a=await inspectMigrationSources(f.sources),b=await inspectMigrationSources([{...f.sources[0],root:target}])
  assert.notEqual(a.fingerprint,b.fingerprint);assert.equal(a.sources[0].contentFingerprint,b.sources[0].contentFingerprint)
  assert.deepEqual(reconcileMigrationInventories(a,b),{equal:true,missing:[],extra:[],changed:[],consistentSnapshot:false,requiresStopProof:true})
  await writeFile(join(target,'state.json'),'{}');await writeFile(join(target,'added'),'added');await unlink(join(target,'unknown-extension.bin'))
  const delta=reconcileMigrationInventories(a,await inspectMigrationSources([{...f.sources[0],root:target}]))
  assert.equal(delta.equal,false);assert.deepEqual(delta.changed,[{sourceId:'privateLabel',path:'state.json',reason:'structure-or-content'}]);assert.deepEqual(delta.missing,[{sourceId:'privateLabel',path:'unknown-extension.bin'}]);assert.deepEqual(delta.extra,[{sourceId:'privateLabel',path:'added'}])
})
test('migration inventory: a missing or additional domain and wrong domain kind are explicit',async()=>{
  const f=await fixture(),other=join(f.dir,'other');await mkdir(other)
  const a=await inspectMigrationSources(f.sources),b=await inspectMigrationSources([...f.sources,{id:'other',kind:'other',root:other}])
  assert.deepEqual(reconcileMigrationInventories(a,b).extra,[{sourceId:'other',path:''}]);assert.deepEqual(reconcileMigrationInventories(b,a).missing,[{sourceId:'other',path:''}])
  const wrong=await inspectMigrationSources([{...f.sources[0],kind:'sessions'}]);assert.deepEqual(reconcileMigrationInventories(a,wrong).changed,[{sourceId:'privateLabel',path:'',reason:'domain-kind'}])
})
test('migration inventory: link to a selected or outside directory is refused rather than followed',async()=>{
  for(const within of [true,false]){
    const f=await fixture(),outside=join(f.dir,'outside');await mkdir(outside);await writeFile(join(outside,'secret'),'never read')
    await symlink(within?join(f.root,'空目录'):outside,join(f.root,'linked'),process.platform==='win32'?'junction':'dir')
    await assert.rejects(inspectMigrationSources(f.sources),code('MIGRATION_LINK_UNSUPPORTED'))
  }
})
test('migration inventory: a selected root junction is also an explicit unsupported reference',async()=>{
  const f=await fixture(),alias=join(f.dir,'alias');await symlink(f.root,alias,process.platform==='win32'?'junction':'dir')
  await assert.rejects(inspectMigrationSources([{...f.sources[0],root:alias}]),code('MIGRATION_LINK_UNSUPPORTED'))
})
test('migration inventory: ordinary hard-linked data retains both logical paths without losing bytes',async()=>{
  const f=await fixture();await link(join(f.root,'state.json'),join(f.root,'state-alias.json'))
  const inventory=await inspectMigrationSources(f.sources),files=inventory.sources[0].entries.filter(e=>e.type==='file')
  assert.equal(files.length,3);assert.equal(files[0].sha256,files[1].sha256);assert.equal(files[0].identity.ino,files[1].identity.ino)
})
test('migration inventory: duplicated, nested and case-alias roots cannot double-count domains',async()=>{
  const f=await fixture()
  for(const root of [f.root,join(f.root,'空目录'),...(process.platform==='win32'?[f.root.toUpperCase()]:[])])await assert.rejects(inspectMigrationSources([...f.sources,{id:'second',kind:'other',root}]),code('MIGRATION_SOURCE_OVERLAP'))
  await assert.rejects(inspectMigrationSources([...f.sources,...f.sources]),code('MIGRATION_SOURCE_INVALID'))
})
test('migration inventory: entry, byte and individual file limits abort the whole inventory',async()=>{
  const f=await fixture()
  for(const [option,expected] of [['maxEntries','MIGRATION_SCAN_ENTRY_LIMIT'],['maxBytes','MIGRATION_SCAN_BYTE_LIMIT'],['maxFileBytes','MIGRATION_SCAN_FILE_LIMIT']])await assert.rejects(inspectMigrationSources(f.sources,{[option]:1}),code(expected))
  for(const value of [-1,1.5,NaN,Infinity,2**53])await assert.rejects(inspectMigrationSources(f.sources,{maxBytes:value}),code('MIGRATION_SCAN_LIMIT_INVALID'))
})
test('migration inventory: a pre-cancelled scan touches no selected source and cancellation stays explicit',async()=>{
  const controller=new AbortController();controller.abort()
  await assert.rejects(inspectMigrationSources([{id:'missing',kind:'other',root:resolve('does-not-exist-fixture')}],{signal:controller.signal}),code('MIGRATION_SCAN_CANCELLED'))
})
test('migration inventory: malformed or altered private manifests cannot pass verification or summary',async()=>{
  const f=await fixture(),inventory=await inspectMigrationSources(f.sources)
  for(const value of [{...inventory,schemaVersion:999},{...inventory,consistentSnapshot:true},{...inventory,requiresStopProof:false}])assert.throws(()=>summarizeMigrationInventory(value),code('MIGRATION_INVENTORY_INVALID'))
  const changed=structuredClone(inventory);changed.sources[0].entries[1].sha256='0'.repeat(64)
  await assert.rejects(verifyMigrationInventory(changed),code('MIGRATION_INVENTORY_CHANGED'))
  assert.throws(()=>reconcileMigrationInventories(inventory,changed),code('MIGRATION_INVENTORY_CHANGED'))
})
test('migration inventory: inputs must be explicit absolute directories and errors do not print private paths',async()=>{
  const f=await fixture()
  for(const input of [[],[{id:'privateLabel',kind:'other',root:'relative'}],[{id:'privateLabel',kind:'unknown',root:f.root}],[{id:'../unsafe',kind:'other',root:f.root}]])await assert.rejects(inspectMigrationSources(input),e=>e.code.startsWith('MIGRATION_')&&!e.message.includes(f.root))
  await assert.rejects(inspectMigrationSources([{...f.sources[0],root:join(f.root,'state.json')}]),code('MIGRATION_SOURCE_NOT_DIRECTORY'))
})
