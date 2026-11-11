import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createDesktopHttpCarrier } from '../packages/orchestration/src/desktop-http-carrier.mjs'

class Socket extends EventEmitter{
  readyState=1;sent=[];pongs=[];closed=false
  send(value,done){this.sent.push(value);done?.()}
  pong(value){this.pongs.push(value.toString())}
  terminate(){this.closed=true;this.readyState=3;this.emit('close')}
}
async function fixture(t){
  const carrier=createDesktopHttpCarrier(),socket=new Socket(),life=new AbortController(),peer={principal:{kind:'owner'},signal:life.signal}
  const context={kind:'owner',peer,botId:'bot-a',clientOrigin:'dsh-app://app'}
  const ticket=carrier.wrapTicket({sessionId:'desktop-a',token:'s'.repeat(43),expiresAt:Date.now()+60000},
    {ownerPeer:peer,botId:'bot-a',clientOrigin:context.clientOrigin,validate:()=>true,connect:()=>socket})
  const input={sessionId:ticket.sessionId,token:ticket.token,cursor:0}
  t.after(()=>carrier.close())
  return {carrier,socket,ticket,context,input,life}
}

test('native carrier retains lost-response records and sends a frame receipt only after the owner acknowledges its cursor',async t=>{
  const f=await fixture(t),poll=f.carrier.poll(f.input,f.context)
  await delay(0);f.socket.emit('message',Buffer.from('{"type":"ready"}'),false)
  const first=await poll;assert.equal(first.cursor,1);assert.equal(JSON.parse(f.socket.sent[0]).token,'s'.repeat(43))
  assert.equal(JSON.stringify(f.ticket).includes('s'.repeat(43)),false)
  const replay=await f.carrier.poll(f.input,f.context);assert.deepEqual(replay,first)
  f.socket.emit('message',Buffer.from([255,216,255,217]),true);f.socket.emit('ping',Buffer.from('frame:1'))
  const frame=await f.carrier.poll({...f.input,cursor:1},f.context)
  assert.deepEqual(frame.events.map(event=>event.kind),['message','ping']);assert.deepEqual(f.socket.pongs,[])
  const follow=f.carrier.poll({...f.input,cursor:frame.cursor},f.context);await delay(0)
  assert.deepEqual(f.socket.pongs,['frame:1'])
  f.socket.emit('message',Buffer.from('{"type":"input","id":1,"ok":true}'),false);await follow
  await assert.rejects(f.carrier.poll({...f.input,cursor:999},f.context),/DESKTOP_CURSOR_INVALID/)
})

test('native carrier checks owner, exact Bot and origin; deduplicates a sent request and closes on payload pressure',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.carrier.poll(f.input,{...f.context,kind:'bot'}),/REMOTE_OWNER_REQUIRED/)
  await assert.rejects(f.carrier.poll(f.input,{...f.context,botId:'bot-other'}),/DESKTOP_SESSION_DENIED/)
  await assert.rejects(f.carrier.poll(f.input,{...f.context,clientOrigin:'https://outside.invalid'}),/DESKTOP_SESSION_DENIED/)
  const pending=f.carrier.poll(f.input,f.context);await delay(0);f.socket.emit('message',Buffer.from('{}'),false);await pending
  const send={sessionId:f.ticket.sessionId,token:f.ticket.token,requestId:'http-desktop-1',message:JSON.stringify({type:'input',id:1,event:{type:'text',text:'one write'}})}
  await f.carrier.send(send,f.context);await f.carrier.send(send,f.context)
  assert.equal(f.socket.sent.length,2)
  await assert.rejects(f.carrier.send({...send,message:'{"type":"close"}'},f.context),/DESKTOP_REQUEST_CONFLICT/)
  for(let i=0;i<70;i++)f.socket.emit('message',Buffer.from('{}'),false)
  assert.equal(f.socket.closed,true)
  await assert.rejects(f.carrier.poll(f.input,f.context),/DESKTOP_SESSION_EXPIRED/)
})
