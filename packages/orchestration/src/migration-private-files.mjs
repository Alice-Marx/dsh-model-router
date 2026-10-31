import {mkdir,rmdir,lstat,open,realpath} from 'node:fs/promises'
import {isAbsolute,join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'

const execute=promisify(execFile)
const fail=code=>{throw Object.assign(new Error(code),{code})}
export async function createPrivateMigrationDirectory(path){
  if(typeof path!=='string'||!isAbsolute(path))fail('MIGRATION_PRIVATE_OUTPUT_ABSOLUTE_REQUIRED')
  await mkdir(path,{mode:0o700})
  try{
    if(process.platform==='win32'){
      const system=join(process.env.SystemRoot??'C:/Windows','System32')
      const who=await execute(join(system,'whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true,timeout:5000,maxBuffer:65536})
      const sid=who.stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];if(!sid)fail('MIGRATION_PRIVATE_ACL_FAILED')
      await execute(join(system,'icacls.exe'),[path,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,timeout:5000,maxBuffer:65536})
    }else if((await lstat(path)).mode&0o077)fail('MIGRATION_PRIVATE_ACL_FAILED')
    if((await lstat(path)).isSymbolicLink())fail('MIGRATION_PRIVATE_ACL_FAILED')
  }catch{await rmdir(path).catch(()=>{});fail('MIGRATION_PRIVATE_ACL_FAILED')}
}

/** New owner-controlled directory only; no arbitrary relative paths. */
export async function writePrivateMigrationFile(directory,name,bytes){
  if(!/^[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/.test(name)||!Buffer.isBuffer(bytes))fail('MIGRATION_PRIVATE_FILE_INVALID')
  const canonical=await realpath(directory),path=join(canonical,name),handle=await open(path,'wx',0o600)
  try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
  const result=await hashPrivateMigrationFile(canonical,name,bytes.length)
  if(result.bytes!==bytes.length||result.sha256!==createHash('sha256').update(bytes).digest('hex'))fail('MIGRATION_PRIVATE_OUTPUT_VERIFY_FAILED')
  return result
}

export async function hashPrivateMigrationFile(directory,name,maxBytes,{sync=false,signal}={}){
  if(!/^[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/.test(name)||!Number.isSafeInteger(maxBytes)||maxBytes<0)fail('MIGRATION_PRIVATE_FILE_INVALID')
  const root=await realpath(directory),path=join(root,name),before=await lstat(path,{bigint:true})
  if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(maxBytes)||await realpath(path)!==path)fail('MIGRATION_PRIVATE_FILE_INVALID')
  const handle=await open(path,sync?'r+':'r')
  try{
    const opened=await handle.stat({bigint:true}),identity=s=>['dev','ino','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':')
    if(identity(before)!==identity(opened))fail('MIGRATION_PRIVATE_OUTPUT_CHANGED')
    const h=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0
    while(true){
      if(signal?.aborted)fail('MIGRATION_LEDGER_CANCELLED')
      const r=await handle.read(buffer,0,buffer.length,null);if(!r.bytesRead)break
      bytes+=r.bytesRead;if(bytes>maxBytes)fail('MIGRATION_PRIVATE_OUTPUT_LIMIT');h.update(buffer.subarray(0,r.bytesRead))
    }
    if(sync)await handle.sync()
    const after=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true})
    if(identity(before)!==identity(after)||identity(before)!==identity(named)||BigInt(bytes)!==before.size||await realpath(path)!==path)fail('MIGRATION_PRIVATE_OUTPUT_CHANGED')
    return {bytes,sha256:h.digest('hex')}
  }finally{await handle.close()}
}
