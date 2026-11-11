import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket, { WebSocketServer } from 'ws'
import { createDesktopProxy, DESKTOP_PROXY_PATH } from '../packages/orchestration/src/desktop-proxy.mjs'

async function until(check){for(let i=0;i<300;i++){if(check())return;await delay(5)}assert.fail('fixture condition not reached')}
async function fixture(t){
  let route,valid=true,clock=Date.now(),unregistered=false,released=0,admitGate
  const lifetime=new AbortController(),botLife=new AbortController()
  const peer={principal:{kind:'owner'},signal:lifetime.signal}
  const bot={principal:{kind:'bot'},signal:botLife.signal}
  const admission=req=>req.headers.cookie==='fixture=owner'?{peer}:req.headers.cookie==='fixture=bot'?{peer:bot}:{rejection:401}
  const connection={admit:admission,admitConnection:async req=>{if(admitGate)await admitGate;const result=admission(req);return 'peer'in result?{...result,release:async()=>{released++}}:result}}
  const server=http.createServer((_req,res)=>{res.writeHead(404);res.end()})
  server.on('upgrade',(req,socket,head)=>{if(!route){socket.destroy();return};void route.handler(req,socket,head)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${server.address().port}`
  const upstreamServer=new WebSocketServer({port:0,host:'127.0.0.1',perMessageDeflate:false,autoPong:false})
  await once(upstreamServer,'listening')
  const sourceToken=randomBytes(32).toString('base64url'),upstreamUrl=`ws://127.0.0.1:${upstreamServer.address().port}`
  const upstreams=[],received=[],pongs=[]
  upstreamServer.on('connection',ws=>{upstreams.push(ws);ws.on('error',()=>{});ws.on('message',(data,binary)=>{
    received.push({data:Buffer.from(data),binary})
    if(!binary&&JSON.parse(data).type==='auth')ws.send(JSON.stringify({type:'ready',mode:'watch'}))
  });ws.on('pong',data=>pongs.push(data.toString()))})
  const proxy=createDesktopProxy({webServer:{protocol:'http:',registerUpgrade:value=>{route=value;return()=>{route=null;unregistered=true}}},connection,now:()=>clock})
  const clients=[]
  const ticket={sessionId:'desktop-fixture',token:sourceToken,websocketUrl:upstreamUrl,expiresAt:clock+60_000,mode:'watch',canControl:true,displays:[{id:'display-1',width:800,height:600}],endpoint:'private-sentinel'}
  const wrap=(input=ticket,extra={})=>proxy.wrapTicket(input,{ownerPeer:peer,clientOrigin:origin,validate:()=>valid,
    connect:({webSocketOptions})=>new WebSocket(upstreamUrl,webSocketOptions),...extra})
  const connect=(options={})=>{
    const ws=new WebSocket(`${origin.replace('http:','ws:')}${DESKTOP_PROXY_PATH}`,{origin,headers:{cookie:'fixture=owner'},...options})
    ws.on('error',()=>{});clients.push(ws)
    const messages=[];ws.on('message',(data,binary)=>messages.push(binary?Buffer.from(data):JSON.parse(data)))
    return {ws,messages,open:()=>once(ws,'open'),auth:value=>ws.send(JSON.stringify({type:'auth',sessionId:value.sessionId,token:value.token}))}
  }
  t.after(async()=>{for(const ws of clients)ws.terminate();await proxy.close();for(const ws of upstreams)ws.terminate();await new Promise(resolve=>upstreamServer.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  return {proxy,wrap,connect,sourceToken,ticket,peer,origin,upstreams,received,pongs,lifetime,
    revoke:()=>{valid=false},advance:()=>{clock+=70_000},state:()=>({unregistered,released}),gate:value=>{admitGate=value}}
}

test('proxy requires authenticated same-origin owner before upgrading; queries and Bot peers are refused',async t=>{
  const f=await fixture(t);f.wrap()
  for(const [options,status] of [[{headers:{}},401],[{headers:{cookie:'fixture=bot'}},403],[{origin:'https://outside.invalid'},403]]){
    const p=f.connect(options)
    assert.equal(await new Promise(resolve=>p.ws.once('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);p.ws.terminate()})),status)
  }
  assert.equal(f.upstreams.length,0)
})

test('proxy hides source credentials, authenticates exactly once, and forwards text, JPEG and receipt ping/pong without early ack',async t=>{
  const f=await fixture(t),ticket=f.wrap()
  assert.notEqual(ticket.token,f.sourceToken);assert.equal(ticket.websocketPath,DESKTOP_PROXY_PATH)
  assert.equal(JSON.stringify(ticket).includes(f.sourceToken),false);assert.equal(Object.hasOwn(ticket,'websocketUrl'),false);assert.equal(Object.hasOwn(ticket,'endpoint'),false)
  const p=f.connect({autoPong:false});await p.open();p.auth(ticket)
  await until(()=>p.messages.some(value=>value.type==='ready'))
  assert.equal(JSON.parse(f.received[0].data).token,f.sourceToken)
  p.ws.send(JSON.stringify({type:'input',id:1,event:{type:'text',text:'fixture'}}))
  await until(()=>f.received.length===2)
  assert.equal(JSON.parse(f.received[1].data).event.text,'fixture')
  const jpeg=Buffer.from([255,216,1,2,3,255,217])
  f.upstreams[0].send(JSON.stringify({type:'frame',sequence:1}));f.upstreams[0].send(jpeg,{binary:true})
  const receipt=once(p.ws,'ping');f.upstreams[0].ping('frame:1');await receipt
  await until(()=>p.messages.some(Buffer.isBuffer));assert.deepEqual(p.messages.find(Buffer.isBuffer),jpeg)
  await delay(20);assert.deepEqual(f.pongs,[])
  p.ws.pong('frame:1');await until(()=>f.pongs.length===1);assert.deepEqual(f.pongs,['frame:1'])
  const replay=f.connect();await replay.open();replay.auth(ticket);await until(()=>replay.messages.some(value=>value.code==='DESKTOP_PROXY_AUTH_INVALID'))
  assert.equal(f.upstreams.length,1)
  const renewed=f.wrap({...f.ticket,expiresAt:Date.now()+100_000});assert.equal(renewed.token,ticket.token);assert.equal(p.ws.readyState,1)
  f.revoke();await until(()=>p.ws.readyState!==1);await until(()=>f.upstreams[0].readyState===3)
})

test('proxy expires or revokes a ticket on owner disposal and never revives a consumed disconnected session',async t=>{
  const f=await fixture(t),ticket=f.wrap(),p=f.connect();await p.open();p.auth(ticket)
  await until(()=>p.messages.some(value=>value.type==='ready'))
  f.lifetime.abort();await until(()=>p.ws.readyState!==1)
  assert.throws(()=>f.wrap(),/DESKTOP_PROXY_TICKET_INVALID/)
  assert.ok(f.state().released>=1)
})

test('proxy rejects oversized text, async authority checks and resurrection of revoked sessions',async t=>{
  const f=await fixture(t)
  const ticket=f.wrap()
  f.proxy.revoke(ticket.sessionId)
  assert.throws(()=>f.wrap(),/DESKTOP_PROXY_TICKET_INVALID/)
  assert.throws(()=>f.wrap({...f.ticket,sessionId:'different'},{validate:async()=>true}),/DESKTOP_PROXY_AUTHORITY_INVALID/)
  const fresh=f.wrap({...f.ticket,sessionId:'bounded-session'})
  const p=f.connect();await p.open();p.auth(fresh)
  await until(()=>f.upstreams.length===1)
  await until(()=>p.messages.some(value=>value.type==='ready'))
  f.upstreams[0].send('x'.repeat(65537))
  await until(()=>p.messages.some(value=>value.code==='DESKTOP_PROXY_MESSAGE_LIMIT'))
  assert.equal(p.messages.some(value=>JSON.stringify(value).includes(f.sourceToken)),false)
})

test('proxy bounds input queued during upstream connection and never forwards an overflowed session',async t=>{
  const f=await fixture(t),gate=Promise.withResolvers()
  const ticket=f.wrap(undefined,{connect:()=>gate.promise})
  const p=f.connect();await p.open();p.auth(ticket)
  for(let i=0;i<70;i++)p.ws.send(JSON.stringify({type:'input',id:i+1,event:{type:'text',text:'fixture'}}))
  await until(()=>p.messages.some(value=>value.code==='DESKTOP_PROXY_BACKPRESSURE'))
  let terminated=false
  const late={readyState:0,on(){return late},terminate(){terminated=true}}
  gate.resolve(late);await until(()=>terminated)
  assert.equal(f.upstreams.length,0)
})

test('asynchronous admission that settles after disconnect is released and proxy close unregisters the route',async t=>{
  const f=await fixture(t),gate=Promise.withResolvers();f.gate(gate.promise)
  const p=f.connect();await delay(20);p.ws.terminate();gate.resolve()
  await until(()=>f.state().released===1)
  await f.proxy.close();assert.equal(f.state().unregistered,true)
})
