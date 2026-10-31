import {constants} from 'node:fs'
import {open,lstat,realpath,readdir,copyFile,rename,link,unlink} from 'node:fs/promises'
import {resolve,join,dirname,basename,relative,isAbsolute,sep} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {hostname} from 'node:os'
import {createPrivateMigrationDirectory,writePrivateMigrationFile} from './migration-private-files.mjs'
import {readMigrationStartupGate} from './migration-startup-gate.mjs'
import {renameMigrationFile} from './migration-atomic-rename.mjs'
import {migrationImageMetadataMismatch,migrationImageCtimeRetry} from './migration-file-stability.mjs'
import {setTimeout as sleep} from 'node:timers/promises'

const fail=(code,diagnostic)=>{throw Object.assign(new Error(code),{code,...(diagnostic?{diagnostic}:{})})},sha=bytes=>createHash('sha256').update(bytes).digest('hex'),encode=value=>Buffer.from(JSON.stringify(value)+'\n')
const identity=s=>({dev:String(s.dev),ino:String(s.ino)}),same=(a,b)=>a?.dev===b?.dev&&a?.ino===b?.ino
const metadata=s=>({identity:identity(s),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),nlink:String(s.nlink)})
const within=(root,path)=>{const p=relative(root,path);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)}
const maximum=8*1024**2
const OPERATION_ID=/^[A-Za-z0-9_.-]{1,128}$/,GATE_OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
async function imageOnce(path,{missing=false,links=1}={}){
 let named;try{named=await lstat(path,{bigint:true})}catch(e){if(missing&&e.code==='ENOENT')return null;throw e}
 if(!named.isFile()||named.isSymbolicLink()||![links].flat().some(n=>named.nlink===BigInt(n))||named.size>BigInt(maximum)||await realpath(path)!==path)fail('MIGRATION_COMMIT_FILE_INVALID')
 const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
 try{
  const opened=await fd.stat({bigint:true});if(!same(identity(named),identity(opened)))fail('MIGRATION_COMMIT_SOURCE_CHANGED',{check:'open-identity',expected:metadata(named),actual:metadata(opened)})
  const data=Buffer.alloc(Number(named.size)+1);let n=0
  while(n<data.length){const r=await fd.read(data,n,data.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead}
  const after=await fd.stat({bigint:true}),again=await lstat(path,{bigint:true}),unstable=migrationImageMetadataMismatch(named,opened,after,again)
  if(unstable)fail('MIGRATION_COMMIT_SOURCE_CHANGED',{check:'read-stable',observation:unstable.observation,field:unstable.field,expected:metadata(unstable.baseline),actual:metadata(unstable.actual)})
  if(n!==Number(named.size))fail('MIGRATION_COMMIT_SOURCE_CHANGED',{check:'read-length',expectedBytes:Number(named.size),actualBytes:n})
  const bytes=data.subarray(0,n);return {bytes,digest:sha(bytes),identity:identity(named),mode:Number(named.mode&0o777n)}
 }finally{await fd.close()}
}
async function image(path,options){
 for(let attempt=0;;attempt++)try{return await imageOnce(path,options)}catch(error){if(attempt>=2||!migrationImageCtimeRetry(error))throw error;await sleep(10)}
}
async function syncDirectory(path){if(process.platform==='win32')return;const fd=await open(path,'r');try{await fd.sync()}finally{await fd.close()}}
async function atomicJson(path,value){
 const temp=join(dirname(path),'.migration-gate-'+randomUUID()+'.tmp'),fd=await open(temp,'wx',0o600)
 try{await fd.writeFile(encode(value));await fd.sync()}finally{await fd.close()}
 try{await renameMigrationFile(temp,path);await syncDirectory(dirname(path))}finally{await unlink(temp).catch(()=>{})}
}
async function canonicalDirectory(path){if(typeof path!=='string'||!isAbsolute(path)||await realpath(path)!==resolve(path)||(await lstat(path)).isSymbolicLink())fail('MIGRATION_COMMIT_PATH_INVALID');return resolve(path)}
const alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code==='EPERM'}}
async function exclusive(home,id,recover,run){
 const path=join(home,'migration-gate.lock'),token=randomUUID(),owner={id,token,pid:process.pid,host:hostname()};let fd
 try{fd=await open(path,'wx',0o600)}catch(e){
  if(e.code!=='EEXIST')throw e
  const existing=await image(path);let value;try{if(existing.bytes.length>16384)fail('MIGRATION_COMMIT_BUSY');value=JSON.parse(existing.bytes.toString('utf8'))}catch{fail('MIGRATION_COMMIT_BUSY')}
  if(!recover||value.id!==id||value.host!==hostname()||!Number.isSafeInteger(value.pid)||value.pid<1||alive(value.pid))fail('MIGRATION_COMMIT_BUSY')
  const again=await image(path);if(again.digest!==existing.digest||!same(again.identity,existing.identity))fail('MIGRATION_COMMIT_BUSY')
  await unlink(path);fd=await open(path,'wx',0o600)
 }
 try{await fd.writeFile(encode(owner));await fd.sync();return await run()}finally{
  await fd.close()
  const saved=await image(path,{missing:true}).catch(()=>null)
  if(saved){let value;try{value=JSON.parse(saved.bytes.toString('utf8'))}catch{}if(value?.token===token)await unlink(path)}
 }
}
async function load(directory){
 directory=await canonicalDirectory(directory);const raw=await image(join(directory,'transaction.private.json'));let plan
 try{plan=JSON.parse(raw.bytes.toString('utf8'))}catch{fail('MIGRATION_COMMIT_PLAN_INVALID')}
 if(plan?.schemaVersion!==1||plan.kind!=='private-configuration-transaction'||plan.directory!==directory||!Array.isArray(plan.changes)||plan.changes.length<1||plan.changes.length>64||!Array.isArray(plan.attestationsRequired)||plan.attestationsRequired.join(',')!=='stopped-hosts,complete-domains,consistent-backups,artifact,permissions,money')fail('MIGRATION_COMMIT_PLAN_INVALID')
 await canonicalDirectory(plan.home)
 const gate=readMigrationStartupGate({home:plan.home});if(!gate||gate.operationId!==plan.id||gate.planDigest!==raw.digest||gate.operationDirectory!==directory)fail('MIGRATION_COMMIT_GATE_MISMATCH')
 const events=[],names=(await readdir(directory)).filter(n=>/^event-\d{5}\.json$/.test(n)).sort();let previous=raw.digest
 for(let i=0;i<names.length;i++){
  if(names[i]!==`event-${String(i).padStart(5,'0')}.json`||i>1000)fail('MIGRATION_COMMIT_JOURNAL_INVALID')
  const bytes=await image(join(directory,names[i]));let row;try{row=JSON.parse(bytes.bytes.toString('utf8'))}catch{fail('MIGRATION_COMMIT_JOURNAL_INVALID')}
  const {digest,...body}=row;if(row.index!==i||row.previous!==previous||sha(encode(body))!==digest)fail('MIGRATION_COMMIT_JOURNAL_INVALID');events.push(row);previous=digest
 }
 if(!Number.isSafeInteger(gate.journalEvents)||gate.journalEvents<0||gate.journalEvents>events.length||(gate.journalEvents===0?raw.digest:events[gate.journalEvents-1].digest)!==gate.journalHead)fail('MIGRATION_COMMIT_JOURNAL_INVALID')
 return {plan,gate,events,previous,digest:raw.digest}
}
async function event(state,value){
 const row={index:state.events.length,previous:state.previous,...value},digest=sha(encode(row)),complete={...row,digest}
 await writePrivateMigrationFile(state.plan.directory,`event-${String(row.index).padStart(5,'0')}.json`,encode(complete));state.events.push(complete);state.previous=digest
 state.gate={...state.gate,journalEvents:state.events.length,journalHead:digest};await atomicJson(join(state.plan.home,'migration-gate.json'),state.gate)
}
async function setGate(state,phase){
 await atomicJson(join(state.plan.home,'migration-gate.json'),{...state.gate,phase});state.gate={...state.gate,phase}
}
function accepted(state,index,value){
 const row=state.plan.changes[index]
 if(value===null)return false
 if(row.before!==null&&value.digest===sha(Buffer.from(row.before,'base64'))&&same(value.identity,row.beforeIdentity))return true
 return state.events.some(e=>e.type==='write-intent'&&e.change===index&&e.nextDigest===value.digest&&same(e.stagedIdentity,value.identity))
}
async function recognized(state,index,value){
 if(accepted(state,index,value))return true
 if(value!==null)return false
 const pending=state.events.filter(e=>e.type==='write-intent'&&e.change===index).at(-1)
 if(!pending)return state.plan.changes[index].before===null
 const completed=state.events.some(e=>e.type==='write-complete'&&e.change===index&&e.index>pending.index)
 if(pending.nextDigest===null&&completed)return true
 if(!completed&&state.plan.changes[index].before===null&&pending.previousIdentity===null)return true
 if(!pending?.retiredPath)return false
 const retired=await image(pending.retiredPath,{missing:true})
 return retired!==null&&same(retired.identity,pending.previousIdentity)&&accepted(state,index,retired)
}
async function currentImage(state,index,{cleanup=false}={}){
 const path=state.plan.changes[index].path,value=await image(path,{missing:true,links:[1,2]})
 if(!value)return null
 const info=await lstat(path)
 if(info.nlink===2){
  const pending=state.events.filter(e=>e.type==='write-intent'&&e.change===index&&e.stagePath&&same(e.stagedIdentity,value.identity)).at(-1)
  if(!pending)fail('MIGRATION_COMMIT_FILE_INVALID')
  const staged=await image(pending.stagePath,{links:2});if(staged.digest!==value.digest||!same(staged.identity,value.identity))fail('MIGRATION_COMMIT_FILE_INVALID')
  if(cleanup){await unlink(pending.stagePath);return image(path)}
 }
 return value
}
async function cleanupOwnedTemps(state){
 for(const e of state.events.filter(e=>e.type==='write-intent'))for(const [path,expected] of [[e.stagePath,e.stagedIdentity],[e.retiredPath,e.previousIdentity]]){
  if(!path)continue;const value=await image(path,{missing:true});if(!value)continue
  const reservation=path===e.retiredPath&&same(value.identity,e.retiredReservationIdentity)&&value.digest===sha(Buffer.alloc(0))
  if(!reservation&&(!same(value.identity,expected)||!accepted(state,e.change,value)))fail('MIGRATION_COMMIT_SOURCE_CHANGED')
  await unlink(path);await syncDirectory(dirname(path))
 }
}
async function verifyOwned(state,index,path,expected){
 const value=await image(path,{missing:true});if(!value||value.digest!==expected.digest||!same(value.identity,expected.identity))fail('MIGRATION_COMMIT_SOURCE_CHANGED');return value
}
async function replace(state,index,phase,next,onStep){
 const row=state.plan.changes[index],path=row.path,parent=await canonicalDirectory(dirname(path)),desired=next===null?null:Buffer.from(next,'base64')
 let current=await currentImage(state,index,{cleanup:true})
 if(!await recognized(state,index,current))fail('MIGRATION_COMMIT_SOURCE_CHANGED')
 if(desired!==null&&current?.digest===sha(desired)||desired===null&&current===null)return
 const pending=state.events.filter(e=>e.type==='write-intent'&&e.change===index).at(-1)
 let retired
 if(current===null&&pending?.retiredPath){retired=await image(pending.retiredPath,{missing:true});if(retired&&(!accepted(state,index,retired)||!same(retired.identity,pending.previousIdentity)))fail('MIGRATION_COMMIT_SOURCE_CHANGED')}
 const stage=join(parent,`.${basename(path)}.dsh-${state.plan.id}-${randomUUID()}.stage`),retiredPath=current?join(parent,`.${basename(path)}.dsh-${state.plan.id}-${randomUUID()}.retired`):retired?pending.retiredPath:null
 let staged=null
 if(desired!==null){
  if(current||retired){await copyFile(current?path:retiredPath,stage,constants.COPYFILE_EXCL);const copied=await image(stage);if(copied.digest!==(current??retired).digest)fail('MIGRATION_COMMIT_SOURCE_CHANGED')}
  else{const fd=await open(stage,'wx',0o600);await fd.close()}
  const fd=await open(stage,'r+');try{await fd.truncate(0);await fd.writeFile(desired);if(process.platform!=='win32')await fd.chmod(row.beforeMode??0o600);await fd.sync()}finally{await fd.close()}
  staged=await image(stage);if(staged.digest!==sha(desired))fail('MIGRATION_COMMIT_STAGE_CHANGED')
 }
 let retiredReservationIdentity=null
 if(current){const reservation=await open(retiredPath,'wx',0o600);try{await reservation.sync();retiredReservationIdentity=identity(await reservation.stat({bigint:true}))}finally{await reservation.close()}}
 await event(state,{type:'write-intent',phase,change:index,nextDigest:desired===null?null:sha(desired),stagedIdentity:staged?.identity??null,stagePath:staged?stage:null,retiredPath,retiredReservationIdentity,previousIdentity:(current??retired)?.identity??null})
 await onStep('intent',index,phase)
 if(current){
  await verifyOwned(state,index,path,current)
  await onStep('before-retire',index,phase)
  await rename(path,retiredPath);await syncDirectory(parent)
  const retiredNow=await image(retiredPath);if(retiredNow.digest!==current.digest||!same(retiredNow.identity,current.identity)){
   // Preserve a concurrent edit captured by the rename and restore its name
   // only when no other writer has created that name in the meantime.
   try{await link(retiredPath,path);await unlink(retiredPath);await syncDirectory(parent)}catch(e){if(e.code!=='EEXIST')throw e}
   fail('MIGRATION_COMMIT_SOURCE_CHANGED')
  }
  await onStep('retired',index,phase)
 }
 if(desired!==null){
  const check=await image(stage);if(!same(check.identity,staged.identity)||check.digest!==staged.digest)fail('MIGRATION_COMMIT_STAGE_CHANGED')
  try{await link(stage,path)}catch(e){if(e.code==='EEXIST')fail('MIGRATION_COMMIT_SOURCE_CHANGED');throw e}
  await onStep('linked',index,phase)
  await unlink(stage);await syncDirectory(parent)
  await onStep('published',index,phase);const actual=await image(path);if(actual.digest!==staged.digest||!same(actual.identity,staged.identity))fail('MIGRATION_COMMIT_SOURCE_CHANGED',{check:'published-image',phase,change:index,expected:{digest:staged.digest,identity:staged.identity},actual:{digest:actual.digest,identity:actual.identity}})
 }
 await event(state,{type:'write-complete',phase,change:index});await onStep('written',index,phase)
}

/** Owner-only low-level byte transaction. Full migration activation gates stay separate. */
export async function prepareMigrationConfigurationCommit({home,privateOutput,changes,operationId,onStep=async()=>{}}={}){
 home=await canonicalDirectory(home)
 if(!Array.isArray(changes)||changes.length<1||changes.length>64)fail('MIGRATION_COMMIT_INPUT_INVALID')
 privateOutput=resolve(privateOutput);const parent=await canonicalDirectory(dirname(privateOutput));if(join(parent,basename(privateOutput))!==privateOutput||within(home,privateOutput)||within(privateOutput,home))fail('MIGRATION_COMMIT_OUTPUT_OVERLAP')
 const id=operationId===undefined?randomUUID():operationId
 // One id binds fence intent/exclusive, plan.id and gate.operationId. The gate
 // reader (migration-startup-gate.mjs) accepts only a UUID v4 operation id, so an
 // id it could not read back would poison every later prepare/resume on this home.
 if(typeof id!=='string'||!OPERATION_ID.test(id))fail('MIGRATION_COMMIT_INPUT_INVALID')
 if(!GATE_OPERATION_ID.test(id))fail('MIGRATION_COMMIT_OPERATION_ID_UNSUPPORTED')
 const seen=new Set(),rows=[];let total=0
 for(const change of changes){
  if(typeof change?.path!=='string'||!isAbsolute(change.path)||!Buffer.isBuffer(change.maintenance)||!Buffer.isBuffer(change.after)||change.maintenance.length>maximum||change.after.length>maximum)fail('MIGRATION_COMMIT_INPUT_INVALID')
  const path=resolve(change.path);await canonicalDirectory(dirname(path));if(seen.has(path)||within(dirname(path),privateOutput)||within(privateOutput,path)||basename(path).startsWith('migration-gate.'))fail('MIGRATION_COMMIT_INPUT_INVALID');seen.add(path)
  const before=await image(path,{missing:true});if((before?.digest??null)!==change.beforeSha256)fail('MIGRATION_COMMIT_SOURCE_CHANGED')
  total+=(before?.bytes.length??0)+change.maintenance.length+change.after.length;if(total>4*1024**2)fail('MIGRATION_COMMIT_INPUT_LIMIT')
  rows.push({path,before:before?.bytes.toString('base64')??null,beforeIdentity:before?.identity??null,beforeMode:before?.mode??null,maintenance:change.maintenance.toString('base64'),after:change.after.toString('base64')})
 }
 const plan={schemaVersion:1,kind:'private-configuration-transaction',id,home,directory:privateOutput,changes:rows,attestationsRequired:['stopped-hosts','complete-domains','consistent-backups','artifact','permissions','money'],activationSupported:false,postActivationRollbackSupported:false}
 return exclusive(home,id,false,async()=>{
  const old=readMigrationStartupGate({home});if(old&&!['committed','rolled-back'].includes(old.phase))fail('MIGRATION_COMMIT_PENDING')
  if(old&&old.operationId===id)fail('MIGRATION_COMMIT_OPERATION_CONFLICT')
  await createPrivateMigrationDirectory(privateOutput);const raw=encode(plan);if(raw.length>maximum)fail('MIGRATION_COMMIT_INPUT_LIMIT');await writePrivateMigrationFile(privateOutput,'transaction.private.json',raw)
  for(let i=0;i<rows.length;i++){const before=await image(rows[i].path,{missing:true});if((before?.digest??null)!==(rows[i].before===null?null:sha(Buffer.from(rows[i].before,'base64')))||before&&!same(before.identity,rows[i].beforeIdentity))fail('MIGRATION_COMMIT_SOURCE_CHANGED')}
  const gate={schemaVersion:1,kind:'profile-migration-gate',operationId:id,home,operationDirectory:privateOutput,planDigest:sha(raw),phase:'prepared',journalEvents:0,journalHead:sha(raw)}
  await atomicJson(join(home,'migration-gate.json'),gate);await onStep('prepared');return {operationId:id,phase:'prepared',configurationFiles:rows.length,activationSupported:false,requiresStopProof:true}
 })
}

export async function resumeMigrationConfigurationCommit({privateOutput,phase='maintenance',recover=false,onStep=async()=>{}}={}){
 if(!['maintenance','install','rollback'].includes(phase))fail('MIGRATION_COMMIT_PHASE_INVALID')
 const initial=await load(privateOutput)
 return exclusive(initial.plan.home,initial.plan.id,recover,async()=>{
  const state=await load(privateOutput)
  if(state.gate.phase==='committed')fail('MIGRATION_POST_ACTIVATION_ROLLBACK_REQUIRED')
  if(state.gate.phase==='rolled-back'){if(phase!=='rollback')fail('MIGRATION_COMMIT_ALREADY_ROLLED_BACK');await cleanupOwnedTemps(state);return {phase:'rolled-back',activationSupported:false}}
  if(phase==='install'&&!['maintenance','installing','validating'].includes(state.gate.phase))fail('MIGRATION_COMMIT_MAINTENANCE_REQUIRED')
  if(phase==='maintenance'&&['installing','validating','rolling-back'].includes(state.gate.phase))fail('MIGRATION_COMMIT_PHASE_INVALID')
  if(state.gate.phase==='rolling-back'&&phase!=='rollback')fail('MIGRATION_COMMIT_ROLLBACK_PENDING')
  await setGate(state,phase==='rollback'?'rolling-back':phase==='install'?'installing':'maintenance');await event(state,{type:'phase-intent',phase});await onStep('phase',-1,phase)
  const indices=state.plan.changes.map((_,i)=>i);if(phase==='rollback')indices.reverse()
  for(const index of indices){const row=state.plan.changes[index];await replace(state,index,phase,row[phase==='rollback'?'before':phase==='install'?'after':'maintenance'],onStep)}
  await event(state,{type:'phase-complete',phase});await setGate(state,phase==='rollback'?'rolled-back':phase==='install'?'validating':'maintenance');await onStep('phase-complete',-1,phase)
  if(phase==='rollback')await cleanupOwnedTemps(state)
  return {phase:state.gate.phase,configurationFiles:state.plan.changes.length,activationSupported:false,requiresStopProof:true,postActivationRollbackSupported:false}
 })
}

export async function inspectMigrationConfigurationCommit({privateOutput}={}){
 const state=await load(privateOutput),files=[]
 for(let i=0;i<state.plan.changes.length;i++){const value=await currentImage(state,i);files.push({index:i,recognized:await recognized(state,i,value),present:value!==null})}
 return {schemaVersion:1,phase:state.gate.phase,configurationFiles:files.length,recognized:files.every(f=>f.recognized),events:state.events.length,activationSupported:false,requiresStopProof:true,postActivationRollbackSupported:false}
}
