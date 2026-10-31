import {constants,lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync} from 'node:fs'
import {join,resolve} from 'node:path'
const phases=new Set(['prepared','maintenance','installing','validating','committed','rolling-back','rolled-back'])
const fail=code=>{throw Object.assign(new Error(code),{code})}
export function readMigrationStartupGate({home}={}){
 if(typeof home!=='string')fail('PROFILE_MIGRATION_GATE_INVALID')
 // DSH_HOME itself can be an intentional Windows junction. Bind to its
 // canonical home, while the gate file must remain a regular unlinked file.
 let directory;try{directory=realpathSync(resolve(home))}catch(e){if(e.code==='ENOENT')return null;fail('PROFILE_MIGRATION_GATE_UNREADABLE')}
 const file=join(directory,'migration-gate.json');let before
 try{before=lstatSync(file)}catch(e){if(e.code==='ENOENT')return null;fail('PROFILE_MIGRATION_GATE_UNREADABLE')}
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>16384||realpathSync(directory)!==directory)fail('PROFILE_MIGRATION_GATE_INVALID')
 const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
 try{
  const opened=fstatSync(fd),bytes=readFileSync(fd),after=fstatSync(fd),named=lstatSync(file)
  if(bytes.length>16384||[opened,after,named].some(s=>s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs))fail('PROFILE_MIGRATION_GATE_CHANGED')
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{fail('PROFILE_MIGRATION_GATE_INVALID')}
  if(value?.schemaVersion!==1)fail('PROFILE_MIGRATION_GATE_VERSION_UNSUPPORTED')
  if(value.kind!=='profile-migration-gate'||value.home!==directory||typeof value.operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.operationId)||!phases.has(value.phase)||typeof value.operationDirectory!=='string'||!/^[a-f0-9]{64}$/.test(value.planDigest??'')||!Number.isSafeInteger(value.journalEvents)||value.journalEvents<0||!/^[a-f0-9]{64}$/.test(value.journalHead??''))fail('PROFILE_MIGRATION_GATE_INVALID')
  return value
 }finally{closeSync(fd)}
}

/** Invoke before opening any new product writer. This does not stop old Hosts. */
export function assertMigrationStartupAllowed({home}={}){
 const gate=readMigrationStartupGate({home})
 if(gate&&!['committed','rolled-back'].includes(gate.phase))fail('PROFILE_MIGRATION_PENDING')
 return {allowed:true,maintenanceRecorded:gate!==null}
}
