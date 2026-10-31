import {createHash} from 'node:crypto'
import {parseMemory,cleanTopic} from '../../../modules/bot-runtime/vendor/ds-bot/src/host/memory.js'
import {validateCapabilityName,expandCapabilityNames} from '../../../modules/bot-runtime/vendor/ds-bot/src/host/capabilities.js'
const fail=code=>{throw Object.assign(new Error(code),{code})}
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex')
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),own=(o,k)=>Object.hasOwn(o??{},k)?o[k]:undefined
const ref=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\x00-\x1f\x7f]/.test(x)
const relative=x=>typeof x==='string'&&x.length>0&&x.length<=2048&&!/^[\\/]|[:\\\x00-\x1f\x7f]/.test(x)&&x.split('/').every(p=>p&&p!=='.'&&p!=='..')
const safeId=id=>/^[\w-]{1,128}$/.test(id)?id:createHash('sha256').update(id).digest('hex').slice(0,32)
const defaults=Object.freeze({maxFiles:10000,maxFileBytes:8*1024**2,maxTotalBytes:64*1024**2,maxLines:100000,maxJsonNodes:100000,maxJsonDepth:64,maxDiagnostics:256})
export const migrationSupportingDiagnosticCodes=Object.freeze(['MEMORY_SCOPE_ORPHAN','MEMORY_IDENTITY_COLLISION','MEMORY_TOPIC_LINK_INVALID','MEMORY_TOPIC_MISSING','MEMORY_OPAQUE_FILE_PRESERVED','MEMORY_FORMAT_INVALID','MEMORY_JOURNAL_CONFLICT','MEMORY_JOURNAL_TORN','MEMORY_OPERATION_CONTEXT','MEMORY_ARCHIVE_MISSING','MEMORY_PENDING_RECOVERY_REQUIRED','MEMORY_PENDING_PATH_INVALID','MEMORY_SNAPSHOT_ORPHAN','MEMORY_SUMMARY_ORPHAN','MEMORY_REVIEW_ORPHAN','CAPABILITY_FORMAT_INVALID','CAPABILITY_REFERENCE_INVALID','CAPABILITY_KIND_CONTEXT','CAPABILITY_UNAPPROVED_PRESERVED','CAPABILITY_CREATOR_ORPHAN','CAPABILITY_SECRET_MISSING','CAPABILITY_SECRET_DENIED','SUPPORTING_SECRET_INVALID','SUPPORTING_SECRET_ORPHAN','SUPPORTING_EXTENSION_PRESERVED'])

/** Private, bounded, pure projection of saved bytes. Never installs/mounts/replays. */
export function auditMigrationSupportingDomains({team,secrets=null,memoryFiles,memoryDirectories=[],sessionIds=[],connectorConfig={},limits:requested={},signal}={}){
 if(!record(requested)||!record(team)||team.version!==1||!record(team.bots)||!record(team.rooms)||!Array.isArray(memoryFiles)||!Array.isArray(memoryDirectories)||!Array.isArray(sessionIds)||!record(connectorConfig))fail('MIGRATION_SUPPORTING_INPUT_INVALID')
 const limits={...defaults}
 for(const [k,v] of Object.entries(requested)){if(!Object.hasOwn(defaults,k)||!Number.isSafeInteger(v)||v<1||v>defaults[k])fail('MIGRATION_SUPPORTING_INPUT_INVALID');limits[k]=v}
 const abort=()=>{if(signal?.aborted)fail('MIGRATION_SUPPORTING_CANCELLED')};abort()
 const diagnostics=[],add=(code,severity='error',detail={})=>{if(diagnostics.length>=limits.maxDiagnostics)fail('MIGRATION_SUPPORTING_DIAGNOSTIC_LIMIT');diagnostics.push({code,severity,...detail})}
 const bounded=value=>{const pending=[[value,0]];let count=0;while(pending.length){const [v,depth]=pending.pop();if(++count>limits.maxJsonNodes||depth>limits.maxJsonDepth)fail('MIGRATION_SUPPORTING_JSON_LIMIT');abort();if(v!==null&&typeof v==='object')for(const x of Object.values(v)){if(pending.length+count>=limits.maxJsonNodes)fail('MIGRATION_SUPPORTING_JSON_LIMIT');pending.push([x,depth+1])}}return value}
 bounded(team);bounded(secrets);bounded(connectorConfig)
 for(const ids of [Object.keys(team.bots),Object.keys(team.rooms),sessionIds])if(ids.some(id=>!ref(id)))fail('MIGRATION_SUPPORTING_INPUT_INVALID')
 const botIds=new Set(Object.keys(team.bots)),roomIds=new Set(Object.keys(team.rooms)),sessions=new Set(sessionIds)
 const identity=ids=>{const names=new Map();for(const id of ids){const name=safeId(id);if(names.has(name)&&names.get(name)!==id)add('MEMORY_IDENTITY_COLLISION');names.set(name,id)}return names}
 const botNames=identity(botIds),roomNames=identity(roomIds),sessionNames=identity(sessions),summaryNames=identity([...botIds,...roomIds])
 for(const id of botIds)if(roomIds.has(id))add('MEMORY_IDENTITY_COLLISION')
 const files=new Map();let bytes=0,lines=0
 if(memoryFiles.length+memoryDirectories.length>limits.maxFiles)fail('MIGRATION_SUPPORTING_FILE_LIMIT')
 for(const file of memoryFiles){abort();if(!record(file)||!relative(file.path)||!Buffer.isBuffer(file.bytes)||files.has(file.path))fail('MIGRATION_SUPPORTING_INPUT_INVALID');bytes+=file.bytes.length;if(file.bytes.length>limits.maxFileBytes||bytes>limits.maxTotalBytes)fail('MIGRATION_SUPPORTING_READ_LIMIT');files.set(file.path,file.bytes)}
 const decode=(path,data)=>{let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{add('MEMORY_FORMAT_INVALID','error',{path});return null}lines+=text.split('\n').length;if(lines>limits.maxLines)fail('MIGRATION_SUPPORTING_LINE_LIMIT');return text}
 const directories=new Set();for(const path of memoryDirectories){if(!relative(path)||directories.has(path)||files.has(path))fail('MIGRATION_SUPPORTING_INPUT_INVALID');directories.add(path)}
 const json=(path,text)=>{try{const value=bounded(JSON.parse(text));if(record(value))return value}catch(e){if(e.code)throw e}add('MEMORY_FORMAT_INVALID','error',{path});return null}
 const memory={files:[],directories:[...directories].sort(),documents:[],journal:[],snapshots:[],summaries:[],reviewCursors:[],pending:null,archiveFiles:0,opaqueFiles:0,entries:0}
 const journalIds=new Map(),topics=[]
 for(const [path,data] of files){
  abort();memory.files.push({path,bytes:data.length,sha256:hash(data)})
  const scope=/^(team|bots\/([^/]+)|groups\/([^/]+))\/([^/]+)\.md$/.exec(path)
  if(scope){
   const owner=scope[2]?botNames.get(scope[2]):scope[3]?roomNames.get(scope[3]):'team'
   if(owner===undefined)add('MEMORY_SCOPE_ORPHAN','warning',{path})
   const text=decode(path,data);if(text===null)continue
   const parsed=parseMemory(text),directory=path.slice(0,path.lastIndexOf('/')),name=scope[4]
   if(name!=='MEMORY'&&cleanTopic(name)!==name)add('MEMORY_OPERATION_CONTEXT','needs-context',{path})
   for(const link of parsed.links){const topic=cleanTopic(link);if(topic===undefined)add('MEMORY_TOPIC_LINK_INVALID','error',{path});else topics.push({path,target:directory+'/'+topic+'.md'})}
   memory.entries+=parsed.entries.length;memory.documents.push({path,owner:owner??null,kind:scope[2]?'bot':scope[3]?'group':'team',entryCount:parsed.entries.length,digest:hash(parsed)})
  }else if(path.startsWith('archive/')){
   // Archive names contain deleted identity and historical date. Never reassign.
   memory.archiveFiles++
  }else if(path==='journal.jsonl'){
   const text=decode(path,data);if(text===null)continue
   const rows=text.split('\n');for(let i=0;i<rows.length;i++){
    abort();const line=rows[i].replace(/\r$/,'');if(!line.trim())continue
    let row;try{row=bounded(JSON.parse(line))}catch(e){if(e.code)throw e;add(i===rows.length-1?'MEMORY_JOURNAL_TORN':'MEMORY_FORMAT_INVALID',i===rows.length-1?'needs-context':'error',{path,line:i+1});continue}
    if(!record(row)||!ref(row.id)||!ref(row.op)||!ref(row.scope)||typeof row.time!=='string'){add('MEMORY_FORMAT_INVALID','error',{path,line:i+1});continue}
    const digest=hash(row);if(journalIds.has(row.id)&&journalIds.get(row.id)!==digest)add('MEMORY_JOURNAL_CONFLICT','error',{path});journalIds.set(row.id,digest)
    if(!['add','replace','remove','archive'].includes(row.op))add('MEMORY_OPERATION_CONTEXT','needs-context',{path})
    if(row.scope!=='team'&&!/^(bot|group):.+$/.test(row.scope))add('MEMORY_OPERATION_CONTEXT','needs-context',{path})
    if(row.op==='archive'&&(!relative(row.to)||!row.to.startsWith('archive/')||!directories.has(row.to)&&![...files.keys()].some(p=>p.startsWith(row.to+'/'))))add('MEMORY_ARCHIVE_MISSING','error',{path})
    memory.journal.push({id:row.id,op:row.op,scope:row.scope,digest})
   }
  }else if(path==='journal.torn'){
   if(data.length)add('MEMORY_JOURNAL_TORN','needs-context',{path})
  }else if(path==='pending.json'){
   const text=decode(path,data);if(text===null)continue;const p=json(path,text)
   const valid=record(p)&&ref(p.id)&&ref(p.op)&&ref(p.scope)&&Array.isArray(p.steps)&&p.steps.length>0&&record(p.row)&&p.row.id===p.id&&p.steps.every(s=>record(s)&&typeof s.path==='string'&&(s.action==='remove'?s.text===undefined:s.action==='write'&&typeof s.text==='string'))
   if(!valid){add('MEMORY_FORMAT_INVALID','error',{path});continue}
   if(p.steps.some(s=>!relative(s.path)))add('MEMORY_PENDING_PATH_INVALID','error',{path})
   add('MEMORY_PENDING_RECOVERY_REQUIRED','needs-context',{path});memory.pending={id:p.id,steps:p.steps.length,digest:hash(p),journaled:journalIds.has(p.id)}
  }else if(/^snapshots\/[^/]+\.md$/.test(path)){
   const key=path.slice(10,-3),id=sessionNames.get(key);if(id===undefined)add('MEMORY_SNAPSHOT_ORPHAN','warning',{path})
   if(decode(path,data)!==null)memory.snapshots.push({sessionId:id??null,path,digest:hash(data)})
  }else if(/^summaries\/[^/]+\.json$/.test(path)){
   const key=path.slice(10,-5),id=summaryNames.get(key);if(id===undefined)add('MEMORY_SUMMARY_ORPHAN','warning',{path})
   const text=decode(path,data),v=text===null?null:json(path,text)
   if(v!==null&&(!record(v)||typeof v.hash!=='string'||typeof v.text!=='string'))add('MEMORY_FORMAT_INVALID','error',{path})
   else if(v!==null)memory.summaries.push({ownerId:id??null,path,digest:hash(v)})
  }else if(path==='reviewed.json'){
   const text=decode(path,data),v=text===null?null:json(path,text)
   if(v!==null&&!record(v))add('MEMORY_FORMAT_INVALID','error',{path})
   else for(const [key,value] of Object.entries(v??{})){
    if(!Number.isSafeInteger(value)||value< -1){add('MEMORY_FORMAT_INVALID','error',{path});continue}
    const match=/^(chat|group):(.+)$/.exec(key)
    if(!match)add('MEMORY_OPERATION_CONTEXT','needs-context',{path})
    else if(!(match[1]==='chat'?sessions:roomIds).has(match[2]))add('MEMORY_REVIEW_ORPHAN','warning',{path})
    memory.reviewCursors.push({key,through:value})
   }
  }else{memory.opaqueFiles++;add('MEMORY_OPAQUE_FILE_PRESERVED','needs-context',{path})}
 }
 if(memory.pending)memory.pending.journaled=journalIds.has(memory.pending.id)
 for(const link of topics)if(!files.has(link.target))add('MEMORY_TOPIC_MISSING','error',{path:link.path,target:link.target})
 memory.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
 const secretMap=new Map()
 if(secrets!==null){
  if(secrets?.version!==1||!Array.isArray(secrets.secrets))add('SUPPORTING_SECRET_INVALID')
  else for(const s of secrets.secrets){if(!record(s)||typeof s.name!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(s.name)||typeof s.value!=='string'||secretMap.has(s.name)||s.scope!=='all'&&(!Array.isArray(s.scope)||s.scope.some(id=>!ref(id)))){add('SUPPORTING_SECRET_INVALID');continue}secretMap.set(s.name,s);if(Array.isArray(s.scope)&&s.scope.some(id=>!botIds.has(id)))add('SUPPORTING_SECRET_ORPHAN','warning')}
 }
 const library=team.capabilities?.items,capabilities={items:[],bindings:[],references:[],libraryDigest:hash(team.capabilities??null),secretsDigest:hash(secrets),connector:{configured:connectorConfig.github!==false,credentialPresent:secretMap.has('GITHUB_TOKEN'),configurationDigest:hash(connectorConfig),verified:false}}
 const strings=v=>v===undefined||Array.isArray(v)&&v.every(x=>typeof x==='string'),stringMap=v=>v===undefined||record(v)&&Object.values(v).every(x=>typeof x==='string')
 if(!record(library))add('CAPABILITY_FORMAT_INVALID')
 else{
  for(const [name,item] of Object.entries(library)){
   abort();let valid=true;try{valid=validateCapabilityName(name)===name}catch{valid=false}
   if(!valid||!record(item)||item.name!==name){add('CAPABILITY_FORMAT_INVALID');continue}
   if(item.createdBy!=null&&!botIds.has(item.createdBy))add('CAPABILITY_CREATOR_ORPHAN','warning')
   if(!['mcp','skill','pack'].includes(item.kind))add('CAPABILITY_KIND_CONTEXT','needs-context')
   else if(item.kind==='pack'){
    if(!strings(item.items)||item.items===undefined)add('CAPABILITY_FORMAT_INVALID')
    else try{expandCapabilityNames([name],library)}catch{add('CAPABILITY_REFERENCE_INVALID')}
   }else if(item.kind==='skill'){if(typeof item.content!=='string')add('CAPABILITY_FORMAT_INVALID')}
   else if(item.transport==='stdio'){
    if(typeof item.command!=='string'||!item.command.trim()||!strings(item.args)||!stringMap(item.env)||item.approved!==undefined&&typeof item.approved!=='boolean')add('CAPABILITY_FORMAT_INVALID')
    if(item.approved!==true)add('CAPABILITY_UNAPPROVED_PRESERVED','warning')
   }else if(item.transport==='streamable-http'){
    try{if(!['http:','https:'].includes(new URL(item.url).protocol)||!stringMap(item.headers))throw Error()}catch{add('CAPABILITY_FORMAT_INVALID')}
   }else add('CAPABILITY_KIND_CONTEXT','needs-context')
   capabilities.items.push({name,kind:item.kind,approved:item.approved??null,digest:hash(item)})
  }
  for(const [botId,bot] of Object.entries(team.bots)){
   if(!record(bot)||!strings(bot.capabilities)){add('CAPABILITY_FORMAT_INVALID');continue}
   let expanded;try{expanded=[...expandCapabilityNames(bot.capabilities??[],library)]}catch{add('CAPABILITY_REFERENCE_INVALID','error',{botId});continue}
   capabilities.bindings.push({botId,attached:[...(bot.capabilities??[])],expanded})
   for(const name of expanded){const item=own(library,name);if(item?.kind!=='mcp')continue
    const values=item.transport==='stdio'?[...(Array.isArray(item.args)?item.args:[]),...Object.values(record(item.env)?item.env:{})]:[item.url,...Object.values(record(item.headers)?item.headers:{})]
    for(const secretName of new Set(values.filter(x=>typeof x==='string').flatMap(x=>[...x.matchAll(/\$DSH_SECRET_([A-Z][A-Z0-9_]*)/g)].map(m=>m[1])))){
     const secret=secretMap.get(secretName),allowed=secret!==undefined&&(secret.scope==='all'||secret.scope.includes(botId))
     capabilities.references.push({botId,capability:name,secretName,allowed})
     if(secret===undefined)add('CAPABILITY_SECRET_MISSING','needs-context',{botId,capability:name})
     else if(!allowed)add('CAPABILITY_SECRET_DENIED','needs-context',{botId,capability:name})
    }
   }
  }
 }
 abort()
 const result={schemaVersion:1,kind:'private-migration-supporting-audit',status:diagnostics.some(d=>d.severity==='error')?'blocked':diagnostics.some(d=>d.severity==='needs-context')?'needs-context':'audited',memory,capabilities,diagnostics,requiresStopProof:true,requiresCompleteDomainReview:true,applySupported:false}
 result.fingerprint=hash({memory,capabilities});return result
}

export function summarizeMigrationSupportingDomains(result){
 const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000?x:0
 return {status:['audited','blocked','needs-context'].includes(result?.status)?result.status:'blocked',memoryFiles:count(result?.memory?.files?.length),memoryEntries:count(result?.memory?.entries),journalRows:count(result?.memory?.journal?.length),snapshots:count(result?.memory?.snapshots?.length),summaries:count(result?.memory?.summaries?.length),reviewCursors:count(result?.memory?.reviewCursors?.length),archiveFiles:count(result?.memory?.archiveFiles),capabilities:count(result?.capabilities?.items?.length),capabilityBindings:count(result?.capabilities?.bindings?.length),secretReferences:count(result?.capabilities?.references?.length),connectorVerified:false,diagnostics:(Array.isArray(result?.diagnostics)?result.diagnostics:[]).slice(0,256).map(d=>({code:migrationSupportingDiagnosticCodes.includes(d?.code)?d.code:'UNKNOWN_DIAGNOSTIC',severity:['error','warning','needs-context'].includes(d?.severity)?d.severity:'error'})),applySupported:false,requiresStopProof:true,requiresCompleteDomainReview:true}
}
