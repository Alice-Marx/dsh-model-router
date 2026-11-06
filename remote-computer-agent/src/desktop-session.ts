import net from 'node:net'
import {readFile} from 'node:fs/promises'
import {EventEmitter} from 'node:events'
import {randomUUID} from 'node:crypto'
import type {WebSocket} from 'ws'
import {AgentError,canonical,fail,integer,matches,secret,sha,type Context} from './protocol.js'

type Config={pipeName:string;secretFile:string}
type Ack={ok:boolean;code?:string;possiblyApplied?:boolean;stopConfirmed?:boolean;mode?:'watch'|'control';expiresAt?:number}
export interface NativeDesktopSession extends EventEmitter {
  metadata:any
  request(message:any):Promise<Ack>
  frame(keyframe?:boolean):void
  close():Promise<{stopConfirmed:boolean}>
}
type Authority={validate:(context:Context)=>void;audit?:(code:string,actor?:string|null,operation?:string|null)=>void}
export type DesktopSessionOptions={nativeFactory?:(config:Config,request:any)=>Promise<NativeDesktopSession>;authTimeoutMs?:number;maxBufferedAmount?:number;sweepMs?:number}
const inputTools=['desktop_click','desktop_type','desktop_key','desktop_scroll']
const unknown=()=>Object.assign(new AgentError('OUTCOME_UNKNOWN',409),{possiblyApplied:true,stopConfirmed:false})
// Native Harness has a standard Electron origin that Node's URL serializes as
// "null". Permit this exact origin only when bound to an authenticated ticket;
// it is not added to the Agent's global HTTP Origin allowlist.
const safeOrigin=(value:any)=>{if(value==='dsh-app://app')return value;if(typeof value!=='string')fail('INVALID_ORIGIN');try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.origin!==value)fail('INVALID_ORIGIN');return value}catch{fail('INVALID_ORIGIN')}}
const ownerIdentity=(c:Context)=>canonical({client:c.clientId,bot:c.botId,task:c.taskId,attempt:c.attemptId,revision:c.revision,roots:[...c.roots].sort()})

/** Private native pipe; no helper token or Host grant is sent to the renderer. */
export class NativeDesktopPipe extends EventEmitter implements NativeDesktopSession {
  metadata:any;private frameMetadata:any;private socket:net.Socket;private buffer=Buffer.alloc(0);private nextId=0;private ended=false;private stopConfirmed=false
  private pending=new Map<number,{resolve:(v:Ack)=>void;reject:(e:any)=>void;timer:ReturnType<typeof setTimeout>}>()
  private opening=Promise.withResolvers<any>();private openTimer:ReturnType<typeof setTimeout>;private stopping?:Promise<{stopConfirmed:boolean}>
  private constructor(config:Config,request:any,token:string){
    super();this.socket=net.createConnection(`\\\\.\\pipe\\${config.pipeName}-stream`)
    this.openTimer=setTimeout(()=>this.finish(new AgentError('DESKTOP_UNAVAILABLE',503)),5000)
    this.socket.once('connect',()=>this.write({...request,streamVersion:1,token}))
    this.socket.on('data',chunk=>{try{this.receive(chunk)}catch{this.finish(unknown())}})
    this.socket.once('error',()=>this.finish(new AgentError(this.metadata?'OUTCOME_UNKNOWN':'DESKTOP_UNAVAILABLE',503)))
    this.socket.once('close',()=>this.finish(unknown()))
  }
  static async open(config:Config,request:any){
    if(process.platform!=='win32'||!/^dsh-desktop-[-a-zA-Z0-9]{1,64}$/.test(config.pipeName))fail('DESKTOP_UNAVAILABLE',503)
    const token=(await readFile(config.secretFile,'utf8')).trim(),pipe=new NativeDesktopPipe(config,request,token)
    await pipe.opening.promise;return pipe
  }
  private write(value:any){if(this.ended)throw unknown();const body=Buffer.from(JSON.stringify(value));if(body.length>65535)fail('INPUT_LIMIT');const packet=Buffer.allocUnsafe(body.length+5);packet.writeUInt32LE(body.length+1);packet[4]=74;body.copy(packet,5);this.socket.write(packet)}
  private receive(chunk:Buffer){
    this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>8388613+65536)throw unknown()
    while(this.buffer.length>=4){
      const length=this.buffer.readUInt32LE(0);if(length<1||length>8388609)throw unknown();if(this.buffer.length<length+4)return
      const tag=this.buffer[4],body=this.buffer.subarray(5,length+4);this.buffer=this.buffer.subarray(length+4)
      if(tag===70){if(!this.metadata)throw unknown();this.emit('frame',body,this.frameMetadata);continue}
      if(tag!==74||body.length>65536)throw unknown();const value=JSON.parse(body.toString('utf8'))
      if(value.t==='opened'){
        if(this.metadata)throw unknown();if(value.ok!==true){this.finish(new AgentError(value.code??'DESKTOP_UNAVAILABLE',503));return}
        if(value.streamVersion!==1||!Number.isSafeInteger(value.width)||value.width<1||!Number.isSafeInteger(value.height)||value.height<1||!Array.isArray(value.displays)||typeof value.displayId!=='string')throw unknown()
        this.metadata=value;clearTimeout(this.openTimer);this.opening.resolve(value)
      }else if(value.t==='frame-meta'){this.frameMetadata=value}
      else if(value.t==='ack'){
        const pending=this.pending.get(value.id);if(!pending)continue;clearTimeout(pending.timer);this.pending.delete(value.id);pending.resolve(value)
      }else if(value.t==='ended'){this.stopConfirmed=value.stopConfirmed===true;this.emit('ended',{code:value.code??'DESKTOP_STOPPED',stopConfirmed:this.stopConfirmed})}
      else throw unknown()
    }
  }
  private finish(error:any){
    if(this.ended)return;this.ended=true;clearTimeout(this.openTimer);this.socket.destroy();this.buffer=Buffer.alloc(0);this.opening.reject(error)
    for(const row of this.pending.values()){clearTimeout(row.timer);row.reject(unknown())}this.pending.clear();this.emit('ended',{code:error?.code??'DESKTOP_DISCONNECTED',stopConfirmed:this.stopConfirmed})
  }
  request(message:any):Promise<Ack>{
    if(this.ended)return Promise.reject(unknown());if(this.pending.size>=64)return Promise.reject(new AgentError('DESKTOP_INPUT_LIMIT',429))
    const id=++this.nextId
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(unknown());this.finish(unknown())},6500);this.pending.set(id,{resolve,reject,timer});try{this.write({...message,id})}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e)}})
  }
  frame(keyframe=false){try{this.write({t:'frame',...(keyframe?{keyframe:true}:{})})}catch{this.finish(unknown())}}
  close(){
    if(!this.stopping)this.stopping=(async()=>{if(this.ended)return {stopConfirmed:this.stopConfirmed};try{const ack=await this.request({t:'close'});this.stopConfirmed=ack.ok===true&&ack.stopConfirmed===true;return {stopConfirmed:this.stopConfirmed}}catch{return {stopConfirmed:this.stopConfirmed}}finally{this.finish(unknown())}})()
    return this.stopping
  }
}

type Session={id:string;token:string;digest:string;context:Context;origin?:string;native:NativeDesktopSession;mode:'watch'|'control';requestedControl:boolean;controlAllowed:boolean;socket?:WebSocket;used:boolean;closed:boolean;stopped:boolean;closedAt?:number;stop?:Promise<{stopConfirmed:boolean}>;queue:Promise<any>;queued:number;renewing:boolean;frameTimer?:ReturnType<typeof setTimeout>;ackTimer?:ReturnType<typeof setTimeout>;sending:boolean;lastInputId:number;events:any[];fps:number;profile:number;appliedProfile:number;fastFrames:number;baselineRtt:number;pingTag?:string;pingStarted:number;frameSequence:number;frameRequested:boolean;pendingFrame?:{jpeg:Buffer;metadata:any}}
const videoProfiles=[{scalePercent:100,quality:70},{scalePercent:75,quality:60},{scalePercent:60,quality:50},{scalePercent:50,quality:45},{scalePercent:40,quality:35},{scalePercent:35,quality:30}]

/** Process-lifetime, grant-bound capabilities. This object has no model tool route. */
export class DesktopSessions {
  private forceKeyframes=new Set<Session>()
  private flights=new WeakMap<Session,Map<string,{started:number;keyframe:boolean}>>()
  private sessions=new Map<string,Session>();private nonce=randomUUID();private closing=false;private timer:ReturnType<typeof setInterval>;private sockets=new Set<WebSocket>();private opening=0
  constructor(private config:Config|undefined,private authority:Authority,private options:DesktopSessionOptions={}){this.timer=setInterval(()=>void this.sweep(),options.sweepMs??100);this.timer.unref()}
  private check(c:Context){if(this.closing)fail('DESKTOP_HOST_STOPPED',503);this.authority.validate(c);if(!c.tools.includes('desktop_screenshot'))fail('SCOPE_DENIED',403);if(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=Date.now())fail('GRANT_REVOKED',403)}
  private audit(row:Session,kind:string,extra:any={}){row.events.push({at:Date.now(),kind,sessionId:row.id,taskId:row.context.taskId,attemptId:row.context.attemptId,...extra});if(row.events.length>128)row.events.shift();if(!['input','frame-drop'].includes(kind))this.authority.audit?.(`DESKTOP_SESSION_${kind.toUpperCase().replaceAll('-','_')}`,row.context.botId,`${row.context.taskId}/${row.context.attemptId}/${row.id}`)}
  private ticket(row:Session){return {sessionId:row.id,token:row.token,expiresAt:row.context.expiresAt,path:'/desktop/v1/socket',displayId:row.native.metadata.displayId,displays:row.native.metadata.displays,width:row.native.metadata.width,height:row.native.metadata.height,mode:row.mode,controlAllowed:row.controlAllowed}}
  private own(c:Context,id:any){this.check(c);const row=this.sessions.get(id);if(!row)fail('DESKTOP_SESSION_NOT_FOUND',404);if(ownerIdentity(c)!==ownerIdentity(row.context))fail('SCOPE_DENIED',403);return row}
  async open(c:Context,request:any){
    this.check(c);if(!this.config)fail('DESKTOP_UNAVAILABLE',503)
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['mode','fps','displayId','origin'].includes(k)))fail('INVALID_ARGUMENT')
    const mode=request.mode??'watch';if(!['watch','control'].includes(mode))fail('INVALID_ARGUMENT');const fps=integer(request.fps,1,30,15)
    if(request.displayId!==undefined&&(typeof request.displayId!=='string'||request.displayId.length>128))fail('INVALID_ARGUMENT')
    const origin=request.origin===undefined?undefined:safeOrigin(request.origin),controlAllowed=inputTools.every(tool=>c.tools.includes(tool))
    if(mode==='control'&&!controlAllowed)fail('SCOPE_DENIED',403)
    await this.sweep();if(this.opening+[...this.sessions.values()].filter(s=>!s.closed).length>=4||this.sessions.size>=256)fail('DESKTOP_SESSION_LIMIT',429)
    const id=`desktop-${randomUUID()}`,token=secret()
    this.opening++;let native:NativeDesktopSession
    try{native=await (this.options.nativeFactory??NativeDesktopPipe.open)(this.config,{owner:sha(canonical({agent:this.nonce,session:id,identity:ownerIdentity(c)})),expiresAt:c.expiresAt,fps,controlAllowed,...(request.displayId?{displayId:request.displayId}:{})})}finally{this.opening--}
    try{this.check(c)}catch(e){await native.close();throw e}
    const row:Session={id,token,digest:sha(token),context:structuredClone(c),origin,native,mode:'watch',requestedControl:mode==='control',controlAllowed,used:false,closed:false,stopped:false,queue:Promise.resolve(),queued:0,renewing:false,sending:false,lastInputId:0,events:[],fps,profile:0,appliedProfile:0,fastFrames:0,baselineRtt:0,pingStarted:0,frameSequence:0,frameRequested:false}
    this.sessions.set(id,row);native.on('frame',(jpeg,metadata)=>{row.frameRequested=false;this.frame(row,jpeg,metadata)});native.on('ended',value=>{row.stopped=value.stopConfirmed===true;if(!row.closed){row.closed=true;row.closedAt=Date.now();clearTimeout(row.frameTimer);clearTimeout(row.ackTimer);row.pendingFrame=undefined;this.send(row,{type:'status',status:'disconnected',mode:'watch',code:value.code,stopConfirmed:row.stopped});row.socket?.close(1000,'Desktop session ended');this.audit(row,'ended',{code:value.code,stopConfirmed:row.stopped})}})
    this.audit(row,'opened');return this.ticket(row)
  }
  async renew(c:Context,request:any){
    const row=this.own(c,request?.sessionId);if(row.closed)fail('DESKTOP_SESSION_CLOSED',409)
    if(request.origin!==undefined&&safeOrigin(request.origin)!==row.origin)fail('ORIGIN_DENIED',403)
    if(!row.context.tools.every(tool=>c.tools.includes(tool)))fail('SCOPE_DENIED',403)
    if(row.renewing)fail('DESKTOP_RENEW_PENDING',409);row.renewing=true
    try{this.check(c);const ack=await row.native.request({t:'renew',expiresAt:c.expiresAt});if(ack.ok!==true)fail(ack.code??'DESKTOP_RENEW_FAILED',409);this.check(c);if(row.closed)fail('DESKTOP_SESSION_CLOSED',409);row.context=structuredClone(c);this.audit(row,'renewed');return this.ticket(row)}catch(e){await this.stop(row,'DESKTOP_RENEW_FAILED');throw e}finally{row.renewing=false}
  }
  async closeSession(c:Context,request:any){const row=this.own(c,request?.sessionId);return this.stop(row,'SESSION_CLOSED')}
  hasOrigin(origin:string){return [...this.sessions.values()].some(row=>!row.closed&&row.origin===origin&&row.context.expiresAt>Date.now())}
  private send(row:Session,message:any){if(row.socket?.readyState===1)row.socket.send(JSON.stringify(message))}
  private nextFrame(row:Session,delay=0){if(row.closed||row.frameRequested||row.pendingFrame||!row.socket||row.socket.readyState!==1)return;clearTimeout(row.frameTimer);row.frameRequested=true;row.frameTimer=setTimeout(()=>void (async()=>{if(row.closed)return;this.check(row.context);if(row.profile!==row.appliedProfile){const ack=await row.native.request({t:'video',...videoProfiles[row.profile]});if(!ack.ok)throw new AgentError(ack.code??'DESKTOP_VIDEO_FAILED');row.appliedProfile=row.profile}if(!row.closed)row.native.frame(this.forceKeyframes.delete(row))})().catch(()=>this.stop(row,'DESKTOP_VIDEO_FAILED')),delay);row.frameTimer.unref()}
  private framePing(row:Session,baseline=false,sequence=row.frameSequence){
    if(row.closed||row.socket?.readyState!==1)return
    const tag=baseline?'baseline':`frame:${sequence}`
    if(baseline){row.pingTag=tag;row.pingStarted=performance.now()}
    clearTimeout(row.ackTimer);row.ackTimer=setTimeout(()=>void this.stop(row,'DESKTOP_FRAME_ACK_TIMEOUT'),15000);row.ackTimer.unref()
    row.socket.ping(tag,undefined,error=>{if(error)void this.stop(row,'DESKTOP_DISCONNECTED')})
  }
  private frame(row:Session,jpeg:Buffer,metadata?:any){
    if(row.closed||!row.socket||row.socket.readyState!==1)return
    try{this.check(row.context)}catch{void this.stop(row,'GRANT_REVOKED');return}
    const socket=row.socket
    if(!Buffer.isBuffer(jpeg)||jpeg.length>8388608){void this.stop(row,'CAPTURE_LIMIT');return}
    const flights=this.flights.get(row)??new Map();this.flights.set(row,flights)
    // Two small patches can cover a link RTT while a full image stays one-at-a-time.
    // The pong is beyond that JPEG on the wire; write callbacks alone are not receipt proof.
    const small=metadata?.region&&metadata.region.width*metadata.region.height<=row.native.metadata.width*row.native.metadata.height*.15&&jpeg.length<=65536
    if(flights.size>=(small?2:1)){if(row.pendingFrame){this.audit(row,'frame-drop');this.forceKeyframes.add(row)}row.pendingFrame={jpeg,metadata};return}
    if(socket.bufferedAmount>(this.options.maxBufferedAmount??524288)){this.audit(row,'frame-drop');this.forceKeyframes.add(row);this.nextFrame(row,100);return}
    row.sending=true;row.pingStarted=performance.now();row.frameSequence++
    flights.set(`frame:${row.frameSequence}`,{started:row.pingStarted,keyframe:metadata?.keyframe===true})
    this.send(row,{type:'frame',width:row.native.metadata.width,height:row.native.metadata.height,frameWidth:metadata?.frameWidth??row.native.metadata.width,frameHeight:metadata?.frameHeight??row.native.metadata.height,...(metadata?.region?{region:metadata.region,keyframe:metadata.keyframe===true}:{}),quality:metadata?.quality??70,scalePercent:metadata?.scalePercent??100,sequence:row.frameSequence,captureMs:metadata?.captureMs,encodeMs:metadata?.encodeMs})
    const sequence=row.frameSequence
    socket.send(jpeg,{binary:true},error=>{if(error)void this.stop(row,'DESKTOP_DISCONNECTED');else{this.framePing(row,false,sequence);this.nextFrame(row)}})
  }
  private enqueue(row:Session,work:()=>Promise<void>){
    if(row.queued>=64){this.send(row,{type:'error',code:'DESKTOP_INPUT_LIMIT'});return}row.queued++
    row.queue=row.queue.then(async()=>{if(row.closed)return;try{this.check(row.context);await work()}catch(e:any){this.send(row,{type:'error',code:e?.code??'DESKTOP_SESSION_FAILED'});await this.stop(row,e?.code??'DESKTOP_SESSION_FAILED')}}).finally(()=>row.queued--)
  }
  private input(event:any,row:Session){
    if(!event||typeof event!=='object'||Array.isArray(event))fail('INVALID_ARGUMENT')
    if(event.type==='pointer'){
      if(!['move','down','up'].includes(event.action)||!['left','middle','right'].includes(event.button??'left'))fail('INVALID_ARGUMENT')
      return {kind:'pointer',action:event.action,button:event.button??'left',x:integer(event.x,0,row.native.metadata.width-1),y:integer(event.y,0,row.native.metadata.height-1)}
    }
    if(event.type==='key'){if(!['down','up'].includes(event.action)||typeof event.code!=='string'||!event.code||event.code.length>64||typeof event.key!=='string'||event.key.length>64)fail('INVALID_ARGUMENT');return {kind:'key',action:event.action,code:event.code,key:event.key}}
    if(event.type==='wheel')return {kind:'wheel',deltaX:integer(event.deltaX,-4800,4800),deltaY:integer(event.deltaY,-4800,4800)}
    if(event.type==='text'){if(typeof event.text!=='string'||event.text.length>8192||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(event.text))fail('INPUT_LIMIT');return {kind:'text',text:event.text}}
    fail('INVALID_ARGUMENT')
  }
  /** Called only after the HTTP server validates Host/network/TLS on upgrade. */
  accept(socket:WebSocket,origin?:string,allowedOrigins:string[]=[]){
    this.sockets.add(socket);let row:Session|undefined,authenticating=false,alive=true
    const authTimer=setTimeout(()=>socket.close(1008,'Desktop authentication required'),this.options.authTimeoutMs??5000);authTimer.unref()
    const heartbeat=setInterval(()=>{if(!alive){socket.terminate();return}alive=false;socket.ping()},15000);heartbeat.unref();socket.on('pong',data=>{
      alive=true;if(!row)return
      const tag=data.toString(),baseline=tag==='baseline'&&row.pingTag==='baseline'
      const flights=this.flights.get(row),flight=flights?.get(tag)
      if(!baseline&&!flight)return
      clearTimeout(row.ackTimer);const elapsed=performance.now()-(baseline?row.pingStarted:flight!.started)
      if(baseline){row.pingTag=undefined;row.baselineRtt=elapsed;this.nextFrame(row);return}
      flights!.delete(tag)
      row.sending=false;const target=1000/row.fps,transfer=Math.max(1,elapsed-row.baselineRtt)
      if(!flight!.keyframe&&transfer>target*1.35&&row.profile<videoProfiles.length-1){row.profile=Math.min(videoProfiles.length-1,row.profile+(transfer>target*4?2:1));row.fastFrames=0}
      else if(transfer<target*.55&&row.profile>0&&++row.fastFrames>=20){row.profile--;row.fastFrames=0}
      else if(transfer>=target*.55)row.fastFrames=0
      if(row.pendingFrame){const pending=row.pendingFrame;row.pendingFrame=undefined;this.frame(row,pending.jpeg,pending.metadata)}else this.nextFrame(row)
    })
    const reject=(code:string)=>{if(socket.readyState===1)socket.send(JSON.stringify({type:'error',code}));socket.close(1008,code)}
    socket.on('message',(data,isBinary)=>{
      let message:any;try{if(isBinary||data.length>65536)fail('INVALID_ARGUMENT');message=JSON.parse(data.toString());if(!message||typeof message!=='object'||Array.isArray(message))fail('INVALID_ARGUMENT')}catch{reject('INVALID_ARGUMENT');return}
      if(!row){
        if(authenticating){reject('AUTH_INVALID');return}
        try{
          const candidate=this.sessions.get(message.sessionId)
          if(message.type!=='auth'||typeof message.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(message.token)||!candidate||!matches(message.token,candidate.digest))fail('AUTH_INVALID',401)
          if(candidate.closed||candidate.used)fail('DESKTOP_SESSION_CLOSED',409)
          this.check(candidate.context)
          if(origin!==undefined&&(candidate.origin?origin!==candidate.origin:!allowedOrigins.includes(origin)))fail('ORIGIN_DENIED',403)
          if(candidate.origin&&origin===undefined){/* Trusted Node clients may omit Origin. */}
          row=candidate;row.used=true;row.socket=socket;authenticating=true;clearTimeout(authTimer)
          this.enqueue(row,async()=>{
            if(row!.requestedControl){const ack=await row!.native.request({t:'control',action:'acquire'});if(!ack.ok)fail(ack.code??'CONTROL_NOT_GRANTED',409);row!.mode='control'}
            const {t,ok,sessionId:physicalSessionId,...metadata}=row!.native.metadata
            this.send(row!,{...metadata,type:'ready',sessionId:row!.id,nativeSessionId:physicalSessionId,mode:row!.mode,expiresAt:row!.context.expiresAt,controlAllowed:row!.controlAllowed});this.audit(row!,'authenticated');this.framePing(row!,true)
          })
        }catch(e:any){reject(e.code??'AUTH_INVALID')}
        return
      }
      const current=row
      if(message.type==='close'){void this.stop(current,'SESSION_CLOSED');return}
      this.enqueue(current,async()=>{
        if(message.type==='control'){
          if(!['acquire','release'].includes(message.action))fail('INVALID_ARGUMENT')
          if(message.action==='acquire'&&!current.controlAllowed){this.send(current,{type:'control',mode:'watch',ok:false,code:'SCOPE_DENIED',...(message.id!==undefined?{id:message.id}:{})});return}
          let ack:Ack
          try{ack=await current.native.request({t:'control',action:message.action})}catch(e:any){this.send(current,{type:'control',mode:'watch',ok:false,code:e.code??'OUTCOME_UNKNOWN',possiblyApplied:true,...(message.id!==undefined?{id:message.id}:{})});await this.stop(current,'OUTCOME_UNKNOWN');return}
          if(ack.ok!==true){this.send(current,{type:'control',mode:current.mode,ok:false,code:ack.code??'CONTROL_NOT_GRANTED',...(message.id!==undefined?{id:message.id}:{})});if(message.action==='release')await this.stop(current,'INPUT_RELEASE_UNCONFIRMED');return}
          current.mode=ack.mode==='control'?'control':'watch';this.send(current,{type:'control',mode:current.mode,ok:true,...(message.id!==undefined?{id:message.id}:{})});this.audit(current,'control',{mode:current.mode})
        }else if(message.type==='input'){
          let event:any
          try{integer(message.id,1,Number.MAX_SAFE_INTEGER);if(message.id<=current.lastInputId)fail('DESKTOP_INPUT_REPLAY',409);current.lastInputId=message.id;if(current.mode!=='control')fail('CONTROL_NOT_GRANTED',403);event=this.input(message.event,current)}catch(e:any){this.send(current,{type:'input',id:message.id,ok:false,code:e.code??'INVALID_ARGUMENT',possiblyApplied:false});return}
          let ack:Ack;try{ack=await current.native.request({t:'input',...event})}catch(e:any){this.send(current,{type:'input',id:message.id,ok:false,code:e.code??'OUTCOME_UNKNOWN',possiblyApplied:true});await this.stop(current,'OUTCOME_UNKNOWN');return}
          this.send(current,{type:'input',id:message.id,ok:ack.ok===true,...(ack.ok?{}:{code:ack.code??'INPUT_REJECTED',possiblyApplied:ack.possiblyApplied===true})});this.audit(current,'input',{id:message.id,event:event.kind,ok:ack.ok===true})
        }else if(message.type==='release-input'){
          let ack:Ack
          try{ack=await current.native.request({t:'release-input'})}catch(e:any){this.send(current,{type:'release-input',...(message.id!==undefined?{id:message.id}:{}),ok:false,code:e.code??'OUTCOME_UNKNOWN',possiblyApplied:true});await this.stop(current,'OUTCOME_UNKNOWN');return}
          this.send(current,{type:'release-input',...(message.id!==undefined?{id:message.id}:{}),ok:ack.ok===true,...(ack.ok?{}:{code:ack.code??'INPUT_RELEASE_UNCONFIRMED',possiblyApplied:true})});this.audit(current,'release-input');if(!ack.ok)await this.stop(current,'INPUT_RELEASE_UNCONFIRMED')
        }else fail('INVALID_ARGUMENT')
      })
    })
    socket.on('error',()=>{if(row)void this.stop(row,'DESKTOP_DISCONNECTED')})
    socket.once('close',()=>{clearTimeout(authTimer);clearInterval(heartbeat);this.sockets.delete(socket);if(row)void this.stop(row,'DESKTOP_DISCONNECTED')})
  }
  private stop(row:Session,reason:string):Promise<{stopConfirmed:boolean}>{
    this.forceKeyframes.delete(row)
    if(row.stop)return row.stop
    row.closed=true;row.closedAt=Date.now();clearTimeout(row.frameTimer);clearTimeout(row.ackTimer);row.pendingFrame=undefined
    row.stop=(async()=>{const result=await row.native.close().catch(()=>({stopConfirmed:false}));row.stopped=result.stopConfirmed===true;row.mode='watch';this.send(row,{type:'status',status:'disconnected',mode:'watch',code:reason,stopConfirmed:row.stopped});row.socket?.close(1000,'Desktop session closed');this.audit(row,'closed',{reason,stopConfirmed:row.stopped});return {stopConfirmed:row.stopped}})()
    return row.stop
  }
  async sweep(){
    const pending:Promise<any>[]=[]
    for(const [id,row] of this.sessions){
      if(row.closed){if(row.closedAt!+30000<Date.now())this.sessions.delete(id);continue}
      if(row.renewing)continue
      try{this.check(row.context)}catch{pending.push(this.stop(row,'GRANT_REVOKED'))}
    }
    await Promise.all(pending)
  }
  sessionAudit(c:Context,id:string){return structuredClone(this.own(c,id).events)}
  async close(){this.closing=true;clearInterval(this.timer);const result=await Promise.all([...this.sessions.values()].map(row=>this.stop(row,'DESKTOP_HOST_STOPPED')));for(const socket of this.sockets)socket.terminate();this.sockets.clear();return {stopConfirmed:result.every(r=>r.stopConfirmed)}}
}
