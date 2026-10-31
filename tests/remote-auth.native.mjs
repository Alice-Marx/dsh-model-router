import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import http from 'node:http'
import https from 'node:https'
import {setTimeout as sleep} from 'node:timers/promises'
import Database from 'better-sqlite3'
import {createTlsFixture} from './helpers/remote-auth-tls.mjs'
await import('../remote-computer-agent/build.mjs')
const {Agent,Store,AuthThrottle,validateNetwork,serve}=await import('../remote-computer-agent/dist/index.mjs')
const parent=resolve('tmp/integration/remote-auth');await mkdir(parent,{recursive:true})
const ceiling={botIds:['bot-a','bot-b'],roots:['project'],tools:['machine_ping']}
const grantInput={botId:'bot-a',taskId:'task-a',attemptId:'attempt-a',roots:['project'],tools:['machine_ping']}
const rpc={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'machine_ping',arguments:{}}}
async function fixture(t,config={}){
  const dir=await mkdtemp(join(parent,'case-'));await mkdir(join(dir,'root'))
  const agent=new Agent({dataDir:join(dir,'data'),roots:{project:join(dir,'root')}},Database),pair=agent.store.pair('host-a',ceiling)
  let transport
  t.after(async()=>{await transport?.close();await agent.close()})
  transport=await serve(agent,{port:0,...config})
  return{agent,pair,dir,transport,endpoint:`${config.tls?'https':'http'}://127.0.0.1:${transport.address.port}`}
}
function request(f,{path='/mcp',token,headers={},body=rpc,tls={}}={}){
  return new Promise((done,reject)=>{
    const url=new URL(f.endpoint+path),client=url.protocol==='https:'?https:http
    const req=client.request(url,{method:'POST',headers:{'content-type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},...tls},res=>{
      let text='';res.setEncoding('utf8');res.on('data',value=>text+=value);res.on('end',()=>{try{done({status:res.statusCode,headers:res.headers,body:JSON.parse(text)})}catch(error){reject(error)}})
    });req.once('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('Fixture HTTPS request timed out')));req.end(JSON.stringify(body))
  })
}
const ticket=(f,pair=f.pair)=>f.agent.store.issue(f.agent.store.client(pair.token),grantInput).grantToken

test('auth/native: anonymous backoff is finite, global failures and memory are bounded, and valid identities have independent budgets',()=>{
  let now=0
  const limiter=new AuthThrottle({windowMs:60000,failureThreshold:5,maxSources:2,maxClients:2,globalFailureLimit:20,clientRequestLimit:2},()=>now)
  for(let i=0;i<4;i++)assert.equal(limiter.failure('peer-a').status,401)
  assert.equal(limiter.failure('peer-a').retryAfterMs,1000)
  assert.equal(limiter.failure('peer-a').audit,false)
  now=1000;assert.equal(limiter.failure('peer-a').retryAfterMs,2000)
  now=3000;assert.equal(limiter.failure('peer-a').retryAfterMs,4000)
  assert.equal(limiter.authenticated('client-a',1),null);assert.equal(limiter.authenticated('client-a',1),null)
  assert.equal(limiter.authenticated('client-a',1).status,429);assert.equal(limiter.authenticated('client-b',1),null)
  assert.equal(limiter.authenticated('client-a',2),null,'actual credential revision unlocks its old client window')
  for(let i=0;i<50;i++)limiter.failure(`peer-${i}`)
  assert.equal(limiter.stats().sources,2);assert.equal(limiter.stats().globalFailures,20)
  assert.equal(limiter.failure('new-peer').status,429);assert.equal(limiter.authenticated('client-c',1),null)
  assert.equal(limiter.stats().clients,2)
  now=60000;assert.equal(limiter.failure('peer-a').status,401);assert.equal(limiter.authenticated('client-a',1),null)
  const capped=new AuthThrottle({failureThreshold:1,baseBackoffMs:30000,maxBackoffMs:30000},()=>now)
  assert.equal(capped.failure('peer').retryAfterMs,30000);now+=30000;assert.equal(capped.failure('peer').retryAfterMs,30000)
  now=0;assert.equal(capped.failure('peer').retryAfterMs,30000,'clock rollback cannot stretch temporary cooling beyond its cap')
})

test('auth/native HTTP: spoofed forwarding/client headers cannot reset source cooling; a legitimate shared peer works and cooldown recovers',async t=>{
  const f=await fixture(t,{authLimits:{windowMs:2000,failureThreshold:3,baseBackoffMs:150,maxBackoffMs:300,globalFailureLimit:100}}),valid=ticket(f)
  assert.equal((await request(f,{token:valid})).status,200)
  for(let i=0;i<3;i++){
    const response=await request(f,{token:'x'.repeat(43),headers:{'x-forwarded-for':`198.51.100.${i}`,'forwarded':`for=198.51.100.${i}`,'x-client-id':`invented-${i}`}})
    assert.equal(response.status,i===2?429:401);assert.equal(response.body.error.code,i===2?'AUTH_RATE_LIMIT':'AUTH_INVALID')
  }
  const limited=await request(f,{token:'y'.repeat(43),headers:{'x-forwarded-for':'203.0.113.99'}})
  assert.equal(limited.status,429);assert.equal(limited.headers['retry-after'],'1')
  assert.equal((await request(f,{token:valid})).status,200)
  await sleep(310)
  const recovered=await request(f,{token:'z'.repeat(43)})
  assert.equal(recovered.status,429,'a new failed attempt resumes exponential cooling instead of resetting its failure history')
  await sleep(2010);assert.equal((await request(f,{token:'z'.repeat(43)})).status,401)
  const audit=JSON.stringify(f.agent.store.db.prepare('SELECT * FROM audit').all())
  for(const value of [valid,f.pair.token,'x'.repeat(43),'y'.repeat(43),'z'.repeat(43)])assert.equal(audit.includes(value),false)
})

test('auth/native HTTP: a saturated anonymous global quota refuses guesses while valid control and MCP clients remain usable',async t=>{
  const f=await fixture(t,{authLimits:{failureThreshold:100,globalFailureLimit:2}}),valid=ticket(f)
  assert.equal((await request(f)).status,401);assert.equal((await request(f,{token:'x'.repeat(43)})).status,401)
  const rejected=await request(f,{token:'y'.repeat(43)});assert.equal(rejected.status,429)
  assert.ok(Number(rejected.headers['retry-after'])>=1&&Number(rejected.headers['retry-after'])<=60)
  assert.equal((await request(f,{token:valid})).status,200)
  assert.equal((await request(f,{path:'/control/v1/grants',token:f.pair.token,body:grantInput})).status,200)
  const before=f.agent.store.db.prepare('SELECT count(*) AS n FROM audit').get().n
  for(let i=0;i<10;i++)assert.equal((await request(f,{token:'z'.repeat(43)})).status,429)
  assert.equal(f.agent.store.db.prepare('SELECT count(*) AS n FROM audit').get().n,before,'cooldown cannot fill the audit with repeated failures')
})

test('auth/native HTTP: all tickets share their actual client budget, other clients are isolated, and rotation immediately invalidates old secrets',async t=>{
  const f=await fixture(t,{authLimits:{clientRequestLimit:2}}),first=ticket(f),second=ticket(f)
  assert.equal((await request(f,{token:first})).status,200);assert.equal((await request(f,{token:second})).status,200)
  assert.equal((await request(f,{token:first,headers:{'x-client-id':'some-other-client'}})).status,429)
  const other=f.agent.store.pair('host-b',ceiling);assert.equal((await request(f,{token:ticket(f,other)})).status,200)
  const admin=new Store(join(f.dir,'data'),Database,{admin:true}),rotated=admin.rotate('host-a');admin.close()
  assert.equal((await request(f,{token:first})).status,401)
  assert.equal((await request(f,{path:'/control/v1/grants',token:f.pair.token,body:grantInput})).status,401)
  const next=await request(f,{path:'/control/v1/grants',token:rotated.token,body:grantInput});assert.equal(next.status,200)
  assert.equal((await request(f,{token:next.body.grantToken})).status,200)
  const stored=JSON.stringify({clients:f.agent.store.db.prepare('SELECT * FROM clients').all(),grants:f.agent.store.db.prepare('SELECT * FROM grants').all(),audit:f.agent.store.db.prepare('SELECT * FROM audit').all()})
  for(const secret of [first,second,rotated.token,f.pair.token,next.body.grantToken])assert.equal(stored.includes(secret),false)
})

test('auth/native: stale authenticated client rows cannot issue or revoke tickets from a newer revision',async t=>{
  const f=await fixture(t),stale=f.agent.store.client(f.pair.token),rotated=f.agent.store.rotate('host-a')
  const fresh=f.agent.store.issue(f.agent.store.client(rotated.token),grantInput)
  assert.throws(()=>f.agent.store.issue(stale,grantInput),/AUTH_INVALID/)
  assert.throws(()=>f.agent.store.revokeGrants(stale,{botId:'bot-a'}),/AUTH_INVALID/)
  assert.equal(f.agent.store.grant(fresh.grantToken).botId,'bot-a')
})

async function pausedBody(f,{token,path,body},whilePaused){
  const seen=Promise.withResolvers(),text=JSON.stringify(body)
  f.transport.server.once('request',()=>seen.resolve())
  let req
  const response=new Promise((done,reject)=>{
    req=http.request(f.endpoint+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'}},res=>{let value='';res.setEncoding('utf8');res.on('data',chunk=>value+=chunk);res.on('end',()=>done({status:res.statusCode,body:JSON.parse(value)}))})
    req.once('error',reject);req.setTimeout(3000,()=>req.destroy(new Error('Paused request timed out')));req.write(text.slice(0,1))
  })
  await seen.promise
  try{await whilePaused()}finally{req.end(text.slice(1))}
  return response
}
test('auth/native HTTP: rotation while a body uploads prevents the old control request revoking newly issued tickets',async t=>{
  const f=await fixture(t);let fresh
  const result=await pausedBody(f,{token:f.pair.token,path:'/control/v1/grants/revoke',body:{botId:'bot-a'}},()=>{
    const rotated=f.agent.store.rotate('host-a')
    fresh=f.agent.store.issue(f.agent.store.client(rotated.token),grantInput)
  })
  assert.equal(result.status,401);assert.equal(result.body.error.code,'AUTH_INVALID')
  assert.equal(f.agent.store.grant(fresh.grantToken).botId,'bot-a')
})
test('auth/native HTTP: a ticket revoked during body upload cannot list its old capabilities',async t=>{
  const f=await fixture(t),grant=ticket(f)
  const result=await pausedBody(f,{token:grant,path:'/mcp',body:{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}},()=>f.agent.store.revoke('host-a'))
  assert.equal(result.status,401);assert.equal(result.body.error.code,'AUTH_INVALID')
})

test('auth/native HTTP: public proxy mode trusts the actual peer and exact TLS marker, Host and Origin before any action',async t=>{
  const f=await fixture(t,{mode:'public-tls',trustedProxies:['127.0.0.1'],allowedHosts:['agent.example.invalid'],allowedOrigins:['https://console.example.invalid']})
  const headers={Host:'agent.example.invalid','x-forwarded-proto':'https',Origin:'https://console.example.invalid'},auth={token:f.pair.token,path:'/control/v1/grants',body:grantInput,headers}
  assert.equal((await request(f,auth)).status,200)
  for(const override of [{'x-forwarded-proto':'http'},{'x-forwarded-proto':'https,http'},{Host:'attacker.invalid','x-forwarded-host':'agent.example.invalid'},{Origin:''},{Origin:'null'},{Origin:'https://console.example.invalid.attacker.invalid'}])assert.equal((await request(f,{...auth,headers:{...headers,...override}})).status,403)
  const other=await fixture(t,{mode:'public-tls',trustedProxies:['127.0.0.2']})
  assert.equal((await request(other,{path:'/control/v1/grants',token:other.pair.token,body:grantInput,headers:{'x-forwarded-proto':'https','x-forwarded-for':'127.0.0.2'}})).status,403)
  assert.throws(()=>validateNetwork({mode:'public-tls',host:'0.0.0.0'}))
  assert.throws(()=>validateNetwork({allowedOrigins:['null']}))
  assert.throws(()=>validateNetwork({trustedProxies:['proxy.invalid']}))
  assert.throws(()=>validateNetwork({authLimits:{maxSources:1000000}}))
})

const tlsDir=await mkdtemp(join(parent,'tls-')),cert=await createTlsFixture(tlsDir),ca=await readFile(cert['ca.crt'])
test('auth/native HTTPS: explicit CA validates real TLS; an untrusted certificate is refused and no-Origin still requires Bearer',async t=>{
  const f=await fixture(t,{mode:'public-tls',tls:{keyFile:cert['server.key'],certFile:cert['server.crt']}}),valid=ticket(f)
  assert.equal((await request(f,{token:valid,tls:{ca}})).status,200)
  assert.equal((await request(f,{tls:{ca}})).status,401)
  await assert.rejects(request(f,{token:valid}))
  assert.equal((await request(f,{token:valid,tls:{ca},headers:{Origin:'https://attacker.invalid'}})).status,403)
})

test('auth/native mTLS: a trusted client certificate and independent Bearer are both mandatory',async t=>{
  assert.throws(()=>validateNetwork({tls:{keyFile:'key',certFile:'cert',requireClientCertificate:true}}),/MTLS_CA_REQUIRED/)
  const f=await fixture(t,{mode:'public-tls',tls:{keyFile:cert['server.key'],certFile:cert['server.crt'],caFile:cert['ca.crt'],requireClientCertificate:true}}),valid=ticket(f)
  const good={ca,key:await readFile(cert['client.key']),cert:await readFile(cert['client.crt'])}
  assert.equal((await request(f,{token:valid,tls:good})).status,200)
  assert.equal((await request(f,{tls:good})).status,401)
  await assert.rejects(request(f,{token:valid,tls:{ca}}))
  await assert.rejects(request(f,{token:valid,tls:{ca,key:await readFile(cert['untrusted.key']),cert:await readFile(cert['untrusted.crt'])}}))
})
