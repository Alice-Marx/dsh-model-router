import { readFile, writeFile, mkdir, rename, unlink, lstat, stat, realpath } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AGENT_VERSION, AGENT_API_MAJOR, AgentError, canonical, fail, integer, isMutating, sha, TOOL_NAMES, type Context } from './protocol.js'
import { Store } from './store.js'
import { Roots } from './scope.js'
import { BrowserTools } from './browser.js'
import { DesktopTools } from './desktop.js'
import { DesktopSessions } from './desktop-session.js'
import {ContainerCommands,type ContainerCommandConfig} from './container-command.js'
import {WorkspacePin} from './workspace-identity.js'
import {WorkspaceAdmissions} from './workspace-admission.js'
import {reconcileRootsGeneration,rootsGeneration} from './workspace-generation.js'
import {pinnedCreateNewFile,pinnedWriteSupported} from './pinned-write.js'
import {CliTasks,validateCliProfiles,type CliProfileConfig} from './cli-task.js'
const execFileAsync=promisify(execFile)
const ARTIFACT_QUOTA_BYTES=256*1024*1024
export type AgentConfig={dataDir:string;roots:Record<string,string>;executables?:Record<string,string>;shell?:string;windowsJobRunner?:string;browserOrigins?:string[];browserExecutablePath?:string;browserProfiles?:Record<string,string>;isolation?:'os-account'|'container'|'application';container?:ContainerCommandConfig;desktop?:{pipeName:string;secretFile:string};cliProfiles?:CliProfileConfig[]}
export class Agent {
  store:Store;roots:Roots;browser:BrowserTools;desktop:DesktopTools;desktopSessions:DesktopSessions;workspaces:WorkspaceAdmissions;container?:ContainerCommands;cliTasks:CliTasks;rootsGeneration:string;private processes=new Map<string,any>();private jobs=new Map<string,Promise<any>>();private desktopJobs=new Map<string,{context:Context;cancel:(why:string)=>Promise<void>}>();private cancelRequested=new Set<string>();private writes=new Set<string>();private authTimer:any
  constructor(public config:AgentConfig,Database?:any){const cliProfiles=validateCliProfiles(config.cliProfiles,config.dataDir,config.roots);this.store=new Store(resolve(config.dataDir),Database);this.roots=new Roots(config.roots,{protectedPaths:[resolve(config.dataDir),...(config.desktop?[resolve(config.desktop.secretFile)]:[])]});this.cliTasks=new CliTasks(cliProfiles,this.store,this.roots);this.browser=new BrowserTools(config.browserOrigins??[],config.browserExecutablePath,undefined,config.browserProfiles);this.desktop=new DesktopTools(config.desktop,{validate:c=>this.store.validate(c)})
    try{
     // Which roots configuration produced the persisted workspace state. A
     // changed mapping between runs fences unsettled admissions instead of
     // letting them be interpreted against roots they were not admitted under.
     this.rootsGeneration=rootsGeneration(config.roots)
     this.workspaces=new WorkspaceAdmissions(this.store,this.rootsGeneration)
     this.store.db.exec('CREATE TABLE IF NOT EXISTS agent_stop_receipts(operation_id TEXT PRIMARY KEY REFERENCES operations(id),proof TEXT NOT NULL)')
     // Older journals have no physical-root receipt. Keep an explicit recovery
     // fence instead of assuming those unknown writers had no effects.
     this.store.db.exec(`CREATE TABLE IF NOT EXISTS workspace_legacy_fences(operation_id TEXT PRIMARY KEY);
       INSERT OR IGNORE INTO workspace_legacy_fences SELECT id FROM operations WHERE tool IN ('fs_write','shell_exec','worktree_create','worktree_integrate') AND status IN ('admitted','running','cancel_pending','unknown') AND NOT EXISTS(SELECT 1 FROM workspace_admissions WHERE operation_id=operations.id);`)
     const generationChange=reconcileRootsGeneration(this.store.db,this.rootsGeneration)
     if(generationChange.changed)this.store.audit('WORKSPACE_ROOTS_GENERATION_CHANGED')
     if(config.container){if(config.isolation!=='container'||Object.keys(config.executables??{}).length||config.shell||config.windowsJobRunner)fail('CONTAINER_CONFIG_INVALID');this.container=new ContainerCommands(this.store,config.container)}else if(config.isolation==='container')fail('CONTAINER_CONFIG_INVALID')
    }catch(e){this.store.close();throw e}
    this.desktopSessions=new DesktopSessions(config.desktop,{validate:c=>this.store.validate(c),audit:(code,actor,operation)=>this.store.audit(code,actor,operation)})
    this.authTimer=setInterval(()=>{for(const p of [...this.processes.values(),...this.desktopJobs.values()]){try{this.store.validate(p.context)}catch{void p.cancel('GRANT_REVOKED')}};void this.container?.sweep((data,c)=>this.artifact(data,c,'text/plain')).catch(()=>{})},100);this.authTimer.unref()}
  async call(name:string,args:any,c:Context,operationId?:string) {
    this.store.validate(c);if(!TOOL_NAMES.includes(name)||!c.tools.includes(name))fail('SCOPE_DENIED',403)
    if(args?.rootId&&!c.roots.includes(args.rootId))fail('SCOPE_DENIED',403)
    if(name==='cli_probe_v1')return this.cliTasks.probe(args,c,operationId)
    if(name==='machine_ping')return {schemaVersion:1,machineId:this.store.machineId,agentVersion:AGENT_VERSION,agentApiMajor:AGENT_API_MAJOR,rootsGeneration:this.rootsGeneration,os:{platform:process.platform,arch:process.arch},node:process.version,isolation:this.config.isolation??'application',isolationStatus:this.container?'command-container':'configuration-only',container:this.container?await this.container.probe():null,capabilities:TOOL_NAMES.filter(n=>(!n.startsWith('desktop_')||!!this.config.desktop)&&(!this.container||!n.startsWith('worktree_'))),browser:await this.browser.probe(),shell:{configured:!!this.container||!!Object.keys(this.config.executables??{}).length||!!this.config.shell,processIsolation:this.container?'container':process.platform==='win32'?(this.config.windowsJobRunner?'job-object-configured':'unavailable'):'process-group'},desktop:{configured:!!this.config.desktop,status:this.config.desktop?'unverified':'unavailable'}}
    if(name==='operation_status'){if(this.container){await this.container.observe(args.operationId,c,(data,context)=>this.artifact(data,context,'text/plain'));this.store.validate(c)}return this.operationStatus(args.operationId,c)}
    if(name==='operation_cancel'){
      this.store.status(args.operationId,c)
      const p=this.processes.get(args.operationId),desktop=this.desktopJobs.get(args.operationId),pending=this.jobs.has(args.operationId)
      let requested=!!p||!!desktop||pending
      if(p)await p.cancel('CANCELLED');else if(desktop)await desktop.cancel('CANCELLED');else if(pending)this.cancelRequested.add(args.operationId);else if(this.container)requested=await this.container.cancel(args.operationId,c)
      if(this.container){await this.container.observe(args.operationId,c,(data,context)=>this.artifact(data,context,'text/plain'));this.store.validate(c)}
      const operation=this.operationStatus(args.operationId,c)
      const terminal=['succeeded','failed','cancelled'].includes(operation.status)
      // A terminal journal row alone does not prove an external process or
      // helper has stopped. Trust only the original strict boolean evidence.
      // Successful file writes await all in-process I/O and cleanup. A failed
      // write without explicit evidence is not enough to infer that it stopped.
      // A file write confirms stopping only through its own completed
      // in-process chain, and only when no tracked job or controller for it
      // remains. A raw stopConfirmed on a failed or cancelled write, or the
      // mere absence of tracked processes, is not proof that the write
      // stopped or that it never ran.
      const inProcessWrite=operation.tool==='fs_write'&&!!operation.stopProof
      const evidence=operation.tool!=='fs_write'&&(operation.result?.stopConfirmed===true||operation.result?.notStarted===true)
      const writeSettled=operation.tool!=='fs_write'||(!this.jobs.has(args.operationId)&&!this.processes.has(args.operationId))
      const stopConfirmed=terminal&&writeSettled&&(inProcessWrite||evidence)
      return {cancelRequested:requested,stopConfirmed,...(stopConfirmed&&operation.stopProof?{stopProof:operation.stopProof}:{}),operation}
    }
    if(!isMutating(name))return this.execute(name,args,c)
    if(!operationId)fail('OPERATION_ID_REQUIRED');const admitted=this.store.admit(operationId,c,name,args);if(!admitted.fresh)return name==='fs_write'?this.operationStatus(operationId,c):admitted.operation
    this.store.running(operationId)
    if(name==='cli_task_v1'){
      const job=(async()=>{
        let settled
        try{settled=await this.cliTasks.run(args,c,operationId,{setProcess:record=>this.processes.set(operationId,record),clearProcess:()=>this.processes.delete(operationId)})}
        catch(e:any){settled={status:'unknown',result:{kind:'remote-cli',schemaVersion:1,receipt:null,stopConfirmed:false,stopEvidence:{treeStopped:false,status:'unconfirmed'}},error:'OUTCOME_UNKNOWN'}}
        this.jobs.delete(operationId);this.processes.delete(operationId);this.cancelRequested.delete(operationId)
        this.store.finish(operationId,settled.status,settled.result,settled.error)
        return this.operationStatus(operationId,c)
      })().finally(()=>{this.jobs.delete(operationId);this.processes.delete(operationId);this.cancelRequested.delete(operationId)})
      this.jobs.set(operationId,job);return this.store.status(operationId,c)
    }
    if(name==='shell_exec'||name==='container_command_v1'){
      // The versioned command backend is container-only by construction: a
      // non-container Agent settles the operation as never-started instead of
      // throwing (a thrown refusal would leave an unsettled admitted
      // operation and an unknown Task forever), argv is the only input shape,
      // and the native shell path below stays unreachable for it.
      const commandOnly=name==='container_command_v1'
      const job=(async()=>{
        if(commandOnly){
          if(!this.container)fail('CONTAINER_COMMAND_UNAVAILABLE',503)
          if(args?.script!==undefined||!args?.workspaceRef?.rootId)fail('INVALID_ARGUMENT')
        }
        return this.container?this.withWorkspace(args.workspaceRef?.rootId,c,operationId,()=>this.shell(args,c,operationId)):this.shell(args,c,operationId)
      })().catch(e=>{
        const notStarted=commandOnly&&!this.container||(this.container&&!this.store.db.prepare('SELECT 1 FROM container_workers WHERE operation_id=?').get(operationId))
        this.store.finish(operationId,'failed',notStarted?{notStarted:true,stopConfirmed:true,possiblyApplied:false}:null,e instanceof AgentError?e.code:'EXECUTION_FAILED')
      }).finally(()=>{this.jobs.delete(operationId);this.cancelRequested.delete(operationId)});this.jobs.set(operationId,job);return this.store.status(operationId,c)}
    if(name==='fs_write'){
      const controller=new AbortController()
      this.processes.set(operationId,{context:c,cancel:async(why:string)=>{controller.abort(new AgentError(why))}})
      const job=(async()=>{
       try{
        const result=await this.withWorkspace(args.rootId,c,operationId,pin=>this.execute(name,args,c,controller.signal,pin))
        this.store.finish(operationId,controller.signal.aborted?'cancelled':'succeeded',controller.signal.aborted?{...result,stopConfirmed:true,possiblyApplied:true}:{...result,stopConfirmed:true},controller.signal.aborted?'CANCELLED':null)
       }catch(e:any){
        const cancelled=e?.code==='WRITE_CANCELLED',published=e?.published===true,unknown=!cancelled&&(published||e?.code==='OUTCOME_UNKNOWN')
        // This catch runs only after the in-process write and awaited cleanup
        // have settled. Post-publication cancellation can retain a shape-checked
        // digest; every other post-publication error remains unknown and locked.
        const digest=cancelled&&published&&e?.result&&/^[a-f0-9]{64}$/.test(e.result.sha256)&&Number.isSafeInteger(e.result.size)&&e.result.size>=0&&e.result.size<=1048576?{sha256:e.result.sha256,size:e.result.size}:{}
        this.store.finish(operationId,cancelled?'cancelled':unknown?'unknown':'failed',unknown?null:{stopConfirmed:true,possiblyApplied:cancelled&&e?.possiblyApplied===false?false:true,...digest},cancelled&&published?'CANCELLED':unknown?'OUTCOME_UNKNOWN':e instanceof AgentError?e.code:'EXECUTION_FAILED')
       }
       finally{this.jobs.delete(operationId);this.processes.delete(operationId);this.cancelRequested.delete(operationId)}
       // This independent receipt is written only by the settled in-process
       // chain, never reconstructed from raw stopConfirmed/notStarted flags.
       const operation=this.store.status(operationId,c)
       if(['succeeded','failed','cancelled'].includes(operation.status)){
        const proof={schemaVersion:1,kind:'agent-stop-receipt',source:'in-process-write',machineId:this.store.machineId,taskId:c.taskId,attemptId:c.attemptId,operationId,tool:'fs_write',status:operation.status,receiptHash:sha(canonical(operation))}
        this.store.db.prepare('INSERT OR REPLACE INTO agent_stop_receipts VALUES(?,?)').run(operationId,canonical(proof))
       }
       return this.operationStatus(operationId,c)
      })()
      this.jobs.set(operationId,job);return job
    }
    if(name.startsWith('desktop_')){
      const controller=new AbortController();let job:Promise<any>
      const cancel=async(why:string)=>{controller.abort(new AgentError(why));await this.desktop.cancel(c);await job}
      job=(async()=>{
        try{const result=await this.execute(name,args,c,controller.signal);this.store.validate(c);if(controller.signal.aborted){const stop=await this.desktop.cancel(c);throw Object.assign(new AgentError(stop.stopConfirmed?'DESKTOP_CANCELLED':'OUTCOME_UNKNOWN'),{stopConfirmed:stop.stopConfirmed,possiblyApplied:name!=='desktop_screenshot'})}this.store.finish(operationId,'succeeded',result)}
        catch(e:any){
          if(e.code==='GRANT_REVOKED'){controller.abort(e);const stop=await this.desktop.cancel(c);e=Object.assign(new AgentError(stop.stopConfirmed?'DESKTOP_CANCELLED':'OUTCOME_UNKNOWN'),{stopConfirmed:stop.stopConfirmed,possiblyApplied:name!=='desktop_screenshot'})}
          const code=e instanceof AgentError?e.code:'EXECUTION_FAILED',stopped=e.stopConfirmed===true,possiblyApplied=e.possiblyApplied===true
          const state=code==='DESKTOP_CANCELLED'&&stopped?'cancelled':code==='OUTCOME_UNKNOWN'||possiblyApplied?'unknown':'failed'
          this.store.finish(operationId,state,{stopConfirmed:stopped,possiblyApplied,cancelReason:controller.signal.aborted?(controller.signal.reason?.code??'CANCELLED'):null},code)
        }finally{this.desktopJobs.delete(operationId);this.jobs.delete(operationId)}
        return this.store.status(operationId,c)
      })()
      this.jobs.set(operationId,job);this.desktopJobs.set(operationId,{context:c,cancel});return job
    }
    try{const result=await this.execute(name,args,c);this.store.finish(operationId,'succeeded',result)}catch(e){this.store.finish(operationId,e instanceof AgentError&&e.code==='OUTCOME_UNKNOWN'?'unknown':'failed',null,e instanceof AgentError?e.code:'EXECUTION_FAILED')}
    return this.store.status(operationId,c)
  }
  private operationStatus(id:string,c:Context){
    const operation=this.store.status(id,c),saved=this.store.db.prepare('SELECT proof FROM agent_stop_receipts WHERE operation_id=?').get(id)
    if(!saved||this.jobs.has(id)||this.processes.has(id))return operation
    const proof=JSON.parse(saved.proof)
    if(proof.schemaVersion!==1||proof.kind!=='agent-stop-receipt'||proof.source!=='in-process-write'||proof.machineId!==operation.machineId||proof.taskId!==c.taskId||proof.attemptId!==c.attemptId||proof.operationId!==id||proof.tool!==operation.tool||proof.status!==operation.status||proof.receiptHash!==sha(canonical(operation)))return operation
    return {...operation,stopProof:proof}
  }
  async artifact(data:Buffer,c:Context,media='application/octet-stream'){
    if(data.length>8*1024*1024)fail('ARTIFACT_LIMIT',413)
    // Artifacts are delivery objects (one screenshot, one stream tail), not history. Without a
    // sweep the quota is a one-way stop: every later screenshot and command would fail
    // ARTIFACT_QUOTA with nothing able to free space. The oldest rows go first, and only when
    // the new artifact would not fit.
    const usage=await this.evictArtifacts(data.length)
    if(usage+data.length>ARTIFACT_QUOTA_BYTES)fail('ARTIFACT_QUOTA',507)
    const id=`artifact-${randomUUID()}`;await mkdir(join(this.config.dataDir,'artifacts'),{recursive:true,mode:0o700});await writeFile(join(this.config.dataDir,'artifacts',id),data,{flag:'wx',mode:0o600})
    this.store.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?,?)').run(id,canonical(c),sha(data),data.length,media);return {artifactId:id,sha256:sha(data),size:data.length,mediaType:media}
  }
  private async evictArtifacts(needed:number){
    let usage:number=this.store.db.prepare('SELECT coalesce(sum(size),0) AS size FROM artifacts').get().size
    if(usage+needed<=ARTIFACT_QUOTA_BYTES)return usage
    const rows:any[]=this.store.db.prepare('SELECT id,size FROM artifacts ORDER BY rowid ASC').all()
    for(const row of rows){
      if(usage+needed<=ARTIFACT_QUOTA_BYTES)break
      this.store.db.prepare('DELETE FROM artifacts WHERE id=?').run(row.id)
      usage-=row.size
      await unlink(join(this.config.dataDir,'artifacts',row.id)).catch(()=>{})
    }
    return usage
  }
  async execute(name:string,a:any,c:Context,signal?:AbortSignal,pin?:WorkspacePin):Promise<any>{
    if(name==='fs_list'){const all=await this.roots.list(a.rootId,a.relativePath??'');all.sort((x,y)=>x.name.localeCompare(y.name));const offset=integer(a.cursor?Number(a.cursor):0,0,1e9),limit=integer(a.limit,1,1000,100);return {entries:all.slice(offset,offset+limit).map(x=>({name:x.name,type:x.isSymbolicLink()?'link':x.isDirectory()?'directory':'file'})),cursor:offset+limit<all.length?String(offset+limit):null}}
    if(name==='fs_read'){const offset=integer(a.offset,0,Number.MAX_SAFE_INTEGER,0),length=integer(a.length,1,1048576,65536);const {data,size}=await this.roots.read(a.rootId,a.relativePath,offset,length);return {encoding:'base64',content:data.toString('base64'),sha256:sha(data),offset,size,eof:offset+data.length>=size}}
    if(name==='fs_write')return this.write(a,c,signal,pin)
    if(name.startsWith('artifact_')){const row=this.store.db.prepare('SELECT * FROM artifacts WHERE id=?').get(a.artifactId);if(!row)fail('ARTIFACT_NOT_FOUND',404);this.store.own(row.context,c);if(name==='artifact_stat')return {artifactId:row.id,sha256:row.hash,size:row.size,mediaType:row.media};const offset=integer(a.offset,0,Number.MAX_SAFE_INTEGER,0),length=integer(a.length,1,1048576,65536),data=await readFile(join(this.config.dataDir,'artifacts',row.id));if(sha(data)!==row.hash)fail('ARTIFACT_CORRUPT');return {encoding:'base64',content:data.subarray(offset,offset+length).toString('base64'),eof:offset+length>=row.size}}
    if(name.startsWith('browser_'))return this.browser.run(name,a,c)
    if(name.startsWith('desktop_')){const result=await this.desktop.run(name,a,c,signal);this.store.validate(c);if(result.pngBase64){const artifact=await this.artifact(Buffer.from(result.pngBase64,'base64'),c,'image/png');delete result.pngBase64;return {...result,...artifact}}return result}
    if(name.startsWith('worktree_'))return this.worktree(name,a,c)
    fail('TOOL_NOT_READY',503)
  }
  private async withWorkspace(rootId:string,c:Context,id:string,run:(pin:WorkspacePin)=>Promise<any>){
    if(typeof rootId!=='string'||!c.roots.includes(rootId))fail('WORKSPACE_OUTSIDE_SCOPE',403)
    const pin=await WorkspacePin.capture(await this.roots.resolve(rootId,''))
    try{
     const legacy=this.store.db.prepare(`SELECT o.id FROM workspace_legacy_fences f JOIN operations o ON o.id=f.operation_id WHERE o.status IN ('admitted','running','cancel_pending','unknown') OR (o.tool='shell_exec' AND NOT (o.status IN ('succeeded','failed','cancelled') AND (coalesce(json_type(o.result,'$.stopConfirmed'),'null')='true' OR coalesce(json_type(o.result,'$.notStarted'),'null')='true'))) LIMIT 1`).get()
     if(legacy)fail('WORKSPACE_RECOVERY_REQUIRED',409)
     // Same fail-closed contract for admissions that predate the current
     // roots configuration: until the fenced operation settles with stop
     // evidence, no mutating workspace operation interprets persisted state.
     const generationFenced=this.store.db.prepare(`SELECT o.id FROM workspace_generation_fences f JOIN operations o ON o.id=f.operation_id WHERE o.status IN ('admitted','running','cancel_pending','unknown') OR (o.tool='shell_exec' AND NOT (o.status IN ('succeeded','failed','cancelled') AND (coalesce(json_type(o.result,'$.stopConfirmed'),'null')='true' OR coalesce(json_type(o.result,'$.notStarted'),'null')='true'))) LIMIT 1`).get()
     if(generationFenced)fail('WORKSPACE_RECOVERY_REQUIRED',409)
     this.workspaces.admit(id,c,pin.identity);await pin.verify();return await run(pin)
    }finally{await pin.close()}
  }
  async write(a:any,c:Context,signal?:AbortSignal,pin?:WorkspacePin){
    if(signal?.aborted)throw Object.assign(new AgentError('WRITE_CANCELLED',409),{possiblyApplied:false})
    if(!Object.hasOwn(a,'expectedHash')||(a.expectedHash!==null&&!/^[a-f0-9]{64}$/.test(a.expectedHash)))fail('EXPECTED_HASH_REQUIRED')
    if(typeof a.content!=='string'||Buffer.byteLength(a.content)>1048576||!['utf8','base64',undefined].includes(a.encoding))fail('INVALID_ARGUMENT')
    const target=await this.roots.resolve(a.rootId,a.relativePath,true);if(this.writes.has(target))fail('FILE_CHANGED',409);this.writes.add(target)
    try{
      if(pinnedWriteSupported())return await this.pinnedWrite(a,c,signal,target,pin)
      return await this.legacyWrite(a,c,signal,target)
    }finally{this.writes.delete(target)}
  }
  /**
   * Descriptor-pinned publication for Linux: only brand-new files. Every
   * existing target answers the public FILE_CHANGED contract, an explicit
   * hash-overwrite request is refused outright instead of falling back to the
   * rename path, and a missing target keeps the old mismatch answer.
   */
  private async pinnedWrite(a:any,c:Context,signal:AbortSignal|undefined,target:string,pin?:WorkspacePin){
    if(a.expectedHash!==null){
      // Only a matching hash is an actual overwrite attempt (refused); a
      // mismatched expectation and a missing target keep the public CAS
      // refusal contract instead of reading as "unsupported".
      try{const data=(await this.roots.read(a.rootId,a.relativePath,0,1048577)).data;if(data.length>1048576)fail('FILE_TOO_LARGE');fail(sha(data)===a.expectedHash?'OVERWRITE_UNSUPPORTED':'FILE_CHANGED',sha(data)===a.expectedHash?501:409)}
      catch(e:any){if(e.code!=='ENOENT')throw e;fail('FILE_CHANGED',409)}
    }
    try{
      const result=await pinnedCreateNewFile({
        rootPath:pin?pin.identity.path:await realpath(await this.roots.resolve(a.rootId,'')),
        relativePath:a.relativePath,content:a.content,encoding:a.encoding,signal,
        check:report=>this.pinnedWritePolicy(a,c,pin,report)})
      return {sha256:result.sha256,size:result.size}
    }catch(e:any){
      if(e instanceof AgentError&&e.code==='TARGET_EXISTS')fail('FILE_CHANGED',409)
      throw e
    }
  }
  /** Grant, protected-path and root-identity rechecks at every pinned-write phase. */
  protected async pinnedWritePolicy(a:any,c:Context,pin:WorkspacePin|undefined,report:{phase:string;targetPath:string}){
    this.store.validate(c)
    await this.roots.assertPublicTree(report.targetPath)
    if(pin)await pin.verify()
  }
  private async legacyWrite(a:any,c:Context,signal:AbortSignal|undefined,target:string){
    const temp=join(dirname(target),`.dsh-write-${randomUUID()}`)
    try{const parent=await stat(dirname(target));let previous:Buffer|null=null;try{previous=(await this.roots.read(a.rootId,a.relativePath,0,1048577)).data;if(previous.length>1048576)fail('FILE_TOO_LARGE')}catch(e:any){if(e.code!=='ENOENT')throw e}
      if((previous===null?null:sha(previous))!==a.expectedHash)fail('FILE_CHANGED',409)
      const data=Buffer.from(a.content,a.encoding??'utf8');await writeFile(temp,data,{flag:'wx',mode:0o600})
      if(signal?.aborted)throw Object.assign(new AgentError('WRITE_CANCELLED',409),{possiblyApplied:false})
      this.store.validate(c);await this.roots.resolve(a.rootId,a.relativePath,true);const now=await stat(dirname(target));if(now.ino!==parent.ino||now.dev!==parent.dev)fail('FILE_CHANGED',409)
      let current:Buffer|null=null;try{current=(await this.roots.read(a.rootId,a.relativePath,0,1048577)).data}catch(e:any){if(e.code!=='ENOENT')throw e}
      if((current===null?null:sha(current))!==a.expectedHash)fail('FILE_CHANGED',409)
      if(signal?.aborted)throw Object.assign(new AgentError('WRITE_CANCELLED',409),{possiblyApplied:false})
      await rename(temp,target);return {sha256:sha(data),size:data.length}
    }finally{await unlink(temp).catch(()=>{})}
  }
  async shell(a:any,c:Context,id:string){
    if(!a.workspaceRef||a.workspaceRef.kind!=='remote'||a.workspaceRef.machineId!==this.store.machineId||!c.roots.includes(a.workspaceRef.rootId))fail('WORKSPACE_OUTSIDE_SCOPE',403)
    const cwd=await this.roots.resolve(a.workspaceRef.rootId,a.workspaceRef.relativePath??'');if(!(await stat(cwd)).isDirectory())fail('WORKSPACE_OUTSIDE_SCOPE')
    const timeout=integer(a.timeoutMs,1,1800000,60000);let executable:string,argv:string[]
    if(this.container){
      if(a.argv){if(!Array.isArray(a.argv)||a.argv.length<1||a.argv.length>256||a.argv.some((x:any)=>typeof x!=='string'||x.includes('\0')))fail('INVALID_ARGUMENT');executable=this.config.container!.executables[a.argv[0]];if(!executable)fail('EXECUTABLE_NOT_ALLOWED',403);argv=a.argv.slice(1)}
      else{if(this.config.container!.shell!==true||typeof a.script!=='string'||a.script.length>1048576)fail('SCRIPT_NOT_ALLOWED',403);executable='/bin/sh';argv=['-c',a.script]}
      const pin=await WorkspacePin.capture(cwd)
      try{
       await this.roots.assertContainerTree(pin.scanPath)
       this.processes.set(id,{context:c,cancel:(why:string)=>this.container!.cancel(id,c,why)})
       await this.container.run({id,c,rootId:a.workspaceRef.rootId,workspace:pin.identity.path,workspaceIdentity:pin.mountIdentity,executable,argv,timeout,validate:()=>this.store.validate(c),validateWorkspace:()=>pin.verify(),shouldCancel:()=>this.cancelRequested.has(id),artifact:(data,context)=>this.artifact(data,context,'text/plain')})
      }finally{this.processes.delete(id);await pin.close()}
      return
    }
    if(a.argv){if(!Array.isArray(a.argv)||a.argv.length<1||a.argv.length>256||a.argv.some((x:any)=>typeof x!=='string'||x.includes('\0')))fail('INVALID_ARGUMENT');executable=this.config.executables?.[a.argv[0]];if(!executable)fail('EXECUTABLE_NOT_ALLOWED',403);argv=a.argv.slice(1)}
    else {if(!this.config.shell||typeof a.script!=='string'||a.script.length>1048576)fail('SCRIPT_NOT_ALLOWED',403);executable=this.config.shell;argv=process.platform==='win32'?['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(a.script,'utf16le').toString('base64')]:['-c',a.script]}
    this.store.validate(c);if(this.cancelRequested.has(id)){this.store.finish(id,'cancelled',null,'CANCELLED');return}
    if(process.platform==='win32'&&!this.config.windowsJobRunner)fail('PROCESS_ISOLATION_UNAVAILABLE',503)
    const child=spawn(process.platform==='win32'?this.config.windowsJobRunner!:executable,process.platform==='win32'?[]:argv,{cwd,windowsHide:true,detached:process.platform!=='win32',env:{PATH:process.env.PATH??'',SystemRoot:process.env.SystemRoot??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??'',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']})
    if(process.platform==='win32')child.stdin.end(JSON.stringify({executable,args:argv,cwd})+'\n');else child.stdin.end()
    child.stdin.on('error',()=>{})
    let stdout:Buffer[]=[],stderr:Buffer[]=[],bytes=0,truncated=false,reason:string|null=null,cancelPromise:Promise<void>|null=null
    const capture=(target:Buffer[]) => (chunk:Buffer)=>{const remaining=8*1024*1024-bytes;if(remaining>0){target.push(chunk.subarray(0,remaining));bytes+=Math.min(remaining,chunk.length)}if(chunk.length>remaining)truncated=true}
    child.stdout.on('data',capture(stdout));child.stderr.on('data',capture(stderr))
    const cancel=(why:string)=>{if(cancelPromise)return cancelPromise;reason=why;cancelPromise=(async()=>{if(child.exitCode!==null||child.signalCode!==null)return
      if(process.platform==='win32'){if(!child.kill('SIGKILL')&&child.exitCode===null&&child.signalCode===null)this.store.db.prepare("UPDATE operations SET status='cancel_pending',error='CANCEL_PENDING' WHERE id=?").run(id)}
      else {try{process.kill(-child.pid!,'SIGTERM')}catch{}await new Promise(r=>setTimeout(r,200));try{process.kill(-child.pid!,'SIGKILL')}catch{}}
    })();return cancelPromise}
    this.processes.set(id,{child,context:c,cancel});const timer=setTimeout(()=>void cancel('PROCESS_TIMEOUT'),timeout)
    try{const exit=await new Promise<any>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({exitCode:code,signal}))});await cancelPromise
      const out=await this.artifact(Buffer.concat(stdout),c,'text/plain'),err=await this.artifact(Buffer.concat(stderr),c,'text/plain')
      this.store.finish(id,reason==='CANCELLED'?'cancelled':reason?'failed':exit.exitCode===0?'succeeded':'failed',{...exit,stdoutArtifactId:out.artifactId,stderrArtifactId:err.artifactId,truncated},reason??(exit.exitCode===0?null:'PROCESS_EXIT_NONZERO'))
    }finally{clearTimeout(timer);this.processes.delete(id)}
  }
  async git(cwd:string,args:string[]){return (await execFileAsync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:60000,maxBuffer:8*1024*1024,windowsHide:true,env:{...process.env,GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'}})).stdout.trim()}
  async worktree(name:string,a:any,c:Context){
    // Git can execute repository-configured helpers. Container mode must never
    // cross back into the Agent's native account through a worktree tool.
    if(this.container)fail('CONTAINER_TOOL_UNAVAILABLE',503)
    if(name==='worktree_create'){
      const source=await this.roots.resolve(a.rootId,a.relativePath??'');await this.roots.assertPublicTree(source);if(await this.git(source,['status','--porcelain']))fail('WORKSPACE_DIRTY',409)
      const head=await this.git(source,['rev-parse','HEAD']);const id=`worktree-${randomUUID()}`,relative=a.worktreeRelativePath
      if(typeof relative!=='string')fail('INVALID_ARGUMENT');const target=await this.roots.resolve(a.rootId,relative,true);if(target===source||this.roots.inside(source,target))fail('INVALID_WORKTREE_PATH')
      this.store.validate(c);await this.git(source,['worktree','add','--detach',target,head]);this.store.db.prepare('INSERT INTO worktrees VALUES (?,?,?,?,?,?)').run(id,canonical(c),a.rootId,target,head,source);return {worktreeId:id,rootId:a.rootId,relativePath:relative,sourceHead:head}
    }
    const row=this.store.db.prepare('SELECT * FROM worktrees WHERE id=?').get(a.worktreeId);if(!row)fail('WORKTREE_NOT_FOUND',404);this.store.own(row.context,c);if(!c.roots.includes(row.root))fail('SCOPE_DENIED',403)
    const base=await realpath(this.config.roots[row.root]);for(const p of [row.path,row.source]){if(!this.roots.inside(base,await realpath(p)))fail('WORKSPACE_OUTSIDE_SCOPE',403);await this.roots.assertPublicTree(p)}
    const patch=await this.git(row.path,['diff','--binary',row.head]);if(name==='worktree_diff')return {sourceHead:row.head,...await this.artifact(Buffer.from(patch+'\n'),c,'text/x-diff')}
    if(await this.git(row.path,['rev-parse','HEAD'])!==row.head||await this.git(row.source,['rev-parse','HEAD'])!==row.head||await this.git(row.source,['status','--porcelain']))return {status:'integration-pending',reason:'SOURCE_CHANGED',worktreeId:a.worktreeId}
    const patchFile=join(this.config.dataDir,`patch-${randomUUID()}`);await writeFile(patchFile,patch+'\n',{mode:0o600})
    try{if(!patch)return {status:'no-changes'};await this.git(row.source,['apply','--check',patchFile]);this.store.validate(c);await this.git(row.source,['apply',patchFile]);return {status:'integrated',sourceHead:row.head,patchSha256:sha(patch)}}catch(e){if(e instanceof AgentError)throw e;return {status:'integration-pending',reason:'PATCH_CONFLICT',worktreeId:a.worktreeId}}finally{await unlink(patchFile)}
  }
  async close(){clearInterval(this.authTimer);const sessions=await this.desktopSessions.close();for(const id of this.jobs.keys())this.cancelRequested.add(id);await Promise.all([...this.processes.values(),...this.desktopJobs.values()].map(p=>p.cancel('CANCELLED')));await this.container?.close();const desktop=await this.desktop.close();await Promise.all([...this.jobs.values()]);await this.browser.close();this.store.close();return {desktopStopConfirmed:desktop.stopConfirmed&&sessions.stopConfirmed}}
}
