import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,readdir,link,symlink,unlink,rename,lstat} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {prepareMigrationConfigurationCommit as prepare,resumeMigrationConfigurationCommit as resume,inspectMigrationConfigurationCommit as inspect} from '../packages/orchestration/src/migration-configuration-commit.mjs'
import {assertMigrationStartupAllowed,readMigrationStartupGate} from '../packages/orchestration/src/migration-startup-gate.mjs'

const parent=resolve('tmp/integration/migration-configuration-commit');await mkdir(parent,{recursive:true})
const sha=b=>createHash('sha256').update(b).digest('hex'),json=v=>JSON.stringify(v)+'\n'
async function fixture({prepareNow=true}={}){
 const root=await mkdtemp(join(parent,'case-')),home=join(root,'home'),profile=join(home,'profiles/desktop'),privateOutput=join(root,'owner-private');await mkdir(profile,{recursive:true})
 const a=join(profile,'package.json'),b=join(profile,'cordis.patch.yml'),before=Buffer.from('PRIVATE-BEFORE\n'),maintenance=Buffer.from('PRIVATE-DISABLED\n'),after=Buffer.from('PRIVATE-AFTER\n');await writeFile(a,before)
 const f={root,home,profile,privateOutput,a,b,before,maintenance,after,changes:[{path:a,beforeSha256:sha(before),maintenance,after},{path:b,beforeSha256:null,maintenance,after}]}
 if(prepareNow)f.result=await prepare(f);return f
}
const run=(f,phase,options={})=>resume({privateOutput:f.privateOutput,phase,...options})
test('configuration commit: private preparation preserves bytes, gates startup, and install stays validating',async()=>{
 const f=await fixture();assert.deepEqual(await readFile(f.a),f.before);assert.equal((await inspect(f)).phase,'prepared');assert.throws(()=>assertMigrationStartupAllowed({home:f.home}),{code:'PROFILE_MIGRATION_PENDING'})
 await run(f,'maintenance');assert.deepEqual(await readFile(f.a),f.maintenance);assert.deepEqual(await readFile(f.b),f.maintenance)
 await run(f,'install');assert.deepEqual(await readFile(f.a),f.after);assert.equal((await inspect(f)).phase,'validating');assert.equal((await inspect(f)).activationSupported,false);assert.throws(()=>assertMigrationStartupAllowed({home:f.home}),{code:'PROFILE_MIGRATION_PENDING'})
 await run(f,'install');assert.equal((await inspect(f)).recognized,true)
})
test('configuration commit: rollback restores original bytes/removes new files and only cleans owned temps',async()=>{
 const f=await fixture();await run(f,'maintenance');await run(f,'install');await writeFile(join(f.profile,'unrelated.keep'),'KEEP')
 await run(f,'rollback');await run(f,'rollback');assert.deepEqual(await readFile(f.a),f.before);await assert.rejects(readFile(f.b),{code:'ENOENT'});assert.equal(await readFile(join(f.profile,'unrelated.keep'),'utf8'),'KEEP');assert.ok(!(await readdir(f.profile)).some(n=>/\.dsh-/.test(n)));assert.equal(assertMigrationStartupAllowed({home:f.home}).allowed,true)
})
test('configuration commit: every real-process write boundary recovers without publishing a half activation',async()=>{
 for(const phase of ['maintenance','install','rollback'])for(const boundary of ['phase','intent','before-retire','retired','linked','published','written','phase-complete']){
  const f=await fixture();if(phase!=='maintenance')await run(f,'maintenance');if(phase==='rollback')await run(f,'install')
  const r=spawnSync(process.execPath,['tests/fixtures/migration-commit-crash.mjs',f.privateOutput,phase,boundary],{cwd:resolve('.'),encoding:'utf8',windowsHide:true,timeout:20000})
  assert.equal(r.status,86,`${phase}/${boundary}: ${r.stderr}`)
  if(phase==='rollback'&&boundary==='phase-complete')assert.equal(assertMigrationStartupAllowed({home:f.home}).allowed,true)
  else assert.throws(()=>assertMigrationStartupAllowed({home:f.home}),{code:'PROFILE_MIGRATION_PENDING'})
  await run(f,phase,{recover:true});assert.equal((await inspect(f)).recognized,true)
  if(phase!=='rollback')await run(f,'rollback');assert.deepEqual(await readFile(f.a),f.before);await assert.rejects(readFile(f.b),{code:'ENOENT'})
 }
})
test('configuration commit: a concurrent edit before retirement is preserved at its original name',async()=>{
 for(const boundary of ['intent','before-retire']){
  const f=await fixture();await assert.rejects(run(f,'maintenance',{onStep:async(step,index)=>{if(step===boundary&&index===0)await writeFile(f.a,'PRIVATE-USER-EDIT')}}),{code:'MIGRATION_COMMIT_SOURCE_CHANGED'})
  assert.equal(await readFile(f.a,'utf8'),'PRIVATE-USER-EDIT');assert.equal((await inspect(f)).recognized,false);await assert.rejects(run(f,'rollback'),{code:'MIGRATION_COMMIT_SOURCE_CHANGED'})
 }
})
test('configuration commit: a concurrently created target is never overwritten by publication or recovery',async()=>{
 const f=await fixture();await assert.rejects(run(f,'maintenance',{onStep:async(step,index)=>{if(step==='retired'&&index===0)await writeFile(f.a,'PRIVATE-NEW-CONTENT',{flag:'wx'})}}),{code:'MIGRATION_COMMIT_SOURCE_CHANGED'});assert.equal(await readFile(f.a,'utf8'),'PRIVATE-NEW-CONTENT');await assert.rejects(run(f,'maintenance',{recover:true}),{code:'MIGRATION_COMMIT_SOURCE_CHANGED'});assert.equal(await readFile(f.a,'utf8'),'PRIVATE-NEW-CONTENT')
})
test('configuration commit: same-byte replacement and deleted completed file cannot impersonate a known state',async()=>{
 const f=await fixture();await run(f,'maintenance');const tmp=join(f.profile,'replacement');await writeFile(tmp,f.maintenance);await rename(tmp,f.a);assert.equal((await inspect(f)).recognized,false);await assert.rejects(run(f,'install'),{code:'MIGRATION_COMMIT_SOURCE_CHANGED'})
 const g=await fixture();await run(g,'maintenance');await unlink(g.b);assert.equal((await inspect(g)).recognized,false);await assert.rejects(run(g,'install'),{code:'MIGRATION_COMMIT_SOURCE_CHANGED'})
})
test('configuration commit: journal tampering, missing checkpointed tail and plan mutation refuse recovery',async()=>{
 for(const mutate of [async f=>{const n=(await readdir(f.privateOutput)).filter(n=>n.startsWith('event-')).sort().at(-1);await unlink(join(f.privateOutput,n))},async f=>{const n=(await readdir(f.privateOutput)).filter(n=>n.startsWith('event-')).sort()[0];const p=join(f.privateOutput,n),v=JSON.parse(await readFile(p,'utf8'));v.phase='forged';await writeFile(p,json(v))},async f=>{const p=join(f.privateOutput,'transaction.private.json'),v=JSON.parse(await readFile(p,'utf8'));v.changes[0].after=Buffer.from('forged').toString('base64');await writeFile(p,json(v))}]){
  const f=await fixture();await run(f,'maintenance');await mutate(f);await assert.rejects(inspect(f));assert.throws(()=>assertMigrationStartupAllowed({home:f.home}),{code:'PROFILE_MIGRATION_PENDING'})
 }
})
test('configuration commit: a live process lock is never broken and pending maintenance refuses a second plan',async()=>{
 const f=await fixture(),path=join(f.home,'migration-gate.lock'),gate=readMigrationStartupGate({home:f.home});await writeFile(path,json({id:gate.operationId,token:'other',pid:process.pid,host:(await import('node:os')).hostname()}));await assert.rejects(run(f,'maintenance',{recover:true}),{code:'MIGRATION_COMMIT_BUSY'});await unlink(path)
 const g={...f,privateOutput:join(f.root,'another')};await assert.rejects(prepare(g),{code:'MIGRATION_COMMIT_PENDING'});assert.deepEqual(await readFile(f.a),f.before)
})
test('configuration commit: overlap, duplicate targets and initial hardlinks are rejected before a gate exists',async()=>{
 const f=await fixture({prepareNow:false});await assert.rejects(prepare({...f,privateOutput:join(f.home,'private')}),{code:'MIGRATION_COMMIT_OUTPUT_OVERLAP'});await assert.rejects(prepare({...f,changes:[f.changes[0],f.changes[0]]}),{code:'MIGRATION_COMMIT_INPUT_INVALID'});await link(f.a,join(f.profile,'alias'));await assert.rejects(prepare(f),{code:'MIGRATION_COMMIT_FILE_INVALID'});assert.equal(readMigrationStartupGate({home:f.home}),null)
})
test('configuration commit: linked source/redirected directory paths and future/corrupt gates stay closed',async t=>{
 const f=await fixture({prepareNow:false}),alias=join(f.root,'alias');try{await symlink(f.profile,alias,process.platform==='win32'?'junction':'dir')}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('OS symlink privilege unavailable');return}throw e}
 await assert.rejects(prepare({...f,changes:[{...f.changes[0],path:join(alias,'package.json')}]}),{code:'MIGRATION_COMMIT_PATH_INVALID'})
 const path=join(f.home,'migration-gate.json');for(const bytes of ['{',json({schemaVersion:2}),json({schemaVersion:1,phase:'committed'})]){await writeFile(path,bytes);assert.throws(()=>assertMigrationStartupAllowed({home:f.home}))}
})
test('configuration commit: activation and post-activation data rollback cannot be asserted by an owner boolean',async()=>{
 const f=await fixture();await assert.rejects(resume({privateOutput:f.privateOutput,phase:'commit',validated:true}),{code:'MIGRATION_COMMIT_PHASE_INVALID'});await run(f,'maintenance');await run(f,'install');const path=join(f.home,'migration-gate.json'),gate=readMigrationStartupGate({home:f.home});await writeFile(path,json({...gate,phase:'committed'}));await assert.rejects(run(f,'rollback'),{code:'MIGRATION_POST_ACTIVATION_ROLLBACK_REQUIRED'});assert.equal((await inspect(f)).activationSupported,false)
})

test('configuration commit: runtime gate refuses every nonterminal phase before funds/Task/Bot initialization',async()=>{
 const f=await fixture(),path=join(f.home,'migration-gate.json'),gate=readMigrationStartupGate({home:f.home}),previous=process.env.DSH_HOME
 const {apply}=await import('../.dsh-plugin/index.mjs');process.env.DSH_HOME=f.home
 try{
  for(const phase of ['prepared','maintenance','installing','validating','rolling-back']){
   await writeFile(path,json({...gate,phase}));assert.throws(()=>apply({provide(){},effect(){},get(){return {}}}),{code:'PROFILE_MIGRATION_PENDING'});await assert.rejects(lstat(join(f.home,'model-router')),{code:'ENOENT'})
  }
 }finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous}
 const alias=join(f.root,'home-alias');await symlink(f.home,alias,process.platform==='win32'?'junction':'dir');assert.equal(readMigrationStartupGate({home:alias}).home,f.home);assert.throws(()=>assertMigrationStartupAllowed({home:alias}),{code:'PROFILE_MIGRATION_PENDING'})
})
