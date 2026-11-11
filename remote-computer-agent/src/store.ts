import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, unlinkSync, chmodSync, fstatSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { canonical, fail, identifier, matches, secret, sha, TOOL_NAMES, type Context } from './protocol.js'
import { SecurePairing, MAX_PAIRED_CLIENTS } from './secure-pairing.js'
export class Store {
  pairing: SecurePairing
  db:any;machineId:string;private lockFd:number|undefined;private lockPath:string;private controllerGuard:any;private closed=false;private admin=false
  constructor(public dataDir:string,Database?:any,options:{admin?:boolean}={}) {
    this.admin=options.admin===true
    mkdirSync(dataDir,{recursive:true,mode:0o700});chmodSync(dataDir,0o700)
    this.lockPath=join(dataDir,'agent.lock')
    try {
    const Driver=Database??createRequire(import.meta.url)('better-sqlite3')
    if(!options.admin){
      // A lifetime transaction in a separate private file is a kernel-held
      // semaphore. Stale PID readers cannot unlink each other's new ownership.
      const guardPath=join(dataDir,'agent-instance.sqlite')
      try{const s=lstatSync(guardPath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('AGENT_LOCKED')}catch(e:any){if(e.code!=='ENOENT')throw e}
      this.controllerGuard=new Driver(guardPath)
      this.controllerGuard.pragma('busy_timeout = 0')
      try{this.controllerGuard.exec('BEGIN IMMEDIATE')}catch(e:any){if(e.code?.startsWith('SQLITE_BUSY')||e.code?.startsWith('SQLITE_LOCKED'))fail('AGENT_LOCKED');throw e}
      try {this.lockFd=openSync(this.lockPath,'wx',0o600)} catch {
      let old:any;try{old=JSON.parse(readFileSync(this.lockPath,'utf8'))}catch{fail('AGENT_LOCKED')}
      if(!Number.isSafeInteger(old?.pid)||old.pid<=0||typeof old.instanceId!=='string'||!old.instanceId)fail('AGENT_LOCKED')
      try{process.kill(old.pid,0);fail('AGENT_LOCKED')}catch(e:any){if(e.code!=='ESRCH')throw e}
      unlinkSync(this.lockPath);this.lockFd=openSync(this.lockPath,'wx',0o600)
    }
    writeFileSync(this.lockFd!,JSON.stringify({pid:process.pid,instanceId:randomUUID()}))}
      this.db=new Driver(join(dataDir,'agent.sqlite'))
      this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 5000')
      this.db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,digest TEXT NOT NULL,revision INTEGER NOT NULL,revoked INTEGER NOT NULL,ceiling TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS grants(digest TEXT PRIMARY KEY,context TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS grants_identity ON grants(json_extract(context,'$.grantId'));
        CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,digest TEXT NOT NULL,context TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,result TEXT,error TEXT);
        CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,context TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL,media TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS worktrees(id TEXT PRIMARY KEY,context TEXT NOT NULL,root TEXT NOT NULL,path TEXT NOT NULL,head TEXT NOT NULL,source TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time INTEGER NOT NULL,code TEXT NOT NULL,actor TEXT,operation TEXT);`)
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('machineId',`machine-${randomUUID()}`)
      this.machineId=this.db.prepare('SELECT value FROM meta WHERE key=?').get('machineId').value
      this.pairing=new SecurePairing(this.db,this.machineId,(id,ceiling)=>this.commitClient(id,ceiling))
      if(!options.admin)this.db.prepare("UPDATE operations SET status='unknown',error='OUTCOME_UNKNOWN' WHERE status IN ('admitted','running','cancel_pending')").run()
      // Tickets are process-lifetime credentials; a restart requires explicit reissuance.
      if(!options.admin)this.db.prepare('DELETE FROM grants').run()
    } catch(e) {try{this.db?.close()}catch{};this.releaseController();throw e}
  }
  private releaseController(){
    try{
      if(this.lockFd!==undefined){
        let same=false;try{const fd=fstatSync(this.lockFd),named=lstatSync(this.lockPath);same=fd.dev===named.dev&&fd.ino===named.ino&&!named.isSymbolicLink()}catch{}
        closeSync(this.lockFd);this.lockFd=undefined
        if(same)try{unlinkSync(this.lockPath)}catch(e:any){if(e.code!=='ENOENT')throw e}
      }
    }finally{if(this.controllerGuard){try{this.controllerGuard.exec('ROLLBACK')}catch{};this.controllerGuard.close();this.controllerGuard=undefined}}
  }
  private approvedCeiling(id:string,ceiling:{botIds?:string[];hostManagedBots?:boolean;roots:string[];tools:string[]}) {
    identifier(id)
    if(!ceiling||ceiling.hostManagedBots!==undefined&&typeof ceiling.hostManagedBots!=='boolean'||!Array.isArray(ceiling.botIds??[])||!Array.isArray(ceiling.roots)||!ceiling.roots.length||!Array.isArray(ceiling.tools)||!ceiling.tools.length||ceiling.tools.some(x=>!TOOL_NAMES.includes(x)))fail('INVALID_CEILING')
    const managed=ceiling.hostManagedBots===true,botIds=ceiling.botIds??[]
    if(managed&&!this.admin)fail('ADMIN_REQUIRED',403)
    if(!managed&&!botIds.length)fail('INVALID_CEILING')
    botIds.forEach(identifier);ceiling.roots.forEach(identifier)
    const saved={botIds,roots:ceiling.roots,tools:ceiling.tools,...(managed?{hostManagedBots:true}:{})}
    return saved
  }
  private commitClient(id:string,ceiling:{botIds:string[];hostManagedBots?:boolean;roots:string[];tools:string[]}) { return this.db.transaction(()=>{
    const previous=this.db.prepare('SELECT revoked FROM clients WHERE id=?').get(id);if(previous&&!previous.revoked)fail('CLIENT_ALREADY_PAIRED',409)
    if(this.db.prepare('SELECT count(*) AS n FROM clients WHERE revoked=0').get().n>=MAX_PAIRED_CLIENTS)fail('PAIRING_DEVICE_LIMIT',429)
    const token=secret();if(previous)this.db.prepare('UPDATE clients SET digest=?,revision=revision+1,revoked=0,ceiling=? WHERE id=? AND revoked=1').run(sha(token),canonical(ceiling),id)
    else this.db.prepare('INSERT INTO clients VALUES (?,?,1,0,?)').run(id,sha(token),canonical(ceiling));return {clientId:id,token,machineId:this.machineId,secretRef:`remote-agent/${this.machineId}/${id}`,hostManagedBots:ceiling.hostManagedBots===true}
  }).immediate() }
  pair(id:string,ceiling:{botIds?:string[];hostManagedBots?:boolean;roots:string[];tools:string[]}) { return this.commitClient(id,this.approvedCeiling(id,ceiling)) }
  invite(id:string,ceiling:{botIds?:string[];hostManagedBots?:boolean;roots:string[];tools:string[]},options:{endpoint:string;name?:string}) { if(!this.admin)fail('ADMIN_REQUIRED',403);return this.pairing.create(id,this.approvedCeiling(id,ceiling),options) }
  client(token:string) {if(typeof token!=='string'||token.length>256)fail('AUTH_INVALID',401);const row=this.db.prepare('SELECT * FROM clients WHERE digest=?').get(sha(token));const verified=matches(token,row?.digest??'0'.repeat(64));if(!verified||!row||row.revoked)fail('AUTH_INVALID',401);return row}
  rotate(id:string) {return this.db.transaction(()=>{
    identifier(id);const row=this.db.prepare('SELECT revoked FROM clients WHERE id=?').get(id);if(!row)fail('AUTH_INVALID',401)
    if(row.revoked&&this.db.prepare('SELECT count(*) AS n FROM clients WHERE revoked=0').get().n>=MAX_PAIRED_CLIENTS)fail('PAIRING_DEVICE_LIMIT',429)
    const token=secret();this.db.prepare('UPDATE clients SET digest=?,revision=revision+1,revoked=0 WHERE id=?').run(sha(token),id);this.pairing.invalidate(id);return {clientId:id,token}
  }).immediate() }
  revoke(id:string) {this.db.prepare('UPDATE clients SET revoked=1,revision=revision+1 WHERE id=?').run(identifier(id));this.pairing.invalidate(id)}
  private currentClient(client:any){const row=this.db.prepare('SELECT * FROM clients WHERE id=?').get(client?.id);if(!row||row.revoked||row.revision!==client.revision||row.digest!==client.digest)fail('AUTH_INVALID',401);return row}
  issue(client:any,request:any) {
    client=this.currentClient(client)
    const ceiling=JSON.parse(client.ceiling);for(const key of ['botId','taskId','attemptId'])identifier(request[key])
    if(ceiling.hostManagedBots!==true&&!ceiling.botIds.includes(request.botId)||!Array.isArray(request.roots)||!Array.isArray(request.tools)||request.roots.some((x:string)=>!ceiling.roots.includes(x))||request.tools.some((x:string)=>!ceiling.tools.includes(x)))fail('SCOPE_DENIED',403)
    const ttl=request.ttlMs??300000;if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>300000)fail('INVALID_ARGUMENT')
    this.db.prepare("DELETE FROM grants WHERE json_extract(context,'$.expiresAt')<=?").run(Date.now())
    if(this.db.prepare('SELECT count(*) AS count FROM grants').get().count>=4096)fail('GRANT_LIMIT',429)
    const context={clientId:client.id,botId:request.botId,taskId:request.taskId,attemptId:request.attemptId,roots:request.roots,tools:request.tools,expiresAt:Date.now()+ttl,revision:client.revision,grantId:randomUUID()}
    const token=secret();this.db.prepare('INSERT INTO grants VALUES (?,?)').run(sha(token),canonical(context));return {grantToken:token,machineId:this.machineId,agentApiMajor:1,...context}
  }
  grant(token:string):Context {if(typeof token!=='string'||token.length>256)fail('AUTH_INVALID',401);const row=this.db.prepare('SELECT digest,context FROM grants WHERE digest=?').get(sha(token));const verified=matches(token,row?.digest??'0'.repeat(64));if(!verified||!row)fail('AUTH_INVALID',401);const context=JSON.parse(row.context);this.validate(context);return context}
  validate(c:Context) {const row=this.db.prepare('SELECT revision,revoked FROM clients WHERE id=?').get(c.clientId);if(!row||row.revoked||row.revision!==c.revision||c.expiresAt<=Date.now()||!c.grantId||!this.db.prepare("SELECT 1 FROM grants WHERE json_extract(context,'$.grantId')=?").get(c.grantId))fail('GRANT_REVOKED',403)}
  revokeGrants(client:any,request:any) {
    client=this.currentClient(client)
    identifier(request.botId)
    const ceiling=JSON.parse(client.ceiling);if(ceiling.hostManagedBots!==true&&!ceiling.botIds.includes(request.botId))fail('SCOPE_DENIED',403)
    // An authenticated Host may revoke its own tickets, never another client's.
    const result=this.db.prepare("DELETE FROM grants WHERE json_extract(context,'$.clientId')=? AND json_extract(context,'$.botId')=?").run(client.id,request.botId)
    return {machineId:this.machineId,agentApiMajor:1,revoked:result.changes,botId:request.botId}
  }
  admit(id:string,context:Context,tool:string,args:any) {
    identifier(id);const digest=sha(canonical({clientId:context.clientId,botId:context.botId,taskId:context.taskId,attemptId:context.attemptId,tool,args}))
    return this.db.transaction(()=>{const row=this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);if(row){if(row.digest!==digest)fail('OPERATION_CONFLICT',409);return {fresh:false,operation:this.decode(row)}}
      this.db.prepare("INSERT INTO operations(id,digest,context,tool,status,started) VALUES (?,?,?,?,'admitted',?)").run(id,digest,canonical(context),tool,Date.now());return {fresh:true,operation:this.status(id,context)}})()
  }
  own(saved:string,c:Context) {const v=JSON.parse(saved);if(v.clientId!==c.clientId||v.botId!==c.botId||v.taskId!==c.taskId||v.attemptId!==c.attemptId)fail('SCOPE_DENIED',403)}
  status(id:string,c:Context) {const row=this.db.prepare('SELECT * FROM operations WHERE id=?').get(identifier(id));if(!row)fail('OPERATION_NOT_FOUND',404);this.own(row.context,c);return this.decode(row)}
  decode(row:any) {return {schemaVersion:1,machineId:this.machineId,operationId:row.id,tool:row.tool,status:row.status,startedAt:new Date(row.started).toISOString(),finishedAt:row.finished?new Date(row.finished).toISOString():null,result:row.result?JSON.parse(row.result):null,error:row.error?{code:row.error}:null}}
  finish(id:string,status:string,result:any=null,error:string|null=null) {this.db.prepare('UPDATE operations SET status=?,result=?,error=?,finished=? WHERE id=?').run(status,result===null?null:canonical(result),error,Date.now(),id)}
  running(id:string) {this.db.prepare("UPDATE operations SET status='running' WHERE id=? AND status='admitted'").run(id)}
  audit(code:string,actor:string|null=null,operation:string|null=null){this.db.prepare('INSERT INTO audit(time,code,actor,operation) VALUES (?,?,?,?)').run(Date.now(),code,actor,operation);this.db.prepare('DELETE FROM audit WHERE id < (SELECT max(id)-10000 FROM audit)').run()}
  close(){if(this.closed)return;this.closed=true;this.pairing?.close();try{this.db.close()}finally{this.releaseController()}}
}
