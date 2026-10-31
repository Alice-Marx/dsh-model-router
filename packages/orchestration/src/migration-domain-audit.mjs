import {constants} from 'node:fs'
import {open,lstat,realpath} from 'node:fs/promises'
import {join,dirname,basename} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {sessionFormatCatalog} from '@deepseek-ai/dsh-session-format-catalog'
import {readVerifiedMigrationDataArchive,verifyMigrationDataArchive} from './migration-data-archive.mjs'
import {decodeMigrationSession,sessionStorageAddress} from './migration-session-reader.mjs'
import {auditMigrationFinance,summarizeMigrationFinance} from './migration-financial-audit.mjs'
import {auditMigrationWorkspaceRegistry,migrationWorkspaceDiagnosticCodes} from './migration-workspace-audit.mjs'
import {auditMigrationSupportingDomains,summarizeMigrationSupportingDomains,migrationSupportingDiagnosticCodes} from './migration-supporting-domains.mjs'
const sdkRequire=createRequire(import.meta.resolve('@deepseek-ai/dsh-session-format-catalog'))
const {parseSessionFormatLogFilename}=await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-session-format')))
const fail=code=>{throw Object.assign(new Error(code),{code})},hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex')
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),own=(o,k)=>o&&Object.hasOwn(o,k)?o[k]:undefined
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\0-\x1f\x7f]/.test(x)
const relative=x=>typeof x==='string'&&!/^[\\/]|^[a-zA-Z]:/.test(x)&&x.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\0\\]/.test(p))
const abort=signal=>{if(signal?.aborted)fail('MIGRATION_DOMAIN_CANCELLED')}
const defaults=Object.freeze({maxFileBytes:32*1024**2,maxTotalBytes:256*1024**2,maxDecodedBytes:256*1024**2,maxSessions:10000,maxDiagnostics:256,maxJsonDepth:64,maxJsonNodes:500000})
const diagnosticCodes=new Set(['LAYOUT_CONTEXT_REQUIRED','SELECTED_SOURCE_MISSING','DATA_FILE_MISSING','DATA_FORMAT_INVALID','TEAM_VERSION_UNSUPPORTED','TEAM_IDENTITY_INVALID','MISSING_BOT_REFERENCE','MISSING_CAPABILITY_REFERENCE','MISSING_SESSION_REFERENCE','CONFLICTING_SESSION_OWNER','SESSION_LAYOUT_UNSUPPORTED','SESSION_COMPRESSION_CONTEXT','SESSION_FORMAT_REFUSED','SESSION_DECODE_LIMIT','SESSION_PHYSICAL_INVALID','SESSION_VERSION_MISMATCH','SESSION_ZSTD_INVALID','SESSION_CHILD_CONTEXT_REQUIRED','MIGRATION_SESSION_TIMEOUT','MIGRATION_SESSION_WORKER_FAILED','SESSION_STORAGE_BINDING_INVALID','DUPLICATE_SESSION_ID','SESSION_PARENT_CYCLE','UNINTERPRETED_EXTENSION_RECORD','EXTERNAL_CHILD_REFERENCE','ATTACHMENT_REFERENCE_INVALID','ATTACHMENT_MISSING_OR_CHANGED','ATTACHMENT_LAYOUT_AMBIGUOUS','SECRETS_FORMAT_INVALID','SECRET_SCOPE_ORPHAN','WORKSPACE_REGISTRY_REQUIRED','UNPRESERVED_WORKSPACE','FINANCE_CONTEXT_REQUIRED'])

/** PRIVATE owner-only audit. Reads the verified capture, never original paths. */
for(const code of migrationWorkspaceDiagnosticCodes)diagnosticCodes.add(code)
for(const code of migrationSupportingDiagnosticCodes)diagnosticCodes.add(code)
export async function auditMigrationDataDomains({privateOutput,layout,finance:financeInputs={},limits:requested={},signal}={}){
 if(!record(requested)||!record(financeInputs))fail('MIGRATION_DOMAIN_INPUT_INVALID')
 const limits={...defaults};for(const [k,v] of Object.entries(requested)){if(!Object.hasOwn(defaults,k)||!Number.isSafeInteger(v)||v<1||v>defaults[k])fail('MIGRATION_DOMAIN_INPUT_INVALID');limits[k]=v}
 abort(signal)
 const {root,manifest,configurationPlan}=await readVerifiedMigrationDataArchive({privateOutput,signal})
 const diagnostics=[],add=(code,severity='error',detail={})=>{if(diagnostics.length>=limits.maxDiagnostics)fail('MIGRATION_DOMAIN_DIAGNOSTIC_LIMIT');diagnostics.push({code,severity,...detail})}
 const sources=new Map(manifest.sources.map((s,i)=>[s.id,{...s,original:manifest.sourceInventory.sources[i],root:join(root,'data',s.directory),files:new Map(manifest.sourceInventory.sources[i].entries.filter(e=>e.type==='file').map(e=>[e.path,e]))}]))
 let used=0,decodedBytes=0
 async function selected(ref,{optional=false}={}){
  if(!record(ref)||typeof ref.sourceId!=='string'||!relative(ref.path)){add('LAYOUT_CONTEXT_REQUIRED','needs-context');return null}
  const source=sources.get(ref.sourceId),entry=source?.files.get(ref.path)
  if(!source){add('SELECTED_SOURCE_MISSING','needs-context',{sourceId:ref.sourceId});return null}
  if(!entry){if(!optional)add('DATA_FILE_MISSING','error',ref);return null}
  if(entry.bytes>limits.maxFileBytes||used+entry.bytes>limits.maxTotalBytes)fail('MIGRATION_DOMAIN_READ_LIMIT')
  const path=join(source.root,...ref.path.split('/'));if(await realpath(path)!==path||(await lstat(path)).isSymbolicLink())fail('MIGRATION_DOMAIN_CAPTURE_CHANGED')
  const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
  try{
   const before=await fd.stat({bigint:true});if(!before.isFile()||before.size!==BigInt(entry.bytes))fail('MIGRATION_DOMAIN_CAPTURE_CHANGED')
   const bytes=Buffer.alloc(entry.bytes+1);let n=0
   while(n<bytes.length){abort(signal);const r=await fd.read(bytes,n,bytes.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead}
   const data=bytes.subarray(0,n),after=await fd.stat({bigint:true})
   if(n!==entry.bytes||hash(data)!==entry.sha256||before.ino!==after.ino||before.dev!==after.dev||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)fail('MIGRATION_DOMAIN_CAPTURE_CHANGED')
   used+=n;return data
  }finally{await fd.close()}
 }
 async function jsonFile(ref,options){
  const bytes=await selected(ref,options);if(!bytes)return null
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{add('DATA_FORMAT_INVALID','error',ref);return null}
  // Bound opaque JSON before recursive projections or hashing as well.
  const pending=[[value,0]];let nodes=0
  while(pending.length){
   const [item,depth]=pending.pop();if(++nodes>limits.maxJsonNodes||depth>limits.maxJsonDepth)fail('MIGRATION_DOMAIN_JSON_LIMIT')
   if(nodes%1024===0)abort(signal)
   if(item!==null&&typeof item==='object')for(const child of Object.values(item)){if(pending.length+nodes>=limits.maxJsonNodes)fail('MIGRATION_DOMAIN_JSON_LIMIT');pending.push([child,depth+1])}
  }
  return value
 }
 if(!record(layout)){layout={};add('LAYOUT_CONTEXT_REQUIRED','needs-context')}
 for(const key of ['team','router','secrets','usage'])if(!Object.hasOwn(layout,key))add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:key})
 for(const key of ['sessions','attachments'])if(!Array.isArray(layout[key]))add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:key})
 const team=layout.team===null?null:layout.team?await jsonFile(layout.team):null,owners=new Map(),refs=[],workspaces=[]
 const addSession=(id,owner,role)=>{
  if(!validId(id)){add('TEAM_IDENTITY_INVALID','error',{role});return}
  const previous=owners.get(id),key=JSON.stringify(owner)
  if(previous&&previous!==key)add('CONFLICTING_SESSION_OWNER','error',{sessionId:id})
  else owners.set(id,key)
  refs.push({sessionId:id,owner,role})
 }
 let bots={},rooms={},agents={}
 if(team!==null){
  if(team?.version!==1)add('TEAM_VERSION_UNSUPPORTED')
  else if(!record(team.bots)||!record(team.rooms)||team.agents!==undefined&&!record(team.agents))add('TEAM_IDENTITY_INVALID')
  else{
   bots=team.bots;rooms=team.rooms;agents=team.agents??{}
   const mains=Array.isArray(team.mainBotIds)?team.mainBotIds:[]
   for(const id of [...mains,...(typeof team.mainBotId==='string'?[team.mainBotId]:[])])if(!own(bots,id))add('MISSING_BOT_REFERENCE','error',{botId:id})
   if(team.workspaceId!==undefined&&!layout.workspaceRegistry)add('WORKSPACE_REGISTRY_REQUIRED','needs-context',{workspaceId:team.workspaceId})
   for(const [id,bot] of Object.entries(bots)){
    if(!record(bot)||bot.id!==id||!validId(id)){add('TEAM_IDENTITY_INVALID');continue}
    const owner={kind:'bot',id};addSession(id,owner,'original');addSession(bot.sessionId??id,owner,'current')
    if(bot.segments!==undefined&&!Array.isArray(bot.segments))add('TEAM_IDENTITY_INVALID')
    else for(const part of bot.segments??[])addSession(part?.sessionId,owner,'part')
    if(bot.capabilities!==undefined&&!Array.isArray(bot.capabilities))add('TEAM_IDENTITY_INVALID')
    else for(const capability of bot.capabilities??[])if(!own(team.capabilities?.items,capability))add('MISSING_CAPABILITY_REFERENCE','needs-context',{botId:id,capabilityId:capability})
    if(bot.workDir!==undefined)workspaces.push({owner,path:bot.workDir})
   }
   for(const [id,room] of Object.entries(rooms)){
    if(!record(room)||room.id!==id||!Array.isArray(room.members)){add('TEAM_IDENTITY_INVALID');continue}
    addSession(id,{kind:'room',id},'room')
    for(const member of room.members)if(!own(bots,member))add('MISSING_BOT_REFERENCE','error',{roomId:id,botId:member})
    if(room.admin!==undefined&&room.admin!==null&&!room.members.includes(room.admin))add('MISSING_BOT_REFERENCE','error',{roomId:id,botId:room.admin})
    if(room.sessions!==undefined&&!record(room.sessions)||room.segments!==undefined&&!record(room.segments)){add('TEAM_IDENTITY_INVALID');continue}
    for(const [member,sessionId] of Object.entries(room.sessions??{})){if(!own(bots,member)||!room.members.includes(member))add('MISSING_BOT_REFERENCE','error',{roomId:id,botId:member});addSession(sessionId,{kind:'room-bot',id,botId:member},'room-current')}
    for(const [member,parts] of Object.entries(room.segments??{})){if(!Array.isArray(parts)){add('TEAM_IDENTITY_INVALID');continue}for(const part of parts)addSession(part?.sessionId,{kind:'room-bot',id,botId:member},'room-part')}
    if(room.workDir!==undefined)workspaces.push({owner:{kind:'room',id},path:room.workDir})
   }
   for(const [id,agent] of Object.entries(agents)){if(!record(agent)||agent.id!==id||!Array.isArray(agent.sessions)){add('TEAM_IDENTITY_INVALID');continue}for(const session of agent.sessions)addSession(session,{kind:'agent',id},'agent')}
  }
 }
 if(workspaces.length&&layout.workspacePolicy!=='preserve-in-place')add('UNPRESERVED_WORKSPACE','needs-context')
 const generations=[],groups=new Map(),sessionIds=new Map(),namedGenerations=new Map()
 for(const selection of Array.isArray(layout.sessions)?layout.sessions:[]){
  if(!record(selection)||!sources.has(selection.sourceId)||!['none','zstd'].includes(selection.compression)||(selection.prefix!==undefined&&selection.prefix!==''&&!relative(selection.prefix))){add('SESSION_COMPRESSION_CONTEXT','needs-context');continue}
  const source=sources.get(selection.sourceId),prefix=selection.prefix?selection.prefix+'/':''
  for(const [path] of source.files){
   if(!path.startsWith(prefix))continue
   const name=basename(path),compressed=name.endsWith('.zstd'),rawName=compressed?name.slice(0,-5):name,version=parseSessionFormatLogFilename(rawName)
   if(version===undefined){if(/\.jsonl(?:\.zstd)?$|session\.migration\./.test(name))add('SESSION_LAYOUT_UNSUPPORTED','needs-context',{sourceId:source.id,path});continue}
   if(path.slice(prefix.length).split('/').length!==3){add('SESSION_LAYOUT_UNSUPPORTED','needs-context',{sourceId:source.id,path});continue}
   if((compressed?'zstd':'none')!==selection.compression){add('SESSION_COMPRESSION_CONTEXT','needs-context',{sourceId:source.id,path});continue}
   const groupKey=source.id+'\0'+dirname(path);namedGenerations.set(groupKey,Math.max(namedGenerations.get(groupKey)??-1,version))
   if(generations.length>=limits.maxSessions)fail('MIGRATION_DOMAIN_SESSION_LIMIT')
   const bytes=await selected({sourceId:source.id,path});if(!bytes)continue
   let value
   try{value=await decodeMigrationSession(bytes,{compression:selection.compression,storedVersion:version,historicalInspection:version<=3,signal})}catch(e){if(['MIGRATION_SESSION_CANCELLED','MIGRATION_SESSION_BUSY'].includes(e.code))throw e;add(diagnosticCodes.has(e.code)?e.code:'SESSION_FORMAT_REFUSED','error',{sourceId:source.id,path,...(e.bound?{bound:e.bound}:{})});continue}
   decodedBytes+=value.decodedBytes;if(decodedBytes>limits.maxDecodedBytes)fail('MIGRATION_DOMAIN_DECODE_LIMIT')
   const storage=path.slice(prefix.length, -(name.length+1))
   if(storage!==sessionStorageAddress(value.header))add('SESSION_STORAGE_BINDING_INVALID','error',{sourceId:source.id,path,sessionId:value.header.id})
   const item={sourceId:source.id,path,storage,compression:selection.compression,version,...value};generations.push(item)
   const key=source.id+'\0'+dirname(path),previous=groups.get(key)
   if(!previous||version>previous.version)groups.set(key,item)
  }
 }
 for(const [key,item] of groups)if(item.version!==namedGenerations.get(key))groups.delete(key)
 const historicalFacts=[...groups.values()].map(child=>({header:structuredClone(child.header),fact:structuredClone(child.childFact)}))
 // Historical parents need the complete child evidence set, even when empty.
 // First-pass inspection uses the SDK's historical catalog, never a guessed
 // empty inventory; latest captured child generations supply the facts.
 for(const item of generations.filter(g=>g.version<=3)){
  const historicalChildren=historicalFacts.filter(child=>child.header.origin==='subagent'&&child.header.parentSession===item.header.id).map(child=>child.fact)
  for(const child of historicalChildren)if(child?.descriptorCount!==1)add('SESSION_CHILD_CONTEXT_REQUIRED','needs-context',{sessionId:item.header.id,childId:child?.childId})
  const bytes=await selected({sourceId:item.sourceId,path:item.path})
  try{
   const value=await decodeMigrationSession(bytes,{compression:item.compression,storedVersion:item.version,historicalChildren,signal})
   decodedBytes+=value.decodedBytes;if(decodedBytes>limits.maxDecodedBytes)fail('MIGRATION_DOMAIN_DECODE_LIMIT');Object.assign(item,value)
  }catch(e){if(['MIGRATION_SESSION_CANCELLED','MIGRATION_SESSION_BUSY','MIGRATION_DOMAIN_DECODE_LIMIT'].includes(e.code))throw e;add(diagnosticCodes.has(e.code)?e.code:'SESSION_FORMAT_REFUSED','error',{sourceId:item.sourceId,path:item.path,...(e.bound?{bound:e.bound}:{})})}
 }
 for(const item of groups.values()){if(sessionIds.has(item.header.id))add('DUPLICATE_SESSION_ID','error',{sessionId:item.header.id});else sessionIds.set(item.header.id,item)}
 const edges=[],attachments=[]
 for(const item of sessionIds.values()){
  const id=item.header.id,parent=item.header.parentSession
  if(parent!==undefined){edges.push({from:id,to:parent,kind:'parent'});if(!sessionIds.has(parent))add('MISSING_SESSION_REFERENCE','error',{sessionId:parent,fromSession:id})}
  for(const child of item.children){edges.push({from:id,to:child.id,kind:'catalog-child',mode:child.mode});if(child.mode==='external')add('EXTERNAL_CHILD_REFERENCE','warning',{sessionId:child.id});else if(!sessionIds.has(child.id))add('MISSING_SESSION_REFERENCE',child.mode==='continuable'?'error':'needs-context',{sessionId:child.id,fromSession:id})}
  if(item.opaqueRecords)add('UNINTERPRETED_EXTENSION_RECORD','warning',{sessionId:id,count:item.opaqueRecords})
  for(const ref of item.attachments)attachments.push({sessionId:id,ref})
 }
 for(const id of owners.keys())if(!sessionIds.has(id))add('MISSING_SESSION_REFERENCE','error',{sessionId:id})
 const finished=new Set()
 for(const id of sessionIds.keys()){
  const chain=new Set();let current=id
  while(current!==undefined&&!finished.has(current)){if(chain.has(current)){add('SESSION_PARENT_CYCLE','error',{sessionId:current});break}chain.add(current);current=sessionIds.get(current)?.header.parentSession}
  for(const node of chain)finished.add(node)
 }
 let resolvedAttachments=0
 const attachmentSelections=[]
 for(const x of Array.isArray(layout.attachments)?layout.attachments:[]){if(!record(x)||!sources.has(x.sourceId)||(x.prefix!==undefined&&x.prefix!==''&&!relative(x.prefix))){add('LAYOUT_CONTEXT_REQUIRED','needs-context');continue}attachmentSelections.push({source:sources.get(x.sourceId),prefix:x.prefix?x.prefix+'/':''})}
 for(const {sessionId,ref} of attachments){
  const digest=/^sha256:([a-f0-9]{64})$/.exec(ref.attachmentId??'')?.[1]
  if(!digest||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.kind==='file'&&(typeof ref.name!=='string'||!relative(ref.name)||ref.name.includes('/'))){add('ATTACHMENT_REFERENCE_INVALID','error',{sessionId});continue}
  const suffix=ref.kind==='image'?`objects/${digest.slice(0,2)}/${digest}`:`files/${digest.slice(0,2)}/${digest}/${ref.name}`
  const matches=attachmentSelections.map(x=>x.source.files.get(x.prefix+suffix)).filter(Boolean)
  if(matches.length>1)add('ATTACHMENT_LAYOUT_AMBIGUOUS','needs-context',{sessionId,attachmentId:ref.attachmentId})
  else if(matches.length!==1||matches[0].bytes!==ref.bytes||matches[0].sha256!==digest)add('ATTACHMENT_MISSING_OR_CHANGED','error',{sessionId,attachmentId:ref.attachmentId})
  else resolvedAttachments++
 }
 let secrets=null,secretDocument=null
 if(layout.secrets!==null&&layout.secrets){
  const value=await jsonFile(layout.secrets,{optional:layout.secrets.optional===true})
  secretDocument=value
  if(value!==null){
   if(value?.version!==1||!Array.isArray(value.secrets))add('SECRETS_FORMAT_INVALID')
   else{
    const names=new Set();secrets=[]
    for(const secret of value.secrets){
     if(!record(secret)||typeof secret.name!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(secret.name)||typeof secret.value!=='string'||names.has(secret.name)||secret.scope!=='all'&&(!Array.isArray(secret.scope)||secret.scope.some(id=>typeof id!=='string'))){add('SECRETS_FORMAT_INVALID');continue}
     names.add(secret.name);secrets.push({name:secret.name,scope:secret.scope,digest:hash(secret)})
     for(const id of Array.isArray(secret.scope)?secret.scope:[])if(!own(bots,id))add('SECRET_SCOPE_ORPHAN','warning',{secretName:secret.name,botId:id})
    }
   }
  }
 }
 const router=layout.router===null?null:layout.router?await jsonFile(layout.router):undefined
 const flat=[];function entries(rows){for(const row of rows??[]){flat.push(row);if(row.group===true&&Array.isArray(row.config))entries(row.config)}}entries(configurationPlan.proposal?.effectiveEntries)
 const budgetConfig=flat.find(x=>x.id==='model-router-galgame')?.config??{}
 const observedUsage=[...sources.values()].some(s=>s.original.kind==='bot-data'&&s.files.has('usage.sqlite'))
 if(observedUsage&&layout.usage===null)add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:'usage'})
 const moneyInput={routerState:router,budgetConfig,timeZone:financeInputs.timeZone,...(Object.hasOwn(financeInputs,'usageExport')&&!(observedUsage&&financeInputs.usageExport===null)?{usageExport:financeInputs.usageExport}:layout.usage===null&&!observedUsage?{usageExport:null}:{}),...(Object.hasOwn(financeInputs,'ledgerExport')?{ledgerExport:financeInputs.ledgerExport}:{})}
 if(moneyInput.routerState===undefined)delete moneyInput.routerState
 if(moneyInput.timeZone===undefined)delete moneyInput.timeZone
 const financial=auditMigrationFinance(moneyInput)
 if(financial.status!=='audited')add('FINANCE_CONTEXT_REQUIRED',financial.status==='blocked'?'error':'needs-context')
 let workspaceRegistry=null
 if(!layout.workspaceRegistry&&team?.workspaceId===undefined&&[...sources.values()].some(s=>s.files.has('workspace.json')))add('WORKSPACE_REGISTRY_REQUIRED','needs-context')
 if(layout.workspaceRegistry){
  const selection=layout.workspaceRegistry
  if(!record(selection)||selection.format!=='sdk-json-single')add('WORKSPACE_REGISTRY_REQUIRED','needs-context')
  else{
   const document=await jsonFile(selection)
   workspaceRegistry=auditMigrationWorkspaceRegistry({document,sessions:[...sessionIds.values()].map(x=>({header:x.header})),...(team?.workspaceId===undefined?{}:{teamWorkspaceId:team.workspaceId}),platform:selection.platform,workspacePolicy:layout.workspacePolicy})
   for(const diagnostic of workspaceRegistry.diagnostics)add(diagnostic.code,diagnostic.severity,Object.fromEntries(Object.entries(diagnostic).filter(([key])=>!['code','severity'].includes(key))))
  }
 }
 let supportingDomains=null
 if(layout.supportingDomains!==undefined){
  const selection=layout.supportingDomains,memoryFiles=[],memoryDirectories=[],covered=new Set()
  if(!record(selection)||!Array.isArray(selection.memory)||!team||team.version!==1)add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:'supportingDomains'})
  else{
   for(const x of selection.memory){
    if(!record(x)||!sources.has(x.sourceId)||(x.prefix!==undefined&&x.prefix!==''&&!relative(x.prefix))){add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:'memory'});continue}
    const source=sources.get(x.sourceId),prefix=x.prefix?x.prefix+'/':''
    for(const entry of source.original.entries)if(entry.type==='directory'&&entry.path.startsWith(prefix)&&entry.path.length>prefix.length)memoryDirectories.push(entry.path.slice(prefix.length))
    for(const [path] of source.files){if(!path.startsWith(prefix))continue;const name=path.slice(prefix.length),key=source.id+'\0'+path;if(covered.has(key)||memoryFiles.some(f=>f.path===name)){add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:'ambiguous-memory'});continue}covered.add(key);const bytes=await selected({sourceId:source.id,path});if(bytes)memoryFiles.push({path:name,bytes})}
   }
   for(const source of sources.values())if(source.original.kind==='bot-data')for(const [path] of source.files)if(path.startsWith('memory/')&&!covered.has(source.id+'\0'+path))add('LAYOUT_CONTEXT_REQUIRED','needs-context',{field:'unselected-memory'})
   supportingDomains=auditMigrationSupportingDomains({team,secrets:secretDocument,memoryFiles,memoryDirectories,sessionIds:[...sessionIds.keys()],connectorConfig:selection.connectorConfig??{},signal})
   for(const diagnostic of supportingDomains.diagnostics)add(diagnostic.code,diagnostic.severity,Object.fromEntries(Object.entries(diagnostic).filter(([key])=>!['code','severity'].includes(key))))
  }
 }
 await verifyMigrationDataArchive({privateOutput,signal});abort(signal)
 const result={schemaVersion:1,kind:'private-migration-domain-audit',diagnostics,team:team===null?null:{digest:hash(team),bots:Object.keys(bots).length,rooms:Object.keys(rooms).length,agents:Object.keys(agents).length},references:refs,sessionEdges:edges,sessions:[...sessionIds.values()].map(x=>({id:x.header.id,header:x.header,version:x.version,eventCount:x.eventCount,logicalDigest:x.logicalDigest})),generations:generations.map(x=>({sourceId:x.sourceId,path:x.path,version:x.version,logicalDigest:x.logicalDigest})),attachments:{referenced:attachments.length,resolved:resolvedAttachments},secrets,workspaces,financial,sourceContentDigests:manifest.sourceInventory.sources.map(s=>({id:s.id,kind:s.kind,contentFingerprint:s.contentFingerprint})),coverage:'team-session-attachment-secret-finance',requiresCompleteDomainReview:true,requiresStopProof:true,applySupported:false}
 result.status=diagnostics.some(x=>x.severity==='error')?'blocked':diagnostics.some(x=>x.severity==='needs-context')?'needs-context':'audited'
 result.workspaceRegistry=workspaceRegistry
 result.supportingDomains=supportingDomains
 result.fingerprint=domainFingerprint(result)
 return result
}

function domainFingerprint(result){return hash({team:result.team,references:result.references,sessionEdges:result.sessionEdges,sessions:result.sessions,generations:result.generations,attachments:result.attachments,secrets:result.secrets,workspaces:result.workspaces,workspaceRegistry:result.workspaceRegistry,supportingDomains:result.supportingDomains,financial:result.financial?.fingerprint,sourceContentDigests:result.sourceContentDigests})}

export function reconcileMigrationDomainAudits(before,after){
 for(const value of [before,after])if(value?.schemaVersion!==1||value.kind!=='private-migration-domain-audit'||domainFingerprint(value)!==value.fingerprint)fail('MIGRATION_DOMAIN_AUDIT_INVALID')
 const fields=['team','references','sessionEdges','sessions','generations','attachments','secrets','workspaces','workspaceRegistry','supportingDomains','sourceContentDigests']
 const changes=fields.filter(k=>hash(before[k])!==hash(after[k]));if(before.financial.fingerprint!==after.financial.fingerprint)changes.push('financial')
 return {equal:changes.length===0,changes,requiresCompleteDomainReview:true,requiresStopProof:true,readyToApply:false}
}

export function summarizeMigrationDomainAudit(result){
 const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000?n:0
 return {schemaVersion:1,status:['audited','blocked','needs-context'].includes(result?.status)?result.status:'blocked',bots:count(result?.team?.bots),rooms:count(result?.team?.rooms),agents:count(result?.team?.agents),sessions:count(result?.sessions?.length),generations:count(result?.generations?.length),references:count(result?.references?.length),attachments:count(result?.attachments?.referenced),resolvedAttachments:count(result?.attachments?.resolved),secrets:count(result?.secrets?.length),workspaceRecords:count(result?.workspaceRegistry?.records?.length),supportingDomains:result?.supportingDomains?summarizeMigrationSupportingDomains(result.supportingDomains):null,finance:summarizeMigrationFinance(result?.financial),diagnostics:(Array.isArray(result?.diagnostics)?result.diagnostics:[]).slice(0,256).map(d=>({code:diagnosticCodes.has(d?.code)?d.code:'UNKNOWN_DIAGNOSTIC',severity:['error','warning','needs-context'].includes(d?.severity)?d.severity:'error'})),applySupported:false,requiresCompleteDomainReview:true,requiresStopProof:true}
}
