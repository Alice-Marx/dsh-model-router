import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import http from 'node:http'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { openRemoteMachines, normalizeMachineEndpoint } from '../packages/orchestration/src/remote-machines.mjs'
await import('../remote-computer-agent/build.mjs')
const { Agent, serve, TOOL_NAMES } = await import('../remote-computer-agent/dist/index.mjs')
const context={kind:'owner'}, secretName='ds-secret/REMOTE_AGENT_TEST'
async function fixture(t,options={}){
  await mkdir(resolve('tmp/integration/remote-machines'),{recursive:true})
  const dir=await mkdtemp(resolve('tmp/integration/remote-machines/case-'));await mkdir(join(dir,'root'))
  await writeFile(join(dir,'root/probe.txt'),'owned test data')
  const agent=new Agent({dataDir:join(dir,'agent'),roots:{project:join(dir,'root')}},Database)
  const paired=agent.store.pair('host',{botIds:['bot-a','bot-b'],roots:['project'],tools:TOOL_NAMES})
  const server=await serve(agent,{port:0}),endpoint=`http://127.0.0.1:${server.address.port}`
  const authority=createAuthority(),a={},b={}
  for(const [subject,botId] of [[a,'bot-a'],[b,'bot-b']])authority.register(subject,{botId,modelRoutes:[],tools:TOOL_NAMES.map(name=>`remote/${name}`)})
  const config={Database,file:join(dir,'host.sqlite'),resolveSecret:async ref=>{assert.equal(ref,secretName);return paired.token},botExists:id=>['bot-a','bot-b'].includes(id),authority,...options}
  const directory=openRemoteMachines(config)
  const pair={machineId:paired.machineId,name:'Native test machine',endpoint,secretRef:secretName,roots:['project'],tools:['machine_ping','fs_read','fs_list'],probeBotId:'bot-a',expectedRevision:0}
  t.after(async()=>{directory.close();authority.dispose();await server.close();await agent.close()})
  return{dir,agent,paired,server,endpoint,authority,a,b,directory,pair,config}
}
const bind=(f,botId='bot-a',overrides={})=>f.directory.bind({machineId:f.pair.machineId,botId,expectedRevision:0,roots:['project'],tools:['machine_ping','fs_read'],mode:'read-only',...overrides},context)
const call=(f,overrides={})=>f.directory.call(f.a,{machineId:f.pair.machineId,rootId:'project',taskId:'task-read',attemptId:'attempt-read',tool:'fs_read',args:{rootId:'project',relativePath:'probe.txt'},...overrides})

test('machine host: verifies real Agent identity before pairing; SQLite and public projection never contain credentials',async t=>{
  const f=await fixture(t);const result=await f.directory.pair(f.pair,context)
  assert.equal(result.status,'online');assert.equal(result.machineId,f.paired.machineId);assert.equal(result.platform,process.platform)
  assert.equal(result.secretRef,secretName);assert.equal(result.bindings.length,0)
  assert.equal(JSON.stringify(f.directory.readModel()).includes(f.paired.token),false)
  assert.equal((await readFile(f.config.file)).includes(Buffer.from(f.paired.token)),false)
  await assert.rejects(f.directory.pair(f.pair,context),/MACHINE_CONFIG_CONFLICT/)
  await assert.rejects(f.directory.pair({...f.pair,machineId:'machine-wrong'},context),/MACHINE_IDENTITY_MISMATCH/)
  assert.equal(f.directory.readModel().items.length,1)
})
test('machine host: secret resolver failures are uniform and redacted before any tool action',async t=>{
  let f
  f=await fixture(t,{resolveSecret:async()=>{throw new Error(`resolver failed at ${f.endpoint} with ${f.paired.token}`)}})
  let error
  try{await f.directory.pair(f.pair,context)}catch(value){error=value}
  assert.equal(error.code,'MACHINE_SECRET_UNAVAILABLE')
  assert.equal(error.message,'MACHINE_SECRET_UNAVAILABLE')
  assert.equal(JSON.stringify(error).includes(f.paired.token),false)
  assert.equal(JSON.stringify(f.directory.readModel()).includes(f.paired.token),false)
  assert.equal(f.directory.readModel().items.length,0)
  assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n,0)
  assert.equal((await readFile(f.config.file)).includes(Buffer.from(f.paired.token)),false)
})
test('machine host: only owner can pair/bind/probe/revoke; scopes are ceilings with CAS and explicit read-only enforcement',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.directory.pair(f.pair,{kind:'agent'}),/REMOTE_OWNER_REQUIRED/)
  await f.directory.pair(f.pair,context)
  await assert.rejects(bind(f,'bot-a',{tools:['fs_write']}),/INVALID_MACHINE_SCOPE/)
  await assert.rejects(bind(f,'bot-a',{roots:['outside']}),/INVALID_MACHINE_SCOPE/)
  await assert.rejects(bind(f,'other'),/MACHINE_BOT_DENIED/)
  assert.equal((await bind(f)).remoteRevoked,true)
  await assert.rejects(bind(f),/MACHINE_CONFIG_CONFLICT/)
  assert.equal(f.directory.scopes('bot-a').length,1)
  await assert.rejects(f.directory.probe({machineId:f.pair.machineId,botId:'bot-a',rootId:'project'},{kind:'agent'}),/REMOTE_OWNER_REQUIRED/)
  const read=await f.directory.probe({machineId:f.pair.machineId,botId:'bot-a',rootId:'project',relativePath:'probe.txt'},context)
  assert.equal(read.diagnostic,'read-confirmed');assert.equal(read.bytes,15);assert.equal(read.content,undefined)
})
test('machine host: model calls use actual object identity, exact root and host metadata, with no endpoint or ticket arguments',async t=>{
  const f=await fixture(t);await f.directory.pair(f.pair,context);await bind(f)
  const read=await call(f);assert.equal(Buffer.from(read.content,'base64').toString(),'owned test data')
  await assert.rejects(f.directory.call({},{}),/UNKNOWN_SUBJECT|INVALID_MACHINE_REQUEST/)
  await assert.rejects(f.directory.call(f.b,{machineId:f.pair.machineId,rootId:'project',taskId:'t',attemptId:'a',tool:'fs_read',args:{rootId:'project',relativePath:'probe.txt'}}),/MACHINE_BOT_DENIED/)
  await assert.rejects(call(f,{args:{rootId:'project',relativePath:'probe.txt',botId:'bot-b'}}),/MACHINE_CONTEXT_FORGED/)
  await assert.rejects(call(f,{args:{rootId:'outside',relativePath:'probe.txt'}}),/MACHINE_BOT_DENIED/)
  await assert.rejects(call(f,{args:{rootId:'project',relativePath:'../host.sqlite'}}),/WORKSPACE_OUTSIDE_SCOPE/)
  f.authority.replaceGrant(f.a,{botId:'bot-a',tools:[],modelRoutes:[]})
  await assert.rejects(call(f),/TOOL_DENIED/)
})
test('machine host: revoking one Bot invalidates its real remote ticket without revoking the other Bot',async t=>{
  const f=await fixture(t);await f.directory.pair(f.pair,context);await bind(f);await bind(f,'bot-b')
  const client=f.agent.store.client(f.paired.token),tickets=['bot-a','bot-b'].map(botId=>f.agent.store.issue(client,{botId,taskId:'task',attemptId:'attempt',roots:['project'],tools:['machine_ping']}))
  const a=f.agent.store.grant(tickets[0].grantToken),b=f.agent.store.grant(tickets[1].grantToken)
  assert.equal((await f.directory.revoke({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:1},context)).remoteRevoked,true)
  assert.throws(()=>f.agent.store.validate(a),/GRANT_REVOKED/)
  assert.equal((await f.agent.call('machine_ping',{},b)).machineId,f.pair.machineId)
  await assert.rejects(call(f),/MACHINE_BOT_DENIED/)
  assert.equal(f.directory.scopes('bot-b').length,1)
})
test('machine host: offline revoke remains revoked after restart and reports remote stop as unconfirmed',async t=>{
  const f=await fixture(t);await f.directory.pair(f.pair,context);await bind(f)
  const offline=openRemoteMachines({...f.config,fetchImpl:async()=>{throw new Error(`private endpoint ${f.endpoint}; ${f.paired.token}`)}})
  try{
    const result=await offline.revoke({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:1},context)
    assert.equal(result.remoteRevoked,false);assert.equal(result.warning,'REMOTE_REVOCATION_UNCONFIRMED')
    await assert.rejects(call(f),/MACHINE_BOT_DENIED/)
  }finally{offline.close()}
  const restored=openRemoteMachines(f.config)
  try{
    assert.deepEqual(restored.scopes('bot-a'),[]);assert.equal(JSON.stringify(restored.readModel()).includes(f.paired.token),false)
    assert.equal(restored.readModel().items[0].revocations[0].status,'unconfirmed')
    const result=await restored.reconcile({machineId:f.pair.machineId},context)
    assert.equal(result.remoteRevoked,true);assert.equal(result.grantsRestored,false)
    assert.equal(restored.readModel().items[0].revocations[0].status,'revoked');assert.deepEqual(restored.scopes('bot-a'),[])
  }finally{restored.close()}
})
test('machine host: a cross-origin redirect is refused without forwarding credentials or reaching the target',async t=>{
  const f=await fixture(t);let hits=0
  const target=http.createServer((req,res)=>{hits++;res.end()})
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>target.close(resolve)))
  const redirect=http.createServer((req,res)=>{res.writeHead(302,{location:`http://127.0.0.1:${target.address().port}/control/v1/grants`});res.end()})
  await new Promise(resolve=>redirect.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>redirect.close(resolve)))
  let error
  try{await f.directory.pair({...f.pair,endpoint:`http://127.0.0.1:${redirect.address().port}/`},context)}catch(value){error=value}
  assert.equal(error.code,'MACHINE_CONNECTION_FAILED')
  assert.equal(hits,0,'the redirect target never receives the Authorization header or request body')
  assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n,0)
  assert.equal(f.directory.readModel().items.length,0)
})
test('machine host: endpoint validation rejects embedded secrets, unprotected public HTTP and arbitrary URL paths',()=>{
  assert.equal(normalizeMachineEndpoint('https://machine.example/'),'https://machine.example')
  assert.equal(normalizeMachineEndpoint('http://127.0.0.1:9900'),'http://127.0.0.1:9900')
  for(const endpoint of ['http://machine.example/','https://user:key@machine.example/','https://machine.example/?key=x','https://machine.example/path','file:///tmp/x'])assert.throws(()=>normalizeMachineEndpoint(endpoint))
})
test('machine host: changing the actual Bot grant aborts an in-flight remote request before a late result can succeed',async t=>{
  let opened;const entered=new Promise(resolve=>{opened=resolve})
  const f=await fixture(t,{fetchImpl:async(url,options)=>{
    if(JSON.parse(options.body).params?.name==='fs_read'){
      opened();return new Promise((_,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})})
    }
    return fetch(url,options)
  }})
  await f.directory.pair(f.pair,context);await bind(f)
  const work=call(f),refused=assert.rejects(work,/GRANT_CHANGED/)
  await entered;f.authority.replaceGrant(f.a,{botId:'bot-a',tools:[],modelRoutes:[]});await refused
})
test('machine host: a late successful revoke cannot overwrite a newer unconfirmed revoke from another Host connection',async t=>{
  let delay=false,opened,release
  const entered=new Promise(resolve=>{opened=resolve}),gate=new Promise(resolve=>{release=resolve})
  const f=await fixture(t,{fetchImpl:async(url,options)=>{
    const response=await fetch(url,options)
    if(delay&&url.endsWith('/control/v1/grants/revoke')){opened();await gate}
    return response
  }})
  await f.directory.pair(f.pair,context);await bind(f);delay=true
  const old=f.directory.revoke({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:1},context)
  await entered
  const other=openRemoteMachines({...f.config,fetchImpl:async()=>{throw new Error('offline')}})
  try{
    assert.equal((await other.revoke({machineId:f.pair.machineId,botId:'bot-a',expectedRevision:2},context)).remoteRevoked,false)
    release();assert.equal((await old).remoteRevoked,false)
    assert.equal(other.readModel().items[0].revocations[0].status,'unconfirmed')
  }finally{release();other.close()}
})
