import {createHash} from 'node:crypto'
import {posix,win32} from 'node:path'
import {workspaceDomainSpec} from '@deepseek-ai/dsh-workspace'

const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const id=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\0-\x1f\x7f]/.test(x)
const fail=code=>{throw Object.assign(new Error(code),{code})}
export const migrationWorkspaceDiagnosticCodes=Object.freeze(['WORKSPACE_PLATFORM_REQUIRED','WORKSPACE_LOCATION_POLICY_REQUIRED','WORKSPACE_FORMAT_INVALID','WORKSPACE_VERSION_UNSUPPORTED','WORKSPACE_SCHEMA_INVALID','WORKSPACE_BOOTSTRAP_REQUIRED','WORKSPACE_PENDING_RECOVERY_REQUIRED','WORKSPACE_SESSION_IDENTITY_INVALID','WORKSPACE_IDENTITY_INVALID','WORKSPACE_PATH_INVALID','WORKSPACE_DUPLICATE_PATH','WORKSPACE_SESSION_MULTIPLE_OWNERS','WORKSPACE_REFERENCED_SESSION_MISSING','WORKSPACE_PATH_CONTEXT_REQUIRED','WORKSPACE_ORDER_INVALID','WORKSPACE_TEAM_REFERENCE_MISSING','WORKSPACE_ARCHIVE_PIN_INVALID','WORKSPACE_EXTENSION_DATA_PRESERVED'])
// No accessors, cyclic graphs or huge opaque trees may reach SDK schemas/hash.
function boundedJSON(input){
 const pending=[[input,0]],seen=new Set();let nodes=0,bytes=0
 while(pending.length){
  const [value,depth]=pending.pop();if(++nodes>500000||depth>64)fail('MIGRATION_WORKSPACE_INPUT_LIMIT')
  if(typeof value==='string'){bytes+=Buffer.byteLength(value);if(bytes>32*1024**2)fail('MIGRATION_WORKSPACE_INPUT_LIMIT');continue}
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))continue
  if(typeof value!=='object'||seen.has(value)||![null,Object.prototype,Array.prototype].includes(Object.getPrototypeOf(value)))fail('MIGRATION_WORKSPACE_INPUT_INVALID')
  seen.add(value)
  for(const key of Object.keys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))fail('MIGRATION_WORKSPACE_INPUT_INVALID');bytes+=Buffer.byteLength(key);pending.push([d.value,depth+1]);if(pending.length+nodes>500000||bytes>32*1024**2)fail('MIGRATION_WORKSPACE_INPUT_LIMIT')}
 }
}

/** Pure private audit of the explicitly selected fixed-SDK single JSON unit. */
export function auditMigrationWorkspaceRegistry({document,sessions=[],teamWorkspaceId,platform,workspacePolicy}={}){
 boundedJSON({document:document??null,sessions,...(teamWorkspaceId===undefined?{}:{teamWorkspaceId}),platform:platform??null,workspacePolicy:workspacePolicy??null})
 const diagnostics=[],add=(code,severity='error',detail={})=>{if(diagnostics.length>=256)fail('MIGRATION_WORKSPACE_DIAGNOSTIC_LIMIT');diagnostics.push({code,severity,...detail})}
 const result={schemaVersion:1,kind:'private-migration-workspace-audit',diagnostics,rawDigest:hash(document??null),state:null,records:[],membership:[],pathProof:'saved-string-identity-only',requiresCompleteDomainReview:true,requiresStopProof:true,applySupported:false}
 function finish(){result.status=diagnostics.some(d=>d.severity==='error')?'blocked':diagnostics.some(d=>d.severity==='needs-context')?'needs-context':'audited';result.fingerprint=hash({rawDigest:result.rawDigest,state:result.state,records:result.records,membership:result.membership});return result}
 if(!['win32','linux','darwin'].includes(platform)){add('WORKSPACE_PLATFORM_REQUIRED','needs-context');return finish()}
 if(workspacePolicy!=='preserve-in-place')add('WORKSPACE_LOCATION_POLICY_REQUIRED','needs-context')
 if(!record(document)||!record(document.unit)||document.unit.name!=='workspace'||!record(document.tables)||!record(document.tables.workspaces)){add('WORKSPACE_FORMAT_INVALID');return finish()}
 if(document.unit.version!==workspaceDomainSpec.version){add('WORKSPACE_VERSION_UNSUPPORTED');return finish()}
 let state
 try{state=workspaceDomainSpec.global.schema.parse(document.global??workspaceDomainSpec.global.initial)}catch{add('WORKSPACE_SCHEMA_INVALID');return finish()}
 result.state=state
 if(!state.initialized)add('WORKSPACE_BOOTSTRAP_REQUIRED','needs-context')
 if(state.pendingMutation!==undefined)add('WORKSPACE_PENDING_RECOVERY_REQUIRED','needs-context')
 const allowedGlobal=new Set(['initialized','defaultWorkspaceId','workspaceIds','archivedSessionIds','pinnedSessionIds','pendingMutation'])
 let extension=Object.keys(document).some(k=>!['unit','global','tables'].includes(k))||Object.keys(document.unit).some(k=>!['name','version'].includes(k))||Object.keys(document.tables).some(k=>k!=='workspaces')||Object.keys(document.global??{}).some(k=>!allowedGlobal.has(k))
 const rows=new Map(),paths=new Map(),accounted=new Map(),headers=new Map()
 for(const session of sessions){if(!record(session)||!record(session.header)||!id(session.header.id)||headers.has(session.header.id)){add('WORKSPACE_SESSION_IDENTITY_INVALID');continue}headers.set(session.header.id,session.header)}
 for(const [key,raw] of Object.entries(document.tables.workspaces)){
  if(!id(key)){add('WORKSPACE_IDENTITY_INVALID');continue}
  let value;try{value=workspaceDomainSpec.tables.workspaces.valueSchema.parse(raw)}catch{add('WORKSPACE_SCHEMA_INVALID','error',{workspaceId:key});continue}
  const absolute=platform==='win32'?win32.isAbsolute(value.path)&&!['\\','/'].includes(win32.parse(value.path).root):posix.isAbsolute(value.path)
  if(!absolute||value.path.includes('\0'))add('WORKSPACE_PATH_INVALID','error',{workspaceId:key})
  if(paths.has(value.path))add('WORKSPACE_DUPLICATE_PATH','error',{workspaceId:key,otherWorkspaceId:paths.get(value.path)})
  paths.set(value.path,key);rows.set(key,value);result.records.push({id:key,...value,rawDigest:hash(raw)})
  extension ||= Object.keys(raw).some(k=>!['path','title','sessionIds','createdAt','updatedAt'].includes(k))
  for(const sessionId of value.sessionIds){
   if(!id(sessionId)){add('WORKSPACE_SESSION_IDENTITY_INVALID');continue}
   if(accounted.has(sessionId))add('WORKSPACE_SESSION_MULTIPLE_OWNERS','error',{sessionId,workspaceId:key,otherWorkspaceId:accounted.get(sessionId)})
   accounted.set(sessionId,key);const header=headers.get(sessionId)
   if(!header)add('WORKSPACE_REFERENCED_SESSION_MISSING','needs-context',{sessionId,workspaceId:key})
   else if(header.cwd!==value.path)add('WORKSPACE_PATH_CONTEXT_REQUIRED','needs-context',{sessionId,workspaceId:key})
   result.membership.push({sessionId,workspaceId:key,cwdMatchesSavedPath:header?.cwd===value.path})
  }
 }
 const order=new Set()
 for(const key of state.workspaceIds){if(!id(key)||order.has(key))add('WORKSPACE_ORDER_INVALID');if(!rows.has(key))add('WORKSPACE_ORDER_INVALID','error',{workspaceId:key});order.add(key)}
 if(state.initialized&&[...rows.keys()].some(key=>!order.has(key)))add('WORKSPACE_ORDER_INVALID')
 // defaultWorkspaceId deliberately survives deletion in the SDK contract.
 if(teamWorkspaceId!==undefined&&(!id(teamWorkspaceId)||!rows.has(teamWorkspaceId)||!order.has(teamWorkspaceId)))add('WORKSPACE_TEAM_REFERENCE_MISSING','needs-context')
 const archived=new Set(),pinned=new Set()
 for(const [values,set] of [[state.archivedSessionIds,archived],[state.pinnedSessionIds,pinned]])for(const sessionId of values){if(!id(sessionId)||set.has(sessionId))add('WORKSPACE_ARCHIVE_PIN_INVALID');set.add(sessionId);if(!headers.has(sessionId))add('WORKSPACE_REFERENCED_SESSION_MISSING','needs-context',{sessionId})}
 if([...pinned].some(sessionId=>archived.has(sessionId)))add('WORKSPACE_ARCHIVE_PIN_INVALID')
 if(extension)add('WORKSPACE_EXTENSION_DATA_PRESERVED','warning')
 return finish()
}
