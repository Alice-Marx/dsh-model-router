import {constants} from 'node:fs'
import {lstat,realpath,opendir,open} from 'node:fs/promises'
import {resolve,join,relative,isAbsolute,sep} from 'node:path'
import {createHash} from 'node:crypto'

const SCHEMA=1
const DEFAULTS=Object.freeze({maxEntries:100000,maxBytes:8*1024**3,maxFileBytes:4*1024**3})
const MAX=Object.freeze({maxEntries:1000000,maxBytes:1024**4,maxFileBytes:1024**4})
const kinds=new Set(['bot-data','sessions','attachments','ledger','workspace','other'])
const hash=data=>createHash('sha256').update(data).digest('hex')
const digest=value=>hash(JSON.stringify(value))
const fail=(code,details)=>{throw Object.assign(new Error(code),{code,...(details?{details}: {})})}
const inside=(base,target)=>{const part=relative(base,target);return !part||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)}
const identity=s=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','nlink'].map(k=>[k,String(s[k])]))
const same=(a,b)=>JSON.stringify(identity(a))===JSON.stringify(identity(b))
const abort=signal=>{if(signal?.aborted)fail('MIGRATION_SCAN_CANCELLED')}
function limitsFor(options){
  const result={}
  for(const key of Object.keys(DEFAULTS)){
    const n=options[key]??DEFAULTS[key]
    if(!Number.isSafeInteger(n)||n<0||n>MAX[key])fail('MIGRATION_SCAN_LIMIT_INVALID')
    result[key]=n
  }
  return result
}
function contentRows(entries){return entries.map(row=>({path:row.path,type:row.type,...(row.type==='file'?{bytes:row.bytes,sha256:row.sha256}:{})}))}
function validateInventory(value){
  if(value?.schemaVersion!==SCHEMA||!Array.isArray(value.sources)||value.consistentSnapshot!==false||value.requiresStopProof!==true)fail('MIGRATION_INVENTORY_INVALID')
  for(const source of value.sources){
    if(typeof source.root!=='string'||!isAbsolute(source.root)||!kinds.has(source.kind)||!Array.isArray(source.entries))fail('MIGRATION_INVENTORY_INVALID')
    if(source.fingerprint!==digest({root:source.root,entries:source.entries})||source.contentFingerprint!==digest(contentRows(source.entries)))fail('MIGRATION_INVENTORY_CHANGED')
  }
  if(value.fingerprint!==digest(value.sources.map(s=>({id:s.id,kind:s.kind,fingerprint:s.fingerprint}))))fail('MIGRATION_INVENTORY_CHANGED')
}

/** Host-only explicit tree selection. No source writes, execution, or network. */
export async function inspectMigrationSources(sources,options={}){
  if(!Array.isArray(sources)||!sources.length||sources.length>64)fail('MIGRATION_SOURCES_REQUIRED')
  const limits=limitsFor(options),selected=[],ids=new Set()
  let files=0,directories=0,totalBytes=0,entriesCount=0
  for(let index=0;index<sources.length;index++){
    abort(options.signal)
    const input=sources[index]
    if(!input||typeof input.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.id)||ids.has(input.id)||!kinds.has(input.kind)||typeof input.root!=='string'||!isAbsolute(input.root))fail('MIGRATION_SOURCE_INVALID',{sourceIndex:index})
    ids.add(input.id)
    const root=resolve(input.root),s=await lstat(root,{bigint:true})
    if(s.isSymbolicLink())fail('MIGRATION_LINK_UNSUPPORTED',{sourceIndex:index,path:''})
    if(!s.isDirectory())fail('MIGRATION_SOURCE_NOT_DIRECTORY',{sourceIndex:index})
    const actual=await realpath(root)
    if(selected.some(p=>inside(p.root,actual)||inside(actual,p.root)))fail('MIGRATION_SOURCE_OVERLAP',{sourceIndex:index})
    selected.push({id:input.id,kind:input.kind,root:actual,initial:s})
  }
  const result=[]
  for(let sourceIndex=0;sourceIndex<selected.length;sourceIndex++){
    const source=selected[sourceIndex],entries=[]
    async function visit(parts){
      abort(options.signal)
      if(++entriesCount>limits.maxEntries)fail('MIGRATION_SCAN_ENTRY_LIMIT',{sourceIndex})
      const path=parts.join('/'),absolute=join(source.root,...parts),before=await lstat(absolute,{bigint:true})
      if(before.isSymbolicLink())fail('MIGRATION_LINK_UNSUPPORTED',{sourceIndex,path})
      if(!inside(source.root,await realpath(absolute)))fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path})
      if(before.isDirectory()){
        directories++;entries.push({path,type:'directory',identity:identity(before)})
        const names=[]
        for await(const entry of await opendir(absolute)){
          names.push(entry.name)
          if(names.length+entriesCount>limits.maxEntries)fail('MIGRATION_SCAN_ENTRY_LIMIT',{sourceIndex})
        }
        for(const name of names.sort()){
          if(!name||name==='.'||name==='..'||/[\0/\\]/.test(name))fail('MIGRATION_PATH_UNSUPPORTED',{sourceIndex})
          await visit([...parts,name])
        }
        const after=await lstat(absolute,{bigint:true})
        if(!same(before,after)||before.isDirectory()!==after.isDirectory())fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path})
      }else if(before.isFile()){
        if(before.size>BigInt(limits.maxFileBytes))fail('MIGRATION_SCAN_FILE_LIMIT',{sourceIndex,path})
        if(before.size>BigInt(limits.maxBytes-totalBytes))fail('MIGRATION_SCAN_BYTE_LIMIT',{sourceIndex})
        const handle=await open(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW??0))
        try{
          const opened=await handle.stat({bigint:true})
          if(!opened.isFile()||!same(before,opened))fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path})
          // On Linux the opened descriptor must still refer to this selected
          // tree even when an ancestor name changes during the open.
          if(process.platform==='linux'&&!inside(source.root,await realpath(`/proc/self/fd/${handle.fd}`)))fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path})
          const h=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0
          while(true){
            abort(options.signal)
            const read=await handle.read(buffer,0,buffer.length,null)
            if(!read.bytesRead)break
            bytes+=read.bytesRead
            if(bytes>limits.maxFileBytes||bytes>limits.maxBytes-totalBytes||BigInt(bytes)>opened.size)fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path})
            h.update(buffer.subarray(0,read.bytesRead))
          }
          const after=await handle.stat({bigint:true}),named=await lstat(absolute,{bigint:true})
          if(!same(opened,after)||!same(opened,named)||named.isSymbolicLink()||BigInt(bytes)!==opened.size)fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path})
          files++;totalBytes+=bytes;entries.push({path,type:'file',bytes,sha256:h.digest('hex'),identity:identity(opened)})
        }finally{await handle.close()}
      }else fail('MIGRATION_SPECIAL_FILE_UNSUPPORTED',{sourceIndex,path})
    }
    await visit([])
    if(!same(source.initial,await lstat(source.root,{bigint:true})))fail('MIGRATION_SOURCE_CHANGED',{sourceIndex,path:''})
    result.push({id:source.id,kind:source.kind,root:source.root,entries,contentFingerprint:digest(contentRows(entries)),fingerprint:digest({root:source.root,entries})})
  }
  return {schemaVersion:SCHEMA,sources:result,fingerprint:digest(result.map(s=>({id:s.id,kind:s.kind,fingerprint:s.fingerprint}))),counts:{sources:result.length,files,directories,totalBytes},limits,consistentSnapshot:false,requiresStopProof:true}
}

/** Detect drift, not proof that every writer is stopped. */
export async function verifyMigrationInventory(inventory,options={}){
  validateInventory(inventory)
  const current=await inspectMigrationSources(inventory.sources.map(({id,kind,root})=>({id,kind,root})),{...inventory.limits,...options})
  if(current.fingerprint!==inventory.fingerprint)fail('MIGRATION_SOURCE_CHANGED')
  return {unchanged:true,consistentSnapshot:false,requiresStopProof:true}
}

/** Compare copied bytes/structure. IDs inside files need domain reconciliation. */
export function reconcileMigrationInventories(before,after){
  validateInventory(before);validateInventory(after)
  const domains=new Map(after.sources.map(s=>[s.id,s])),missing=[],extra=[],changed=[]
  for(const source of before.sources){
    const target=domains.get(source.id)
    if(!target){missing.push({sourceId:source.id,path:''});continue}
    domains.delete(source.id)
    if(source.kind!==target.kind){changed.push({sourceId:source.id,path:'',reason:'domain-kind'});continue}
    const targets=new Map(contentRows(target.entries).map(e=>[e.path,e]))
    for(const entry of contentRows(source.entries)){
      const next=targets.get(entry.path);targets.delete(entry.path)
      if(!next)missing.push({sourceId:source.id,path:entry.path})
      else if(JSON.stringify(entry)!==JSON.stringify(next))changed.push({sourceId:source.id,path:entry.path,reason:'structure-or-content'})
    }
    for(const path of targets.keys())extra.push({sourceId:source.id,path})
  }
  for(const sourceId of domains.keys())extra.push({sourceId,path:''})
  return {equal:!missing.length&&!extra.length&&!changed.length,missing,extra,changed,consistentSnapshot:false,requiresStopProof:true}
}

/** Public diagnostics never include caller labels, paths or individual hashes. */
export function summarizeMigrationInventory(inventory){
  validateInventory(inventory)
  const counts={sources:inventory.sources.length,files:0,directories:0,totalBytes:0}
  for(const source of inventory.sources)for(const entry of source.entries){if(entry.type==='directory')counts.directories++;else{counts.files++;counts.totalBytes+=entry.bytes}}
  return {schemaVersion:SCHEMA,...counts,consistentSnapshot:false,requiresStopProof:true,scope:'read-only-selected-trees'}
}
