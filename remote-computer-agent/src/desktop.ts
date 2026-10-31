import net from 'node:net'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {AgentError,fail,sha,canonical,type Context} from './protocol.js'

type Owner={tag:string;expiresAt:number;helper?:string;token?:string;blocked:boolean;active:number;idleAt:number;uncertain:number;stopAttempts:number;stop?:Promise<boolean>}
type Options={connect?:typeof net.createConnection;validate?:(context:Context)=>void;timeoutMs?:number}
const error=(code:string,possiblyApplied=false,stopConfirmed=false)=>Object.assign(new AgentError(code,409),{possiblyApplied,stopConfirmed})

/** The native helper is the global arbiter. This client never substitutes a local lock. */
export class DesktopTools {
  private nonce=randomUUID();private owners=new Map<string,Owner>();private closing=new AbortController();private active=new Set<Promise<any>>()
  constructor(private config?:{pipeName:string;secretFile:string},private options:Options={}){}
  private tag(c:Context){return sha(canonical({agent:this.nonce,client:c.clientId,bot:c.botId,task:c.taskId,attempt:c.attemptId,revision:c.revision}))}
  private owner(c:Context){
    const now=Date.now();for(const [tag,row] of this.owners)if(!row.active&&!row.uncertain&&row.expiresAt+10000<now)this.owners.delete(tag)
    const tag=this.tag(c);let row=this.owners.get(tag)
    if(!row){if(this.owners.size>=4096)fail('DESKTOP_LEASE_LIMIT',429);row={tag,expiresAt:c.expiresAt,blocked:false,active:0,idleAt:0,uncertain:0,stopAttempts:0};this.owners.set(tag,row)}
    row.expiresAt=Math.max(row.expiresAt,c.expiresAt);return row
  }
  private async rpc(control:boolean,packet:any,beforeWrite:()=>void=()=>{}){
    const name=this.config!.pipeName+(control?'-control':'')
    return new Promise<any>((resolve,reject)=>{
      const socket=(this.options.connect??net.createConnection)(`\\\\.\\pipe\\${name}`),chunks:Buffer[]=[]
      let bytes=0,sent=false,settled=false
      const finish=(value:any,e?:any)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();if(e)reject(e);else resolve(value)}
      const timer=setTimeout(()=>finish(null,error(sent?'OUTCOME_UNKNOWN':'DESKTOP_UNAVAILABLE',!control&&sent)),this.options.timeoutMs??10000)
      socket.once('connect',()=>{try{beforeWrite();sent=true;socket.write(JSON.stringify({...packet,protocolVersion:2})+'\n')}catch(e){finish(null,e)}})
      socket.on('data',chunk=>{
        const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=data.length
        if(bytes>24000000){finish(null,error('OUTCOME_UNKNOWN',!control&&sent));return}
        chunks.push(data)
        if(data.includes(10))try{const all=Buffer.concat(chunks),end=all.indexOf(10);if(all.subarray(end+1).toString('utf8').trim())throw Error();finish(JSON.parse(all.subarray(0,end).toString('utf8')))}catch{finish(null,error('OUTCOME_UNKNOWN',!control&&sent))}
      })
      socket.once('error',()=>finish(null,error(sent?'OUTCOME_UNKNOWN':'DESKTOP_UNAVAILABLE',!control&&sent)))
      socket.once('close',()=>finish(null,error(sent?'OUTCOME_UNKNOWN':'DESKTOP_UNAVAILABLE',!control&&sent)))
    })
  }
  private checkResponse(result:any,possiblyApplied=false){if(result?.protocolVersion!==2)throw error('DESKTOP_PROTOCOL_UNSUPPORTED',possiblyApplied);return result}
  private async stop(row:Owner,retry=false):Promise<boolean>{
    row.blocked=true
    if(!row.helper||!row.token)return !row.uncertain
    if(row.stop&&retry){const previous=row.stop,stopped=await previous;if(stopped||row.stopAttempts>=2)return stopped;if(row.stop===previous)row.stop=undefined}
    if(!row.stop){row.stopAttempts++;row.stop=(async()=>{
      try{
        const result=this.checkResponse(await this.rpc(true,{token:row.token,name:'cancel',owner:row.tag,helperInstanceId:row.helper}))
        const stopped=result.ok===true&&result.result?.helperInstanceId===row.helper&&result.result?.stopConfirmed===true
        if(stopped){row.uncertain=0;row.idleAt=0}return stopped
      }catch{return false}
    })()}
    return row.stop
  }
  async cancel(c:Context){const row=this.owners.get(this.tag(c));return {stopConfirmed:row?await this.stop(row,true):true}}
  async run(name:string,args:any,c:Context,external?:AbortSignal){
    if(process.platform!=='win32'&&!this.options.connect||!this.config)fail('DESKTOP_UNAVAILABLE',503)
    if(!/^dsh-desktop-[-a-zA-Z0-9]{1,64}$/.test(this.config.pipeName))fail('DESKTOP_UNAVAILABLE',503)
    const row=this.owner(c),signal=AbortSignal.any([this.closing.signal,...(external?[external]:[])])
    const check=()=>{if(signal.aborted||row.blocked)throw error('DESKTOP_CANCELLED',false,true);if(!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=Date.now())throw error('GRANT_REVOKED');this.options.validate?.(c)}
    const work=(async()=>{
      let sent=false,notApplied=false
      const abort=()=>{void this.stop(row)};signal.addEventListener('abort',abort,{once:true});row.active++
      try{
        check();const token=(await readFile(this.config!.secretFile,'utf8')).trim();check()
        const probe=this.checkResponse(await this.rpc(true,{token,name:'probe'}))
        if(!probe.ok)throw error(probe.code??'DESKTOP_UNAVAILABLE')
        if(probe.result?.protocolVersion!==2||!/^[a-f0-9]{32}$/.test(probe.result?.helperInstanceId??''))throw error('DESKTOP_PROTOCOL_UNSUPPORTED')
        check();row.helper=probe.result.helperInstanceId;row.token=token
        const response=this.checkResponse(await this.rpc(false,{token,name,args,owner:row.tag,expiresAt:c.expiresAt,helperInstanceId:row.helper},()=>{check();sent=true;row.uncertain++}),true)
        // Only this acknowledged packet retires its own uncertainty. A failed
        // later connect must not erase another packet's missing receipt.
        row.uncertain=Math.max(0,row.uncertain-1)
        row.idleAt=Date.now()
        notApplied=response.effect==='not-applied'
        if(signal.aborted||row.blocked)throw error('DESKTOP_CANCELLED',sent&&!notApplied)
        this.options.validate?.(c)
        if(!response.ok)throw error(response.code??'DESKTOP_UNAVAILABLE',response.effect==='possibly-applied',response.stopConfirmed===true)
        row.idleAt=Date.now();return response.result
      }catch(e:any){
        if(e.code==='GRANT_REVOKED')row.blocked=true
        if(signal.aborted||row.blocked){const stopped=await this.stop(row,true);throw error(stopped?'DESKTOP_CANCELLED':'OUTCOME_UNKNOWN',sent&&!notApplied,stopped)}
        if(!sent)e.stopConfirmed=true
        throw e
      }finally{row.active--;signal.removeEventListener('abort',abort)}
    })()
    this.active.add(work)
    try{return await work}finally{this.active.delete(work)}
  }
  async close(){
    this.closing.abort(error('DESKTOP_HOST_STOPPED'))
    const relevant=[...this.owners.values()].filter(row=>row.active||row.uncertain||row.idleAt+15000>Date.now())
    const stopped=await Promise.all(relevant.map(row=>this.stop(row,true)))
    await Promise.allSettled([...this.active]);return {stopConfirmed:stopped.every(Boolean)}
  }
}
