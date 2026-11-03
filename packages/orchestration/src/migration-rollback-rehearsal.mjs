import {lstat,readFile,realpath,stat} from 'node:fs/promises'
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {readVerifiedMigrationDataArchive} from './migration-data-archive.mjs'
import {exportMigrationLedger,verifyMigrationLedgerArchive} from './migration-ledger-export.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from './migration-snapshot.mjs'
import {verifyProfileMigrationSources} from './profile-migration-plan.mjs'
import {diagnoseMigrationRollbackReadiness} from './migration-rollback-readiness.mjs'
import {auditMigrationRecovery} from './migration-recovery-audit.mjs'
import {restoreMigrationArchives} from './migration-restore.mjs'

const INPUTS=new Set(['Database','journalFile','routerFile','dataArchive','ledgerArchive','targets','operationDirectory','assertExclusive','signal','onBoundary'])
const PERMANENT_ADVISORIES=new Set(['RECOVERY_DOMAIN_SCOPE_LEDGER_ONLY'])
const json=value=>JSON.stringify(value)
const fail=(code,details)=>{throw Object.assign(new Error(code),{code,...(details?{details}:{})})}
const inside=(base,target)=>{const part=relative(base,target);return !part||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)}
const overlap=(a,b)=>inside(a,b)||inside(b,a)

async function canonical(path){
 if(typeof path!=='string'||!path||path.includes('\0')||!isAbsolute(path))fail('MIGRATION_ROLLBACK_INPUT_INVALID')
 const resolved=resolve(path)
 try{return await realpath(resolved)}catch(error){
  if(!['ENOENT','ENOTDIR'].includes(error?.code))throw error
  const parent=dirname(resolved);if(parent===resolved)throw error
  return join(await canonical(parent),basename(resolved))
 }
}
async function identity(path){try{return await stat(path,{bigint:true})}catch(error){if(error?.code==='ENOENT')return null;throw error}}
function sameIdentity(a,b){return a&&b&&String(a.dev)===String(b.dev)&&String(a.ino)===String(b.ino)}
async function liveExport(Database,file,signal){
 let db
 try{db=new Database(file,{readonly:true,fileMustExist:true});db.pragma('query_only=ON');return exportMigrationLedger(db,{signal})}finally{db?.close()}
}
async function readArchives({Database,dataArchive,ledgerArchive,signal}){
 const data=await readVerifiedMigrationDataArchive({privateOutput:dataArchive,signal})
 await verifyMigrationLedgerArchive({Database,privateOutput:ledgerArchive,signal})
 const root=await realpath(ledgerArchive),ledgerExport=JSON.parse(await readFile(join(root,'ledger-export.private.json'),'utf8'))
 if(ledgerExport.userVersion!==5)fail('MIGRATION_ROLLBACK_SCHEMA_REQUIRED')
 return {...data,ledgerRoot:root,ledgerExport}
}
function configurationPaths(plan){
 return [plan.context?.profileDir,plan.context?.dshHome,plan.context?.launchCwd,plan.runtimePaths?.effectiveHome,plan.runtimePaths?.effectiveWorkspace,
  ...(plan.sources??[]).flatMap(source=>[source.path,typeof source.path==='string'?dirname(source.path):null])].filter(path=>typeof path==='string'&&isAbsolute(path))
}
function inventoryPaths(inventory){
 return inventory.sources.flatMap(source=>source.entries.map(entry=>entry.path?join(source.root,...entry.path.split('/')):source.root))
}
function archivePaths(archive){
 const data=[archive.root,join(archive.root,'README.txt'),join(archive.root,'capture.private.json'),join(archive.root,'profile-plan.private.json'),join(archive.root,'data')]
 for(let index=0;index<archive.manifest.sources.length;index++){
  const root=join(archive.root,'data',archive.manifest.sources[index].directory);data.push(root)
  for(const entry of archive.manifest.sourceInventory.sources[index].entries)if(entry.path)data.push(join(root,...entry.path.split('/')))
 }
 return [...data,archive.ledgerRoot,...['README.txt','archive.private.json','ledger.sqlite','ledger-export.private.json'].map(name=>join(archive.ledgerRoot,name))]
}
async function targetPaths(targets,operationDirectory,manifest){
 if(!targets||!Array.isArray(targets.domains)||targets.domains.length!==manifest.sources.length)fail('MIGRATION_RESTORE_TARGETS_INVALID')
 const byId=new Map()
 for(const row of targets.domains){
  if(!row||typeof row.id!=='string'||byId.has(row.id))fail('MIGRATION_RESTORE_TARGETS_INVALID')
  byId.set(row.id,row.root)
 }
 const domains=[]
 for(const source of manifest.sources){if(!byId.has(source.id))fail('MIGRATION_RESTORE_TARGETS_INVALID');domains.push({id:source.id,root:byId.get(source.id)});byId.delete(source.id)}
 if(byId.size)fail('MIGRATION_RESTORE_TARGETS_INVALID')
 return {domains,ledger:targets.ledger,operationDirectory}
}
async function assertFreshRehearsalTargets({targets,operationDirectory,archive,ledgerFile}){
 const selected=await targetPaths(targets,operationDirectory,archive.manifest)
 const targetInputs=[...selected.domains.map(row=>row.root),selected.ledger]
 for(const path of targetInputs){const info=await lstat(path).catch(error=>{if(error?.code==='ENOENT')return null;throw error});if(info?.isSymbolicLink())fail('MIGRATION_ROLLBACK_TARGET_CONFLICT')}
 const targetList=await Promise.all(targetInputs.map(canonical)),operation=await canonical(operationDirectory)
 const liveInputs=[...inventoryPaths(archive.manifest.sourceInventory),ledgerFile,...configurationPaths(archive.configurationPlan)]
 const archiveInputs=archivePaths(archive)
 const live=await Promise.all(liveInputs.map(canonical)),archives=await Promise.all([archive.root,archive.ledgerRoot].map(canonical))
 for(const target of [...targetList,operation]){
  for(const source of [...live,...archives])if(overlap(target,source))fail('MIGRATION_ROLLBACK_TARGET_CONFLICT')
 }
 for(let i=0;i<targetList.length;i++)for(let j=i+1;j<targetList.length;j++)if(overlap(targetList[i],targetList[j]))fail('MIGRATION_ROLLBACK_TARGET_CONFLICT')
 for(const target of targetList)if(overlap(target,operation))fail('MIGRATION_ROLLBACK_TARGET_CONFLICT')
 const protectedIdentities=await Promise.all([...liveInputs,...archiveInputs].map(identity))
 for(const target of [...targetInputs,operationDirectory]){const current=await identity(target);for(const source of protectedIdentities)if(sameIdentity(current,source))fail('MIGRATION_ROLLBACK_TARGET_CONFLICT')}
}
async function assertCurrentMatchesArchives({Database,routerFile,archive,signal}){
 const current=await inspectMigrationSources(archive.manifest.sourceInventory.sources.map(({id,kind,root})=>({id,kind,root})),{...archive.manifest.sourceInventory.limits,signal})
 if(!reconcileMigrationInventories(archive.manifest.sourceInventory,current).equal)fail('MIGRATION_ROLLBACK_SOURCE_CHANGED')
 if(!(await verifyProfileMigrationSources(archive.configurationPlan)).unchanged)fail('MIGRATION_ROLLBACK_SOURCE_CHANGED')
 const live=await liveExport(Database,routerFile,signal)
 if(json(live)!==json(archive.ledgerExport))fail('MIGRATION_ROLLBACK_SOURCE_CHANGED')
}
async function assertRollbackPreconditions({Database,journalFile,routerFile,ledgerArchive,archive,signal}){
 const readiness=await diagnoseMigrationRollbackReadiness({Database,journalFile,routerFile,privateOutput:ledgerArchive,signal})
 const recovery=auditMigrationRecovery({ledgerExport:archive.ledgerExport,signal})
 const recoveryBlockers=recovery.diagnostics.filter(row=>!PERMANENT_ADVISORIES.has(row.code)).map(row=>row.code)
 const readinessBlockers=readiness.blockers.map(row=>row.code)
 if(!readiness.ready||recoveryBlockers.length||recovery.recovery.tasks.abstained>0)fail('MIGRATION_ROLLBACK_PRECONDITION_BLOCKED',{readinessBlockers,recoveryBlockers,abstainedTasks:recovery.recovery.tasks.abstained})
}
async function assertRestoredMatchesArchives({Database,targets,archive,signal}){
 const selected=await targetPaths(targets,undefined,archive.manifest)
 const restored=await inspectMigrationSources(selected.domains.map(({id,root},index)=>({id,kind:archive.manifest.sources[index].kind,root})),{...archive.manifest.sourceInventory.limits,signal})
 if(!reconcileMigrationInventories(archive.manifest.sourceInventory,restored).equal)fail('MIGRATION_ROLLBACK_RESTORED_MISMATCH')
 const exported=await liveExport(Database,selected.ledger,signal)
 if(json(exported)!==json(archive.ledgerExport))fail('MIGRATION_ROLLBACK_RESTORED_MISMATCH')
}
function summarizeRehearsal(result){return {schemaVersion:1,kind:'migration-rollback-rehearsal',status:'rehearsed',rehearsed:true,domains:result.domains,duplicateWrites:0,replayed:result.replayed,activated:false,rolledBack:false,authoritySwitched:false,crossDomainConsistent:false,domainCompletenessProven:false,activationSupported:false,postActivationRollbackSupported:false,stopWriteProvable:false}}

/** Owner-only isolated rollback rehearsal; never changes live authority or data. */
export async function rehearseMigrationRollback(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!INPUTS.has(key)))fail('MIGRATION_ROLLBACK_INPUT_INVALID')
 const {Database,journalFile,routerFile,dataArchive,ledgerArchive,targets,operationDirectory,assertExclusive,signal,onBoundary=async()=>{}}=options
 if(typeof Database!=='function'||typeof assertExclusive!=='function'||typeof onBoundary!=='function')fail('MIGRATION_ROLLBACK_INPUT_INVALID')
 if(signal?.aborted)fail('MIGRATION_ROLLBACK_CANCELLED')
 const guard=async()=>{let held=false;try{held=await assertExclusive()}catch{}if(held!==true)fail('MIGRATION_ROLLBACK_EXCLUSIVE_REQUIRED')}
 const [journal,router]=await Promise.all([canonical(journalFile),canonical(routerFile)])
 if(journal!==router||!sameIdentity(await identity(journal),await identity(router)))fail('MIGRATION_ROLLBACK_LEDGER_SCOPE_UNSUPPORTED')
 await guard()
 const live=await liveExport(Database,router,signal)
 if(live.userVersion!==5)fail(live.userVersion<5?'MIGRATION_ROLLBACK_SCHEMA_REQUIRED':'MIGRATION_LEDGER_SCHEMA_UNSUPPORTED')
 const archive=await readArchives({Database,dataArchive,ledgerArchive,signal})
 await assertFreshRehearsalTargets({targets,operationDirectory,archive,ledgerFile:router})
 await assertRollbackPreconditions({Database,journalFile:journal,routerFile:router,ledgerArchive,archive,signal})
 const current={Database,routerFile:router,archive,signal}
 const recheck=async()=>{await guard();await assertCurrentMatchesArchives(current)}
 await recheck()
 const result=await restoreMigrationArchives({Database,dataArchive,ledgerArchive,targets,operationDirectory,signal,onBoundary:async boundary=>{
  await recheck()
  await onBoundary(boundary)
  await recheck()
 }})
 await guard()
 await onBoundary({phase:'before-final-recheck'})
 await recheck()
 await assertRestoredMatchesArchives({Database,targets,archive,signal})
 await guard()
 return summarizeRehearsal(result)
}
