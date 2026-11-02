import { readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { canonical, fail, sha, type Context } from './protocol.js'
import { Store } from './store.js'
import { Roots } from './scope.js'
import { WorkspacePin } from './workspace-identity.js'
import { createAgentCodexSession } from '../../packages/cli-runtime/src/agent-codex-runtime.mjs'

export type CliProfileConfig={profileId:string;rootId:string;profileRevision:number;executable:string;runtimeRoot:string;entry:{sha256:string;version:string};bots:Record<string,{credentialRef:string}>}
const ref=(value:any)=>typeof value==='string'&&/^[-A-Za-z0-9_.]{1,128}$/.test(value)
const plain=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype
const closed=(value:any,keys:string[])=>{if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('INVALID_CLI_ARGUMENT');return value}
const inside=(parent:string,child:string)=>{const part=relative(parent,child);return part!==''&&!part.startsWith('..')&&!isAbsolute(part)}

export function validateCliProfiles(value:any,dataDir:string,roots:Record<string,string>):CliProfileConfig[]{
 if(value===undefined)return []
 if(!Array.isArray(value)||value.length>64||!['win32','linux'].includes(process.platform))fail('CLI_PROFILE_CONFIG_INVALID')
 const seen=new Set<string>(),runtimeRoots=new Set<string>()
 return value.map(raw=>{
  closed(raw,['profileId','rootId','profileRevision','executable','runtimeRoot','entry','bots'])
  if(!ref(raw.profileId)||!ref(raw.rootId)||!Object.hasOwn(roots,raw.rootId)||!Number.isSafeInteger(raw.profileRevision)||raw.profileRevision<1
   ||!isAbsolute(raw.executable)||!isAbsolute(raw.runtimeRoot)||!inside(resolve(dataDir),resolve(raw.runtimeRoot)))fail('CLI_PROFILE_CONFIG_INVALID')
  closed(raw.entry,['sha256','version'])
  if(!/^[a-f0-9]{64}$/.test(raw.entry.sha256)||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(raw.entry.version))fail('CLI_PROFILE_CONFIG_INVALID')
  if(!plain(raw.bots)||!Object.keys(raw.bots).length)fail('CLI_PROFILE_CONFIG_INVALID')
  for(const [botId,bot] of Object.entries<any>(raw.bots)){
   if(!ref(botId))fail('CLI_PROFILE_CONFIG_INVALID');closed(bot,['credentialRef'])
   if(!isAbsolute(bot.credentialRef)||bot.credentialRef.length>4096||bot.credentialRef.includes('\0'))fail('CLI_PROFILE_CONFIG_INVALID')
  }
  const key=`${raw.rootId}/${raw.profileId}`,runtime=resolve(raw.runtimeRoot)
  if(seen.has(key)||runtimeRoots.has(runtime))fail('CLI_PROFILE_CONFIG_INVALID');seen.add(key);runtimeRoots.add(runtime)
  return {profileId:raw.profileId,rootId:raw.rootId,profileRevision:raw.profileRevision,executable:resolve(raw.executable),runtimeRoot:runtime,entry:{sha256:raw.entry.sha256,version:raw.entry.version},bots:structuredClone(raw.bots)}
 })
}

type Identity={args:any;profile:CliProfileConfig;workspaceId:string;pin:WorkspacePin}
type Settlement={status:'succeeded'|'failed'|'cancelled'|'unknown';result:any;error:string|null}

export class CliTasks{
 private profiles:Map<string,CliProfileConfig>
 constructor(cliProfiles:CliProfileConfig[],private store:Store,private roots:Roots){
  this.profiles=new Map(cliProfiles.map(profile=>[`${profile.rootId}/${profile.profileId}`,profile]))
 }
 private async identity(a:any,c:Context,probe:boolean):Promise<Identity>{
  const base=['rootId','workspaceRef','profileId','profileRevision','entry','requestedModel','catalogProvider','catalogModel','billing','deadlineMs']
  closed(a,[...base,...(probe?[]:['task'])]);closed(a.workspaceRef,['kind','machineId','rootId','relativePath','workspaceId']);closed(a.entry,['sha256','version'])
  if(!ref(a.rootId)||!c.roots.includes(a.rootId)||!ref(a.profileId)||!Number.isSafeInteger(a.profileRevision)||a.profileRevision<1
   ||a.workspaceRef.kind!=='remote'||a.workspaceRef.machineId!==this.store.machineId||a.workspaceRef.rootId!==a.rootId
   ||typeof a.workspaceRef.relativePath!=='string'||a.workspaceRef.relativePath.length>2048||typeof a.workspaceRef.workspaceId!=='string'
   ||!/^[a-f0-9]{64}$/.test(a.entry.sha256)||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(a.entry.version)
   ||!/^gpt-[A-Za-z0-9_.-]{1,100}$/.test(a.requestedModel)||typeof a.catalogProvider!=='string'||!a.catalogProvider||typeof a.catalogModel!=='string'||!a.catalogModel
   ||!['api','subscription'].includes(a.billing)||!Number.isSafeInteger(a.deadlineMs)||a.deadlineMs<1000||a.deadlineMs>7200000)fail('INVALID_CLI_ARGUMENT')
  if(!probe&&(typeof a.task!=='string'||!a.task.trim()||a.task.includes('\0')||Buffer.byteLength(a.task)>16000))fail('INVALID_CLI_ARGUMENT')
  const profile=this.profiles.get(`${a.rootId}/${a.profileId}`)
  if(!profile||profile.profileRevision!==a.profileRevision||profile.entry.sha256!==a.entry.sha256||profile.entry.version!==a.entry.version||!Object.hasOwn(profile.bots,c.botId))fail('CLI_PROFILE_DENIED',403)
  const workspaceId='remote_'+sha(canonical({rootId:a.rootId,workspaceRelativePath:a.workspaceRef.relativePath,profileId:a.profileId,profileRevision:a.profileRevision,entrySha256:a.entry.sha256,entryVersion:a.entry.version}))
  if(a.workspaceRef.workspaceId!==workspaceId)fail('CLI_WORKSPACE_IDENTITY_MISMATCH',403)
  const cwd=await this.roots.resolve(a.rootId,a.workspaceRef.relativePath)
  if(!(await stat(cwd)).isDirectory())fail('CLI_WORKSPACE_OUTSIDE_SCOPE',403)
  const pin=await WorkspacePin.capture(cwd);await pin.verify()
  return {args:a,profile,workspaceId,pin}
 }
 private async provision(profile:CliProfileConfig,c:Context,home:string){
  const reference=profile.bots[c.botId].credentialRef
  const bytes=await readFile(reference)
  if(bytes.length>65536)fail('CLI_CREDENTIAL_PROVISION_FAILED')
  await writeFile(join(home,'auth.json'),bytes,{flag:'wx',mode:0o600})
 }
 private async session(identity:Identity,c:Context,operationId:string,signal:AbortSignal){
  const {args,profile,workspaceId,pin}=identity
  return createAgentCodexSession({context:c,validate:()=>this.store.validate(c),binding:{taskId:c.taskId,attemptId:c.attemptId,machineId:this.store.machineId,workspaceId,location:'remote'},operationId,
   runtimeRoot:profile.runtimeRoot,workspace:pin.identity.path,entry:{executable:profile.executable,...profile.entry},requestedModel:args.requestedModel,catalogProvider:args.catalogProvider,catalogModel:args.catalogModel,
   billing:args.billing,deadlineMs:args.deadlineMs,tools:[],handlers:[],signal,provisionCredentials:(home:string)=>this.provision(profile,c,home)})
 }
 private remoteReceipt(identity:Identity,snapshot:any){
  const {args,pin}=identity
  return {...snapshot,remote:{rootId:args.rootId,workspaceRelativePath:args.workspaceRef.relativePath,profileId:args.profileId,profileRevision:args.profileRevision,workspaceIdentity:pin.identity}}
 }
 async probe(a:any,c:Context,operationId?:string){
  if(!operationId)fail('OPERATION_ID_REQUIRED')
  const identity=await this.identity(a,c,true),controller=new AbortController();let session:any
  try{
   session=await this.session(identity,c,operationId,controller.signal)
   const readiness=await session.listCapabilities(),stop=await session.close(),snapshot=this.remoteReceipt(identity,session.snapshot())
   if(stop?.treeStopped!==true)fail('CLI_STOP_UNCONFIRMED',409)
   return {schemaVersion:1,kind:'remote-cli-probe',status:'available',location:'remote',machineId:this.store.machineId,rootId:a.rootId,workspaceId:identity.workspaceId,
    workspaceRelativePath:a.workspaceRef.relativePath,workspaceIdentity:identity.pin.identity,profileId:a.profileId,profileRevision:a.profileRevision,
    entry:{sha256:a.entry.sha256,version:a.entry.version,path:session.entry.path},requestedModel:a.requestedModel,loginStatus:'unknown',versionStatus:'available',dependencyStatus:'available',
    nativeStatus:'available',profileStatus:'available',readinessStatus:'available',readiness,home:session.home,cwd:identity.pin.identity.path,stopConfirmed:true,stopEvidence:stop,
    capabilityProbe:snapshot.capabilityProbe,profile:snapshot.profile}
  }finally{await session?.close().catch(()=>{});controller.abort();await identity.pin.close()}
 }
 async run(a:any,c:Context,operationId:string,hooks:{setProcess:(record:any)=>void;clearProcess:()=>void}):Promise<Settlement>{
  let identity:Identity|undefined,session:any,stop:any=null,error:any=null
  const controller=new AbortController()
  hooks.setProcess({context:c,cancel:async()=>{controller.abort(new Error('CANCELLED'));await session?.close()}})
  try{
   identity=await this.identity(a,c,false)
   session=await this.session(identity,c,operationId,controller.signal)
   await identity.pin.verify();await session.run(a.task);await identity.pin.verify()
  }catch(e){error=e}
  finally{
   try{stop=await session?.close()}catch(e){error??=e}
   if(identity)await identity.pin.close();hooks.clearProcess()
  }
  const base=session?.snapshot(),receipt=identity&&base?this.remoteReceipt(identity,base):null,stopConfirmed=stop?.treeStopped===true
  if(receipt&&stopConfirmed&&controller.signal.aborted&&!['completed','failed'].includes(receipt.terminal))receipt.terminal='interrupted'
  const terminal=receipt?.terminal==='completed'?'succeeded':receipt?.terminal==='failed'?'failed':receipt?.terminal==='interrupted'?'cancelled':'unknown'
  const status=!stopConfirmed?'unknown':error&&terminal==='succeeded'?'unknown':terminal
  const code=status==='unknown'?'OUTCOME_UNKNOWN':status==='cancelled'?'CANCELLED':status==='failed'?(error?.code??'CLI_TASK_FAILED'):null
  const result={kind:'remote-cli',schemaVersion:1,receipt,stopConfirmed,stopEvidence:stop??{treeStopped:false,status:'unconfirmed'},exitCode:Number.isSafeInteger(stop?.exitCode)?stop.exitCode:null,
   ...(receipt?.cliTurnRequestsDispatched===0?{notStarted:true,possiblyApplied:false}:{})}
  return {status,result,error:code}
 }
}
