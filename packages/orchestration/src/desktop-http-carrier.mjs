import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { desktopTicketMetadata, DESKTOP_PROXY_UPSTREAM_OPTIONS } from './desktop-proxy.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const hash=value=>createHash('sha256').update(value).digest()
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)
const id=value=>typeof value==='string'&&/^[-A-Za-z0-9_.]{1,128}$/.test(value)
const keys=(value,names)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!names.includes(key)))fail('INVALID_DESKTOP_REQUEST')}
const owner=peer=>peer?.principal?.kind==='owner'&&peer.signal&&!peer.signal.aborted

/** Native shells without a WebSocket carrier reuse owner-authenticated Fetch. A receipt acknowledges only delivered records. */
export function createDesktopHttpCarrier({now=Date.now}={}){
  const rows=new Map();let closing=false
  const wake=row=>{row.waiter?.();row.waiter=null}
  const stop=(row,code='DESKTOP_DISCONNECTED')=>{
    if(row.closed)return
    row.closed=true;row.code=code;row.secret=null;clearTimeout(row.connectTimer);row.socket?.terminate();row.controller.abort();row.ownerPeer.signal.removeEventListener('abort',row.abort);wake(row)
  }
  const validate=row=>{
    if(closing||row.closed||row.expiresAt<=now()||!owner(row.ownerPeer))fail('DESKTOP_SESSION_EXPIRED')
    const result=row.validate()
    if(result?.then){Promise.resolve(result).catch(()=>{});fail('DESKTOP_AUTHORITY_INVALID')}
    if(result===false)fail('MACHINE_BOT_DENIED')
  }
  const requireRow=(input,context)=>{
    if(context?.kind!=='owner'||!owner(context.peer))fail('REMOTE_OWNER_REQUIRED')
    const row=rows.get(input.sessionId)
    if(!row||row.ownerPeer!==context.peer||context.botId!==row.botId||context.clientOrigin!==row.origin||!token(input.token)||!timingSafeEqual(hash(input.token),row.digest))fail('DESKTOP_SESSION_DENIED')
    try{validate(row)}catch(error){stop(row,error.code);throw error}
    return row
  }
  const enqueue=(row,kind,data,binary=false)=>{
    if(row.closed)return
    try{validate(row)}catch(error){stop(row,error.code);return}
    const bytes=Buffer.from(data)
    if(bytes.length>9*1024*1024||kind==='message'&&!binary&&bytes.length>65536||row.bytes+bytes.length>12*1024*1024||row.queue.length>=64){stop(row,'DESKTOP_BACKPRESSURE');return}
    row.queue.push({sequence:++row.sequence,kind,data:bytes,binary});row.bytes+=bytes.length;wake(row)
  }
  const start=row=>{
    if(row.started)return
    row.started=true;const secret=row.secret;row.secret=null
    row.connectTimer=setTimeout(()=>stop(row,'DESKTOP_CONNECT_TIMEOUT'),5000);row.connectTimer.unref()
    Promise.resolve().then(()=>row.connect({signal:row.controller.signal,webSocketOptions:DESKTOP_PROXY_UPSTREAM_OPTIONS})).then(socket=>{
      socket.on('error',()=>stop(row,'DESKTOP_DISCONNECTED'))
      if(row.closed){socket.terminate();return}
      row.socket=socket
      if(![0,1].includes(socket.readyState)){stop(row);return}
      socket.on('message',(data,binary)=>enqueue(row,'message',data,binary))
      socket.on('ping',data=>enqueue(row,'ping',data))
      socket.once('close',()=>stop(row))
      const auth=()=>{try{validate(row);clearTimeout(row.connectTimer);socket.send(JSON.stringify({type:'auth',sessionId:row.sessionId,token:secret}))}catch{stop(row)}}
      if(socket.readyState===1)auth();else socket.once('open',auth)
    }).catch(()=>stop(row,'DESKTOP_CONNECTION_FAILED'))
  }
  const sweep=setInterval(()=>{
    for(const [key,row]of rows){if(row.closed){if(row.expiresAt<=now())rows.delete(key);continue}try{validate(row);if(row.started&&now()-row.lastPollAt>5000)stop(row,'DESKTOP_VIEWER_DISCONNECTED')}catch(error){stop(row,error.code)}}
  },250);sweep.unref()
  return Object.freeze({
    wrapTicket(ticket,{ownerPeer,clientOrigin,botId,connect,validate:check}={}){
      if(closing||!owner(ownerPeer)||!id(ticket?.sessionId)||!token(ticket.token)||!Number.isSafeInteger(ticket.expiresAt)||ticket.expiresAt<=now()||ticket.expiresAt>now()+300_000
        ||!id(botId)||typeof connect!=='function'||typeof check!=='function'||clientOrigin!=='dsh-app://app')fail('DESKTOP_CARRIER_UNAVAILABLE')
      let row=rows.get(ticket.sessionId)
      const sourceHash=hash(ticket.token)
      if(row){
        if(row.closed||row.ownerPeer!==ownerPeer||row.botId!==botId||row.origin!==clientOrigin||!timingSafeEqual(row.sourceHash,sourceHash))fail('DESKTOP_SESSION_DENIED')
        row.expiresAt=ticket.expiresAt;row.validate=check;row.connect=connect;validate(row)
      }else{
        for(const [key,value]of rows)if(value.expiresAt<=now()){stop(value);rows.delete(key)}
        if(rows.size>=32)fail('DESKTOP_SESSION_LIMIT')
        const proof=randomBytes(32).toString('base64url')
        row={sessionId:ticket.sessionId,expiresAt:ticket.expiresAt,ownerPeer,botId,origin:clientOrigin,token:proof,digest:hash(proof),sourceHash,
          secret:ticket.token,connect,validate:check,controller:new AbortController(),sequence:0,acknowledged:0,delivered:0,queue:[],bytes:0,requests:new Map(),lastInput:0,lastPollAt:now(),closed:false,polling:false}
        row.abort=()=>stop(row,'DESKTOP_OWNER_DISPOSED');validate(row);ownerPeer.signal.addEventListener('abort',row.abort,{once:true});rows.set(row.sessionId,row)
      }
      return Object.freeze({...desktopTicketMetadata(ticket),carrier:'owner-http',token:row.token})
    },
    async poll(input,context){
      keys(input,['sessionId','token','cursor'])
      const row=requireRow(input,context)
      if(!Number.isSafeInteger(input.cursor)||input.cursor<row.acknowledged||input.cursor>row.delivered)fail('DESKTOP_CURSOR_INVALID')
      if(row.polling)fail('DESKTOP_POLL_PENDING')
      row.polling=true;row.lastPollAt=now()
      try{
        while(row.queue.length&&row.queue[0].sequence<=input.cursor){
          const item=row.queue.shift();row.bytes-=item.data.length
          if(item.kind==='ping'&&row.socket?.readyState===1)row.socket.pong(item.data)
        }
        row.acknowledged=input.cursor;start(row)
        if(!row.queue.length&&!row.closed)await new Promise(resolve=>{
          const done=()=>{clearTimeout(timer);context.signal?.removeEventListener('abort',done);if(row.waiter===done)row.waiter=null;resolve()}
          const timer=setTimeout(done,1000);row.waiter=done;context.signal?.addEventListener('abort',done,{once:true});if(context.signal?.aborted)done()
        })
        context.signal?.throwIfAborted()
        if(row.closed)return {events:[],cursor:input.cursor,closed:true,code:row.code}
        validate(row)
        const events=row.queue.slice(0,12).map(item=>({sequence:item.sequence,kind:item.kind,binary:item.binary,data:item.data.toString('base64')}))
        const cursor=events.at(-1)?.sequence??input.cursor;row.delivered=Math.max(row.delivered,cursor)
        return {events,cursor,closed:false}
      }finally{row.polling=false;if(context.signal?.aborted)stop(row,'DESKTOP_VIEWER_DISCONNECTED')}
    },
    async send(input,context){
      keys(input,['sessionId','token','requestId','message'])
      const row=requireRow(input,context)
      const sequence=typeof input.requestId==='string'&&/^http-desktop-[1-9]\d{0,14}$/.test(input.requestId)?Number(input.requestId.slice('http-desktop-'.length)):NaN
      if(!Number.isSafeInteger(sequence)||typeof input.message!=='string'||Buffer.byteLength(input.message)>65536)fail('INVALID_DESKTOP_REQUEST')
      let message;try{message=JSON.parse(input.message)}catch{fail('INVALID_DESKTOP_REQUEST')}
      if(!message||!['control','input','release-input','close'].includes(message.type))fail('INVALID_DESKTOP_REQUEST')
      const digest=hash(input.message).toString('hex'),previous=row.requests.get(input.requestId)
      if(previous){if(previous!==digest)fail('DESKTOP_REQUEST_CONFLICT');return {accepted:true}}
      if(sequence!==row.lastInput+1)fail('DESKTOP_INPUT_REPLAY')
      if(row.socket?.readyState!==1)fail('DESKTOP_NOT_READY')
      row.lastInput=sequence;row.requests.set(input.requestId,digest)
      while(row.requests.size>256)row.requests.delete(row.requests.keys().next().value)
      try{await new Promise((resolve,reject)=>row.socket.send(input.message,error=>error?reject(error):resolve()));return {accepted:true}}
      catch{stop(row,'DESKTOP_INPUT_UNKNOWN');fail('DESKTOP_INPUT_UNKNOWN')}
    },
    revoke(sessionId){const row=rows.get(sessionId);if(row)stop(row,'DESKTOP_REVOKED')},
    close(){if(closing)return;closing=true;clearInterval(sweep);for(const row of rows.values())stop(row);rows.clear()},
  })
}
