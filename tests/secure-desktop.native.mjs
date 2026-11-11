import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import http from 'node:http'
import { EventEmitter, once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { Store, DesktopSessions, serve } from '../remote-computer-agent/dist/index.mjs'
import { openRemoteMachines } from '../packages/orchestration/src/remote-machines.mjs'
import { createDesktopProxy } from '../packages/orchestration/src/desktop-proxy.mjs'
import { createDesktopHttpCarrier } from '../packages/orchestration/src/desktop-http-carrier.mjs'
import { connectDesktopStream } from '../apps/integration-client/desktop-stream.mjs'
import { createBotRoutineStore } from '../packages/orchestration/src/bot-routine-store.mjs'
import { createRoutineExecutionService } from '../packages/orchestration/src/routine-execution.mjs'
import { connectSecureTransport } from '../modules/openmaus-protocol/transport.mjs'

const inputTools=['desktop_click','desktop_key','desktop_type','desktop_scroll']
const tools=['machine_ping','desktop_screenshot',...inputTools]
const JPEG=Buffer.from([255,216,1,2,3,255,217])
async function until(check){for(let i=0;i<400;i++){if(check())return;await delay(5)}assert.fail('condition not reached')}
class Native extends EventEmitter{
  metadata={streamVersion:1,width:1280,height:720,displayId:'screen',displays:[{id:'screen',width:1280,height:720}],coordinateSpace:'display-physical-pixels',captureBackend:'fixture'}
  calls=[];frames=0;closed=0;held=new Set();textHeld=[]
  async request(value){this.calls.push(value);if(value.t==='release-input')this.held.clear();if(value.t==='input'&&value.kind==='key'){if(value.action==='down')this.held.add(value.code);else this.held.delete(value.code)}if(value.t==='input'&&value.kind==='text')this.textHeld.push([...this.held]);return {ok:true,mode:value.action==='acquire'?'control':'watch'}}
  frame(){this.frames++}
  async close(){if(!this.closed++){this.emit('ended',{code:'SESSION_CLOSED',stopConfirmed:true})};return {stopConfirmed:true}}
}
async function fixture(t){
  const parent=resolve('tmp/integration/secure-desktop');await mkdir(parent,{recursive:true})
  const directory=await mkdtemp(join(parent,'case-')),store=new Store(join(directory,'agent'),Database,{admin:true}),natives=[]
  const desktop=new DesktopSessions({pipeName:'offline',secretFile:'offline'},store,{sweepMs:10,nativeFactory:async()=>{const native=new Native();natives.push(native);return native}})
  const agent={store,desktopSessions:desktop,call:async()=>({machineId:store.machineId,agentApiMajor:1,agentVersion:'fixture',os:{platform:'fixture'},capabilities:[],desktop:{status:'available'}})}
  const remote=await serve(agent,{mode:'e2e',port:0}),endpoint=`http://127.0.0.1:${remote.address.port}`
  const credential=store.pair('host-a',{botIds:['bot-a'],roots:['project'],tools})
  let route,allowed=true
  const ownerLife=new AbortController(),peer={principal:{kind:'owner'},signal:ownerLife.signal}
  const admission=request=>request.headers.cookie==='fixture=owner'?{peer}:{rejection:401}
  const web=http.createServer((_req,res)=>res.end());web.on('upgrade',(req,socket,head)=>{if(route)void route.handler(req,socket,head);else socket.destroy()})
  await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${web.address().port}`
  const proxy=createDesktopProxy({webServer:{protocol:'http:',registerUpgrade:row=>{route=row;return()=>{route=null}}},connection:{admit:admission,admitConnection:request=>{const result=admission(request);return 'peer'in result?{...result,release:async()=>{}}:result}}})
  const nativeCarrier=createDesktopHttpCarrier()
  const authority={describe:subject=>({botId:subject}),assertTool:()=>{if(!allowed)throw new Error('BOT_PERMISSION_REVOKED')}}
  const machines=openRemoteMachines({Database,file:join(directory,'host.sqlite'),resolveSecret:async()=>credential.token,botExists:id=>id==='bot-a',authority,desktopProxy:proxy,desktopHttp:nativeCarrier})
  const owner={kind:'owner',peer,clientOrigin:origin}
  await machines.pair({machineId:store.machineId,clientId:'host-a',name:'Fixture computer',endpoint,transport:store.pairing.identity(),secretRef:'ds-secret/REMOTE_AGENT_FIXTURE',roots:['project'],tools,probeBotId:'bot-a',expectedRevision:0},owner)
  assert.equal((await machines.bind({machineId:store.machineId,botId:'bot-a',roots:['project'],tools,mode:'workspace-write',expectedRevision:0},owner)).remoteRevoked,true)
  t.after(async()=>{await machines.closeDesktopSessions();await proxy.close();nativeCarrier.close();machines.close();await remote.close();store.close();web.closeAllConnections();await new Promise(resolve=>web.close(resolve))})
  return {machines,store,natives,owner,origin,peer,nativeCarrier,directory,endpoint,revoke:()=>{allowed=false}}
}

test('web viewer crosses owner proxy and Noise channel, retains physical input identity and releases on committed Bot revocation',async t=>{
  const f=await fixture(t)
  const ticket=await f.machines.desktopSession('bot-a',{machineId:f.store.machineId,rootId:'project',mode:'watch'},f.owner)
  assert.equal(ticket.websocketPath,'/bot-product/desktop/v1/socket');assert.equal(Object.hasOwn(ticket,'websocketUrl'),false)
  const ws=new WebSocket(f.origin.replace('http:','ws:')+ticket.websocketPath,{origin:f.origin,headers:{cookie:'fixture=owner'}});t.after(()=>ws.terminate())
  const messages=[];ws.on('message',(data,binary)=>messages.push(binary?Buffer.from(data):JSON.parse(data)));await once(ws,'open')
  ws.send(JSON.stringify({type:'auth',sessionId:ticket.sessionId,token:ticket.token}));await until(()=>messages.some(value=>value.type==='ready'))
  await until(()=>f.natives[0].frames===1);f.natives[0].emit('frame',JPEG);await until(()=>messages.some(Buffer.isBuffer));assert.deepEqual(messages.find(Buffer.isBuffer),JPEG)
  ws.send(JSON.stringify({type:'control',action:'acquire'}));await until(()=>messages.some(value=>value.type==='control'&&value.mode==='control'))
  ws.send(JSON.stringify({type:'input',id:1,event:{type:'pointer',action:'down',button:'left',x:1279,y:719}}));await until(()=>messages.some(value=>value.type==='input'&&value.id===1))
  assert.equal(f.natives[0].calls.find(value=>value.t==='input').x,1279)
  const grants=f.store.db.prepare('SELECT context FROM grants').all().map(value=>JSON.parse(value.context))
  assert.equal(grants.some(value=>value.botId==='bot-a'&&value.taskId===ticket.taskId&&value.attemptId===ticket.attemptId),true)
  f.revoke();await until(()=>ws.readyState!==1);await until(()=>f.natives[0].closed>0)
  assert.equal((await f.machines.closeDesktopSession('bot-a',{sessionId:ticket.sessionId},f.owner)).stopConfirmed,true,'cleanup remains possible after action authority is removed')
})

test('native shell streams through its authenticated Fetch bridge with real Noise, bounded receipts and no device credentials',async t=>{
  const f=await fixture(t),context={...f.owner,clientOrigin:'dsh-app://app',botId:'bot-a'}
  const ticket=await f.machines.desktopSession('bot-a',{machineId:f.store.machineId,rootId:'project',mode:'watch'},context)
  assert.equal(ticket.carrier,'owner-http');assert.equal(Object.hasOwn(ticket,'websocketUrl'),false)
  const states=[],frames=[],acks=[],calls=[]
  const transport=async(action,payload,signal)=>{
    const {botId,...input}=payload;calls.push({action,botId})
    return action==='machine.desktop.poll'?f.nativeCarrier.poll(input,{...context,botId,signal}):f.nativeCarrier.send(input,{...context,botId,signal})
  }
  const stream=connectDesktopStream({ticket,botId:'bot-a',transport,onState:value=>states.push(value),onFrame:value=>frames.push(Buffer.from(value)),onInputAcknowledged:(event,meta)=>acks.push({event,meta})})
  t.after(()=>stream.close())
  await until(()=>states.some(value=>value.status==='connected'))
  await until(()=>f.natives[0].frames===1);f.natives[0].emit('frame',JPEG);await until(()=>frames.length===1);assert.deepEqual(frames[0],JPEG)
  stream.setMode('control');await until(()=>states.some(value=>value.mode==='control'))
  assert.equal(stream.input({type:'key',action:'down',code:'KeyA',key:'a'}),true)
  await until(()=>acks.length===1);assert.equal(acks[0].meta.sessionId,ticket.sessionId)
  const renewed=await f.machines.renewDesktopSession('bot-a',{sessionId:ticket.sessionId},context)
  assert.equal(renewed.token,ticket.token);assert.equal(renewed.carrier,'owner-http')
  assert.equal((await stream.releaseInput()).ok,true)
  assert.equal(calls.every(call=>call.botId==='bot-a'),true)
  await assert.rejects(f.nativeCarrier.poll({sessionId:ticket.sessionId,token:ticket.token,cursor:0},{...context,botId:'bot-forged'}),/DESKTOP_SESSION_DENIED/)
  f.revoke();await until(()=>states.some(value=>value.status==='error'||value.status==='disconnected'))
  await until(()=>f.natives[0].closed>0)
})

test('Host routine uses a private Noise socket with its original identity and preserves an explicit modifier release before text',async t=>{
  const f=await fixture(t),store=createBotRoutineStore({dir:join(f.directory,'routines')})
  const saved=store.save('bot-a',{name:'release then type',steps:[
    {action:'input',event:{type:'key',action:'down',code:'ControlLeft',key:'Control'},delayMs:0},
    {action:'release-input',delayMs:0},
    {action:'input',event:{type:'text',text:'confirmed text'},delayMs:0},
  ]})
  const service=createRoutineExecutionService({machines:f.machines,store,botIdForSubject:id=>id,ackTimeoutMs:1000})
  t.after(()=>service.close())
  const result=await service.run({subject:'bot-a',botId:'bot-a',routineId:saved.id,machineId:f.store.machineId,rootId:'project',context:{kind:'bot'}})
  assert.equal(result.status,'succeeded');assert.equal(result.cleanup.stopConfirmed,true);assert.deepEqual(result.steps,[0,1,2])
  assert.deepEqual(f.natives[0].textHeld,[[]])
  const grants=f.store.db.prepare('SELECT context FROM grants').all().map(row=>JSON.parse(row.context))
  assert.equal(grants.some(row=>row.botId==='bot-a'&&row.taskId===result.taskId&&row.attemptId===result.attemptId),true)
})

test('an owner viewer cannot renew or close a private routine session without its exact Task attempt identity',async t=>{
  const f=await fixture(t),identity={taskId:'task-routine-private',attemptId:'attempt-private'}
  const ticket=await f.machines.routineDesktopSession('bot-a',{machineId:f.store.machineId,rootId:'project',mode:'watch'},{kind:'bot',...identity})
  assert.equal(typeof ticket.openWebSocket,'function');assert.equal(ticket.websocketUrl,undefined)
  await assert.rejects(f.machines.renewDesktopSession('bot-a',{sessionId:ticket.sessionId},f.owner),/DESKTOP_SESSION_OWNER_MISMATCH/)
  await assert.rejects(f.machines.closeDesktopSession('bot-a',{sessionId:ticket.sessionId},f.owner),/DESKTOP_SESSION_OWNER_MISMATCH/)
  assert.equal((await f.machines.closeDesktopSession('bot-a',{sessionId:ticket.sessionId},{kind:'bot',...identity})).stopConfirmed,true)
})

test('control-plane cleanup is limited to the authenticated client and original Bot/Task/attempt, including after grant revocation',async t=>{
  const f=await fixture(t),ticket=await f.machines.desktopSession('bot-a',{machineId:f.store.machineId,rootId:'project',mode:'watch'},f.owner)
  const other=f.store.pair('host-b',{botIds:['bot-a'],roots:['project'],tools})
  const channel=await connectSecureTransport({endpoint:f.endpoint,transport:f.store.pairing.identity(),token:other.token});t.after(()=>channel.close())
  const input={sessionId:ticket.sessionId,botId:'bot-a',taskId:ticket.taskId,attemptId:ticket.attemptId}
  const response=await channel.fetch('/control/v1/desktop/close',{headers:{'content-type':'application/json',authorization:`Bearer ${other.token}`},body:JSON.stringify(input)})
  assert.equal(response.status,403);assert.equal(f.natives[0].closed,0)
  const binding=f.machines.readModel().items[0].bindings[0]
  assert.equal((await f.machines.revoke({machineId:f.store.machineId,botId:'bot-a',expectedRevision:binding.revision},f.owner)).remoteRevoked,true)
  assert.equal((await f.machines.closeDesktopSession('bot-a',{sessionId:ticket.sessionId},f.owner)).stopConfirmed,true)
})
