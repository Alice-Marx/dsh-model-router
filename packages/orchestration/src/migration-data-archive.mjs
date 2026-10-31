import {lstat,open,realpath,mkdir,readdir} from 'node:fs/promises'
import {constants} from 'node:fs'
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {inspectMigrationSources,verifyMigrationInventory,reconcileMigrationInventories,summarizeMigrationInventory} from './migration-snapshot.mjs'
import {verifyProfileMigrationSources} from './profile-migration-plan.mjs'
import {createPrivateMigrationDirectory,writePrivateMigrationFile,hashPrivateMigrationFile} from './migration-private-files.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const json=value=>JSON.stringify(value),sha=data=>createHash('sha256').update(data).digest('hex')
const abort=signal=>{if(signal?.aborted)fail('MIGRATION_CAPTURE_CANCELLED')}
const inside=(base,target)=>{const part=relative(base,target);return !part||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)}
const identity=s=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','nlink'].map(k=>[k,String(s[k])]))
const same=(s,expected)=>json(identity(s))===json(expected)
async function actual(path){try{return await realpath(path)}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;const parent=dirname(path);if(parent===path)throw e;return join(await actual(parent),path.slice(parent.length).replace(/^[/\\]/,''))}}
const validPart=path=>typeof path==='string'&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\0\\]/.test(p))&&!isAbsolute(path)
async function readPrivateJson(root,name,maximum){
  const info=await hashPrivateMigrationFile(root,name,maximum),handle=await open(join(root,name),'r')
  try{
    const before=await handle.stat();if(!before.isFile()||before.size!==info.bytes)fail('MIGRATION_CAPTURE_CHANGED')
    const bytes=Buffer.alloc(info.bytes+1);let size=0
    while(size<bytes.length){const r=await handle.read(bytes,size,bytes.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead}
    const value=bytes.subarray(0,size);if(size!==info.bytes||sha(value)!==info.sha256)fail('MIGRATION_CAPTURE_CHANGED')
    try{return JSON.parse(value.toString('utf8'))}catch{fail('MIGRATION_CAPTURE_INVALID')}
  }finally{await handle.close()}
}

/** Host owner only: preserve selected source bytes, never claim a migration. */
export async function createMigrationDataArchive({inventory,configurationPlan,privateOutput,signal}={}){
  abort(signal)
  if(configurationPlan?.status!=='ready'||!configurationPlan.context)fail('MIGRATION_CAPTURE_READY_PLAN_REQUIRED')
  if(Buffer.byteLength(json(configurationPlan))>64*1024**2||Buffer.byteLength(json(inventory??null))>64*1024**2)fail('MIGRATION_CAPTURE_MANIFEST_LIMIT')
  if(!(await verifyProfileMigrationSources(configurationPlan)).unchanged)fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
  await verifyMigrationInventory(inventory,{signal})
  if(typeof privateOutput!=='string'||!isAbsolute(privateOutput))fail('MIGRATION_PRIVATE_OUTPUT_ABSOLUTE_REQUIRED')
  const output=resolve(privateOutput),root=join(await realpath(dirname(output)),output.slice(dirname(output).length).replace(/^[/\\]/,''))
  const selected=[...inventory.sources.map(s=>s.root),configurationPlan.context.profileDir,configurationPlan.context.dshHome,configurationPlan.context.launchCwd,configurationPlan.runtimePaths?.effectiveHome,configurationPlan.runtimePaths?.effectiveWorkspace,...configurationPlan.sources.map(s=>dirname(s.path))].filter(p=>typeof p==='string'&&isAbsolute(p))
  for(const path of selected){const source=await actual(resolve(path));if(inside(source,root)||inside(root,source))fail('MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE')}
  await createPrivateMigrationDirectory(root)
  await writePrivateMigrationFile(root,'README.txt',Buffer.from('PRIVATE selected-tree capture. Contains full configuration and data, potentially credentials. Keep outside Git/npm, public reports, model inputs and shared archives. Complete capture manifest is capture.private.json. Raw SQLite files are not consistent live backups. No stop proof, restore, activation or migration apply is provided.\n'))
  await mkdir(join(root,'data'),{mode:0o700})
  const sources=[],modes=[],rawSqlite=[]
  for(let index=0;index<inventory.sources.length;index++){
    abort(signal)
    const source=inventory.sources[index],directory=`domain-${String(index).padStart(4,'0')}`,targetRoot=join(root,'data',directory)
    await mkdir(targetRoot,{mode:0o700});sources.push({id:source.id,kind:source.kind,directory})
    for(const entry of source.entries){
      abort(signal)
      if(entry.path!==''&&!validPart(entry.path))fail('MIGRATION_CAPTURE_INVALID')
      const from=entry.path?join(source.root,...entry.path.split('/')):source.root,to=entry.path?join(targetRoot,...entry.path.split('/')):targetRoot
      const before=await lstat(from,{bigint:true})
      if(!same(before,entry.identity)||before.isSymbolicLink()||!inside(source.root,await realpath(from)))fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
      modes.push({sourceIndex:index,path:entry.path,mode:Number(before.mode&0o777n)})
      if(entry.type==='directory'){
        if(!before.isDirectory())fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
        if(entry.path)await mkdir(to,{mode:0o700})
        continue
      }
      if(entry.type!=='file'||!before.isFile())fail('MIGRATION_CAPTURE_INVALID')
      if(before.nlink!==1n)fail('MIGRATION_CAPTURE_HARDLINK_UNSUPPORTED')
      const sourceHandle=await open(from,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let targetHandle
      try{
        if(!same(await sourceHandle.stat({bigint:true}),entry.identity))fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
        if(process.platform==='linux'&&!inside(source.root,await realpath(`/proc/self/fd/${sourceHandle.fd}`)))fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
        targetHandle=await open(to,'wx',0o600)
        const hash=createHash('sha256'),buffer=Buffer.alloc(65536),header=Buffer.alloc(16);let size=0,headerSize=0
        while(true){
          abort(signal)
          const r=await sourceHandle.read(buffer,0,buffer.length,null);if(!r.bytesRead)break
          size+=r.bytesRead;if(size>entry.bytes)fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
          const bytes=buffer.subarray(0,r.bytesRead);hash.update(bytes)
          if(headerSize<16){const n=Math.min(16-headerSize,r.bytesRead);bytes.copy(header,headerSize,0,n);headerSize+=n}
          await targetHandle.writeFile(bytes)
        }
        if(size!==entry.bytes||hash.digest('hex')!==entry.sha256||!same(await sourceHandle.stat({bigint:true}),entry.identity)||!same(await lstat(from,{bigint:true}),entry.identity)||await realpath(from)!==from)fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
        await targetHandle.sync()
        if(headerSize===16&&header.equals(Buffer.from('SQLite format 3\0')))rawSqlite.push({sourceIndex:index,path:entry.path})
      }finally{await targetHandle?.close();await sourceHandle.close()}
    }
  }
  const copied=await inspectMigrationSources(sources.map(s=>({id:s.id,kind:s.kind,root:join(root,'data',s.directory)})),{...inventory.limits,signal})
  if(!reconcileMigrationInventories(inventory,copied).equal)fail('MIGRATION_CAPTURE_COPY_MISMATCH')
  const planFile=await writePrivateMigrationFile(root,'profile-plan.private.json',Buffer.from(json(configurationPlan)+'\n'))
  const artifact={schemaVersion:1,kind:'private-selected-data-capture',status:'complete',sourceInventory:inventory,sources,modes,rawSqlite,configurationFile:planFile,counts:summarizeMigrationInventory(inventory),crossDomainConsistent:false,databaseConsistent:false,requiresStopProof:true,applySupported:false,permissionsRestored:false}
  const bytes=Buffer.from(json(artifact)+'\n');if(bytes.length>128*1024**2)fail('MIGRATION_CAPTURE_MANIFEST_LIMIT')
  await verifyCaptureContents(root,artifact,signal)
  await verifyMigrationInventory(inventory,{signal})
  if(!(await verifyProfileMigrationSources(configurationPlan)).unchanged)fail('MIGRATION_CAPTURE_SOURCE_CHANGED')
  abort(signal);await writePrivateMigrationFile(root,'capture.private.json',bytes)
  return summarizeMigrationDataArchive(artifact)
}

async function verifyCaptureContents(root,artifact,signal){
  if(artifact?.schemaVersion!==1||artifact.kind!=='private-selected-data-capture'||artifact.status!=='complete'||artifact.crossDomainConsistent!==false||artifact.databaseConsistent!==false||artifact.requiresStopProof!==true||artifact.applySupported!==false||artifact.permissionsRestored!==false||!Array.isArray(artifact.sources)||artifact.sources.length!==artifact.sourceInventory?.sources?.length||artifact.sources.length>64)fail('MIGRATION_CAPTURE_INVALID')
  for(let i=0;i<artifact.sources.length;i++){
    const row=artifact.sources[i],original=artifact.sourceInventory.sources[i]
    if(row.directory!==`domain-${String(i).padStart(4,'0')}`||row.id!==original.id||row.kind!==original.kind)fail('MIGRATION_CAPTURE_INVALID')
  }
  const dataRoot=join(root,'data')
  if(await realpath(dataRoot)!==dataRoot||(await lstat(dataRoot)).isSymbolicLink())fail('MIGRATION_CAPTURE_INVALID')
  if(json((await readdir(dataRoot)).sort())!==json(artifact.sources.map(s=>s.directory).sort()))fail('MIGRATION_CAPTURE_CHANGED')
  const inventory=await inspectMigrationSources(artifact.sources.map(s=>({id:s.id,kind:s.kind,root:join(root,'data',s.directory)})),{...artifact.sourceInventory.limits,signal})
  if(!reconcileMigrationInventories(artifact.sourceInventory,inventory).equal)fail('MIGRATION_CAPTURE_CHANGED')
  if(json(await hashPrivateMigrationFile(root,'profile-plan.private.json',128*1024**2,{signal}))!==json(artifact.configurationFile))fail('MIGRATION_CAPTURE_CHANGED')
  if(json(summarizeMigrationInventory(artifact.sourceInventory))!==json(artifact.counts))fail('MIGRATION_CAPTURE_CHANGED')
  return summarizeMigrationDataArchive(artifact)
}

/** Only reads this archive; does not follow the original source paths. */
export async function verifyMigrationDataArchive({privateOutput,signal}={}){
  if(typeof privateOutput!=='string'||!isAbsolute(privateOutput)||(await lstat(privateOutput)).isSymbolicLink())fail('MIGRATION_CAPTURE_INVALID')
  const root=await realpath(privateOutput),artifact=await readPrivateJson(root,'capture.private.json',128*1024**2)
  return verifyCaptureContents(root,artifact,signal)
}

/** PRIVATE owner seam for semantic audits; never expose its result as a tool. */
export async function readVerifiedMigrationDataArchive({privateOutput,signal}={}){
  await verifyMigrationDataArchive({privateOutput,signal})
  const root=await realpath(privateOutput),manifest=await readPrivateJson(root,'capture.private.json',128*1024**2)
  const configurationPlan=await readPrivateJson(root,'profile-plan.private.json',64*1024**2)
  await verifyCaptureContents(root,manifest,signal)
  return {root,manifest,configurationPlan}
}

export function summarizeMigrationDataArchive(artifact){
  const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1024**4?n:0
  return {schemaVersion:1,kind:'selected-data-capture',status:artifact?.status==='complete'?'complete':'incomplete',sources:count(artifact?.counts?.sources),files:count(artifact?.counts?.files),directories:count(artifact?.counts?.directories),totalBytes:count(artifact?.counts?.totalBytes),rawSqliteFiles:count(artifact?.rawSqlite?.length),crossDomainConsistent:false,databaseConsistent:false,requiresStopProof:true,applySupported:false,permissionsRestored:false}
}
