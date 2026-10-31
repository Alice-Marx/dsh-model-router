import {open,realpath,lstat} from 'node:fs/promises'
import {resolve,dirname,join,isAbsolute,relative,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {createPrivateMigrationDirectory,writePrivateMigrationFile,hashPrivateMigrationFile} from './migration-private-files.mjs'

const fail=code=>{throw Object.assign(new Error(code),{code})}
const hash=value=>createHash('sha256').update(value).digest('hex')
const json=value=>JSON.stringify(value)
const quote=value=>'"'+value.replaceAll('"','""')+'"'
const inside=(base,target)=>{const p=relative(base,target);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)}
const abort=signal=>{if(signal?.aborted)fail('MIGRATION_LEDGER_CANCELLED')}
const defaults=Object.freeze({maxRows:100000,maxSchemaItems:512,maxExportBytes:64*1024**2,maxValueBytes:4*1024**2,maxDatabaseBytes:512*1024**2})
function limitsFor(options={}){
  if(options===null||typeof options!=='object'||Array.isArray(options))fail('MIGRATION_LEDGER_LIMIT_INVALID')
  const out={...defaults}
  for(const [key,value] of Object.entries(options)){
    if(!Object.hasOwn(defaults,key)||!Number.isSafeInteger(value)||value<1||value>defaults[key])fail('MIGRATION_LEDGER_LIMIT_INVALID')
    out[key]=value
  }
  return out
}
const version=db=>{const v=db.pragma('user_version',{simple:true});if(![0,1,2,3,4,5].includes(v))fail('MIGRATION_LEDGER_SCHEMA_UNSUPPORTED');return v}
const connection=db=>{if(!db?.open||typeof db.backup!=='function'||db.inTransaction)fail('MIGRATION_LEDGER_CONNECTION_UNAVAILABLE')}

/** A PRIVATE, bounded, lossless read-transaction export. Never executes payloads. */
export function exportMigrationLedger(database,{limits:requested,signal}={}){
  connection(database);const limits=limitsFor(requested)
  return database.transaction(()=>{
    abort(signal)
    const userVersion=version(database),schema=[],tables=[]
    if(database.pragma('page_count',{simple:true})*database.pragma('page_size',{simple:true})>limits.maxDatabaseBytes)fail('MIGRATION_LEDGER_DATABASE_LIMIT')
    let used=0,rowCount=0
    const account=value=>{const n=Buffer.byteLength(json(value));used+=n;if(used>limits.maxExportBytes)fail('MIGRATION_LEDGER_EXPORT_LIMIT')}
    for(const row of database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').iterate()){
      if(schema.length>=limits.maxSchemaItems)fail('MIGRATION_LEDGER_SCHEMA_LIMIT')
      if(row.sql!==null&&Buffer.byteLength(row.sql)>limits.maxValueBytes)fail('MIGRATION_LEDGER_VALUE_LIMIT')
      if(row.type==='table'&&/^CREATE\s+VIRTUAL\s+TABLE\b/i.test(row.sql??''))fail('MIGRATION_LEDGER_VIRTUAL_UNSUPPORTED')
      account(row);schema.push(row)
    }
    const encode=value=>{
      let out
      if(value===null)out={type:'null'}
      else if(typeof value==='bigint')out={type:'integer',value:String(value)}
      else if(typeof value==='number')out={type:'real',value:Object.is(value,-0)?'-0':String(value)}
      else if(typeof value==='string')out={type:'text',value}
      else if(Buffer.isBuffer(value))out={type:'blob',value:value.toString('base64')}
      else fail('MIGRATION_LEDGER_VALUE_UNSUPPORTED')
      if(Buffer.byteLength(json(out))>limits.maxValueBytes)fail('MIGRATION_LEDGER_VALUE_LIMIT')
      return out
    }
    const tableInfo=database.pragma('table_list').filter(t=>t.schema==='main')
    for(const item of schema.filter(s=>s.type==='table')){
      abort(signal)
      const columns=database.prepare(`PRAGMA table_xinfo(${quote(item.name)})`).all(),names=columns.map(c=>c.name)
      if(columns.length>2048)fail('MIGRATION_LEDGER_SCHEMA_LIMIT')
      const withoutRowid=Boolean(tableInfo.find(t=>t.name===item.name)?.wr)
      const rowidAlias=['rowid','_rowid_','oid'].find(n=>!names.some(c=>c.toLowerCase()===n))
      if(!withoutRowid&&!rowidAlias)fail('MIGRATION_LEDGER_ROWID_UNSUPPORTED')
      const order=withoutRowid?columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>quote(c.name)).join(','):quote(rowidAlias)
      const selected=[...(!withoutRowid?[quote(rowidAlias)]:[]),...names.map(quote)].join(',')
      // Check lengths before fetching values, so a single huge blob or a wide
      // row cannot allocate an oversized JS result before the encoded bound.
      let checkedRows=0
      for(const sizes of database.prepare(`SELECT ${names.map(name=>`length(CAST(${quote(name)} AS BLOB))`).join(',')} FROM ${quote(item.name)}`).raw(true).iterate()){
        abort(signal);if(++checkedRows+rowCount>limits.maxRows)fail('MIGRATION_LEDGER_ROW_LIMIT')
        if(sizes.some(n=>n>limits.maxValueBytes))fail('MIGRATION_LEDGER_VALUE_LIMIT')
        if(sizes.reduce((sum,n)=>sum+(n??0),0)>limits.maxExportBytes)fail('MIGRATION_LEDGER_EXPORT_LIMIT')
      }
      const rows=[]
      for(const row of database.prepare(`SELECT ${selected} FROM ${quote(item.name)} ORDER BY ${order}`).safeIntegers(true).raw(true).iterate()){
        abort(signal);if(++rowCount>limits.maxRows)fail('MIGRATION_LEDGER_ROW_LIMIT')
        const value={rowid:withoutRowid?null:String(row[0]),values:row.slice(withoutRowid?0:1).map(encode)}
        account(value);rows.push(value)
      }
      const table={name:item.name,withoutRowid,columns,rows};account({name:table.name,withoutRowid,columns});tables.push(table)
    }
    const pragmas={applicationId:database.pragma('application_id',{simple:true}),encoding:database.pragma('encoding',{simple:true}),autoVacuum:database.pragma('auto_vacuum',{simple:true}),pageSize:database.pragma('page_size',{simple:true})}
    const data={schemaVersion:1,kind:'private-sqlite-ledger-export',userVersion,pragmas,schema,tables},encoded=json(data)
    if(Buffer.byteLength(encoded)>limits.maxExportBytes)fail('MIGRATION_LEDGER_EXPORT_LIMIT')
    return {...data,contentDigest:hash(encoded),counts:{tables:tables.length,schemaItems:schema.length,rows:rowCount},databaseConsistent:true,crossDomainConsistent:false,requiresStopProof:true}
  }).deferred()
}

function checkDatabase(database){
  if(Object.values(database.prepare('PRAGMA quick_check').get())[0]!=='ok')fail('MIGRATION_LEDGER_INTEGRITY_FAILED')
  if(database.prepare('PRAGMA foreign_key_check').get())fail('MIGRATION_LEDGER_REFERENCES_INVALID')
}
async function boundedJson(directory,name,maximum){
  const expected=await hashPrivateMigrationFile(directory,name,maximum),handle=await open(join(directory,name),'r')
  try{
    const stat=await handle.stat();if(stat.size!==expected.bytes||!stat.isFile())fail('MIGRATION_PRIVATE_OUTPUT_CHANGED')
    const buffer=Buffer.alloc(expected.bytes+1);let size=0
    while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead}
    const bytes=buffer.subarray(0,size)
    if(size!==expected.bytes||hash(bytes)!==expected.sha256)fail('MIGRATION_PRIVATE_OUTPUT_CHANGED')
    try{return JSON.parse(bytes.toString('utf8'))}catch{fail('MIGRATION_LEDGER_ARCHIVE_INVALID')}
  }finally{await handle.close()}
}

/** Borrow an owner connection; backup committed WAL data to a new private archive.
 * Snapshot consistency is per database only. Never alters authority/rollback. */
export async function createMigrationLedgerArchive({Database,database,privateOutput,limits:requested,signal}={}){
  connection(database);if(typeof Database!=='function')fail('MIGRATION_LEDGER_DRIVER_REQUIRED')
  const limits=limitsFor(requested);abort(signal);version(database)
  if(typeof privateOutput!=='string'||!isAbsolute(privateOutput))fail('MIGRATION_PRIVATE_OUTPUT_ABSOLUTE_REQUIRED')
  const output=resolve(privateOutput),canonical=join(await realpath(dirname(output)),output.slice(dirname(output).length).replace(/^[/\\]/,''))
  if(database.name&&database.name!==':memory:'){
    const source=await realpath(resolve(database.name))
    if(inside(dirname(source),canonical)||inside(canonical,source))fail('MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE')
  }
  const pageSize=database.pragma('page_size',{simple:true})
  if(database.pragma('page_count',{simple:true})*pageSize>limits.maxDatabaseBytes)fail('MIGRATION_LEDGER_DATABASE_LIMIT')
  await createPrivateMigrationDirectory(canonical)
  await writePrivateMigrationFile(canonical,'README.txt',Buffer.from('PRIVATE ledger archive. Contains complete SQL data, including credentials and source locations. Keep outside Git/npm, public reports and model inputs. Only archive.private.json with status complete identifies a verified archive. Per-database snapshot only: no cross-domain stop proof, migration activation, relocation or rollback authorization.\n'))
  const backup=join(canonical,'ledger.sqlite'),reservation=await open(backup,'wx',0o600);await reservation.close()
  await database.backup(backup,{progress:({totalPages})=>{abort(signal);if(totalPages*pageSize>limits.maxDatabaseBytes)fail('MIGRATION_LEDGER_DATABASE_LIMIT');return 128}})
  abort(signal)
  let copied,exported
  try{
    copied=new Database(backup,{readonly:true,fileMustExist:true});copied.pragma('query_only=ON');checkDatabase(copied)
    exported=exportMigrationLedger(copied,{limits,signal})
  }finally{copied?.close()}
  const databaseFile=await hashPrivateMigrationFile(canonical,'ledger.sqlite',limits.maxDatabaseBytes,{sync:true,signal})
  const logicalFile=await writePrivateMigrationFile(canonical,'ledger-export.private.json',Buffer.from(json(exported)+'\n'))
  const artifact={schemaVersion:1,kind:'private-ledger-archive',status:'complete',userVersion:exported.userVersion,contentDigest:exported.contentDigest,counts:exported.counts,files:{'ledger.sqlite':databaseFile,'ledger-export.private.json':logicalFile},limits,databaseConsistent:true,crossDomainConsistent:false,requiresStopProof:true}
  await verifyArchiveContents({Database,root:canonical,artifact,signal})
  abort(signal)
  await writePrivateMigrationFile(canonical,'archive.private.json',Buffer.from(json(artifact)+'\n'))
  return summarizeMigrationLedgerArchive(artifact)
}

/** Re-derive the full export from the standalone database, not just manifest hashes. */
export async function verifyMigrationLedgerArchive({Database,privateOutput,signal}={}){
  if(typeof Database!=='function'||typeof privateOutput!=='string'||!isAbsolute(privateOutput))fail('MIGRATION_LEDGER_ARCHIVE_INVALID')
  if((await lstat(privateOutput)).isSymbolicLink())fail('MIGRATION_LEDGER_ARCHIVE_INVALID')
  const root=await realpath(privateOutput),artifact=await boundedJson(root,'archive.private.json',1048576)
  return verifyArchiveContents({Database,root,artifact,signal})
}

async function verifyArchiveContents({Database,root,artifact,signal}){
  if(artifact?.schemaVersion!==1||artifact.kind!=='private-ledger-archive'||artifact.status!=='complete'||artifact.databaseConsistent!==true||artifact.crossDomainConsistent!==false||artifact.requiresStopProof!==true)fail('MIGRATION_LEDGER_ARCHIVE_INVALID')
  const limits=limitsFor(artifact.limits);abort(signal)
  if(Object.keys(artifact.files??{}).sort().join(',')!=='ledger-export.private.json,ledger.sqlite')fail('MIGRATION_LEDGER_ARCHIVE_INVALID')
  for(const name of ['ledger.sqlite','ledger-export.private.json']){
    const info=await hashPrivateMigrationFile(root,name,name==='ledger.sqlite'?limits.maxDatabaseBytes:limits.maxExportBytes+1024,{signal})
    if(json(info)!==json(artifact.files[name]))fail('MIGRATION_LEDGER_ARCHIVE_CHANGED')
  }
  const saved=await boundedJson(root,'ledger-export.private.json',limits.maxExportBytes+1024)
  let db,exported
  try{db=new Database(join(root,'ledger.sqlite'),{readonly:true,fileMustExist:true});db.pragma('query_only=ON');checkDatabase(db);exported=exportMigrationLedger(db,{limits,signal})}finally{db?.close()}
  if(json(exported)!==json(saved)||exported.contentDigest!==artifact.contentDigest||json(exported.counts)!==json(artifact.counts)||exported.userVersion!==artifact.userVersion)fail('MIGRATION_LEDGER_ARCHIVE_CHANGED')
  return summarizeMigrationLedgerArchive(artifact)
}

/** No SQL, labels, paths, row content or user-data digests cross this boundary. */
export function summarizeMigrationLedgerArchive(artifact){
  const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000?n:0
  return {schemaVersion:1,kind:'ledger-archive',status:artifact?.status==='complete'?'complete':'incomplete',tables:count(artifact?.counts?.tables),rows:count(artifact?.counts?.rows),databaseConsistent:artifact?.databaseConsistent===true,crossDomainConsistent:false,requiresStopProof:true,applySupported:false}
}
