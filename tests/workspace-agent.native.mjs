import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,symlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const {Agent,WorkspacePin,canonical,sha}=await import('../remote-computer-agent/dist/index.mjs')
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
async function fixture(t){
 const base=resolve('tmp/integration/workspace-agent');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'case-')),parent=join(dir,'parent'),child=join(parent,'child'),other=join(dir,'other'),alias=join(dir,'alias');await mkdir(child,{recursive:true});await mkdir(other);await symlink(parent,alias,process.platform==='win32'?'junction':'dir');await writeFile(join(parent,'read.txt'),'read while locked')
 const config={dataDir:join(dir,'agent'),roots:{parent,child,other,alias}},tools=['fs_list','fs_read','fs_write','operation_status','operation_cancel'],roots=Object.keys(config.roots),f={dir,parent,other,config,pending:[]}
 f.agent=new Agent(config,Database);f.pair=f.agent.store.pair('host',{botIds:['bot-a','bot-b'],roots,tools})
 f.grant=botId=>f.agent.store.grant(f.agent.store.issue(f.agent.store.client(f.pair.token),{botId,taskId:'task-'+botId,attemptId:'attempt',roots,tools}).grantToken)
 f.context=f.grant('bot-a');f.write=(id,rootId='parent',relativePath=id,c=f.context)=>{const job=f.agent.call('fs_write',{rootId,relativePath,content:'scoped write',expectedHash:null},c,id);f.pending.push(job.catch(()=>{}));return job}
 f.hold=()=>{const entered=deferred(),gate=deferred(),original=f.agent.write.bind(f.agent);f.agent.write=async(a,c,signal)=>{if(a.relativePath==='hold'){entered.resolve();await gate.promise}return original(a,c,signal)};f.release=gate.resolve;return {entered:entered.promise,release:gate.resolve}}
 t.after(async()=>{f.release?.();await Promise.all(f.pending);if(!f.closed)await f.agent.close()})
 return f
}
test('workspace Agent: alias/parent writes exclude other bots while independent roots and plain reads proceed',async t=>{
 const f=await fixture(t),hold=f.hold(),first=f.write('op-holder','parent','hold');await hold.entered
 for(const rootId of ['alias','child']){const denied=await f.write('op-denied-'+rootId,rootId,'blocked',f.grant('bot-b'));assert.equal(denied.status,'failed');assert.equal(denied.error.code,'WORKSPACE_BUSY')}
 const separate=await f.write('op-independent','other');assert.equal(separate.status,'succeeded')
 const read=await f.agent.call('fs_read',{rootId:'alias',relativePath:'read.txt'},f.context);assert.equal(Buffer.from(read.content,'base64').toString(),'read while locked')
 hold.release();assert.equal((await first).status,'succeeded');assert.equal((await f.write('op-next','alias')).status,'succeeded');assert.equal(f.agent.workspaces.list().length,0)
})
function assertStopProof(done,status){
 const {stopProof,...operation}=done;assert.equal(stopProof.schemaVersion,1);assert.equal(stopProof.kind,'agent-stop-receipt');assert.equal(stopProof.source,'in-process-write');assert.equal(stopProof.status,status);assert.equal(stopProof.receiptHash,sha(canonical(operation)));return stopProof
}
test('workspace Agent: cancellation before publication waits for the write and releases with a truthful no-effects receipt',async t=>{
 const f=await fixture(t),hold=f.hold(),first=f.write('op-cancel','parent','hold');await hold.entered
 const requested=await f.agent.call('operation_cancel',{operationId:'op-cancel'},f.context);assert.equal(requested.cancelRequested,true);assert.equal(requested.stopConfirmed,false);assert.equal(f.agent.workspaces.list().length,1)
 hold.release();const done=await first;assert.equal(done.status,'cancelled');assert.equal(done.result.stopConfirmed,true);assert.equal(done.result.possiblyApplied,false);assert.equal(await readFile(join(f.parent,'hold'),'utf8').catch(()=>null),null);assert.equal(f.agent.workspaces.list().length,0)
 const proof=assertStopProof(done,'cancelled'),observed=await f.agent.call('operation_status',{operationId:'op-cancel'},f.context),settled=await f.agent.call('operation_cancel',{operationId:'op-cancel'},f.context);assert.deepEqual(observed.stopProof,proof);assert.equal(settled.stopConfirmed,true);assert.deepEqual(settled.stopProof,proof)
})
test('workspace Agent: cancellation at the final pre-publication check has no target effects and cleans up',async t=>{
 const f=await fixture(t),entered=deferred(),gate=deferred()
 // The final pre-publication gate lives in a different phase per publication
 // path: the legacy rename path re-reads the target through roots.read, the
 // Linux descriptor-pinned path calls the before-publish policy check. Both
 // barriers park at the same decision point without weakening the assertions.
 if(process.platform==='linux'){
  const original=f.agent.pinnedWritePolicy.bind(f.agent)
  f.agent.pinnedWritePolicy=async(a,c,pin,report)=>{if(a.relativePath==='hold-last'&&report.phase==='before-publish'){entered.resolve();await gate.promise}return original(a,c,pin,report)}
 }else{
  const original=f.agent.roots.read.bind(f.agent.roots);let reads=0
  f.agent.roots.read=async(rootId,relativePath,...args)=>{if(relativePath==='hold-last'&&++reads===2){entered.resolve();await gate.promise}return original(rootId,relativePath,...args)}
 }
 const first=f.write('op-cancel-last','parent','hold-last');await entered.promise
 const requested=await f.agent.call('operation_cancel',{operationId:'op-cancel-last'},f.context);assert.equal(requested.cancelRequested,true);assert.equal(requested.stopConfirmed,false);assert.equal(f.agent.workspaces.list().length,1)
 gate.resolve();const done=await first;assert.equal(done.status,'cancelled');assert.equal(done.result.possiblyApplied,false);assert.equal(await readFile(join(f.parent,'hold-last'),'utf8').catch(()=>null),null);assert.equal(f.agent.workspaces.list().length,0);assertStopProof(done,'cancelled')
})
test('workspace Agent: cancellation after publication preserves applied content, digest and conservative effects',async t=>{
 const f=await fixture(t),entered=deferred(),gate=deferred(),original=f.agent.write.bind(f.agent)
 f.agent.write=async(a,c,signal)=>{const result=await original(a,c,signal);if(a.relativePath==='hold-published'){entered.resolve();await gate.promise}return result}
 const first=f.write('op-cancel-published','parent','hold-published');await entered.promise
 const requested=await f.agent.call('operation_cancel',{operationId:'op-cancel-published'},f.context);assert.equal(requested.cancelRequested,true);assert.equal(requested.stopConfirmed,false);assert.equal(f.agent.workspaces.list().length,1)
 gate.resolve();const done=await first;assert.equal(done.status,'cancelled');assert.equal(done.result.stopConfirmed,true);assert.equal(done.result.possiblyApplied,true);assert.equal(done.result.size,12);assert.match(done.result.sha256,/^[a-f0-9]{64}$/);assert.equal(await readFile(join(f.parent,'hold-published'),'utf8'),'scoped write');assert.equal(f.agent.workspaces.list().length,0);assertStopProof(done,'cancelled')
})
test('workspace Agent: graceful close cancels and joins an outstanding synchronous file job before closing its journal',async t=>{
 const f=await fixture(t),hold=f.hold(),first=f.write('op-close','parent','hold');await hold.entered
 let ended=false;const close=f.agent.close().then(()=>{ended=true;f.closed=true});await new Promise(r=>setTimeout(r,20));assert.equal(ended,false);hold.release();assert.equal((await first).status,'cancelled');await close;assert.equal(ended,true);assert.equal(await readFile(join(f.parent,'hold'),'utf8').catch(()=>null),null)
})
test('workspace Agent: a stopped failed synchronous write frees its root for the next original operation',async t=>{
 const f=await fixture(t);const bad=await f.agent.call('fs_write',{rootId:'parent',relativePath:'bad',content:'bad'},f.context,'op-invalid');assert.equal(bad.error.code,'EXPECTED_HASH_REQUIRED');assert.equal(f.agent.workspaces.list().length,0);assert.equal((await f.write('op-valid')).status,'succeeded')
})
test('workspace Agent: a journaled unknown physical lock survives restart and ends only with the original terminal receipt',async t=>{
 const f=await fixture(t),pin=await WorkspacePin.capture(f.parent)
 try{f.agent.store.admit('op-interrupted',f.context,'fs_write',{});f.agent.workspaces.admit('op-interrupted',f.context,pin.identity);f.agent.store.running('op-interrupted')}finally{await pin.close()}
 await f.agent.close();f.agent=new Agent(f.config,Database);f.context=f.grant('bot-a')
 assert.equal(f.agent.store.status('op-interrupted',f.context).status,'unknown');assert.equal((await f.write('op-cold-blocked','alias')).error.code,'WORKSPACE_BUSY');assert.equal((await f.write('op-cold-independent','other')).status,'succeeded');assert.equal(f.agent.workspaces.list().length,1)
 f.agent.store.finish('op-interrupted','failed',null,'FIXTURE_ORIGINAL_STOPPED');assert.equal((await f.write('op-after-receipt')).status,'succeeded')
})
test('workspace Agent: an old unknown writer without a physical snapshot fences new writes and preserves plain reads',async t=>{
 const f=await fixture(t);f.agent.store.admit('op-legacy',f.context,'fs_write',{});f.agent.store.running('op-legacy');await f.agent.close();f.agent=new Agent(f.config,Database);f.context=f.grant('bot-a')
 const blocked=await f.write('op-new');assert.equal(blocked.error.code,'WORKSPACE_RECOVERY_REQUIRED');assert.equal(f.agent.workspaces.list().length,0);const read=await f.agent.call('fs_read',{rootId:'parent',relativePath:'read.txt'},f.context);assert.equal(Buffer.from(read.content,'base64').toString(),'read while locked');assert.equal(f.agent.store.status('op-legacy',f.context).status,'unknown')
})
