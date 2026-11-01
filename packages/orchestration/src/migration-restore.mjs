import {constants} from 'node:fs'
import {chmod,lstat,mkdir,open,readFile,realpath,rename,rm} from 'node:fs/promises'
import {basename,dirname,isAbsolute,join,relative,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {createPrivateMigrationDirectory,hashPrivateMigrationFile,writePrivateMigrationFile} from './migration-private-files.mjs'
import {readVerifiedMigrationDataArchive} from './migration-data-archive.mjs'
import {verifyMigrationLedgerArchive,exportMigrationLedger} from './migration-ledger-export.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from './migration-snapshot.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const json=value=>JSON.stringify(value)
const hash=value=>createHash('sha256').update(value).digest('hex')
const inside=(base,target)=>{const part=relative(base,target);return !part||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)}
const abort=signal=>{if(signal?.aborted)fail('MIGRATION_RESTORE_CANCELLED')}

async function optionalStat(path){try{return await lstat(path)}catch(error){if(error?.code==='ENOENT')return null;throw error}}
async function targetPath(path){
 if(typeof path!=='string'||!isAbsolute(path)||!basename(path)||basename(path)==='.'||basename(path)==='..')fail('MIGRATION_RESTORE_TARGET_INVALID')
 const parent=await realpath(dirname(path)).catch(()=>fail('MIGRATION_RESTORE_TARGET_PARENT_INVALID'))
 const target=join(parent,basename(path)),stat=await optionalStat(target)
 if(stat&&(stat.isSymbolicLink()||await realpath(target)!==target))fail('MIGRATION_RESTORE_TARGET_INVALID')
 return target
}
async function readRequest(root){
 const info=await hashPrivateMigrationFile(root,'request.private.json',4*1024**2)
 const bytes=await readFile(join(root,'request.private.json'))
 if(bytes.length!==info.bytes||hash(bytes)!==info.sha256)fail('MIGRATION_RESTORE_JOURNAL_CHANGED')
 let value;try{value=JSON.parse(bytes.toString('utf8'))}catch{fail('MIGRATION_RESTORE_JOURNAL_INVALID')}
 if(value?.schemaVersion!==1||value.kind!=='private-migration-restore'||!Array.isArray(value.domains)||typeof value.ledgerTarget!=='string')fail('MIGRATION_RESTORE_JOURNAL_INVALID')
 return value
}
async function mark(root,name,value={}){
 const bytes=Buffer.from(json({schemaVersion:1,...value})+'\n'),path=join(root,name)
 if(await optionalStat(path)){await hashPrivateMigrationFile(root,name,bytes.length);if(!bytes.equals(await readFile(path)))fail('MIGRATION_RESTORE_JOURNAL_CHANGED');return}
 await writePrivateMigrationFile(root,name,bytes)
}
async function copyVerifiedFile(from,to,expected,signal){
 const source=await open(from,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let target
 try{
  const stat=await source.stat();if(!stat.isFile()||stat.size>expected.bytes)fail('MIGRATION_RESTORE_SOURCE_CHANGED')
  target=await open(to,'wx',0o600)
  const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let size=0
  for(;;){
   abort(signal);const read=await source.read(buffer,0,buffer.length,null);if(!read.bytesRead)break
   size+=read.bytesRead;if(size>expected.bytes)fail('MIGRATION_RESTORE_SOURCE_CHANGED')
   digest.update(buffer.subarray(0,read.bytesRead));await target.writeFile(buffer.subarray(0,read.bytesRead))
  }
  if(size!==expected.bytes||digest.digest('hex')!==expected.sha256)fail('MIGRATION_RESTORE_SOURCE_CHANGED')
  await target.sync()
 }finally{await target?.close();await source.close()}
}
async function existingDomain(target,expected,signal){
 if(!await optionalStat(target))return false
 const source=expected.sources[0]
 let current
 try{current=await inspectMigrationSources([{id:source.id,kind:source.kind,root:target}],{...expected.limits,signal})}
 catch(error){if(error?.code?.startsWith('MIGRATION_'))fail('MIGRATION_RESTORE_TARGET_CONFLICT');throw error}
 if(!reconcileMigrationInventories(expected,current).equal)fail('MIGRATION_RESTORE_TARGET_CONFLICT')
 return true
}
function publicSummary({domains,replayed}){
 return {schemaVersion:1,kind:'migration-restore',status:'restored',domains:domains.length,replayed,duplicateWrites:0,activated:false,activationSupported:false,postActivationRollbackSupported:false,stopWriteProvable:false,permissionsRestored:false}
}

/** Restore verified archives into explicit fresh targets, or reconcile an exact prior restore. */
export async function restoreMigrationArchives({Database,dataArchive,ledgerArchive,targets,operationDirectory,signal,onBoundary=async()=>{}}={}){
 if(typeof Database!=='function')fail('MIGRATION_RESTORE_DRIVER_REQUIRED')
 abort(signal)
 const {root:dataRoot,manifest}=await readVerifiedMigrationDataArchive({privateOutput:dataArchive,signal})
 await verifyMigrationLedgerArchive({Database,privateOutput:ledgerArchive,signal})
 const ledgerRoot=await realpath(ledgerArchive),operationRoot=await targetPath(operationDirectory)
 if(!targets||!Array.isArray(targets.domains)||targets.domains.length!==manifest.sources.length)fail('MIGRATION_RESTORE_TARGETS_INVALID')
 const byId=new Map();for(const row of targets.domains){if(!row||typeof row.id!=='string'||byId.has(row.id))fail('MIGRATION_RESTORE_TARGETS_INVALID');byId.set(row.id,await targetPath(row.root))}
 const domains=manifest.sources.map((source,index)=>{
  const target=byId.get(source.id);byId.delete(source.id);if(!target)fail('MIGRATION_RESTORE_TARGETS_INVALID')
  return {source,index,target,archiveRoot:join(dataRoot,'data',source.directory)}
 })
 if(byId.size)fail('MIGRATION_RESTORE_TARGETS_INVALID')
 const ledgerTarget=await targetPath(targets.ledger)
 const paths=[...domains.map(row=>row.target),ledgerTarget]
 for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)if(inside(paths[i],paths[j])||inside(paths[j],paths[i]))fail('MIGRATION_RESTORE_TARGET_OVERLAP')
 for(const target of [...paths,operationRoot])for(const archive of [dataRoot,ledgerRoot])if(inside(archive,target)||inside(target,archive))fail('MIGRATION_RESTORE_TARGET_OVERLAP')
 for(const row of domains)if(inside(operationRoot,row.target)||inside(row.target,operationRoot)||inside(operationRoot,ledgerTarget)||inside(ledgerTarget,operationRoot))fail('MIGRATION_RESTORE_TARGET_OVERLAP')
 const request={schemaVersion:1,kind:'private-migration-restore',dataArchiveDigest:hash(json(manifest)),domains:domains.map(row=>({id:row.source.id,kind:row.source.kind,target:row.target,contentFingerprint:manifest.sourceInventory.sources[row.index].contentFingerprint})),ledgerTarget}
 let existingRequest=null
 if(await optionalStat(operationRoot)){
  if(process.platform!=='win32'&&(await lstat(operationRoot)).mode&0o077)fail('MIGRATION_RESTORE_JOURNAL_INVALID')
  existingRequest=await readRequest(operationRoot)
 }else{
  await createPrivateMigrationDirectory(operationRoot)
  await writePrivateMigrationFile(operationRoot,'request.private.json',Buffer.from(json(request)+'\n'))
 }
 if(existingRequest&&json(existingRequest)!==json(request)){const fields=Object.keys(request).filter(key=>json(existingRequest[key])!==json(request[key]));throw Object.assign(new Error('MIGRATION_RESTORE_OPERATION_MISMATCH'),{code:'MIGRATION_RESTORE_OPERATION_MISMATCH',details:{fields}})}
 const replayed=Boolean(existingRequest)
 for(const row of domains){
  abort(signal)
  const source=manifest.sourceInventory.sources[row.index]
  const expected=await inspectMigrationSources([{id:row.source.id,kind:row.source.kind,root:row.archiveRoot}],{...manifest.sourceInventory.limits,signal})
  const complete=await existingDomain(row.target,expected,signal)
  if(!complete){
   const stage=join(operationRoot,`domain-${String(row.index).padStart(4,'0')}.staging`)
   await rm(stage,{recursive:true,force:true});await mkdir(stage,{mode:0o700})
   for(const entry of source.entries){
    abort(signal)
    const parts=entry.path?entry.path.split('/'):[],from=join(row.archiveRoot,...parts),to=join(stage,...parts)
    if(entry.type==='directory'){if(entry.path)await mkdir(to,{mode:0o700});if(process.platform!=='win32')await chmod(to,manifest.modes.find(mode=>mode.sourceIndex===row.index&&mode.path===entry.path)?.mode??0o700);continue}
    if(entry.type!=='file')fail('MIGRATION_RESTORE_SOURCE_CHANGED')
    await copyVerifiedFile(from,to,entry,signal)
    if(process.platform!=='win32')await chmod(to,manifest.modes.find(mode=>mode.sourceIndex===row.index&&mode.path===entry.path)?.mode??0o600)
   }
   const copied=await inspectMigrationSources([{id:row.source.id,kind:row.source.kind,root:stage}],{...manifest.sourceInventory.limits,signal})
   if(!reconcileMigrationInventories(expected,copied).equal)fail('MIGRATION_RESTORE_COPY_MISMATCH')
   await mark(operationRoot,`domain-${String(row.index).padStart(4,'0')}-staged.json`)
   if(await optionalStat(row.target))fail('MIGRATION_RESTORE_TARGET_CONFLICT')
   await rename(stage,row.target)
  }
  if(!await existingDomain(row.target,expected,signal))fail('MIGRATION_RESTORE_PUBLISH_FAILED')
  await mark(operationRoot,`domain-${String(row.index).padStart(4,'0')}-restored.json`)
  await onBoundary({phase:'domain-restored',sourceId:row.source.id,index:row.index})
 }
 abort(signal)
 const ledgerExists=await optionalStat(ledgerTarget)
 let expected,archiveDb
 try{archiveDb=new Database(join(ledgerRoot,'ledger.sqlite'),{readonly:true,fileMustExist:true});archiveDb.pragma('query_only=ON');expected=exportMigrationLedger(archiveDb,{signal})}finally{archiveDb?.close()}
 const verifyTarget=path=>{
  let db
  try{db=new Database(path,{readonly:true,fileMustExist:true});db.pragma('query_only=ON');if(json(exportMigrationLedger(db,{signal}))!==json(expected))fail('MIGRATION_RESTORE_TARGET_CONFLICT')}
  catch(error){if(error?.code?.startsWith('MIGRATION_'))throw error;fail('MIGRATION_RESTORE_TARGET_CONFLICT')}finally{db?.close()}
 }
 if(ledgerExists){
  if(!ledgerExists.isFile()||ledgerExists.isSymbolicLink())fail('MIGRATION_RESTORE_TARGET_CONFLICT')
  verifyTarget(ledgerTarget)
 }else{
  const stage=join(operationRoot,'ledger.staging.sqlite'),entry=await hashPrivateMigrationFile(ledgerRoot,'ledger.sqlite',512*1024**2,{signal})
  await rm(stage,{force:true});await copyVerifiedFile(join(ledgerRoot,'ledger.sqlite'),stage,entry,signal)
  let db;try{db=new Database(stage,{readonly:true,fileMustExist:true});db.pragma('query_only=ON');if(json(exportMigrationLedger(db,{signal}))!==json(expected))fail('MIGRATION_RESTORE_COPY_MISMATCH')}finally{db?.close()}
  await mark(operationRoot,'ledger-staged.json')
  if(await optionalStat(ledgerTarget))fail('MIGRATION_RESTORE_TARGET_CONFLICT')
  await rename(stage,ledgerTarget);verifyTarget(ledgerTarget)
 }
 await mark(operationRoot,'ledger-restored.json');await onBoundary({phase:'ledger-restored'})
 await verifyMigrationLedgerArchive({Database,privateOutput:ledgerRoot,signal})
 const result=publicSummary({domains,replayed})
 await mark(operationRoot,'completed.json',{status:result.status,domains:result.domains})
 return result
}
