import {constants,type BigIntStats} from 'node:fs'
import {lstat,mkdir,open,readFile,realpath,stat,unlink,writeFile,type FileHandle} from 'node:fs/promises'
import path from 'node:path'
import {canonical,fail,sha} from './protocol.js'

export type WorkspaceIdentity={key:string;ancestors:string[];path:string;platform:'linux'|'win32'}
type PhysicalIdentity={dev:string;ino:string;birth:string}
function physical(s:BigIntStats):PhysicalIdentity{
 if(!s.isDirectory()||s.ino<=0n||s.dev<0n||s.birthtimeNs<=0n)fail('WORKSPACE_IDENTITY_UNAVAILABLE',503)
 return {dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)}
}
const key=(s:BigIntStats)=>sha(canonical(physical(s)))

/**
 * Cross-dataDir physical-root exclusion (Linux).
 *
 * The per-dataDir journal cannot see a second Agent instance on the same host
 * with its own database. The held directory inode therefore also owns an
 * exclusive claim file under a stable system path keyed by dev:ino, so two
 * processes pinning the same physical root (aliases included — the inode is
 * the identity) cannot both hold it. The claim carries the owner PID; a
 * verifiably dead owner's claim is reclaimed with the same
 * fstat-vs-lstat identity discipline as the controller lock. Nested captures
 * inside one process share the outer claim, which is what lets the container
 * shell re-pin a cwd that withWorkspace already pinned. An unavailable lock
 * directory (for example a different service user owns it) degrades to the
 * previous single-database semantics with an audit-visible marker instead of
 * breaking a previously working workspace.
 */
const ROOT_LOCK_DIRECTORY='/tmp/dsh-agent-root-locks'
type RootLock={count:number;path:string;handle:FileHandle}
const rootLocks=new Map<string,RootLock|Promise<RootLock>>()
export const rootLockDegrades:{lastUnavailableAt:number|null}={lastUnavailableAt:null}
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(e:any){return e?.code==='EPERM'}}

async function createRootClaim(lockPath:string):Promise<RootLock>{
  await mkdir(ROOT_LOCK_DIRECTORY,{recursive:true,mode:0o700}).catch(()=>{})
  for(let attempt=0;attempt<2;attempt++){
    let handle:FileHandle|undefined
    try{
      handle=await open(lockPath,'wx',0o600)
      await writeFile(handle,JSON.stringify({pid:process.pid}))
      return {count:1,path:lockPath,handle}
    }catch(e:any){
      await handle?.close().catch(()=>{})
      const code=(e as {code?:string})?.code
      if(code==='EACCES'||code==='EPERM'){rootLockDegrades.lastUnavailableAt=Date.now();return {count:1,path:'',handle:undefined as unknown as FileHandle}}
      if(code!=='EEXIST')throw e
    }
    // Another process holds the claim. Steal it only when its owner is
    // verifiably dead and the file on the name is still the one we read.
    let stolen=false
    try{
      const held=await open(lockPath,'r'),self=await held.stat(),named=await lstat(lockPath)
      try{
        const owner=JSON.parse(await readFile(held,{encoding:'utf8'}))
        if(!alive(Number(owner?.pid))&&named.dev===self.dev&&named.ino===self.ino&&!named.isSymbolicLink()){
          await unlink(lockPath).catch(()=>{});stolen=true
        }
      }finally{await held.close()}
    }catch{}
    if(!stolen)fail('WORKSPACE_BUSY',409)
  }
  fail('WORKSPACE_BUSY',409)
}

async function acquireRootLock(stat:{dev:bigint;ino:bigint}):Promise<RootLock>{
  const lockKey=`${stat.dev}:${stat.ino}`
  const existing=rootLocks.get(lockKey)
  if(existing){const lock=await existing;lock.count++;return lock}
  const pending=createRootClaim(`${ROOT_LOCK_DIRECTORY}/${lockKey}`).then(lock=>{rootLocks.set(lockKey,lock);return lock})
  rootLocks.set(lockKey,pending)
  try{return await pending}catch(e){rootLocks.delete(lockKey);throw e}
}

async function releaseRootLock(lockKey:string,lock:RootLock):Promise<void>{
  if(--lock.count>0)return
  if(rootLocks.get(lockKey)===lock)rootLocks.delete(lockKey)
  if(!lock.handle)return
  try{
    const self=await lock.handle.stat(),named=await lstat(lock.path)
    if(named.dev===self.dev&&named.ino===self.ino&&!named.isSymbolicLink())await unlink(lock.path).catch(()=>{})
  }catch{}
  await lock.handle.close().catch(()=>{})
}
async function snapshot(target:string):Promise<{identity:WorkspaceIdentity;physical:PhysicalIdentity}>{
 if(!['linux','win32'].includes(process.platform)||typeof target!=='string'||!path.isAbsolute(target)||target.length>4096||target.includes('\0'))fail('WORKSPACE_IDENTITY_UNAVAILABLE',503)
 const actual=await realpath(target),first=await stat(actual,{bigint:true}),ancestors:string[]=[]
 let current=actual
 for(let depth=0;;depth++){
  if(depth>=128)fail('WORKSPACE_IDENTITY_UNAVAILABLE',503)
  ancestors.push(key(depth===0?first:await stat(current,{bigint:true})))
  const parent=path.dirname(current);if(parent===current)break;current=parent
 }
 if(key(await stat(actual,{bigint:true}))!==ancestors[0]||await realpath(target)!==actual)fail('WORKSPACE_CHANGED',409)
 return {identity:{key:ancestors[0],ancestors:[...new Set(ancestors)],path:actual,platform:process.platform as 'linux'|'win32'},physical:physical(first)}
}

/** Trusted filesystem observation, never a model-supplied identity or a lease. */
export class WorkspacePin{
 private closed=false
 private constructor(public readonly identity:WorkspaceIdentity,public readonly mountIdentity:string,private handle?:FileHandle,private rootLock?:{key:string;lock:RootLock}){}
 static async capture(target:string){
  const value=await snapshot(target);let handle:FileHandle|undefined,rootLock:{key:string;lock:RootLock}|undefined
  try{
   if(process.platform==='linux'){
    handle=await open(value.identity.path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
    const held=await handle.stat({bigint:true})
    if(key(held)!==value.identity.key)fail('WORKSPACE_CHANGED',409)
    // One physical inode, one cross-process claim, nested captures refcounted.
    const stat={dev:held.dev,ino:held.ino}
    rootLock={key:`${stat.dev}:${stat.ino}`,lock:await acquireRootLock(stat)}
   }
   const pin=new WorkspacePin(Object.freeze({...value.identity,ancestors:Object.freeze(value.identity.ancestors)}) as WorkspaceIdentity,canonical(value.physical),handle,rootLock)
   await pin.verify();return pin
  }catch(e){await handle?.close();if(rootLock)await releaseRootLock(rootLock.key,rootLock.lock).catch(()=>{});throw e}
 }
 get scanPath(){if(this.closed)fail('WORKSPACE_PIN_CLOSED');return this.handle?`/proc/${process.pid}/fd/${this.handle.fd}/.`:this.identity.path}
 async verify(){
  if(this.closed)fail('WORKSPACE_PIN_CLOSED')
  const current=await snapshot(this.identity.path)
  if(canonical(current.identity)!==canonical(this.identity)||current.physical&&canonical(current.physical)!==this.mountIdentity)fail('WORKSPACE_CHANGED',409)
  if(this.handle&&(key(await this.handle.stat({bigint:true}))!==this.identity.key||await realpath(`/proc/${process.pid}/fd/${this.handle.fd}`)!==this.identity.path))fail('WORKSPACE_CHANGED',409)
 }
 async close(){if(this.closed)return;this.closed=true;if(this.rootLock)await releaseRootLock(this.rootLock.key,this.rootLock.lock).catch(()=>{});await this.handle?.close()}
}
