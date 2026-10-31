import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,chmod,link} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {renameSync,mkdirSync,writeFileSync} from 'node:fs'
import {rename,symlink} from 'node:fs/promises'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const {Agent,serve,RemoteAgentClient,CONTAINER_IMAGE,containerArguments}=await import('../remote-computer-agent/dist/index.mjs')
const enabled=process.platform==='linux'&&process.env.DSH_TEST_DOCKER==='1',real=(name,fn)=>test(name,{skip:!enabled},fn)
const config={dockerExecutable:'/usr/bin/docker',image:CONTAINER_IMAGE,executables:{node:'/usr/local/bin/node'}}
const workspaceIdentity=JSON.stringify({birth:'1',dev:'1',ino:'1'})
test('container command: Docker policy flags precede the immutable image and caller argv cannot become Docker options',()=>{
 const args=containerArguments({name:'dsh-worker-'+'a'.repeat(40),nonce:randomUUID(),machineId:'machine-fixture',workspace:'/fixture workspace',workspaceIdentity,config,executable:'/usr/local/bin/node',argv:['program.mjs','--privileged','a\nb','中文']});assert.ok(args.includes('--network=none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('--cap-drop=ALL'));assert.ok(args.includes('--security-opt=no-new-privileges'));assert.ok(args.includes('--pull=never'));assert.equal(args.indexOf('--privileged')>args.indexOf(CONTAINER_IMAGE),true);assert.ok(!args.includes('/var/run/docker.sock'))
})
test('container command: unowned names and ambiguous mount path grammar are refused',()=>{
 const base={name:'dsh-worker-'+'a'.repeat(40),nonce:randomUUID(),machineId:'machine-fixture',workspace:'/fixture',workspaceIdentity,config,executable:'/usr/local/bin/node',argv:[]};for(const patch of [{name:'foreign'},{nonce:'forged'},{workspace:'/with,comma'},{workspace:'/with\nnewline'},{argv:['nul\0']},{workspaceIdentity:undefined},{workspaceIdentity:'{}'},{workspaceIdentity:JSON.stringify({birth:'0',dev:'1',ino:'2'})}])assert.throws(()=>containerArguments({...base,...patch}))
})
test('container command: declaration without an implemented controller is refused and releases its Agent lock',async()=>{
 const root=resolve('tmp/integration/container-config');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'case-'));assert.throws(()=>new Agent({dataDir:join(dir,'agent'),roots:{project:dir},isolation:'container'},Database),/CONTAINER_CONFIG_INVALID/);const agent=new Agent({dataDir:join(dir,'agent'),roots:{project:dir}},Database);await agent.close()
})
test('container command: container configuration never silently falls back to native executable fields',async()=>{
 const root=resolve('tmp/integration/container-config');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'case-'));assert.throws(()=>new Agent({dataDir:join(dir,'agent'),roots:{project:dir},isolation:'container',container:config,executables:{node:process.execPath}},Database),/CONTAINER_CONFIG_INVALID/)
})
async function wait(check){const end=Date.now()+20000;while(Date.now()<end){const value=await check();if(value)return value;await sleep(40)}throw Error('Owned container fixture did not settle')}
async function fixture(t){
 const root=resolve('tmp/integration/remote-container');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'case-')),workspace=join(dir,'workspace');await mkdir(workspace);await chmod(workspace,0o777)
 const alias=join(dir,'alias'),child=join(workspace,'child'),other=join(dir,'other');await symlink(workspace,alias,'dir');await mkdir(child);await mkdir(other)
 const roots=['project','unsafe','alias','child','other'],tools=['machine_ping','shell_exec','operation_status','operation_cancel','artifact_read','fs_read','fs_write']
 const agentConfig={dataDir:join(dir,'agent'),roots:{project:workspace,unsafe:dir,alias,child,other},isolation:'container',container:{...config,executables:{...config.executables}}},f={dir,workspace,agentConfig}
 f.agent=new Agent(agentConfig,Database);f.pair=f.agent.store.pair('fixture-host',{botIds:['bot-a','bot-b'],roots,tools})
 f.open=async()=>{f.server=await serve(f.agent,{port:0});f.client=new RemoteAgentClient(`http://127.0.0.1:${f.server.address.port}`,f.pair.machineId,async()=>f.pair.token)};await f.open()
 f.grant=async(botId='bot-a',taskId='task-a')=>f.client.grant({botId,taskId,attemptId:'attempt-a',roots,tools})
 f.ticket=await f.grant();f.call=(tool,args={},id)=>f.client.call(f.ticket.grantToken,tool,args,id)
 f.program=async(text,name='program.mjs')=>{await writeFile(join(workspace,name),text,{mode:0o644});return name}
 f.start=async(argv=['node','program.mjs'],extra={})=>{const id='operation-'+randomUUID();await f.call('shell_exec',{workspaceRef:{kind:'remote',machineId:f.pair.machineId,rootId:'project',relativePath:''},argv,timeoutMs:15000,...extra},id);return id}
 f.done=id=>wait(async()=>{const r=await f.call('operation_status',{operationId:id});return ['succeeded','failed','cancelled','unknown'].includes(r.status)&&r})
 f.output=async r=>{const value=await f.call('artifact_read',{artifactId:r.result.stdoutArtifactId,offset:0,length:1024*1024});return Buffer.from(value.content,'base64').toString('utf8')}
 f.reopen=async()=>{await f.server.close();await f.agent.close();f.agent=new Agent(agentConfig,Database);await f.open();f.ticket=await f.grant()}
 t.after(async()=>{await f.server?.close();await f.agent?.close()})
 return f
}
real('container command: actual Agent transport enforces UID, private state, readonly root, clean environment and no network',async t=>{
 const f=await fixture(t);await writeFile(join(f.agentConfig.dataDir,'synthetic-secret'),'PRIVATE-AGENT-FIXTURE',{mode:0o600})
 await f.program(`import fs from 'node:fs/promises';import net from 'node:net';const result={uid:process.getuid()};for(const [key,path] of [['private',${JSON.stringify(join(f.agentConfig.dataDir,'synthetic-secret'))}],['otherBot','/other-bot-state']]){try{await fs.readFile(path);result[key]=false}catch(e){result[key]=['ENOENT','EACCES','EPERM'].includes(e.code)}}try{await fs.writeFile('/outside','bad');result.root=false}catch(e){result.root=['EROFS','EACCES','EPERM'].includes(e.code)}const status=await fs.readFile('/proc/self/status','utf8');result.cap=/CapEff:\\s+0+/.test(status);result.noNew=/NoNewPrivs:\\s+1/.test(status);result.env=!Object.keys(process.env).some(k=>/TOKEN|SECRET|KEY|PASSWORD/i.test(k));result.network=await new Promise(r=>{const s=net.connect({host:'192.0.2.1',port:443});s.once('error',()=>{s.destroy();r(true)});s.once('connect',()=>{s.destroy();r(false)});s.setTimeout(1500,()=>{s.destroy();r(false)})});await fs.writeFile('/workspace/result.txt','scoped output');console.log(JSON.stringify(result));`)
 const done=await f.done(await f.start());assert.equal(done.status,'succeeded');const out=JSON.parse(await f.output(done));assert.equal(out.uid,65532);for(const key of ['private','otherBot','root','cap','noNew','env','network'])assert.equal(out[key],true,key);assert.equal(await readFile(join(f.workspace,'result.txt'),'utf8'),'scoped output');assert.equal(done.result.stopConfirmed,true)
})
real('container command: changed selected directory is refused before Docker create',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs';fs.writeFileSync('/workspace/forbidden','ran')")
 const original=f.agent.container.probe.bind(f.agent.container);let swapped=false
 f.agent.container.probe=async()=>{const ready=await original();if(!swapped){swapped=true;await rename(f.workspace,join(f.dir,'original'));await mkdir(f.workspace);await chmod(f.workspace,0o777);await f.program("import fs from 'node:fs';fs.writeFileSync('/workspace/forbidden','replacement ran')")}return ready}
 const done=await f.done(await f.start());assert.equal(done.status,'failed');assert.equal(done.error.code,'WORKSPACE_CHANGED');assert.equal(done.result.notStarted,true);assert.equal(done.result.stopConfirmed,true);assert.equal(await readFile(join(f.workspace,'forbidden'),'utf8').catch(()=>null),null);assert.equal(await readFile(join(f.dir,'original','forbidden'),'utf8').catch(()=>null),null)
})
real('container command: supervisor refuses a directory replaced after the last Agent check and before runtime bind',async t=>{
 const f=await fixture(t),program="import fs from 'node:fs';fs.writeFileSync('/workspace/forbidden','ran')";await f.program(program)
 const prepare=f.agent.store.db.prepare.bind(f.agent.store.db);let swapped=false
 f.agent.store.db.prepare=sql=>{const statement=prepare(sql);if(sql.includes("phase='starting'")){const run=statement.run.bind(statement);statement.run=(...args)=>{const result=run(...args);if(!swapped){swapped=true;renameSync(f.workspace,join(f.dir,'original'));mkdirSync(f.workspace,{mode:0o777});writeFileSync(join(f.workspace,'program.mjs'),program,{mode:0o644})}return result}}return statement}
 const done=await f.done(await f.start());assert.equal(swapped,true);assert.equal(done.status,'failed');assert.equal(done.result.exitCode,125);assert.equal(done.result.stopConfirmed,true);assert.equal(done.result.possiblyApplied,true);assert.equal(await readFile(join(f.workspace,'forbidden'),'utf8').catch(()=>null),null);assert.equal(await readFile(join(f.dir,'original','forbidden'),'utf8').catch(()=>null),null)
})
real('container command: a verified live bind keeps writing its original directory after the host path is replaced',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs';fs.writeFileSync('/workspace/started','yes');setTimeout(()=>{fs.writeFileSync('/workspace/original-output','original');console.log('bound original')},900)");const id=await f.start();await wait(()=>readFile(join(f.workspace,'started'),'utf8').catch(()=>false));const moved=join(f.dir,'original');await rename(f.workspace,moved);await mkdir(f.workspace);await chmod(f.workspace,0o777);const done=await f.done(id);assert.equal(done.status,'succeeded');assert.equal(await readFile(join(moved,'original-output'),'utf8'),'original');assert.equal(await readFile(join(f.workspace,'original-output'),'utf8').catch(()=>null),null)
})
real('container command: spaces, Unicode and newline argv are exact without shell concatenation',async t=>{
 const f=await fixture(t);await f.program('console.log(JSON.stringify(process.argv.slice(2)))');const argv=['a b','中文','line\nnext','--privileged','$(not-a-shell)'];const done=await f.done(await f.start(['node','program.mjs',...argv]));assert.equal(done.status,'succeeded');assert.deepEqual(JSON.parse(await f.output(done)),argv)
})
real('container command: duplicate original operation is not executed twice and altered input conflicts',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs/promises';await fs.appendFile('/workspace/count','x');console.log('once')");const id=await f.start();const done=await f.done(id),args={workspaceRef:{kind:'remote',machineId:f.pair.machineId,rootId:'project',relativePath:''},argv:['node','program.mjs'],timeoutMs:15000};assert.equal((await f.call('shell_exec',args,id)).result.containerId,done.result.containerId);await assert.rejects(f.call('shell_exec',{...args,argv:['node','program.mjs','different']},id),/OPERATION_CONFLICT/);assert.equal(await readFile(join(f.workspace,'count'),'utf8'),'x')
})
real('container command: an active original worker excludes alias/child writers while independent writes and plain reads continue',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs';fs.writeFileSync('/workspace/started','yes');setInterval(()=>{},100)");const id=await f.start();await wait(()=>readFile(join(f.workspace,'started'),'utf8').catch(()=>false))
 for(const rootId of ['alias','child']){const denied=await f.call('fs_write',{rootId,relativePath:'blocked',content:'bad',expectedHash:null},'operation-'+randomUUID());assert.equal(denied.error.code,'WORKSPACE_BUSY')}
 const separate=await f.call('fs_write',{rootId:'other',relativePath:'allowed',content:'independent',expectedHash:null},'operation-'+randomUUID());assert.equal(separate.status,'succeeded');const read=await f.call('fs_read',{rootId:'project',relativePath:'started'});assert.equal(Buffer.from(read.content,'base64').toString(),'yes')
 await f.call('operation_cancel',{operationId:id});assert.equal((await f.done(id)).result.stopConfirmed,true);assert.equal(f.agent.workspaces.list().length,0);const after=await f.call('fs_write',{rootId:'alias',relativePath:'after-stop',content:'now allowed',expectedHash:null},'operation-'+randomUUID());assert.equal(after.status,'succeeded')
})
real('container command: nonzero exit is failed with confirmed stop and existing effects remain truthful',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs/promises';await fs.writeFile('/workspace/changed','yes');process.exitCode=7");const done=await f.done(await f.start());assert.equal(done.status,'failed');assert.equal(done.result.exitCode,7);assert.equal(done.result.stopConfirmed,true);assert.equal(done.result.possiblyApplied,true);assert.equal(await readFile(join(f.workspace,'changed'),'utf8'),'yes')
})
real('container command: timeout terminates container descendants and leaves no late workspace writes',async t=>{
 const f=await fixture(t);await f.program("import {spawn} from 'node:child_process';spawn(process.execPath,['child.mjs'],{stdio:'ignore'});setInterval(()=>{},100)");await f.program("import fs from 'node:fs';setInterval(()=>fs.appendFileSync('/workspace/ticks','x'),25)",'child.mjs');const done=await f.done(await f.start(undefined,{timeoutMs:1800}));assert.equal(done.status,'failed');assert.equal(done.error.code,'PROCESS_TIMEOUT');assert.equal(done.result.stopConfirmed,true);const before=await readFile(join(f.workspace,'ticks'),'utf8');await sleep(200);assert.equal(await readFile(join(f.workspace,'ticks'),'utf8'),before)
})
real('container command: explicit cancellation confirms the original container stopped',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs';fs.writeFileSync('/workspace/started','yes');setInterval(()=>{},100)");const id=await f.start();await wait(()=>readFile(join(f.workspace,'started'),'utf8').catch(()=>false));await f.call('operation_cancel',{operationId:id});const done=await f.done(id);assert.equal(done.status,'cancelled');assert.equal(done.result.stopConfirmed,true)
})
real('container command: revoked ticket stops active work; newly issued status scope observes original receipt',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs';fs.writeFileSync('/workspace/started','yes');setInterval(()=>{},100)");const id=await f.start();await wait(()=>readFile(join(f.workspace,'started'),'utf8').catch(()=>false));f.agent.store.revokeGrants(f.agent.store.client(f.pair.token),{botId:'bot-a'});await sleep(250);f.ticket=await f.grant();const done=await f.done(id);assert.equal(done.status,'cancelled');assert.equal(done.result.stopConfirmed,true);assert.equal(done.error.code,'GRANT_REVOKED')
})
real('container command: bounded persisted tail output cannot create artifacts beyond its combined cap',async t=>{
 const f=await fixture(t);await f.program("process.stdout.write('x'.repeat(10*1024*1024))");const done=await f.done(await f.start());assert.equal(done.status,'succeeded');assert.equal(done.result.truncated,true);assert.equal(done.result.outputPolicy,'bounded-tail');assert.ok(f.agent.store.db.prepare('SELECT sum(size) n FROM artifacts').get().n<=8*1024*1024)
})
real('container command: protected Agent tree, native aliases and disabled shell are refused before container creation',async t=>{
 const f=await fixture(t);await f.program("console.log('unused')");for(const extra of [{workspaceRef:{kind:'remote',machineId:f.pair.machineId,rootId:'unsafe',relativePath:''}},{argv:['/usr/bin/node','program.mjs']},{argv:undefined,script:'echo forbidden'}]){const done=await f.done(await f.start(undefined,extra));assert.equal(done.status,'failed')};assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM container_workers').get().n,0)
})
real('container command: every worktree entry refuses native Git under container mode',async t=>{
 const f=await fixture(t),context=f.agent.store.grant(f.ticket.grantToken);let nativeCalls=0;f.agent.git=async()=>{nativeCalls++;throw Error('NATIVE_GIT_SHOULD_NOT_RUN')}
 for(const name of ['worktree_create','worktree_diff','worktree_integrate'])await assert.rejects(f.agent.execute(name,{},context),/CONTAINER_TOOL_UNAVAILABLE/)
 assert.equal(nativeCalls,0);assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM worktrees').get().n,0)
})
real('container command: cold Agent reopens a retained completed container receipt without re-execution',async t=>{
 const f=await fixture(t);await f.program("import fs from 'node:fs/promises';await fs.appendFile('/workspace/count','x');console.log('recover original')");const original=f.agent.artifact.bind(f.agent);let dropped=false;f.agent.artifact=async(...args)=>{if(!dropped){dropped=true;throw Error('FIXTURE_RECEIPT_INTERRUPTION')}return original(...args)};const id=await f.start(),unknown=await wait(()=>{const r=f.agent.store.status(id,f.agent.store.grant(f.ticket.grantToken));return r.status==='unknown'&&r});assert.equal(unknown.status,'unknown');const cid=f.agent.store.db.prepare('SELECT cid FROM container_workers WHERE operation_id=?').get(id).cid;await f.reopen();const done=await f.done(id);assert.equal(done.status,'succeeded');assert.equal(done.result.containerId,cid);assert.equal(await readFile(join(f.workspace,'count'),'utf8'),'x');assert.match(await f.output(done),/recover original/)
})
real('container command: a hard link to Agent control data inside the workspace is refused before mounting',async t=>{
 const f=await fixture(t);const secret=join(f.agentConfig.dataDir,'synthetic-readable-control');await writeFile(secret,'PRIVATE-CONTROL',{mode:0o644});await link(secret,join(f.workspace,'planted-control'));await f.program("console.log('unused')");const done=await f.done(await f.start());assert.equal(done.status,'failed');assert.equal(done.error.code,'WORKSPACE_PRIVATE_PATH');assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM container_workers').get().n,0)
})
real('container command: wrong persisted ownership cannot inspect, stop or remove a retained container',async t=>{
 const f=await fixture(t);await f.program("console.log('original ownership')");const original=f.agent.artifact.bind(f.agent);f.agent.artifact=async()=>{throw Error('FIXTURE_RECEIPT_INTERRUPTION')};const id=await f.start();await wait(()=>f.agent.store.status(id,f.agent.store.grant(f.ticket.grantToken)).status==='unknown');const row=f.agent.store.db.prepare('SELECT nonce,cid FROM container_workers WHERE operation_id=?').get(id);f.agent.store.db.prepare('UPDATE container_workers SET nonce=? WHERE operation_id=?').run(randomUUID(),id)
 try{assert.equal((await f.call('operation_status',{operationId:id})).status,'unknown');await assert.rejects(f.call('operation_cancel',{operationId:id}),/CONTAINER_IDENTITY_MISMATCH/);assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM artifacts').get().n,0)}finally{f.agent.store.db.prepare('UPDATE container_workers SET nonce=? WHERE operation_id=?').run(row.nonce,id);f.agent.artifact=original}
 const done=await f.done(id);assert.equal(done.result.containerId,row.cid)
})
real('container command: actual Agent process deaths preserve create/start/receipt boundaries and never replay the original command',async t=>{
 for(const phase of ['prepared','created','starting','before-receipt-commit','after-receipt-commit','running','deadline'])await t.test(phase,async()=>{
  const f=await fixture(t);await f.program(['running','deadline'].includes(phase)?"import fs from 'node:fs';fs.appendFileSync('/workspace/count','x');let denied=false;try{process.kill(1,'SIGSTOP')}catch(e){denied=e.code==='EPERM'}fs.writeFileSync('/workspace/supervisor-denied',String(denied));fs.writeFileSync('/workspace/started','yes');setInterval(()=>fs.appendFileSync('/workspace/ticks','x'),30)":"import fs from 'node:fs';fs.appendFileSync('/workspace/count','x');console.log('one original process')")
  await f.server.close();await f.agent.close();f.server=null;f.agent=null
  const configFile=join(f.dir,'config.json'),readyFile=join(f.dir,'ready.json'),gateFile=join(f.dir,'gate'),id='operation-'+randomUUID();await writeFile(configFile,JSON.stringify(f.agentConfig),{mode:0o600})
  const child=spawn(process.execPath,[resolve('tests/fixtures/remote-container-crash.mjs'),configFile,readyFile,gateFile,phase],{stdio:'ignore'});let childClosed=false;const exited=new Promise((done,reject)=>{child.once('error',reject);child.once('close',()=>{childClosed=true;done()})})
  const kill=async()=>{if(!childClosed)child.kill('SIGKILL');await exited}
  let dispatch
  try{
   const ready=await wait(()=>readFile(readyFile,'utf8').then(JSON.parse).catch(()=>false)),client=new RemoteAgentClient(`http://127.0.0.1:${ready.port}`,f.pair.machineId,async()=>f.pair.token),ticket=await client.grant({botId:'bot-a',taskId:'task-a',attemptId:'attempt-a',roots:['project'],tools:['shell_exec','operation_status','operation_cancel','artifact_read']})
   dispatch=client.call(ticket.grantToken,'shell_exec',{workspaceRef:{kind:'remote',machineId:f.pair.machineId,rootId:'project',relativePath:''},argv:['node','program.mjs'],timeoutMs:phase==='deadline'?1500:30000},id).catch(()=>null)
   await wait(()=>readFile(['running','deadline'].includes(phase)?join(f.workspace,'started'):gateFile,'utf8').catch(()=>false));await kill();await dispatch
   if(phase==='deadline'){assert.equal(await readFile(join(f.workspace,'supervisor-denied'),'utf8'),'true');await sleep(2200);const ticks=await readFile(join(f.workspace,'ticks'),'utf8');await sleep(200);assert.equal(await readFile(join(f.workspace,'ticks'),'utf8'),ticks)}
   f.agent=new Agent(f.agentConfig,Database);await f.open();f.ticket=await f.grant()
   const before=f.agent.store.db.prepare('SELECT name,cid,phase FROM container_workers WHERE operation_id=?').get(id);assert.ok(before)
   let result=await f.call('operation_status',{operationId:id})
   if(phase==='running'||phase==='starting'){
    assert.ok(['unknown','cancelled'].includes(result.status));if(result.status==='unknown'){const cancel=await f.call('operation_cancel',{operationId:id});assert.equal(cancel.cancelRequested,true);result=await f.done(id)}assert.equal(result.status,'cancelled');assert.equal(result.result.stopConfirmed,true)
   }else if(phase==='prepared'||phase==='created'){assert.equal(result.status,'cancelled');assert.equal(result.result.notStarted,true);assert.equal(result.result.possiblyApplied,false)}
   else if(phase==='deadline'){assert.equal(result.status,'failed');assert.equal(result.result.exitCode,124);assert.equal(result.result.stopConfirmed,true)}
   else{assert.equal(result.status,'succeeded');assert.equal(result.result.containerId,before.cid)}
   const count=await readFile(join(f.workspace,'count'),'utf8').catch(()=>''),ticks=await readFile(join(f.workspace,'ticks'),'utf8').catch(()=>'');assert.equal(count,['before-receipt-commit','after-receipt-commit','running','deadline'].includes(phase)?'x':'');await sleep(200);assert.equal(await readFile(join(f.workspace,'count'),'utf8').catch(()=>''),count);assert.equal(await readFile(join(f.workspace,'ticks'),'utf8').catch(()=>''),ticks);assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM container_workers').get().n,1);assert.ok(['removed','settled'].includes(f.agent.store.db.prepare('SELECT phase FROM container_workers').get().phase))
  }finally{
   await kill();await dispatch
   if(!f.agent){f.agent=new Agent(f.agentConfig,Database);await f.open();f.ticket=await f.grant()}
   try{await f.call('operation_cancel',{operationId:id});await f.call('operation_status',{operationId:id})}catch{}
  }
 })
})
