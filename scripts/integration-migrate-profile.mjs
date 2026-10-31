import {open,lstat,realpath,mkdir,rmdir,writeFile,readFile} from 'node:fs/promises'
import {resolve,dirname,join,isAbsolute,relative,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {previewProfileMigration,summarizeProfileMigration,verifyProfileMigrationSources} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources,summarizeMigrationInventory,verifyMigrationInventory} from '../packages/orchestration/src/migration-snapshot.mjs'

const execute=promisify(execFile),sha=data=>createHash('sha256').update(data).digest('hex')
const fail=code=>{throw Object.assign(new Error(code),{code})}
const within=(base,target)=>{const p=relative(base,target);return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p)}
async function actual(p){try{return await realpath(p)}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;const parent=dirname(p);if(parent===p)throw e;return join(await actual(parent),p.slice(parent.length).replace(/^[/\\]/,''))}}
async function readRequest(file){
  const handle=await open(file,'r')
  try{
    const before=await handle.stat({bigint:true});if(!before.isFile()||before.size>1048576n)fail('MIGRATION_REQUEST_LIMIT')
    const buffer=Buffer.alloc(Number(before.size)+1);let bytes=0
    while(bytes<buffer.length){const r=await handle.read(buffer,bytes,buffer.length-bytes,null);if(!r.bytesRead)break;bytes+=r.bytesRead}
    const after=await handle.stat({bigint:true});if(bytes!==Number(before.size)||before.ino!==after.ino||before.dev!==after.dev||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)fail('MIGRATION_REQUEST_CHANGED')
    let request;try{request=JSON.parse(buffer.subarray(0,bytes).toString('utf8'))}catch{fail('MIGRATION_REQUEST_INVALID')}
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['profile','dataSources','limits'].includes(k)))fail('MIGRATION_REQUEST_INVALID')
    return request
  }finally{await handle.close()}
}
async function privateDirectory(path){
  await mkdir(path,{mode:0o700}) // new directory only; never change a user's existing ACL
  try{
    if(process.platform==='win32'){
      const system=join(process.env.SystemRoot??'C:/Windows','System32')
      const who=await execute(join(system,'whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true,timeout:5000,maxBuffer:65536})
      const sid=who.stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];if(!sid)fail('MIGRATION_PRIVATE_ACL_FAILED')
      await execute(join(system,'icacls.exe'),[path,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,timeout:5000,maxBuffer:65536})
    }else if((await lstat(path)).mode&0o077)fail('MIGRATION_PRIVATE_ACL_FAILED')
  }catch{await rmdir(path).catch(()=>{});fail('MIGRATION_PRIVATE_ACL_FAILED')}
}

/** Owner CLI/API only. A preview never installs, activates, or stops a writer. */
export async function runMigrationPreview({request,privateOutput}={}){
  if(!request||typeof request!=='object'||Array.isArray(request)||!request.profile||typeof request.profile!=='object'||Array.isArray(request.profile))fail('MIGRATION_REQUEST_INVALID')
  const profile=await previewProfileMigration(request.profile)
  const inventory=request.dataSources===undefined?null:await inspectMigrationSources(request.dataSources,request.limits??{})
  if(!(await verifyProfileMigrationSources(profile)).unchanged)fail('MIGRATION_SOURCE_CHANGED')
  if(inventory)await verifyMigrationInventory(inventory)
  const summary={schemaVersion:1,kind:'migration-preview',status:profile.status==='ready'?(inventory?'preview-ready':'needs-data-selection'):profile.status,
    configuration:summarizeProfileMigration(profile),data:inventory?summarizeMigrationInventory(inventory):null,
    consistentSnapshot:false,requiresStopProof:true,applySupported:false,savedPrivatePlan:false}
  if(privateOutput!==undefined){
    if(typeof privateOutput!=='string'||!isAbsolute(privateOutput))fail('MIGRATION_PRIVATE_OUTPUT_ABSOLUTE_REQUIRED')
    const output=resolve(privateOutput),parent=await realpath(dirname(output)),canonical=join(parent,output.slice(dirname(output).length).replace(/^[/\\]/,''))
    const roots=[request.profile.profileDir,request.profile.dshHome,profile.runtimePaths?.effectiveHome,profile.runtimePaths?.effectiveWorkspace,
      ...(request.profile.orderedBundleLayers??[]).map(r=>r.packageDir),request.profile.targetBundleLayer?.packageDir,
      ...(inventory?.sources??[]).map(r=>r.root),...profile.sources.map(r=>r.path)].filter(p=>typeof p==='string'&&isAbsolute(p))
    for(const root of roots){const source=await actual(resolve(root));if(within(source,canonical)||within(canonical,source))fail('MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE')}
    const artifact={schemaVersion:1,kind:'migration-preview',consistentSnapshot:false,requiresStopProof:true,applySupported:false,profile,inventory}
    const bytes=Buffer.from(JSON.stringify(artifact,null,2)+'\n');if(bytes.length>128*1024*1024)fail('MIGRATION_PRIVATE_OUTPUT_LIMIT')
    await privateDirectory(canonical)
    const file=join(canonical,'plan.private.json'),handle=await open(file,'wx',0o600)
    try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
    if(sha(await readFile(file))!==sha(bytes))fail('MIGRATION_PRIVATE_OUTPUT_VERIFY_FAILED')
    await writeFile(join(canonical,'README.txt'),'PRIVATE migration preview. Contains configuration, selected source paths and data hashes; may include credentials. Keep outside Git, npm, public reports and model inputs. This does not stop writers or activate a migration. Refresh and verify sources before any future apply.\n',{flag:'wx',mode:0o600})
    if(!(await verifyProfileMigrationSources(profile)).unchanged)fail('MIGRATION_SOURCE_CHANGED')
    if(inventory)await verifyMigrationInventory(inventory)
    summary.savedPrivatePlan=true
  }
  return summary
}

async function main(args){
  if(args.length===1&&['--help','-h'].includes(args[0])){console.log('Read-only migration preview: node scripts/integration-migrate-profile.mjs --request <JSON-file> [--private-output <new-absolute-directory>]\nRequest: {profile: explicit launch/bundle context, dataSources?: selected data trees, limits?: scan bounds}. No apply, writer shutdown or data migration is performed. Stdout contains only a redacted summary.');return}
  let requestFile,privateOutput
  for(let i=0;i<args.length;i++){
    const flag=args[i],value=args[++i]
    if(!value||value.startsWith('--'))fail('MIGRATION_CLI_ARGUMENT_INVALID')
    if(flag==='--request'&&!requestFile)requestFile=value
    else if(flag==='--private-output'&&privateOutput===undefined)privateOutput=value
    else fail('MIGRATION_CLI_ARGUMENT_INVALID')
  }
  if(!requestFile)fail('MIGRATION_CLI_ARGUMENT_INVALID')
  const summary=await runMigrationPreview({request:await readRequest(resolve(requestFile)),privateOutput})
  console.log(JSON.stringify(summary,null,2))
  if(summary.status!=='preview-ready')process.exitCode=2
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await main(process.argv.slice(2))}catch(e){
    const code=typeof e?.code==='string'&&/^MIGRATION_[A-Z_]{1,80}$/.test(e.code)?e.code:['ENOENT','EACCES','EPERM','EEXIST','ENOTDIR'].includes(e?.code)?'MIGRATION_IO_'+e.code:'MIGRATION_PREVIEW_FAILED'
    console.log(JSON.stringify({schemaVersion:1,kind:'migration-preview',status:'failed',code,consistentSnapshot:false,requiresStopProof:true,applySupported:false}))
    process.exitCode=1
  }
}
