import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,open,readFile,lstat} from 'node:fs/promises'
import {isAbsolute,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {AgentError,canonical,fail,sha,type Context} from './protocol.js'
import type {Store} from './store.js'
import {CONTAINER_SUPERVISOR_SOURCE as supervisorSource} from './container-supervisor.mjs'
const control=promisify(execFile)
export const CONTAINER_IMAGE='node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d'
export type ContainerCommandConfig={dockerExecutable:string;image:string;executables:Record<string,string>;shell?:boolean}
const object=(x:any)=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const terminal=new Set(['succeeded','failed','cancelled'])
const env=(directory:string)=>({PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8',HOME:'/nonexistent',DOCKER_CONFIG:directory})
export function validateContainerCommandConfig(value:ContainerCommandConfig){
 if(process.platform!=='linux')fail('CONTAINER_PLATFORM_UNAVAILABLE',503)
 if(!object(value)||Object.keys(value).some(k=>!['dockerExecutable','image','executables','shell'].includes(k))||typeof value.dockerExecutable!=='string'||!isAbsolute(value.dockerExecutable)||value.dockerExecutable.includes('\0')||value.image!==CONTAINER_IMAGE||!object(value.executables)||!Object.keys(value.executables).length||Object.entries(value.executables).some(([name,path])=>!/^[-a-z0-9]{1,32}$/.test(name)||typeof path!=='string'||!/^\/(?:usr\/local\/bin|usr\/bin|bin)\/[-a-zA-Z0-9_.]+$/.test(path))||value.shell!==undefined&&typeof value.shell!=='boolean')fail('CONTAINER_CONFIG_INVALID')
 return value
}
export function containerArguments({name,nonce,machineId,workspace,workspaceIdentity,config,executable,argv,deadlineAt=Date.now()+60000,supervisorFile='/fixture-supervisor.mjs'}:{name:string;nonce:string;machineId:string;workspace:string;workspaceIdentity:string;config:ContainerCommandConfig;executable:string;argv:string[];deadlineAt?:number;supervisorFile?:string}){
 // Arguments after the immutable image are container argv, never Docker options.
 if(!/^dsh-worker-[a-f0-9]{40}$/.test(name)||!/^[-a-f0-9]{36}$/.test(nonce)||![workspace,supervisorFile].every(p=>typeof p==='string'&&isAbsolute(p)&&!/[\0,\r\n]/.test(p))||typeof workspaceIdentity!=='string'||workspaceIdentity.length>256||!Number.isSafeInteger(deadlineAt)||deadlineAt<=0||argv.some(x=>typeof x!=='string'||x.includes('\0')))fail('CONTAINER_ARGUMENT_INVALID')
 let identity:any;try{identity=JSON.parse(workspaceIdentity)}catch{fail('CONTAINER_ARGUMENT_INVALID')}
 if(!object(identity)||Object.keys(identity).sort().join(',')!=='birth,dev,ino'||!['dev','ino','birth'].every(k=>typeof identity[k]==='string'&&/^(0|[1-9][0-9]{0,39})$/.test(identity[k]))||identity.ino==='0'||identity.birth==='0')fail('CONTAINER_ARGUMENT_INVALID')
 return ['container','create','--pull=never','--platform','linux/amd64','--name',name,'--label',`dsh.worker.nonce=${nonce}`,'--label',`dsh.worker.machine=${machineId}`,'--network=none','--read-only','--cap-drop=ALL','--cap-add=SETUID','--cap-add=SETGID','--security-opt=no-new-privileges','--user','0:0','--pids-limit=64','--memory=128m','--cpus=0.5','--log-driver=json-file','--log-opt=max-size=8m','--log-opt=max-file=1','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--mount',`type=bind,src=${workspace},dst=/workspace`,'--mount',`type=bind,src=${supervisorFile},dst=/opt/dsh-supervisor.mjs,readonly`,'--workdir','/workspace','--entrypoint','/usr/local/bin/node',config.image,'/opt/dsh-supervisor.mjs',String(deadlineAt),workspaceIdentity,executable,...argv]
}

/** Durable original-container controller; status observation never creates work. */
export class ContainerCommands {
 private dockerEnv:Record<string,string>;private sessions=new Map<string,{cancel:(why:string)=>Promise<void>}>();private controls=new Map<string,Promise<any>>();private sweeping=false;private closing=false;private sweepCursor=''
 constructor(private store:Store,private config:ContainerCommandConfig){
  validateContainerCommandConfig(config);this.dockerEnv=env(join(store.dataDir,'docker-client'))
  store.db.exec(`CREATE TABLE IF NOT EXISTS container_workers(operation_id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,nonce TEXT NOT NULL,context TEXT NOT NULL,root_id TEXT NOT NULL,workspace TEXT NOT NULL,input_digest TEXT NOT NULL,phase TEXT NOT NULL,cid TEXT,reason TEXT)`)
  if(!store.db.prepare('PRAGMA table_info(container_workers)').all().some((row:any)=>row.name==='workspace_identity'))store.db.exec('ALTER TABLE container_workers ADD COLUMN workspace_identity TEXT')
 }
 private serialized(id:string,fn:()=>Promise<any>){const pending=(this.controls.get(id)??Promise.resolve()).catch(()=>{}).then(fn);this.controls.set(id,pending);return pending.finally(()=>{if(this.controls.get(id)===pending)this.controls.delete(id)})}
 private async supervisor(){
  const path=join(this.store.dataDir,'container-supervisor-'+sha(supervisorSource)+'.mjs')
  try{const fd=await open(path,'wx',0o444);try{await fd.writeFile(supervisorSource);await fd.sync()}finally{await fd.close()}}catch(e:any){if(e.code!=='EEXIST')throw e}
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||sha(await readFile(path))!==sha(supervisorSource))fail('CONTAINER_SUPERVISOR_CHANGED',503)
  return path
 }
 private async cli(args:string[],timeout=15000){
  await mkdir(this.dockerEnv.DOCKER_CONFIG,{recursive:true,mode:0o700})
  try{return (await control(this.config.dockerExecutable,args,{env:this.dockerEnv,encoding:'utf8',timeout,maxBuffer:10*1024*1024,windowsHide:true})).stdout.trim()}catch{fail('CONTAINER_CONTROL_UNAVAILABLE',503)}
 }
 private row(id:string,c:Context){const row=this.store.db.prepare('SELECT * FROM container_workers WHERE operation_id=?').get(id);if(!row)return null;this.store.own(row.context,c);if(!c.roots.includes(row.root_id))fail('SCOPE_DENIED',403);return row}
 private async inspect(row:any){
  const ids=(await this.cli(['container','ls','-a','--no-trunc','--filter',`name=^/${row.name}$`,'--format','{{.ID}}'])).split('\n').filter(Boolean)
  if(!ids.length)return null
  if(ids.length!==1||!/^[a-f0-9]{64}$/.test(ids[0])||row.cid&&row.cid!==ids[0])fail('CONTAINER_IDENTITY_MISMATCH',503)
  let value:any;try{value=JSON.parse(await this.cli(['container','inspect',ids[0]]))[0]}catch{fail('CONTAINER_CONTROL_UNAVAILABLE',503)}
  if(value?.Id!==ids[0]||value.Name!=='/'+row.name||value.Config?.Labels?.['dsh.worker.nonce']!==row.nonce||value.Config?.Labels?.['dsh.worker.machine']!==this.store.machineId)fail('CONTAINER_IDENTITY_MISMATCH',503)
  const host=value.HostConfig,binds=(value.Mounts??[]).filter((m:any)=>m.Type==='bind')
  const workspace=binds.find((m:any)=>m.Destination==='/workspace'),supervisor=binds.find((m:any)=>m.Destination==='/opt/dsh-supervisor.mjs')
  const caps=host?.CapAdd?.map((name:string)=>name.replace(/^CAP_/,''))
  if(typeof row.workspace_identity!=='string'||value.Config?.Cmd?.[0]!=='/opt/dsh-supervisor.mjs'||value.Config.Cmd[2]!==row.workspace_identity||value.Config?.Entrypoint?.length!==1||value.Config.Entrypoint[0]!=='/usr/local/bin/node')fail('CONTAINER_POLICY_MISMATCH',503)
  if(value.Config?.Image!==this.config.image||value.Config?.User!=='0:0'||host?.NetworkMode!=='none'||host?.ReadonlyRootfs!==true||host?.Privileged!==false||!host.CapDrop?.includes('ALL')||caps?.length!==2||!caps.includes('SETUID')||!caps.includes('SETGID')||!host.SecurityOpt?.includes('no-new-privileges')||binds.length!==2||workspace?.Source!==row.workspace||supervisor?.Source!==await this.supervisor()||supervisor?.RW!==false)fail('CONTAINER_POLICY_MISMATCH',503)
  return value
 }
 async probe(){
  try{const info=JSON.parse(await this.cli(['image','inspect',this.config.image]))[0];if(info?.Architecture!=='amd64'||!info.RepoDigests?.includes(this.config.image))fail('CONTAINER_IMAGE_MISMATCH');return {mode:'container',status:'dependency-ready',image:this.config.image,network:'none',filesystem:'workspace-only',user:'65532:65532',measurement:'requires-operation-check'}}catch{return {mode:'container',status:'unavailable',code:'CONTAINER_DEPENDENCY_UNAVAILABLE'}}
 }
 private unknown(id:string,code='OUTCOME_UNKNOWN'){
  this.store.finish(id,'unknown',{kind:'container-command',stopConfirmed:false,possiblyApplied:true},code)
 }
 private async logs(id:string){
  const child=spawn(this.config.dockerExecutable,['container','logs',id],{env:this.dockerEnv,stdio:['ignore','pipe','pipe'],windowsHide:true})
  const stdout:Buffer[]=[],stderr:Buffer[]=[];let bytes=0,failed=false
  const take=(list:Buffer[])=>(chunk:Buffer)=>{const n=Math.min(chunk.length,Math.max(0,8*1024*1024-bytes));if(n)list.push(chunk.subarray(0,n));bytes+=n}
  child.stdout.on('data',take(stdout));child.stderr.on('data',take(stderr));const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL')},15000)
  try{const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});if(failed||code!==0)fail('CONTAINER_OUTPUT_UNAVAILABLE',503);return {stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)}}finally{clearTimeout(timer)}
 }
 private async settle(id:string,c:Context,observed:any,artifact:(data:Buffer,c:Context)=>Promise<any>,reason:string|null){
  if(!observed||!['exited','dead'].includes(observed.State?.Status)||observed.State?.Running!==false){this.unknown(id);return}
  // Bounded tail logs survive a controller crash; rotation can omit old output.
  let logs:any
  try{logs=await this.logs(observed.Id)}catch{this.unknown(id,'CONTAINER_OUTPUT_UNAVAILABLE');return}
  const out=await artifact(logs.stdout,c),err=await artifact(logs.stderr,c),exitCode=observed.State.ExitCode
  const state=reason==='CANCELLED'||reason==='GRANT_REVOKED'?'cancelled':reason?'failed':exitCode===0?'succeeded':'failed'
  const result={kind:'container-command',containerId:observed.Id,exitCode,stdoutArtifactId:out.artifactId,stderrArtifactId:err.artifactId,truncated:true,outputPolicy:'bounded-tail',stopConfirmed:true,possiblyApplied:true,isolation:{mode:'container',image:this.config.image,network:'none',user:'65532:65532'}}
  this.store.db.transaction(()=>{this.store.finish(id,state,result,reason??(state==='failed'?'PROCESS_EXIT_NONZERO':null));this.store.db.prepare("UPDATE container_workers SET phase='settled',reason=? WHERE operation_id=?").run(reason,id)})()
  await this.cleanup(id,c).catch(()=>{})
 }
 async cleanup(id:string,c:Context){
  const row=this.row(id,c);if(!row||row.phase!=='settled'||!terminal.has(this.store.status(id,c).status))return
  const value=await this.inspect(row);if(!value){this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id);return}
  if(value.State?.Running!==false)fail('CONTAINER_STOP_UNCONFIRMED',503)
  await this.cli(['container','rm',value.Id]);this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id)
 }
 async observe(id:string,c:Context,artifact:(data:Buffer,c:Context)=>Promise<any>){return this.serialized(id,()=>this.observeOriginal(id,c,artifact))}
 private async observeOriginal(id:string,c:Context,artifact:(data:Buffer,c:Context)=>Promise<any>){
  const row=this.row(id,c);if(!row)return false
  if(terminal.has(this.store.status(id,c).status)){await this.cleanup(id,c).catch(()=>{});return true}
  if(this.sessions.has(id))return true
  try{
   const value=await this.inspect(row)
   if(['prepared','created'].includes(row.phase)){
    if(value?.State?.Running||value&&value.State?.Status!=='created'){this.unknown(id);return true}
    // The persisted start intent is absent, and this exact old controller died.
    // Remove the never-started owned object before publishing no-effects proof.
    if(value)await this.cli(['container','rm',value.Id])
    this.store.db.transaction(()=>{this.store.finish(id,'cancelled',{kind:'container-command',notStarted:true,stopConfirmed:true,possiblyApplied:false},'HOST_INTERRUPTED_BEFORE_START');this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id)})()
   }else if(value)await this.settle(id,c,value,artifact,row.reason)
   else this.unknown(id)
  }catch{this.unknown(id)}
  return true
 }
 async cancel(id:string,c:Context,why='CANCELLED'){
  const running=this.sessions.get(id);if(running){await running.cancel(why);return true}
  return this.serialized(id,()=>this.cancelOriginal(id,c,why))
 }
 private async cancelOriginal(id:string,c:Context,why:string){
  const row=this.row(id,c);if(!row||terminal.has(this.store.status(id,c).status))return !!row
  const value=await this.inspect(row)
  if(value?.State?.Running){this.store.db.prepare('UPDATE container_workers SET reason=? WHERE operation_id=?').run(why,id);await this.cli(['container','kill','--signal=KILL',value.Id],5000)}
  else if(value?.State?.Status==='created'){
   await this.cli(['container','rm',value.Id])
   this.store.db.transaction(()=>{this.store.finish(id,'cancelled',{kind:'container-command',stopConfirmed:true,possiblyApplied:row.phase==='starting',notStarted:row.phase!=='starting'},why);this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id)})()
  }
  return true
 }
 async sweep(artifact:(data:Buffer,c:Context)=>Promise<any>){
  if(this.sweeping||this.closing)return;this.sweeping=true
  try{const rows=this.store.db.prepare("SELECT operation_id,context FROM container_workers WHERE phase!='removed' AND operation_id>? ORDER BY operation_id LIMIT 4").all(this.sweepCursor);if(!rows.length)this.sweepCursor='';for(const row of rows){
   if(this.closing)break;this.sweepCursor=row.operation_id
   if(this.sessions.has(row.operation_id))continue
   const c=JSON.parse(row.context);let valid=true;try{this.store.validate(c)}catch{valid=false}
   if(!valid)try{await this.cancel(row.operation_id,c,'GRANT_REVOKED')}catch{}
   if(this.closing)break;try{await this.observe(row.operation_id,c,artifact)}catch{}
  }}finally{this.sweeping=false}
 }
 async run({id,c,rootId,workspace,workspaceIdentity,executable,argv,timeout,validate,validateWorkspace,shouldCancel,artifact}:{id:string;c:Context;rootId:string;workspace:string;workspaceIdentity:string;executable:string;argv:string[];timeout:number;validate:()=>void;validateWorkspace:()=>Promise<void>;shouldCancel:()=>boolean;artifact:(data:Buffer,c:Context)=>Promise<any>}){
  const name='dsh-worker-'+sha(canonical({machine:this.store.machineId,id})).slice(0,40),nonce=randomUUID(),digest=sha(canonical({rootId,workspace,workspaceIdentity,executable,argv,image:this.config.image}))
  const deadlineAt=Math.min(c.expiresAt,Date.now()+timeout),supervisorFile=await this.supervisor()
  const args=containerArguments({name,nonce,machineId:this.store.machineId,workspace,workspaceIdentity,config:this.config,executable,argv,deadlineAt,supervisorFile})
  this.store.db.prepare("INSERT INTO container_workers(operation_id,name,nonce,context,root_id,workspace,input_digest,phase,cid,reason,workspace_identity) VALUES (?,?,?,?,?,?,?,'prepared',NULL,NULL,?)").run(id,name,nonce,canonical(c),rootId,workspace,digest,workspaceIdentity)
  let reason:string|null=null,child:any,controlLost=false,cancelling:Promise<void>|undefined,closed=false
  const cancel=(why:string)=>{reason??=why;this.store.db.prepare('UPDATE container_workers SET reason=? WHERE operation_id=?').run(reason,id);return cancelling??=(async()=>{try{const row=this.row(id,c),value=await this.inspect(row);if(value?.State?.Running)await this.cli(['container','kill','--signal=KILL',value.Id],5000)}catch{controlLost=true}finally{if(child&&!closed){const timer=setTimeout(()=>{if(!closed){controlLost=true;try{process.kill(-child.pid,'SIGKILL')}catch{}}},3000);timer.unref()}}})()}
  this.sessions.set(id,{cancel});const timer=setTimeout(()=>void cancel('PROCESS_TIMEOUT'),timeout)
  try{
   validate();if(shouldCancel())reason='CANCELLED'
   if(reason){this.store.finish(id,'cancelled',{kind:'container-command',notStarted:true,stopConfirmed:true,possiblyApplied:false},reason);this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id);return}
   const ready=await this.probe();if(ready.status!=='dependency-ready')fail('CONTAINER_DEPENDENCY_UNAVAILABLE',503)
   await validateWorkspace();validate()
   const cid=await this.cli(args);if(!/^[a-f0-9]{64}$/.test(cid))fail('CONTAINER_CONTROL_UNAVAILABLE',503)
   this.store.db.prepare("UPDATE container_workers SET cid=?,phase='created' WHERE operation_id=?").run(cid,id)
   await validateWorkspace();validate();if(shouldCancel())reason??='CANCELLED'
   if(reason){const row=this.row(id,c),value=await this.inspect(row);if(value?.State?.Status!=='created')fail('OUTCOME_UNKNOWN');await this.cli(['container','rm',cid]);this.store.db.transaction(()=>{this.store.finish(id,'cancelled',{kind:'container-command',notStarted:true,stopConfirmed:true,possiblyApplied:false},reason);this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id)})();return}
   this.store.db.prepare("UPDATE container_workers SET phase='starting' WHERE operation_id=?").run(id)
   child=spawn(this.config.dockerExecutable,['container','start','-a',cid],{env:this.dockerEnv,detached:true,stdio:['ignore','ignore','ignore'],windowsHide:true})
   await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>{closed=true;resolve()})});await cancelling
   if(controlLost){this.unknown(id);return}
   await this.settle(id,c,await this.inspect(this.row(id,c)),artifact,reason)
  }catch(e:any){
   const row=this.row(id,c)
   if(row?.phase==='starting'){this.unknown(id)}
   else{
    // Even a failed create request may have reached the daemon. Observe this
    // owned name before deciding no process could have run.
    try{const value=await this.inspect(row);if(value?.State?.Status!=='created'&&value!==null)throw Error();if(value)await this.cli(['container','rm',value.Id]);this.store.db.transaction(()=>{this.store.finish(id,reason?'cancelled':'failed',{kind:'container-command',notStarted:true,stopConfirmed:true,possiblyApplied:false},reason??(e instanceof AgentError?e.code:'EXECUTION_FAILED'));this.store.db.prepare("UPDATE container_workers SET phase='removed' WHERE operation_id=?").run(id)})()}catch{this.unknown(id)}
   }
  }finally{clearTimeout(timer);this.sessions.delete(id)}
 }
 async close(){this.closing=true;await Promise.all([...this.sessions.values()].map(s=>s.cancel('CANCELLED')));await Promise.allSettled([...this.controls.values()]);while(this.sweeping)await new Promise(r=>setTimeout(r,10))}
}
