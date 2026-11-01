import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,symlink,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import http from 'node:http'
import {pathToFileURL} from 'node:url'
await import('../remote-computer-agent/build.mjs')
if(process.platform==='win32')execFileSync('powershell.exe',['-NoLogo','-NoProfile','-File','native/windows-desktop/build.ps1'],{windowsHide:true})
const {Agent,Store,TOOL_NAMES,sha,serve,validateNetwork,RemoteAgentClient}=await import('../remote-computer-agent/dist/index.mjs')
const require=createRequire(import.meta.url)
const driver=process.env.DSH_REMOTE_AGENT_DRIVER??pathToFileURL(resolve('tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js')).href
let Database;try{Database=(await import(driver)).default}catch{Database=createRequire(new URL('../remote-computer-agent/package.json',import.meta.url))('better-sqlite3')}
await mkdir(resolve('tmp/integration/agent-native'),{recursive:true})
async function fixture(){const dir=await mkdtemp(resolve('tmp/integration/agent-native/case-'));await mkdir(join(dir,'root'));await mkdir(join(dir,'outside'));const config={dataDir:join(dir,'data'),roots:{project:join(dir,'root')},executables:{node:process.execPath},windowsJobRunner:resolve('tmp/integration/agent-helper-build/dsh-process-job.exe'),shell:process.platform==='win32'?join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'/bin/sh'};const agent=new Agent(config,Database);const paired=agent.store.pair('host',{botIds:['bot-a','bot-b'],roots:['project'],tools:TOOL_NAMES});const issued=agent.store.issue(agent.store.client(paired.token),{botId:'bot-a',taskId:'task',attemptId:'attempt',roots:['project'],tools:TOOL_NAMES});return{dir,config,agent,paired,context:agent.store.grant(issued.grantToken),issued}}
const code=(expected)=>e=>e.code===expected
async function settled(f,id){for(let i=0;i<500;i++){const status=f.agent.store.status(id,f.context);if(!['admitted','running','cancel_pending'].includes(status.status))return status;await new Promise(r=>setTimeout(r,20))}assert.fail('operation did not settle')}
async function waitFile(file){for(let i=0;i<250;i++){try{await access(file);return}catch{}await new Promise(r=>setTimeout(r,20))}assert.fail('subprocess did not start')}
function shellArgs(f,argv,timeoutMs=5000){return {workspaceRef:{kind:'remote',machineId:f.agent.store.machineId,rootId:'project'},argv,timeoutMs}}

test('pairing, local rotation/revocation, short grants and stable machine identity',async()=>{const f=await fixture();try{
  assert.equal(f.paired.token.length,43);assert.equal(f.agent.store.db.prepare('SELECT digest FROM clients').get().digest,sha(f.paired.token));assert.ok(!JSON.stringify(f.agent.store.db.prepare('SELECT * FROM clients').all()).includes(f.paired.token))
  assert.throws(()=>new Store(f.config.dataDir,Database),code('AGENT_LOCKED'))
  assert.throws(()=>f.agent.store.issue(f.agent.store.client(f.paired.token),{botId:'evil',taskId:'task',attemptId:'attempt',roots:['project'],tools:['machine_ping']}),code('SCOPE_DENIED'))
  const admin=new Store(f.config.dataDir,Database,{admin:true}),rotated=admin.rotate('host');admin.close()
  assert.throws(()=>f.agent.store.client(f.paired.token),code('AUTH_INVALID'));assert.throws(()=>f.agent.store.grant(f.issued.grantToken),code('GRANT_REVOKED'))
  const fresh=f.agent.store.issue(f.agent.store.client(rotated.token),{botId:'bot-a',taskId:'task',attemptId:'attempt',roots:['project'],tools:['machine_ping']});f.agent.store.revoke('host');assert.throws(()=>f.agent.store.grant(fresh.grantToken),code('GRANT_REVOKED'))
  const id=f.agent.store.machineId;await f.agent.close();f.agent=new Agent(f.config,Database);assert.equal(f.agent.store.machineId,id)
}finally{await f.agent.close()}})

test('root authorization, traversal, ADS and symlink escape fail before reads/writes',async()=>{const f=await fixture();try{
  await writeFile(join(f.dir,'outside/secret'),'outside');await symlink(join(f.dir,'outside'),join(f.dir,'root/link'),process.platform==='win32'?'junction':'dir')
  for(const relativePath of ['../outside/secret','link/secret','C:/secret','file:stream','/etc/passwd','a/../../secret'])await assert.rejects(f.agent.call('fs_read',{rootId:'project',relativePath},f.context),code('WORKSPACE_OUTSIDE_SCOPE'))
  await assert.rejects(f.agent.call('fs_read',{rootId:'other',relativePath:'x'},f.context),code('SCOPE_DENIED'))
  const denied=await f.agent.call('fs_write',{rootId:'project',relativePath:'link/new',content:'x',expectedHash:null},f.context,'escape');assert.equal(denied.error.code,'WORKSPACE_OUTSIDE_SCOPE');await assert.rejects(access(join(f.dir,'outside/new')))
}finally{await f.agent.close()}})

test('atomic file CAS, bounded reads, pagination and operation idempotency',async()=>{const f=await fixture();try{
  const a={rootId:'project',relativePath:'one.txt',content:'hello世界',expectedHash:null};const first=await f.agent.call('fs_write',a,f.context,'write-1');assert.equal(first.status,'succeeded');assert.equal((await f.agent.call('fs_write',a,f.context,'write-1')).startedAt,first.startedAt)
  await assert.rejects(f.agent.call('fs_write',{...a,content:'different'},f.context,'write-1'),code('OPERATION_CONFLICT'))
  const bad=await f.agent.call('fs_write',{...a,content:'bad'},f.context,'write-2');assert.equal(bad.error.code,'FILE_CHANGED');assert.equal(await readFile(join(f.dir,'root/one.txt'),'utf8'),a.content)
  const read=await f.agent.call('fs_read',{rootId:'project',relativePath:'one.txt',offset:0,length:5},f.context);assert.equal(Buffer.from(read.content,'base64').toString(),'hello');assert.equal(read.eof,false)
  const overwrite=await f.agent.call('fs_write',{...a,content:'new',expectedHash:first.result.sha256},f.context,'write-3')
  if(process.platform==='win32'){assert.equal(overwrite.status,'succeeded');assert.equal(await readFile(join(f.dir,'root/one.txt'),'utf8'),'new')}
  else{assert.equal(overwrite.error.code,'OVERWRITE_UNSUPPORTED');assert.equal(await readFile(join(f.dir,'root/one.txt'),'utf8'),a.content)}
  const missing=await f.agent.call('fs_write',{rootId:'project',relativePath:'x',content:'x'},f.context,'write-4');assert.equal(missing.error.code,'EXPECTED_HASH_REQUIRED')
  assert.equal((await f.agent.call('fs_list',{rootId:'project',limit:1},f.context)).entries.length,1)
}finally{await f.agent.close()}})

test('running admissions become unknown on restart, same ID never replays',async()=>{const f=await fixture();try{
  const args={rootId:'project',relativePath:'never',content:'never',expectedHash:null};f.agent.store.admit('lost',f.context,'fs_write',args);f.agent.store.running('lost');await f.agent.close();f.agent=new Agent(f.config,Database)
  const ticket=f.agent.store.issue(f.agent.store.client(f.paired.token),{botId:'bot-a',taskId:'task',attemptId:'attempt',roots:['project'],tools:TOOL_NAMES});f.context=f.agent.store.grant(ticket.grantToken)
  const value=await f.agent.call('fs_write',args,f.context,'lost');assert.equal(value.status,'unknown');assert.equal(value.error.code,'OUTCOME_UNKNOWN');await assert.rejects(access(join(f.dir,'root/never')))
}finally{await f.agent.close()}})

test('real argv process, cwd, separate artifacts and immutable owner',async()=>{const f=await fixture();try{
  const args=shellArgs(f,['node','-e','process.stdout.write(process.cwd());process.stderr.write("stderr");process.stdout.write(process.argv[1])','; echo injected']);await f.agent.call('shell_exec',args,f.context,'process');const result=await settled(f,'process');assert.equal(result.status,'succeeded')
  const out=await f.agent.call('artifact_read',{artifactId:result.result.stdoutArtifactId},f.context);assert.equal(Buffer.from(out.content,'base64').toString(),join(f.dir,'root')+'; echo injected')
  const stderr=await f.agent.call('artifact_read',{artifactId:result.result.stderrArtifactId},f.context);assert.equal(Buffer.from(stderr.content,'base64').toString(),'stderr')
  await assert.rejects(f.agent.call('artifact_read',{artifactId:result.result.stdoutArtifactId},{...f.context,botId:'bot-b'}),code('SCOPE_DENIED'))
  const bad=shellArgs(f,['unregistered','--version']);await f.agent.call('shell_exec',bad,f.context,'unregistered');assert.equal((await settled(f,'unregistered')).error.code,'EXECUTABLE_NOT_ALLOWED')
}finally{await f.agent.close()}})

test('real timeout terminates owned process tree, without delayed grandchild side effect',async()=>{const f=await fixture();try{
  const delayed='setTimeout(()=>require("node:fs").writeFileSync("grandchild-ran","bad"),1200);setInterval(()=>{},1000)';const script='require("node:child_process").spawn(process.execPath,["-e",'+JSON.stringify(delayed)+'],{stdio:"inherit"});setInterval(()=>{},1000)'
  await f.agent.call('shell_exec',shellArgs(f,['node','-e',script],150),f.context,'timeout');const result=await settled(f,'timeout');assert.equal(result.error.code,'PROCESS_TIMEOUT');assert.equal(result.status,'failed');await new Promise(r=>setTimeout(r,1400));await assert.rejects(access(join(f.dir,'root/grandchild-ran')))
}finally{await f.agent.close()}})

test('cancel and active grant revocation stop owned subprocesses',async()=>{const f=await fixture();try{
  await f.agent.call('shell_exec',shellArgs(f,['node','-e','require("node:fs").writeFileSync("cancel-ready","ok");setInterval(()=>{},1000)']),f.context,'cancel');await waitFile(join(f.dir,'root/cancel-ready'));const cancel=await f.agent.call('operation_cancel',{operationId:'cancel'},f.context);assert.equal(cancel.cancelRequested,true);assert.equal((await settled(f,'cancel')).status,'cancelled')
  await f.agent.call('shell_exec',shellArgs(f,['node','-e','require("node:fs").writeFileSync("revoke-ready","ok");setInterval(()=>{},1000)']),f.context,'revoke');await waitFile(join(f.dir,'root/revoke-ready'));f.agent.store.revoke('host');assert.equal((await settled(f,'revoke')).error.code,'GRANT_REVOKED')
}finally{await f.agent.close()}})

test('four network modes reject wildcard, unprotected HTTP and arbitrary VPN bind',()=>{
  validateNetwork({});validateNetwork({mode:'cloudflare-tunnel',protectedTunnel:true});validateNetwork({mode:'public-tls',trustedProxies:['127.0.0.1']})
  for(const config of [{host:'0.0.0.0'},{mode:'public-tls',host:'192.0.2.2'},{mode:'wireguard',host:'192.0.2.2',protectedTunnel:true},{mode:'tailscale',host:'127.0.0.1'},{mode:'cloudflare-tunnel',host:'192.0.2.2',protectedTunnel:true}])assert.throws(()=>validateNetwork(config))
})
test('Host control-plane per-Bot ticket revocation stops an already running owned process without revoking another Bot',async()=>{
  const f=await fixture();let server
  try{
    server=await serve(f.agent,{port:0})
    const peer=f.agent.store.issue(f.agent.store.client(f.paired.token),{botId:'bot-b',taskId:'task',attemptId:'attempt',roots:['project'],tools:['machine_ping']})
    await f.agent.call('shell_exec',shellArgs(f,['node','-e','require("node:fs").writeFileSync("ticket-ready","ok");setInterval(()=>{},1000)']),f.context,'ticket-revoked')
    await waitFile(join(f.dir,'root/ticket-ready'))
    const response=await fetch(`http://127.0.0.1:${server.address.port}/control/v1/grants/revoke`,{method:'POST',headers:{Authorization:`Bearer ${f.paired.token}`,'content-type':'application/json'},body:JSON.stringify({botId:'bot-a'})})
    assert.equal(response.status,200);assert.ok((await response.json()).revoked>0)
    const result=await settled(f,'ticket-revoked');assert.equal(result.error.code,'GRANT_REVOKED')
    assert.throws(()=>f.agent.store.grant(f.issued.grantToken),code('AUTH_INVALID'))
    assert.equal((await f.agent.call('machine_ping',{},f.agent.store.grant(peer.grantToken))).machineId,f.agent.store.machineId)
  }finally{await server?.close();await f.agent.close()}
})

test('real Streamable HTTP initialize/list/call, Host/Origin/auth and secretRef client',async()=>{const f=await fixture();let transport;try{
  transport=await serve(f.agent,{port:0});const endpoint=`http://127.0.0.1:${transport.address.port}`,headers={'content-type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${f.issued.grantToken}`,'MCP-Protocol-Version':'2025-11-25'}
  const rpc=async(method,params={})=>{const response=await fetch(endpoint+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});assert.equal(response.status,200,await response.clone().text());return response.json()}
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'native-test',version:'1'}});assert.equal(init.result.serverInfo.name,'dsh-remote-computer-agent')
  assert.ok((await rpc('tools/list')).result.tools.some(x=>x.name==='fs_write'))
  assert.equal((await rpc('tools/call',{name:'machine_ping',arguments:{}})).result.structuredContent.machineId,f.agent.store.machineId)
  assert.equal((await fetch(endpoint+'/mcp',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:'{}'})).status,403)
  const wrongHost=await new Promise(resolve=>{const req=http.request(endpoint+'/mcp',{method:'POST',headers:{...headers,Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.end('{}')});assert.equal(wrongHost,403)
  assert.equal((await fetch(endpoint+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401)
  for(let i=0;i<5;i++)await fetch(endpoint+'/mcp',{method:'POST',headers:{...headers,Authorization:'Bearer invalid'},body:'{}'})
  assert.equal((await fetch(endpoint+'/mcp',{method:'POST',headers:{...headers,Authorization:'Bearer invalid'},body:'{}'})).status,429)
  assert.equal((await rpc('tools/call',{name:'machine_ping',arguments:{}})).result.structuredContent.machineId,f.agent.store.machineId)
  const client=new RemoteAgentClient(endpoint,f.agent.store.machineId,async()=>f.paired.token);const grant=await client.grant({botId:'bot-a',taskId:'task',attemptId:'attempt',roots:['project'],tools:['machine_ping']});assert.equal((await client.call(grant.grantToken,'machine_ping',{})).machineId,f.agent.store.machineId)
  const notGranted=await rpc('tools/call',{name:'machine_ping',arguments:{},_meta:{'dsh/operationId':'ping'}});assert.equal(notGranted.result.isError,undefined)
}finally{await transport?.close();await f.agent.close()}})

test('remote worktree conditional integration preserves source changes',async()=>{const f=await fixture();try{
  const repo=join(f.dir,'root/repo');await mkdir(repo);const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});git(['init']);await writeFile(join(repo,'a'),'base\n');git(['add','a']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','base'])
  const created=await f.agent.call('worktree_create',{rootId:'project',relativePath:'repo',worktreeRelativePath:'edit'},f.context,'wt-create');assert.equal(created.status,'succeeded');const worktreeId=created.result.worktreeId
  await writeFile(join(f.dir,'root/edit/a'),'changed\n');const diff=await f.agent.call('worktree_diff',{worktreeId},f.context);assert.ok(diff.artifactId)
  await writeFile(join(repo,'a'),'concurrent\n');const blocked=await f.agent.call('worktree_integrate',{worktreeId},f.context,'wt-block');assert.equal(blocked.result.status,'integration-pending');assert.equal(await readFile(join(repo,'a'),'utf8'),'concurrent\n')
  await writeFile(join(repo,'a'),'base\n');const integrated=await f.agent.call('worktree_integrate',{worktreeId},f.context,'wt-integrate');assert.equal(integrated.result.status,'integrated');assert.equal(await readFile(join(repo,'a'),'utf8'),'changed\n')
}finally{await f.agent.close()}})

test('remote worktree dirty source, moved HEAD and internal commit never overwrite the source',async()=>{const f=await fixture();try{
  const repo=join(f.dir,'root/repo');await mkdir(repo);const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true});git(['init']);await writeFile(join(repo,'a'),'base\n');git(['add','a']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','base'])
  const created=await f.agent.call('worktree_create',{rootId:'project',relativePath:'repo',worktreeRelativePath:'edit'},f.context,'wt-create');assert.equal(created.status,'succeeded');const worktreeId=created.result.worktreeId
  await writeFile(join(f.dir,'root/edit/a'),'changed\n');const diff=await f.agent.call('worktree_diff',{worktreeId},f.context);assert.ok(diff.artifactId)
  const recovered=await f.agent.call('artifact_read',{artifactId:diff.artifactId,offset:0,length:1048576},f.context);assert.ok(Buffer.from(recovered.content,'base64').toString().includes('changed'))
  await writeFile(join(repo,'a'),'dirty\n');const dirty=await f.agent.call('worktree_integrate',{worktreeId},f.context,'wt-dirty');assert.equal(dirty.result.status,'integration-pending');assert.equal(dirty.result.reason,'SOURCE_CHANGED');assert.equal(await readFile(join(repo,'a'),'utf8'),'dirty\n')
  git(['checkout','--','a']);await writeFile(join(repo,'a'),'head-moved\n');git(['add','a']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','head moved'])
  const moved=await f.agent.call('worktree_integrate',{worktreeId},f.context,'wt-head');assert.equal(moved.result.status,'integration-pending');assert.equal(moved.result.reason,'SOURCE_CHANGED');assert.equal(await readFile(join(repo,'a'),'utf8'),'head-moved\n')
  git(['reset','--hard','HEAD~1']);const edit=join(f.dir,'root/edit');execFileSync('git',['add','a'],{cwd:edit});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','worktree local'],{cwd:edit})
  const internal=await f.agent.call('worktree_integrate',{worktreeId},f.context,'wt-internal');assert.equal(internal.result.status,'integration-pending');assert.equal(internal.result.reason,'SOURCE_CHANGED');assert.ok(['base\n','base\r\n'].includes(await readFile(join(repo,'a'),'utf8')))
}finally{await f.agent.close()}})

test('desktop without configured interactive helper fails explicitly',async()=>{const f=await fixture();try{const result=await f.agent.call('desktop_screenshot',{displayId:'display',sessionSelector:0,targetWindow:'0'},f.context,'desktop');assert.equal(result.status,'failed');assert.equal(result.error.code,'DESKTOP_UNAVAILABLE')}finally{await f.agent.close()}})
