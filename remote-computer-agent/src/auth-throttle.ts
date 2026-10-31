import {fail} from './protocol.js'

export type AuthLimits={windowMs?:number;failureThreshold?:number;baseBackoffMs?:number;maxBackoffMs?:number;maxSources?:number;maxClients?:number;globalFailureLimit?:number;clientRequestLimit?:number}
type Decision={status:401|429;code:'AUTH_INVALID'|'AUTH_RATE_LIMIT';retryAfterMs:number;audit:boolean}
type Source={start:number;failures:number;until:number}
type Client={start:number;requests:number;revision:number;limited:boolean}
const defaults={windowMs:60000,failureThreshold:5,baseBackoffMs:1000,maxBackoffMs:30000,maxSources:1024,maxClients:1024,globalFailureLimit:128,clientRequestLimit:120}
export function validateAuthLimits(input:AuthLimits={}){
  const limits={...defaults,...input}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(defaults,key)))fail('INVALID_AUTH_LIMITS')
  const bounds={windowMs:[100,3600000],failureThreshold:[1,100],baseBackoffMs:[10,30000],maxBackoffMs:[10,30000],maxSources:[1,4096],maxClients:[1,4096],globalFailureLimit:[1,10000],clientRequestLimit:[1,10000]}
  for(const key of Object.keys(bounds) as (keyof typeof defaults)[]){const [min,max]=bounds[key];if(!Number.isSafeInteger(limits[key])||limits[key]<min||limits[key]>max)fail('INVALID_AUTH_LIMITS')}
  if(limits.baseBackoffMs>limits.maxBackoffMs||limits.maxBackoffMs>limits.windowMs)fail('INVALID_AUTH_LIMITS')
  return Object.freeze(limits)
}

/** Anonymous inputs never establish a client identity or consume its allowance. */
export class AuthThrottle {
  private sources=new Map<string,Source>();private clients=new Map<string,Client>()
  private global={start:0,failures:0,limited:false}
  readonly limits:ReturnType<typeof validateAuthLimits>
  constructor(options:AuthLimits={},private now=Date.now){this.limits=validateAuthLimits(options)}
  private save<T>(map:Map<string,T>,key:string,value:T,max:number){map.delete(key);map.set(key,value);while(map.size>max)map.delete(map.keys().next().value!)}
  failure(source:string):Decision{
    const now=this.now(),p=this.limits
    if(now-this.global.start>=p.windowMs||now<this.global.start)this.global={start:now,failures:0,limited:false}
    if(this.global.failures>=p.globalFailureLimit){const audit=!this.global.limited;this.global.limited=true;return {status:429,code:'AUTH_RATE_LIMIT',retryAfterMs:this.global.start+p.windowMs-now,audit}}
    let row=this.sources.get(source)
    if(row&&now<row.start)row=undefined
    if(row&&row.until>now)return {status:429,code:'AUTH_RATE_LIMIT',retryAfterMs:row.until-now,audit:false}
    if(!row||now-row.start>=p.windowMs||now<row.start)row={start:now,failures:0,until:0}
    this.global.failures++;row.failures++
    if(row.failures>=p.failureThreshold)row.until=now+Math.min(p.maxBackoffMs,p.baseBackoffMs*2**Math.min(16,row.failures-p.failureThreshold))
    this.save(this.sources,source,row,p.maxSources)
    return row.until>now?{status:429,code:'AUTH_RATE_LIMIT',retryAfterMs:row.until-now,audit:true}:{status:401,code:'AUTH_INVALID',retryAfterMs:0,audit:true}
  }
  // clientId and revision come only from Store.client/grant's checked rows.
  authenticated(clientId:string,revision:number):Decision|null{
    const now=this.now(),p=this.limits;let row=this.clients.get(clientId)
    if(!row||row.revision!==revision||now-row.start>=p.windowMs||now<row.start)row={start:now,requests:0,revision,limited:false}
    if(row.requests>=p.clientRequestLimit){const audit=!row.limited;row.limited=true;return {status:429,code:'AUTH_RATE_LIMIT',retryAfterMs:row.start+p.windowMs-now,audit}}
    row.requests++;this.save(this.clients,clientId,row,p.maxClients);return null
  }
  stats(){return {sources:this.sources.size,clients:this.clients.size,globalFailures:this.global.failures}}
}
