import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,rename,symlink,lstat,readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const {Agent}=await import('../remote-computer-agent/dist/index.mjs')

const linux=process.platform==='linux',only={skip:!linux}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const parent=resolve('tmp/integration/workspace-agent-pinned');await mkdir(parent,{recursive:true})
const tools=['fs_list','fs_read','fs_write','operation_status','operation_cancel']

/**
 * Real Linux filesystem + real sqlite. The Agent publish path is the
 * descriptor-pinned component; every case drives the public fs_write contract.
 */
async function fixture(t){
 const dir=await mkdtemp(join(parent,'case-')),root=join(dir,'root'),other=join(dir,'other')
 await mkdir(join(root,'nested'),{recursive:true});await mkdir(other);await writeFile(join(root,'nested','read.txt'),'pinned probe')
 const config={dataDir:join(dir,'agent'),roots:{root,other}},rootIds=['root','other']
 const agent=new Agent(config,Database),pair=agent.store.pair('host',{botIds:['bot-a'],roots:rootIds,tools})
 const context=agent.store.grant(agent.store.issue(agent.store.client(pair.token),{botId:'bot-a',taskId:'task-a',attemptId:'attempt-a',roots:rootIds,tools}).grantToken)
 const write=(id,relativePath,extra={},c=context)=>agent.call('fs_write',{rootId:'root',relativePath,content:'pinned payload',expectedHash:null,...extra},c,id)
 const parkedAt=(phase,relativePath)=>{const entered=deferred(),gate=deferred(),original=agent.pinnedWritePolicy.bind(agent)
  agent.pinnedWritePolicy=async(a,c,pin,report)=>{if(a.relativePath===relativePath&&report.phase===phase){entered.resolve();await gate.promise}return original(a,c,pin,report)}
  return {entered:entered.promise,release:gate.resolve}}
 return {dir,root,nested:join(root,'nested'),other,config,agent,context,write,parkedAt,temps:async d=>(await readdir(d)).filter(n=>n.startsWith('.dsh-'))}
}

test('pinned Agent write: a brand-new file lands with exact bytes, 0600 mode and one link',only,async t=>{
 const f=await fixture(t);t.after(()=>f.agent.close())
 const done=await f.write('op-create','created.txt')
 assert.equal(done.status,'succeeded');assert.equal(done.result.sha256.length,64);assert.equal(done.result.size,'pinned payload'.length)
 const onDisk=await lstat(join(f.root,'created.txt'))
 assert.equal(onDisk.isFile(),true);assert.equal(onDisk.mode&0o777,0o600);assert.equal(onDisk.nlink,1)
 assert.equal(await readFile(join(f.root,'created.txt'),'utf8'),'pinned payload')
 assert.deepEqual(await f.temps(f.root),[],'no private temp names remain')
 assert.equal(f.agent.workspaces.list().length,0)
})

test('pinned Agent write: existing targets keep the public contract and hash overwrite stays disabled',only,async t=>{
 const f=await fixture(t);t.after(()=>f.agent.close())
 const existing=join(f.root,'taken.txt');await writeFile(existing,'original owner')
 const {createHash}=await import('node:crypto')
 const refusal=await f.write('op-exists','taken.txt')
 assert.equal(refusal.status,'failed');assert.equal(refusal.error.code,'FILE_CHANGED')
 assert.equal(await readFile(existing,'utf8'),'original owner')
 const overwrite=await f.write('op-overwrite','taken.txt',{expectedHash:createHash('sha256').update('original owner').digest('hex')})
 assert.equal(overwrite.status,'failed');assert.equal(overwrite.error.code,'OVERWRITE_UNSUPPORTED')
 assert.equal(await readFile(existing,'utf8'),'original owner')
 const missing=await f.write('op-missing','absent.txt',{expectedHash:createHash('sha256').update('x').digest('hex')})
 assert.equal(missing.status,'failed');assert.equal(missing.error.code,'FILE_CHANGED')
 assert.equal((await readdir(f.root)).includes('absent.txt'),false)
 assert.equal(f.agent.workspaces.list().length,0)
})

test('pinned Agent write: a parent replaced while parked publishes nowhere',only,async t=>{
 const f=await fixture(t),parked=f.parkedAt('before-publish','nested/planted.txt');t.after(()=>f.agent.close())
 const job=f.write('op-replace','nested/planted.txt');await parked.entered
 const protectedDir=join(f.dir,'protected');await mkdir(protectedDir)
 await rename(f.root,join(f.dir,'moved-root'));await mkdir(f.root);await symlink(protectedDir,join(f.root,'nested'),'dir')
 parked.release()
 const done=await job
 // The admission pin's identity recheck sees the replaced root first and
 // answers WORKSPACE_CHANGED; nothing was published either way.
 assert.equal(done.status,'failed');assert.equal(done.error.code,'WORKSPACE_CHANGED')
 assert.deepEqual(await readdir(join(f.dir,'moved-root','nested')),['read.txt'],'the original directory keeps nothing of ours')
 assert.deepEqual(await readdir(protectedDir),[],'nothing may land through the replacement')
 assert.equal(f.agent.workspaces.list().length,0,'a detected pre-publication failure releases the root')
})

test('pinned Agent write: an external creator that claims the target first wins',only,async t=>{
 const f=await fixture(t),parked=f.parkedAt('before-publish','contested.txt');t.after(()=>f.agent.close())
 const job=f.write('op-writer','contested.txt');await parked.entered
 await writeFile(join(f.root,'contested.txt'),'external writer')
 parked.release()
 const done=await job
 assert.equal(done.status,'failed');assert.equal(done.error.code,'FILE_CHANGED')
 assert.equal(await readFile(join(f.root,'contested.txt'),'utf8'),'external writer')
 assert.deepEqual(await f.temps(f.root),[],'the losing write cleans its private name')
})

test('pinned Agent write: an after-publish policy refusal is unknown, keeps the lock and never lies',only,async t=>{
 const f=await fixture(t);t.after(()=>f.agent.close())
 const original=f.agent.pinnedWritePolicy.bind(f.agent)
 f.agent.pinnedWritePolicy=async(a,c,pin,report)=>{if(a.relativePath==='landed.txt'&&report.phase==='after-publish')throw Object.assign(new Error('WORKSPACE_PRIVATE_PATH'),{code:'WORKSPACE_PRIVATE_PATH'});return original(a,c,pin,report)}
 const done=await f.write('op-unverified','landed.txt')
 assert.equal(done.status,'unknown');assert.equal(done.error.code,'OUTCOME_UNKNOWN')
 assert.equal(await readFile(join(f.root,'landed.txt'),'utf8'),'pinned payload','the file did land; unknown must not read as clean success')
 assert.equal(done.result,null,'no result payload is projected for an unknown outcome')
 assert.equal(f.agent.workspaces.list().length,1,'the root stays locked until reconciliation')
 assert.equal(done.stopProof,undefined,'no stop proof is minted for an unknown write')
 // Reconciliation: settling the unknown operation with a receipt releases the root.
 const admin=new Database(join(f.config.dataDir,'agent.sqlite'));try{admin.prepare("UPDATE operations SET status='failed',error='ADMIN_RECOVERED',finished=? WHERE id='op-unverified'").run(Date.now())}finally{admin.close()}
 const next=await f.write('op-next','next.txt')
 assert.equal(next.status,'succeeded')
})

test('pinned Agent write: cancellation after publication keeps content and a shape-checked digest',only,async t=>{
 const f=await fixture(t),entered=deferred(),gate=deferred(),original=f.agent.write.bind(f.agent);t.after(()=>f.agent.close())
 f.agent.write=async(a,c,signal,pin)=>{const result=await original(a,c,signal,pin);if(a.relativePath==='hold-published'){entered.resolve();await gate.promise}return result}
 const job=f.write('op-cancel-published','hold-published');await entered.promise
 const requested=await f.agent.call('operation_cancel',{operationId:'op-cancel-published'},f.context)
 assert.equal(requested.cancelRequested,true);assert.equal(requested.stopConfirmed,false)
 gate.resolve()
 const done=await job
 assert.equal(done.status,'cancelled');assert.equal(done.result.stopConfirmed,true);assert.equal(done.result.possiblyApplied,true)
 assert.equal(done.result.size,'pinned payload'.length);assert.match(done.result.sha256,/^[a-f0-9]{64}$/)
 assert.equal(await readFile(join(f.root,'hold-published'),'utf8'),'pinned payload')
 assert.equal(f.agent.workspaces.list().length,0)
 const observed=await f.agent.call('operation_status',{operationId:'op-cancel-published'},f.context)
 assert.equal(observed.stopProof.status,'cancelled')
})
