import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import net from 'node:net'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {WebSocket} from 'ws'
import {setTimeout as delay} from 'node:timers/promises'
import {DesktopSessions,NativeDesktopPipe,AgentError,serve,RemoteAgentClient} from '../remote-computer-agent/dist/index.mjs'

const tools=['desktop_screenshot','desktop_click','desktop_type','desktop_key','desktop_scroll']
const JPEG=Buffer.from([0xff,0xd8,1,2,3,0xff,0xd9]),origin='https://host.example'
async function until(predicate){for(let n=0;n<200;n++){if(predicate())return;await delay(5)}assert.fail('condition did not occur')}
class Native extends EventEmitter {
  metadata={streamVersion:1,width:1280,height:720,displayId:'display-2',displays:[{id:'display-2',name:'Secondary',width:1280,height:720,x:-1280,y:0,dpi:144,primary:false}],physicalOrigin:{x:-1280,y:0},dpi:144,coordinateSpace:'display-physical-pixels',captureBackend:'fixture',mode:'watch'}
  calls=[];mode='watch';held=[];frames=0;closed=0;stopConfirmed=true;expiresAt=0
  async request(value){
    this.calls.push(value)
    if(value.t==='control'){
      if(this.unknownControl)throw new AgentError('OUTCOME_UNKNOWN',409)
      if(value.action==='acquire'&&this.acquireGate)await this.acquireGate.promise
      if(value.action==='acquire'&&this.acquireDenied)return {ok:false,code:'DESKTOP_BUSY',possiblyApplied:false}
      this.mode=value.action==='acquire'?'control':'watch';if(this.mode==='watch')this.held=[];return {ok:true,mode:this.mode}
    }
    if(value.t==='input'){if(this.unknownInput)throw new AgentError('OUTCOME_UNKNOWN',409);if(this.mode!=='control')return {ok:false,code:'CONTROL_NOT_GRANTED',possiblyApplied:false};this.held.push(value);return {ok:true}}
    if(value.t==='release-input'){if(this.unknownRelease)throw new AgentError('OUTCOME_UNKNOWN',409);this.held=[];return {ok:true}}
    if(value.t==='renew'){this.expiresAt=value.expiresAt;return {ok:true,expiresAt:value.expiresAt}}
    if(value.t==='video')return {ok:true}
    return {ok:false,code:'INVALID_ARGUMENT'}
  }
  frame(){this.frames++}
  async close(){this.closed++;if(this.closeGate)await this.closeGate.promise;this.mode='watch';this.held=[];this.emit('ended',{code:'SESSION_CLOSED',stopConfirmed:this.stopConfirmed});return {stopConfirmed:this.stopConfirmed}}
}
async function fixture(options={}){
  let serial=0;const grants=new Map(),natives=[],audit=[]
  const issue=(changes={})=>{const c={clientId:'host',botId:'bot',taskId:'task',attemptId:'attempt',revision:1,roots:['project'],tools:[...tools],expiresAt:Date.now()+10000,grantId:`grant-${++serial}`,...changes},token=String(serial).padStart(43,'a');grants.set(token,c);return {token,c}}
  const store={validate(c){if(c.expiresAt<=Date.now()||![...grants.values()].some(g=>g.grantId===c.grantId))throw new AgentError('GRANT_REVOKED',403)},grant(token){const c=grants.get(token);if(!c)throw new AgentError('AUTH_INVALID',401);this.validate(c);return c},audit(...args){audit.push(args)}}
  const sessions=new DesktopSessions({pipeName:'dsh-desktop-fixture',secretFile:'offline'},store,{nativeFactory:async(config,request)=>{const native=new Native();native.expiresAt=request.expiresAt;natives.push(native);return native},sweepMs:10,authTimeoutMs:100,...options})
  const handle=await serve({store,desktopSessions:sessions},{port:0,allowedOrigins:['https://globally-allowed.example']}),endpoint=`http://127.0.0.1:${handle.address.port}`,url=endpoint.replace('http:','ws:')+'/desktop/v1/socket'
  const granted=issue(),post=async(path,body,token=granted.token)=>{const response=await fetch(endpoint+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});return {response,value:await response.json()}}
  const open=async(body={},token=granted.token)=>{const result=await post('/desktop/v1/session',{mode:'watch',fps:15,origin,...body},token);assert.equal(result.response.status,200,JSON.stringify(result.value));return result.value}
  return {store,grants,granted,issue,natives,audit,sessions,handle,endpoint,url,post,open,async close(){await handle.close()}}
}
function peer(url,options={}){
  const socket=new WebSocket(url,options),messages=[];socket.on('message',(data,binary)=>messages.push(binary?Buffer.from(data):JSON.parse(data)))
  socket.on('error',()=>{})
  return {socket,messages,async opened(){if(socket.readyState!==1)await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})},send(message){socket.send(JSON.stringify(message))},async wait(predicate){await until(()=>messages.some(predicate));return messages.find(predicate)}}
}
async function authenticated(f,ticket){const p=peer(f.url,{origin});await p.opened();p.send({type:'auth',sessionId:ticket.sessionId,token:ticket.token});await p.wait(m=>m.type==='ready');return p}

test('desktop session: trusted HTTP grants, no frames before first-message auth, random session-only credentials',async()=>{
  const f=await fixture();try{
    const denied=await f.post('/desktop/v1/session',{mode:'watch'},'x'.repeat(43));assert.equal(denied.response.status,401);assert.equal(f.natives.length,0)
    const ticket=await f.open();assert.match(ticket.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(ticket.token,f.granted.token);assert.equal(ticket.path,'/desktop/v1/socket');assert.equal(ticket.displays[0].x,-1280)
    const p=peer(f.url,{origin});await p.opened();f.natives[0].emit('frame',JPEG);await delay(30);assert.equal(p.messages.length,0);assert.equal(f.natives[0].frames,0)
    p.send({type:'auth',sessionId:ticket.sessionId,token:'x'.repeat(43)});await p.wait(m=>m.code==='AUTH_INVALID');assert.equal(f.natives[0].calls.length,0)
    const valid=await authenticated(f,ticket);const ready=valid.messages.find(m=>m.type==='ready');assert.equal(ready.mode,'watch');assert.equal(ready.coordinateSpace,'display-physical-pixels');assert.equal(ready.width,1280)
    await until(()=>f.natives[0].frames===1);f.natives[0].emit('frame',JPEG);await valid.wait(Buffer.isBuffer)
    assert.deepEqual(valid.messages.find(Buffer.isBuffer),JPEG);assert.ok(!JSON.stringify(valid.messages).includes(f.granted.token))
  }finally{await f.close()}
})
test('desktop session: watch input is refused; native takeover ACK precedes input and release preserves video',async()=>{
  const f=await fixture();try{
    const ticket=await f.open(),p=await authenticated(f,ticket),native=f.natives[0]
    p.send({type:'input',id:1,event:{type:'key',action:'down',code:'ControlLeft',key:'Control'}})
    assert.equal((await p.wait(m=>m.type==='input'&&m.id===1)).code,'CONTROL_NOT_GRANTED');assert.equal(native.calls.length,0)
    native.acquireGate=Promise.withResolvers();p.send({type:'control',action:'acquire'});p.send({type:'input',id:2,event:{type:'pointer',action:'down',x:8,y:9,button:'right'}})
    await until(()=>native.calls.length===1);await delay(30);assert.equal(native.calls.length,1);assert.ok(!p.messages.some(m=>m.type==='control'))
    native.acquireGate.resolve();assert.equal((await p.wait(m=>m.type==='control')).mode,'control');assert.equal((await p.wait(m=>m.type==='input'&&m.id===2)).ok,true);assert.equal(native.calls[1].x,8)
    p.send({type:'release-input',id:3});assert.equal((await p.wait(m=>m.type==='release-input')).ok,true);assert.equal(native.held.length,0)
    p.send({type:'control',action:'release'});await p.wait(m=>m.type==='control'&&m.mode==='watch');assert.equal(native.closed,0)
    native.emit('frame',JPEG);await p.wait(Buffer.isBuffer)
    p.socket.terminate();await until(()=>native.closed===1);assert.equal(native.held.length,0)
  }finally{await f.close()}
})
test('desktop session: read-only grant and rejected native takeover cannot inject input',async()=>{
  const f=await fixture();try{
    const readonly=f.issue({tools:['desktop_screenshot']}),ticket=await f.open({},readonly.token),p=await authenticated(f,ticket)
    p.send({type:'control',action:'acquire'});assert.equal((await p.wait(m=>m.type==='control')).code,'SCOPE_DENIED');assert.equal(f.natives[0].calls.length,0)
    const full=await f.open(),q=await authenticated(f,full),native=f.natives[1];native.acquireDenied=true;q.send({type:'control',action:'acquire'});assert.equal((await q.wait(m=>m.type==='control')).mode,'watch')
    q.send({type:'input',id:1,event:{type:'text',text:'never'}});assert.equal((await q.wait(m=>m.type==='input')).possiblyApplied,false);assert.ok(!native.calls.some(c=>c.t==='input'))
  }finally{await f.close()}
})
test('desktop session: Host/Origin/network boundary and exact ticket Origin on upgrade and auth',async()=>{
  const f=await fixture();try{
    const ticket=await f.open()
    for(const options of [{origin:'https://attacker.invalid'},{origin,headers:{host:'attacker.invalid'}}]){
      const socket=new WebSocket(f.url,options);socket.on('error',()=>{});const status=await new Promise(resolve=>socket.once('unexpected-response',(req,res)=>{res.resume();resolve(res.statusCode);socket.terminate()}));assert.equal(status,403)
    }
    const unrelated=peer(f.url,{origin:'https://globally-allowed.example'});await unrelated.opened();unrelated.send({type:'auth',sessionId:ticket.sessionId,token:ticket.token});assert.equal((await unrelated.wait(m=>m.type==='error')).code,'ORIGIN_DENIED')
    const node=peer(f.url);await node.opened();node.send({type:'auth',sessionId:ticket.sessionId,token:ticket.token});await node.wait(m=>m.type==='ready')
    const query=new WebSocket(f.url+'?token='+ticket.token);query.on('error',()=>{});assert.equal(await new Promise(resolve=>query.once('unexpected-response',(req,res)=>{res.resume();resolve(res.statusCode);query.terminate()})),404)
  }finally{await f.close()}
})
test('desktop session: same-owner renewal keeps socket/control alive past old grant expiry; revocation releases it',async()=>{
  const f=await fixture();try{
    const old=f.issue({expiresAt:Date.now()+450}),ticket=await f.open({},old.token),p=await authenticated(f,ticket),native=f.natives[0]
    p.send({type:'control',action:'acquire'});await p.wait(m=>m.type==='control'&&m.mode==='control')
    const wrong=f.issue({attemptId:'unrelated'}),denied=await f.post('/desktop/v1/session/renew',{sessionId:ticket.sessionId,origin},wrong.token);assert.equal(denied.response.status,403)
    const fresh=f.issue({expiresAt:Date.now()+5000}),renewed=await f.post('/desktop/v1/session/renew',{sessionId:ticket.sessionId,origin},fresh.token)
    assert.equal(renewed.response.status,200);assert.equal(renewed.value.sessionId,ticket.sessionId);assert.equal(renewed.value.token,ticket.token);assert.equal(renewed.value.mode,'control');assert.equal(native.expiresAt,fresh.c.expiresAt)
    await delay(500);assert.equal(p.socket.readyState,1);assert.equal(native.closed,0)
    p.send({type:'input',id:1,event:{type:'key',action:'down',code:'ShiftLeft',key:'Shift'}});assert.equal((await p.wait(m=>m.type==='input')).ok,true)
    f.grants.delete(fresh.token);await until(()=>native.closed===1);assert.equal(native.held.length,0);assert.equal(native.mode,'watch')
  }finally{await f.close()}
})
test('desktop session: expiry, client disconnect and confirmed HTTP stop tear down native input',async()=>{
  const f=await fixture();try{
    const expires=f.issue({expiresAt:Date.now()+180}),ticket=await f.open({},expires.token),p=await authenticated(f,ticket),native=f.natives[0]
    p.send({type:'control',action:'acquire'});await p.wait(m=>m.type==='control');p.send({type:'input',id:1,event:{type:'pointer',action:'down',x:1,y:2,button:'left'}});await p.wait(m=>m.type==='input')
    await until(()=>native.closed===1);assert.equal(native.held.length,0)
    const second=await f.open(),q=await authenticated(f,second),live=f.natives[1];live.closeGate=Promise.withResolvers();let resolved=false
    const pending=f.post('/desktop/v1/session/close',{sessionId:second.sessionId}).then(r=>{resolved=true;return r});await until(()=>live.closed===1);await delay(30);assert.equal(resolved,false)
    live.closeGate.resolve();assert.equal((await pending).value.stopConfirmed,true);await until(()=>q.socket.readyState===3)
    const third=await f.open();f.natives[2].stopConfirmed=false;assert.equal((await f.post('/desktop/v1/session/close',{sessionId:third.sessionId})).value.stopConfirmed,false)
  }finally{await f.close()}
})
test('desktop session: invalid/replayed/out-of-bounds input never reaches native; lost ACK is unknown without retry',async()=>{
  const f=await fixture();try{
    const ticket=await f.open(),p=await authenticated(f,ticket),native=f.natives[0];p.send({type:'control',action:'acquire'});await p.wait(m=>m.type==='control')
    p.send({type:'input',id:1,event:{type:'pointer',action:'down',x:1280,y:2,button:'left'}});assert.equal((await p.wait(m=>m.type==='input'&&m.id===1)).ok,false)
    p.send({type:'input',id:1,event:{type:'text',text:'duplicate'}});await p.wait(m=>m.type==='input'&&m.code==='DESKTOP_INPUT_REPLAY');assert.equal(native.calls.filter(c=>c.t==='input').length,0)
    native.unknownInput=true;p.send({type:'input',id:2,event:{type:'text',text:'unknown'}});const unknown=await p.wait(m=>m.type==='input'&&m.id===2);assert.equal(unknown.code,'OUTCOME_UNKNOWN');assert.equal(unknown.possiblyApplied,true);await until(()=>native.closed===1);assert.equal(native.calls.filter(c=>c.t==='input').length,1)
  }finally{await f.close()}
})
test('desktop session: backpressure drops frames and waits for browser pong beyond the last flushed JPEG',async()=>{
  const f=await fixture({maxBufferedAmount:32});try{
    const ticket=await f.open(),native=f.natives[0],socket=new EventEmitter();socket.readyState=1;socket.bufferedAmount=64;socket.sent=[];socket.callbacks=[]
    socket.send=(data,options,callback)=>{socket.sent.push(data);if(callback)socket.callbacks.push(callback)};socket.ping=data=>{if(data==='baseline')queueMicrotask(()=>socket.emit('pong',Buffer.from(data)));else socket.lastPing=data};socket.close=()=>{socket.readyState=3;socket.emit('close')};socket.terminate=socket.close
    f.sessions.accept(socket,origin);socket.emit('message',Buffer.from(JSON.stringify({type:'auth',sessionId:ticket.sessionId,token:ticket.token})),false);await until(()=>native.frames===1)
    native.emit('frame',JPEG);assert.equal(socket.sent.filter(Buffer.isBuffer).length,0);await until(()=>native.frames===2)
    socket.bufferedAmount=0;native.emit('frame',JPEG);assert.equal(socket.sent.filter(Buffer.isBuffer).length,1);await delay(20);assert.equal(native.frames,2)
    socket.callbacks.shift()();await until(()=>native.frames===3);native.emit('frame',JPEG);assert.equal(socket.sent.filter(Buffer.isBuffer).length,1);socket.emit('pong',Buffer.from(socket.lastPing));await until(()=>socket.sent.filter(Buffer.isBuffer).length===2);assert.ok(f.sessions.sessionAudit(f.granted.c,ticket.sessionId).some(e=>e.kind==='frame-drop'))
  }finally{await f.close()}
})
test('desktop session: slow receiver adapts encoded pixels while preserving physical input metadata',async()=>{
  const f=await fixture();try{
    const ticket=await f.open(),native=f.natives[0],socket=new EventEmitter();socket.readyState=1;socket.bufferedAmount=0;socket.sent=[]
    socket.send=(data,options,callback)=>{socket.sent.push(data);callback?.()};socket.ping=data=>{if(data==='baseline')queueMicrotask(()=>socket.emit('pong',Buffer.from(data)));else socket.lastPing=data};socket.close=()=>{socket.readyState=3;socket.emit('close')};socket.terminate=socket.close
    f.sessions.accept(socket,origin);socket.emit('message',Buffer.from(JSON.stringify({type:'auth',sessionId:ticket.sessionId,token:ticket.token})),false);await until(()=>native.frames===1)
    native.emit('frame',JPEG,{frameWidth:1280,frameHeight:720,quality:70});await until(()=>native.frames===2);native.emit('frame',JPEG);await delay(120);assert.equal(socket.sent.filter(Buffer.isBuffer).length,1);socket.emit('pong',Buffer.from(socket.lastPing));await until(()=>native.frames===3)
    assert.ok(native.calls.some(call=>call.t==='video'&&call.scalePercent<100));const metadata=socket.sent.filter(value=>typeof value==='string').map(JSON.parse).find(value=>value.type==='frame');assert.equal(metadata.width,1280);assert.equal(metadata.height,720)
  }finally{await f.close()}
})

test('desktop session: two small patches retain distinct pong credits without cancelling an already scheduled capture',async()=>{
  const f=await fixture();try{
    const ticket=await f.open(),native=f.natives[0],socket=new EventEmitter();socket.readyState=1;socket.bufferedAmount=0;socket.sent=[];socket.callbacks=[];socket.pings=[]
    socket.send=(data,options,callback)=>{socket.sent.push(data);if(callback)socket.callbacks.push(callback)}
    socket.ping=data=>{if(data==='baseline')queueMicrotask(()=>socket.emit('pong',Buffer.from(data)));else socket.pings.push(data)}
    socket.close=()=>{socket.readyState=3;socket.emit('close')};socket.terminate=socket.close
    f.sessions.accept(socket,origin);socket.emit('message',Buffer.from(JSON.stringify({type:'auth',sessionId:ticket.sessionId,token:ticket.token})),false);await until(()=>native.frames===1)
    const metadata={frameWidth:1280,frameHeight:720,region:{x:8,y:8,width:40,height:20},keyframe:false}
    native.emit('frame',JPEG,metadata);socket.callbacks.shift()();await until(()=>native.frames===2)
    native.emit('frame',JPEG,metadata);socket.callbacks.shift()();await until(()=>native.frames===3)
    native.emit('frame',JPEG,metadata)
    assert.equal(socket.sent.filter(Buffer.isBuffer).length,2,'only two patches may be in flight')
    assert.deepEqual(socket.pings,['frame:1','frame:2'])
    socket.emit('pong',Buffer.from('frame:1'))
    assert.equal(socket.sent.filter(Buffer.isBuffer).length,3)
    socket.callbacks.shift()()
    socket.emit('pong',Buffer.from('frame:2'))
    await until(()=>native.frames===4)
    assert.equal(socket.pings[2],'frame:3')
    const packets=socket.sent.filter(value=>typeof value==='string').map(JSON.parse).filter(value=>value.type==='frame')
    assert.deepEqual(packets[0].region,metadata.region);assert.equal(packets[0].width,1280)
  }finally{await f.close()}
})
test('desktop session: RemoteAgentClient uses trusted session/renew/close endpoints',async()=>{
  const f=await fixture();try{const client=new RemoteAgentClient(f.endpoint,'fixture',async()=>{throw new Error('Pair secret must not be needed')});const ticket=await client.desktopSession(f.granted.token,{mode:'watch',fps:15,origin});const next=f.issue();assert.equal((await client.renewDesktopSession(next.token,{sessionId:ticket.sessionId,origin})).sessionId,ticket.sessionId);assert.equal((await client.closeDesktopSession(next.token,{sessionId:ticket.sessionId})).stopConfirmed,true)}finally{await f.close()}
})
test('desktop session: lost control/release acknowledgements stay unknown and close the native session without retry',async()=>{
  const f=await fixture();try{
    for(const operation of ['control','release-input']){
      const ticket=await f.open(),p=await authenticated(f,ticket),native=f.natives.at(-1)
      if(operation==='control'){native.unknownControl=true;p.send({type:'control',action:'acquire',id:7})}else{native.unknownRelease=true;p.send({type:'release-input',id:7})}
      const result=await p.wait(m=>m.type===operation&&m.id===7);assert.equal(result.ok,false);assert.equal(result.code,'OUTCOME_UNKNOWN');assert.equal(result.possiblyApplied,true);await until(()=>native.closed===1);assert.equal(native.calls.filter(c=>c.t===operation).length,1)
    }
  }finally{await f.close()}
})
test('desktop session: unauthenticated socket times out and concurrent openings respect native capacity',async()=>{
  const gate=Promise.withResolvers();let started=0
  const f=await fixture({nativeFactory:async()=>{started++;await gate.promise;return new Native()}})
  try{
    const pending=Array.from({length:4},()=>f.sessions.open(f.granted.c,{mode:'watch'}));await until(()=>started===4)
    const limited=await f.post('/desktop/v1/session',{mode:'watch'});assert.equal(limited.response.status,429);assert.equal(limited.value.error.code,'DESKTOP_SESSION_LIMIT')
    gate.resolve();await Promise.all(pending)
    const p=peer(f.url);await p.opened();await until(()=>p.socket.readyState===3);assert.equal(p.messages.some(m=>m.type==='ready'),false)
  }finally{gate.resolve();await f.close()}
})

function packet(tag,value){const body=tag==='J'?Buffer.from(JSON.stringify(value)):value,head=Buffer.alloc(5);head.writeUInt32LE(body.length+1);head[4]=tag.charCodeAt();return Buffer.concat([head,body])}
async function nativePipeFixture(handler){
  await mkdir(resolve('tmp/integration/desktop-session-pipe'),{recursive:true});const dir=await mkdtemp(resolve('tmp/integration/desktop-session-pipe/case-')),config={pipeName:`dsh-desktop-${randomUUID()}`,secretFile:join(dir,'fixture-secret')};await writeFile(config.secretFile,'offline-fixture-secret-'.repeat(3))
  const connections=new Set(),calls=[],server=net.createServer(socket=>{connections.add(socket);let buffer=Buffer.alloc(0);socket.on('error',()=>{});socket.on('close',()=>connections.delete(socket));socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){const n=buffer.readUInt32LE(0),value=JSON.parse(buffer.subarray(5,n+4));buffer=buffer.subarray(n+4);calls.push(value);handler(socket,value)}})})
  await new Promise(resolve=>server.listen(`\\\\.\\pipe\\${config.pipeName}-stream`,resolve))
  return {config,calls,async close(){for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve))}}
}
test('desktop session/native pipe: fragmented metadata, JPEG framing and correlated native stop acknowledgement',{skip:process.platform!=='win32'},async()=>{
  const f=await nativePipeFixture((socket,value)=>{
    if(value.streamVersion){const bytes=packet('J',{t:'opened',ok:true,...new Native().metadata});socket.write(bytes.subarray(0,2));setImmediate(()=>socket.write(bytes.subarray(2)))}
    else if(value.t==='frame')socket.write(packet('F',JPEG))
    else if(value.t==='close')socket.end(Buffer.concat([packet('J',{t:'ended',stopConfirmed:true,code:'SESSION_CLOSED'}),packet('J',{t:'ack',id:value.id,ok:true,stopConfirmed:true})]))
    else socket.write(packet('J',{t:'ack',id:value.id,ok:true,mode:'control'}))
  })
  try{
    const pipe=await NativeDesktopPipe.open(f.config,{owner:'a'.repeat(64),expiresAt:Date.now()+60000,fps:15,controlAllowed:true});assert.equal(pipe.metadata.width,1280);assert.equal(f.calls[0].token,'offline-fixture-secret-'.repeat(3));assert.equal((await pipe.request({t:'control',action:'acquire'})).mode,'control')
    const frame=new Promise(resolve=>pipe.once('frame',resolve));pipe.frame();assert.deepEqual(await frame,JPEG);assert.equal((await pipe.close()).stopConfirmed,true)
    assert.equal(f.calls.filter(c=>c.t==='close').length,1)
  }finally{await f.close()}
})
test('desktop session/native pipe: disconnect after input dispatch is unknown and never retried',{skip:process.platform!=='win32'},async()=>{
  const f=await nativePipeFixture((socket,value)=>{if(value.streamVersion)socket.write(packet('J',{t:'opened',ok:true,...new Native().metadata}));else socket.destroy()})
  try{const pipe=await NativeDesktopPipe.open(f.config,{owner:'a'.repeat(64),expiresAt:Date.now()+60000,fps:15,controlAllowed:true});await assert.rejects(pipe.request({t:'input',kind:'text',text:'fixture'}),e=>e.code==='OUTCOME_UNKNOWN'&&e.possiblyApplied===true);assert.equal((await pipe.close()).stopConfirmed,false);assert.equal(f.calls.filter(c=>c.t==='input').length,1)}finally{await f.close()}
})
