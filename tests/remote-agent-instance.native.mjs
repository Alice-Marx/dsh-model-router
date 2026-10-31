import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,rename,link} from 'node:fs/promises'
import {resolve,join,relative,isAbsolute,basename} from 'node:path'
import {spawn} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const {Store}=await import('../remote-computer-agent/dist/index.mjs')
const parent=resolve('tmp/integration/agent-instance');await mkdir(parent,{recursive:true})
async function wait(check){const deadline=Date.now()+12000;while(Date.now()<deadline){const value=await check();if(value)return value;await sleep(20)}throw Error('Owned instance fixture did not settle')}
const exists=p=>readFile(p).then(()=>true,()=>false)
test('Agent instance: two stale-PID readers cannot unlink a live new owner and both start',async t=>{
 const dir=await mkdtemp(join(parent,'case-'));await writeFile(join(dir,'agent.lock'),JSON.stringify({pid:2147480000,instanceId:'dead-fixture'}))
 const children=[];const start=name=>{const child=spawn(process.execPath,[resolve('tests/fixtures/remote-agent-instance.mjs'),dir,name],{stdio:'ignore',windowsHide:true});children.push(child);return child}
 t.after(async()=>{for(const name of ['a','b'])await writeFile(join(dir,'release-'+name),'release');for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(done=>child.once('close',done))))})
 start('a');await wait(()=>exists(join(dir,'read-a')));start('b');await wait(async()=>await exists(join(dir,'read-b'))||await exists(join(dir,'result-b.json')))
 await writeFile(join(dir,'release-a'),'release');const a=await wait(()=>readFile(join(dir,'result-a.json'),'utf8').then(JSON.parse).catch(()=>false));assert.equal(a.acquired,true)
 await writeFile(join(dir,'release-b'),'release');const b=await wait(()=>readFile(join(dir,'result-b.json'),'utf8').then(JSON.parse).catch(()=>false));assert.equal(b.acquired,false);assert.equal(b.code,'AGENT_LOCKED')
})
test('Agent instance: a rejected second controller cannot clear the live owner tickets or operation state',async t=>{
 const dir=await mkdtemp(join(parent,'case-')),store=new Store(dir,Database);t.after(()=>store.close());const pair=store.pair('host',{botIds:['bot-a'],roots:['project'],tools:['machine_ping']}),ticket=store.issue(store.client(pair.token),{botId:'bot-a',taskId:'task',attemptId:'attempt',roots:['project'],tools:['machine_ping']});store.admit('operation',store.grant(ticket.grantToken),'fixture',{});store.running('operation');assert.throws(()=>new Store(dir,Database),/AGENT_LOCKED/);assert.equal(store.grant(ticket.grantToken).botId,'bot-a');assert.equal(store.status('operation',store.grant(ticket.grantToken)).status,'running')
})
test('Agent instance: explicit admin management can coexist without stealing the lifetime semaphore',async t=>{
 const dir=await mkdtemp(join(parent,'case-')),store=new Store(dir,Database);t.after(()=>store.close());const pair=store.pair('host',{botIds:['bot-a'],roots:['project'],tools:['machine_ping']}),admin=new Store(dir,Database,{admin:true});assert.equal(admin.machineId,store.machineId);assert.equal(admin.client(pair.token).id,'host');admin.close();assert.throws(()=>new Store(dir,Database),/AGENT_LOCKED/);store.close();const next=new Store(dir,Database);assert.equal(next.machineId,store.machineId);next.close()
})
test('Agent instance: a real SIGKILL releases the kernel semaphore and the dead PID file is safely reclaimed',async t=>{
 const dir=await mkdtemp(join(parent,'case-')),child=spawn(process.execPath,[resolve('tests/fixtures/remote-agent-instance.mjs'),dir,'owner'],{stdio:'ignore',windowsHide:true});let closed=false;const exit=new Promise(done=>child.once('close',()=>{closed=true;done()}));t.after(async()=>{if(!closed)child.kill('SIGKILL');await exit});const result=await wait(()=>readFile(join(dir,'result-owner.json'),'utf8').then(JSON.parse).catch(()=>false));assert.equal(result.acquired,true);assert.throws(()=>new Store(dir,Database),/AGENT_LOCKED/);child.kill('SIGKILL');await exit;const restored=new Store(dir,Database);restored.close()
})
test('Agent instance: closing an owner preserves a replacement PID file with a different identity',async()=>{
 const dir=await mkdtemp(join(parent,'case-')),store=new Store(dir,Database),source=join(dir,'agent.lock'),retired=join(dir,'owned-retired.lock');for(const path of [source,retired]){const rest=relative(parent,resolve(path));assert.ok(rest&&!rest.startsWith('..')&&!isAbsolute(rest))};await rename(source,retired);const foreign=JSON.stringify({pid:process.pid,instanceId:'foreign-fixture'});await writeFile(source,foreign);store.close();assert.equal(await readFile(source,'utf8'),foreign);assert.equal((await readFile(retired,'utf8')).includes('instanceId'),true)
})
test('Agent instance: linked guard files refuse rather than locking a different control object',async()=>{
 const dir=await mkdtemp(join(parent,'case-')),guard=join(dir,'agent-instance.sqlite');await writeFile(guard,Buffer.alloc(0));await link(guard,join(dir,'foreign-linked.sqlite'));assert.throws(()=>new Store(dir,Database),/AGENT_LOCKED/)
})
test('Agent instance: bootstrap errors release both lifetime locks so a fresh controller may start',async()=>{
 const dir=await mkdtemp(join(parent,'case-'));class FailedMainDatabase extends Database{constructor(path,...args){if(basename(path)==='agent.sqlite')throw Error('FIXTURE_MAIN_OPEN_FAILED');super(path,...args)}}assert.throws(()=>new Store(dir,FailedMainDatabase),/FIXTURE_MAIN_OPEN_FAILED/);const store=new Store(dir,Database);store.close()
})
test('Agent instance: an altered stale PID cannot bypass the still-held SQLite semaphore',async t=>{
 const dir=await mkdtemp(join(parent,'case-')),store=new Store(dir,Database);t.after(()=>store.close());const text=JSON.stringify({pid:2147480000,instanceId:'stale-fixture'});await writeFile(join(dir,'agent.lock'),text);assert.throws(()=>new Store(dir,Database),/AGENT_LOCKED/);assert.equal(await readFile(join(dir,'agent.lock'),'utf8'),text)
})
test('Agent instance: simultaneous cold starters leave exactly one native controller',async t=>{
 const dir=await mkdtemp(join(parent,'case-')),children=[];for(let i=0;i<6;i++){await writeFile(join(dir,'release-'+i),'release');children.push(spawn(process.execPath,[resolve('tests/fixtures/remote-agent-instance.mjs'),dir,String(i)],{stdio:'ignore',windowsHide:true}))}
 t.after(async()=>{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(done=>child.once('close',done))))})
 const results=await Promise.all(children.map((_,i)=>wait(()=>readFile(join(dir,'result-'+i+'.json'),'utf8').then(JSON.parse).catch(()=>false))));assert.equal(results.filter(x=>x.acquired).length,1);assert.ok(results.filter(x=>!x.acquired).every(x=>x.code==='AGENT_LOCKED'))
})
