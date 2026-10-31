import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import Database from 'better-sqlite3'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'
import {openRemoteMachines} from '../packages/orchestration/src/remote-machines.mjs'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {createRemoteWriteBackend} from '../packages/orchestration/src/remote-execution.mjs'
import {parseRemoteTaskWrite,parseTaskPlan,taskHash} from '../packages/orchestration/src/task-contract.mjs'
await import('../remote-computer-agent/build.mjs')
const {Agent,serve,TOOL_NAMES}=await import('../remote-computer-agent/dist/index.mjs')
const owner={kind:'owner'},all=['task/submit','task/execute','task/read','task/cancel','task/retry','task/reconcile',...TOOL_NAMES.map(t=>'remote/'+t)],root=resolve('tmp/integration/remote-write-tasks');await mkdir(root,{recursive:true})
async function wait(check){const end=Date.now()+7000;while(Date.now()<end){const value=await check();if(value)return value;await sleep(10)}throw Error('Remote task fixture did not settle')}
async function fixture(t){
 const dir=await mkdtemp(join(root,'case-')),project=join(dir,'project');await mkdir(project);await writeFile(join(project,'probe.txt'),'original fixture')
 const agent=new Agent({dataDir:join(dir,'agent'),roots:{'project.v1':project}},Database),pair=agent.store.pair('host',{botIds:['bot-a','bot-b'],roots:['project.v1'],tools:TOOL_NAMES}),server=await serve(agent,{port:0})
 const f={dir,project,agent,pair,server,dropNext:false,corruptNext:false,secret:pair.token,calls:[],pause:null}
 const fetchImpl=async(url,options)=>{
  const request=JSON.parse(options.body),tool=request.params?.name;if(tool)f.calls.push(tool)
  if(tool==='fs_write'&&f.dropBeforeTransport){f.dropBeforeTransport=false;throw Error('FIXTURE_CONNECTION_LOST_BEFORE_ACK')}
  const response=await fetch(url,options)
  if(tool==='fs_write'&&f.pause){const pause=f.pause;f.pause=null;pause.entered();await pause.wait}
  if(tool==='fs_write'&&f.dropNext){f.dropNext=false;await response.arrayBuffer();throw Error('FIXTURE_LOST_RESPONSE')}
  if(tool==='fs_write'&&f.corruptNext){f.corruptNext=false;const body=await response.json();body.result.structuredContent.result.sha256='0'.repeat(64);return new Response(JSON.stringify(body),{status:response.status,headers:{'content-type':'application/json'}})}
  return response
 }
 function open(){
  f.authority=createAuthority();f.directory=createPrincipalDirectory(f.authority);for(const id of ['bot-a','bot-b'])f.directory.register(id,{tools:all,modelRoutes:[]})
  f.machines=openRemoteMachines({Database,file:join(dir,'machines.sqlite'),resolveSecret:async()=>f.secret,botExists:id=>['bot-a','bot-b'].includes(id),authority:f.authority,fetchImpl})
  const remote=createRemoteWriteBackend({machines:()=>f.machines,directory:f.directory,pollMs:5})
  const read={id:'fixture-read',version:'v1',effect:'read',machineId:pair.machineId,workspaceId:'remote_'+taskHash({rootId:'project.v1'}),location:'remote',capability:'remote/fs_read',retryCapability:'remote/fs_read',parse:input=>input,async run(c){const value=await f.machines.call(f.directory.forBot(c.ownerBotId),{machineId:pair.machineId,rootId:'project.v1',taskId:c.binding.taskId,attemptId:c.binding.attemptId,tool:'fs_read',args:{rootId:'project.v1',relativePath:'probe.txt',length:100}});return {outcome:'succeeded',summary:{bytes:Buffer.from(value.content,'base64').length}}}}
  f.journal=openTaskJournal(Database,join(dir,'tasks.sqlite'));f.service=createTaskService({journal:f.journal,authority:f.authority,directory:f.directory,backends:[remote,read],concurrencyFor:()=>2,planTargetsFor:()=>['bot-a','bot-b']});f.service.start();f.subject=f.directory.forBot('bot-a');f.b=f.directory.forBot('bot-b')
 }
 open()
 await f.machines.pair({machineId:pair.machineId,name:'Scoped fixture',endpoint:`http://127.0.0.1:${server.address.port}`,secretRef:'ds-secret/FIXTURE_AGENT',roots:['project.v1'],tools:['machine_ping','fs_read','fs_write','operation_status','operation_cancel'],probeBotId:'bot-a',expectedRevision:0},owner)
 for(const botId of ['bot-a','bot-b'])await f.machines.bind({machineId:pair.machineId,botId,expectedRevision:0,roots:['project.v1'],tools:['fs_write','fs_read','operation_status','operation_cancel'],mode:'workspace-write'},owner)
 f.input=(extra={})=>({machineId:pair.machineId,rootId:'project.v1',relativePath:'new.txt',content:'scoped fixture content',expectedHash:null,...extra})
 f.submit=(key='write',extra={},subject=f.subject)=>f.service.submit(subject,{requestKey:key,backend:'remote-write',input:f.input(extra)})
 f.get=task=>f.journal.get(task.ownerBotId,task.taskId)
 f.settled=task=>wait(()=>{const row=f.get(task);return ['succeeded','failed','cancelled','needs-reconciliation','blocked'].includes(row.state)&&row})
 f.restart=async()=>{await f.service.close();f.machines.close();f.authority.dispose();open()}
 t.after(async()=>{await f.service.close();f.machines.close();f.authority.dispose();await server.close();await agent.close()})
 return f
}
test('remote write: real scoped Agent operation is journaled before dispatch and never masquerades as a money run',async t=>{
 const f=await fixture(t),task=f.submit(),done=await f.settled(task);assert.equal(done.state,'succeeded');assert.equal(await readFile(join(f.project,'new.txt'),'utf8'),f.input().content);assert.equal(done.executionRef.kind,'remote-operation');assert.equal(done.executionRef.operationId,done.operationId);assert.deepEqual(done.legacyRunIds,[]);assert.equal(done.input.target.machineId,f.pair.machineId);assert.equal(done.input.target.workspaceId,'remote_'+taskHash({rootId:'project.v1'}));assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n,1)
})
test('remote write: duplicate command replays original Task/operation; altered content conflicts without another write',async t=>{
 const f=await fixture(t),a=f.submit();await f.settled(a);const b=f.submit();assert.equal(b.taskId,a.taskId);assert.equal(b.operationId,a.operationId);assert.throws(()=>f.submit('write',{content:'different'}),/TASK_REQUEST_CONFLICT/);assert.equal(f.calls.filter(t=>t==='fs_write').length,1)
})
test('remote write: file CAS refusal preserves the file and gives a terminal operation receipt',async t=>{
 const f=await fixture(t),task=f.submit('cas',{relativePath:'probe.txt',expectedHash:'0'.repeat(64)}),done=await f.settled(task);assert.equal(done.state,'failed');assert.equal(await readFile(join(f.project,'probe.txt'),'utf8'),'original fixture');assert.equal(done.result.summary.code,'FILE_CHANGED');assert.equal(done.result.summary.stopConfirmed,true)
})
test('remote write: dropped success reply stays unknown, cold Host observes the original receipt without re-execution',async t=>{
 const f=await fixture(t);f.dropNext=true;const a=f.submit(),unknown=await f.settled(a);assert.equal(unknown.state,'needs-reconciliation');await f.restart();const restored=f.get(a);assert.equal(restored.operationId,a.operationId);const done=await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'observe'});assert.equal(done.state,'succeeded');assert.equal(f.calls.filter(t=>t==='fs_write').length,1);assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n,1);assert.equal((await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'observe'})).replayed,true)
})
test('remote write: a corrupt success receipt stays unknown until a valid durable status is observed',async t=>{
 const f=await fixture(t);f.corruptNext=true;const a=f.submit();assert.equal((await f.settled(a)).state,'needs-reconciliation');const done=await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'real-receipt'});assert.equal(done.state,'succeeded');assert.equal(f.calls.filter(t=>t==='fs_write').length,1)
})
test('remote write: unknown write holds its real workspace lock, another Bot read continues, then reconciliation releases write',async t=>{
 const f=await fixture(t);f.dropNext=true;const a=f.submit('first');await f.settled(a);const b=f.submit('second',{relativePath:'second.txt'},f.b),read=f.service.submit(f.b,{requestKey:'read',backend:'fixture-read',input:{task:'read'}});assert.equal((await f.settled(read)).state,'succeeded');await sleep(30);assert.equal(f.get(b).state,'ready');assert.equal(f.calls.filter(t=>t==='fs_write').length,1);await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'unlock'});assert.equal((await f.settled(b)).state,'succeeded');assert.equal(await readFile(join(f.project,'second.txt'),'utf8'),f.input().content)
})
test('remote write: current binding revision is part of admission, but a new read-status grant can reconcile old output',async t=>{
 const f=await fixture(t);f.dropNext=true;const a=f.submit();await f.settled(a);await f.machines.bind({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:1,roots:['project.v1'],tools:['operation_status'],mode:'read-only'},owner);assert.throws(()=>f.submit('new'),/MACHINE_BOT_DENIED/);const done=await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'read-only-observation'});assert.equal(done.state,'succeeded');assert.equal(f.calls.filter(t=>t==='fs_write').length,1)
})
test('remote write: confirmed pre-dispatch authentication failure is not unknown and an explicit retry gets a new attempt',async t=>{
 const f=await fixture(t);f.secret='x'.repeat(43);const a=f.submit(),failed=await f.settled(a);assert.equal(failed.state,'failed');assert.equal(failed.result.summary.notStarted,true);assert.equal(f.calls.filter(t=>t==='fs_write').length,0);f.secret=f.pair.token;const retry=f.service.retry(f.subject,{taskId:a.taskId,requestKey:'retry'});assert.notEqual(retry.operationId,a.operationId);assert.equal((await f.settled(retry)).state,'succeeded');assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n,1)
})
test('remote write: caller identity and operation references cannot inspect another Bot task or accept forged context',async t=>{
 const f=await fixture(t);f.dropNext=true;const a=f.submit();await f.settled(a);await assert.rejects(f.service.reconcile(f.b,{taskId:a.taskId,requestKey:'stolen'}),/TASK_NOT_FOUND/);await assert.rejects(f.machines.call(f.subject,{machineId:f.pair.machineId,rootId:'project.v1',taskId:a.taskId,attemptId:a.attemptId,tool:'operation_status',operationId:a.operationId,args:{operationId:'other'}}),/MACHINE_CONTEXT_FORGED/)
})
test('remote write: explicit execution compiles a real write plan and dependency failure blocks downstream only',async t=>{
 const f=await fixture(t),pkg=(id,extra={})=>({id,targetBotId:'bot-a',objective:'write fixture',dependsOn:[],acceptance:['file verified'],effectClass:'workspace-write',execution:{backend:'remote-write',input:f.input()},...extra})
 const p=f.service.submitPlan(f.subject,{requestKey:'plan',plan:{schemaVersion:1,taskId:'plan-file',origin:{kind:'private',botId:'bot-a',sessionId:null},planRevision:1,packages:[pkg('bad',{execution:{backend:'remote-write',input:f.input({relativePath:'probe.txt',expectedHash:'0'.repeat(64)})}}),pkg('down',{dependsOn:['bad']}),pkg('read',{targetBotId:'bot-b',effectClass:'read',execution:undefined,objective:'read fixture'})].map(v=>Object.fromEntries(Object.entries(v).filter(([,value])=>value!==undefined)))}})
 const end=await wait(()=>{const r=f.service.getPlan(f.subject,{planId:p.planId});return r.state==='failed'&&r});assert.equal(end.packages.find(p=>p.id==='down').state,'blocked');assert.equal(end.packages.find(p=>p.id==='read').state,'succeeded');assert.equal(f.calls.filter(t=>t==='fs_write').length,1)
})
test('remote write: path/endpoint/credential/program metadata and incomplete write permissions are rejected before dispatch',async t=>{
 const f=await fixture(t);for(const extra of [{endpoint:'https://example.invalid'},{argv:['node']},{botId:'bot-b'},{relativePath:'../outside'},{relativePath:'C:/private'},{relativePath:'file:stream'},{expectedHash:undefined},{content:'x'.repeat(8193)}])assert.throws(()=>parseRemoteTaskWrite({...f.input(),...extra}))
 await f.machines.bind({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:1,roots:['project.v1'],tools:['fs_write','operation_status'],mode:'workspace-write'},owner);assert.throws(()=>f.submit('incomplete'),/MACHINE_BOT_DENIED/);assert.equal(f.calls.filter(t=>t==='fs_write').length,0)
 const plan={schemaVersion:1,taskId:'invalid',origin:{kind:'private',botId:'bot-a',sessionId:null},planRevision:1,packages:[{id:'a',targetBotId:'bot-a',objective:'fixture',dependsOn:[],acceptance:[],effectClass:'workspace-write',execution:{backend:'remote-write',input:{...f.input(),secretRef:'ds-secret/NO'}}}]};assert.throws(()=>parseTaskPlan(plan))
})

test('remote write: genuinely absent remote receipt stays unknown and is never replayed during observation',async t=>{
 const f=await fixture(t);f.dropBeforeTransport=true;const a=f.submit();assert.equal((await f.settled(a)).state,'needs-reconciliation');const observed=await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'absent'});assert.equal(observed.state,'needs-reconciliation');assert.equal(f.calls.filter(t=>t==='fs_write').length,1);assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n,0);await assert.rejects(readFile(join(f.project,'new.txt')),{code:'ENOENT'});assert.throws(()=>f.service.retry(f.subject,{taskId:a.taskId,requestKey:'unsafe-retry'}),/TASK_RECONCILIATION_REQUIRED/)
})

test('remote write: cancellation skips unstarted descendants, confirms terminal receipt and reports an already applied write',async t=>{
 const f=await fixture(t);let release,entered;const ready=new Promise(r=>entered=r);f.pause={entered,wait:new Promise(r=>release=r)}
 const pkg=(id,dependsOn=[])=>({id,targetBotId:'bot-a',objective:'fixture write',dependsOn,acceptance:['verified'],effectClass:'workspace-write',execution:{backend:'remote-write',input:f.input({relativePath:id+'.txt'})}})
 const p=f.service.submitPlan(f.subject,{requestKey:'cancel-plan',plan:{schemaVersion:1,taskId:'cancel-plan',origin:{kind:'private',botId:'bot-a',sessionId:null},planRevision:1,packages:[pkg('first'),pkg('down',['first'])]}})
 await ready;f.service.cancelPlan(f.subject,{planId:p.planId});release();const end=await wait(()=>{const r=f.service.getPlan(f.subject,{planId:p.planId});return r.state==='cancelled'&&r});assert.equal(end.packages.find(p=>p.id==='down').state,'skipped');const first=f.journal.get('bot-a',end.packages.find(p=>p.id==='first').taskId);assert.equal(first.state,'cancelled');assert.equal(first.result.summary.stopConfirmed,true);assert.equal(first.result.summary.status,'succeeded');assert.equal(first.result.summary.possiblyApplied,true);assert.equal(await readFile(join(f.project,'first.txt'),'utf8'),f.input().content);await assert.rejects(readFile(join(f.project,'down.txt')),{code:'ENOENT'})
})

test('remote write: revocation while a response is in flight retains unknown until a new status-only grant observes it',async t=>{
 const f=await fixture(t);let release,entered;const ready=new Promise(r=>entered=r);f.pause={entered,wait:new Promise(r=>release=r)};const a=f.submit();await ready
 await f.machines.bind({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:1,roots:['project.v1'],tools:['operation_status'],mode:'read-only'},owner);release();assert.equal((await f.settled(a)).state,'needs-reconciliation');const result=await f.service.reconcile(f.subject,{taskId:a.taskId,requestKey:'after-revocation'});assert.equal(result.state,'succeeded');assert.equal(f.calls.filter(t=>t==='fs_write').length,1)
})
