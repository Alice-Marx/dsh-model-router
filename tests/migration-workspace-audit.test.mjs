import test from 'node:test'
import assert from 'node:assert/strict'
import {auditMigrationWorkspaceRegistry as audit} from '../packages/orchestration/src/migration-workspace-audit.mjs'
function fixture(){
 const row=(path,sessionIds)=>({path,title:'PRIVATE-TITLE',sessionIds,createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:01:00Z'})
 return {document:{unit:{name:'workspace',version:2},global:{initialized:true,workspaceIds:['second','first'],defaultWorkspaceId:'deleted-default',archivedSessionIds:['s1'],pinnedSessionIds:['s3']},tables:{workspaces:{first:row('C:\\work\\one',['s1','s2']),second:row('C:\\work\\two',['s3'])}}},sessions:[{header:{id:'s1',cwd:'C:\\work\\one'}},{header:{id:'s2',cwd:'C:\\work\\one'}},{header:{id:'s3',cwd:'C:\\work\\two'}}],teamWorkspaceId:'first',platform:'win32',workspacePolicy:'preserve-in-place'}
}
const has=(r,code)=>r.diagnostics.some(d=>d.code===code)
test('workspace audit: pinned SDK schemas retain order, stable identities, titles, timestamps and deleted default',()=>{
 const input=fixture(),before=structuredClone(input),r=audit(input);assert.equal(r.status,'audited');assert.deepEqual(input,before);assert.deepEqual(r.state,input.document.global);assert.deepEqual(r.records[0].sessionIds,['s1','s2']);assert.equal(r.records[0].title,'PRIVATE-TITLE');assert.equal(r.membership.length,3);assert.equal(r.applySupported,false);assert.equal(r.requiresStopProof,true);assert.equal(r.pathProof,'saved-string-identity-only')
})
test('workspace audit: pending create/delete and uninitialized state require recovery without guessed repair',()=>{
 for(const operation of ['create','delete']){const f=fixture();f.document.global.pendingMutation={operation,workspaceId:'pending'};f.document.global.initialized=false;const r=audit(f);assert.equal(r.status,'needs-context');assert.ok(has(r,'WORKSPACE_PENDING_RECOVERY_REQUIRED'));assert.ok(has(r,'WORKSPACE_BOOTSTRAP_REQUIRED'));assert.equal(r.state.pendingMutation.operation,operation)}
 const f=fixture();f.teamWorkspaceId='deleted-team';assert.ok(has(audit(f),'WORKSPACE_TEAM_REFERENCE_MISSING'))
})
test('workspace audit: duplicate/missing order, orphan row, same path and cross-workspace ownership remain blocked',()=>{
 const mutations=[f=>f.document.global.workspaceIds.push('first'),f=>f.document.global.workspaceIds.push('missing'),f=>f.document.global.workspaceIds.pop(),f=>f.document.tables.workspaces.second.path='C:\\work\\one',f=>f.document.tables.workspaces.second.sessionIds.push('s1'),f=>f.document.tables.workspaces.first.sessionIds.push('s1')]
 for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(audit(f).status,'blocked')}
})
test('workspace audit: missing headers and cwd aliases need evidence without probing the original filesystem',()=>{
 const f=fixture();f.sessions[0].header.cwd='C:/work/one';f.sessions.pop();const r=audit(f);assert.equal(r.status,'needs-context');assert.ok(has(r,'WORKSPACE_PATH_CONTEXT_REQUIRED'));assert.ok(has(r,'WORKSPACE_REFERENCED_SESSION_MISSING'));assert.equal(r.membership[0].cwdMatchesSavedPath,false)
})
test('workspace audit: unknown versions, malformed units and schema-invalid rows do not fabricate an empty registry',()=>{
 for(const mutate of [f=>f.document.unit.version=3,f=>f.document.unit.name='foreign',f=>f.document.tables.workspaces=[],f=>f.document.tables.workspaces.first.sessionIds='bad',f=>f.document.global.workspaceIds=null]){const f=fixture();mutate(f);const r=audit(f);assert.equal(r.status,'blocked');assert.equal(r.applySupported,false)}
})
test('workspace audit: archive/pin conflicts and duplicates reject while absent historical IDs retain context',()=>{
 const f=fixture();f.document.global.pinnedSessionIds.push('s1','s3');const r=audit(f);assert.equal(r.status,'blocked');assert.ok(has(r,'WORKSPACE_ARCHIVE_PIN_INVALID'))
 const g=fixture();g.document.global.archivedSessionIds.push('deleted-history');assert.ok(has(audit(g),'WORKSPACE_REFERENCED_SESSION_MISSING'));assert.ok(audit(g).state.archivedSessionIds.includes('deleted-history'))
})
test('workspace audit: source platform is explicit, relative Windows paths reject, UNC and POSIX are portable data',()=>{
 const f=fixture();delete f.platform;assert.ok(has(audit(f),'WORKSPACE_PLATFORM_REQUIRED'))
 for(const path of ['C:relative','\\current-drive','relative']){const g=fixture();g.document.tables.workspaces.first.path=path;assert.ok(has(audit(g),'WORKSPACE_PATH_INVALID'))}
 for(const [platform,path] of [['win32','\\\\server\\share\\work'],['linux','/missing/private/work'],['darwin','/missing/private/work']]){const g=fixture();g.platform=platform;g.document.tables.workspaces={first:{...g.document.tables.workspaces.first,path,sessionIds:['s1']}};g.document.global={initialized:true,workspaceIds:['first'],archivedSessionIds:[],pinnedSessionIds:[]};g.sessions=[{header:{id:'s1',cwd:path}}];assert.equal(audit(g).status,'audited')}
})
test('workspace audit: raw unknown fields and tables survive as digests rather than disappearing in schema projection',()=>{
 const f=fixture(),baseline=audit(f);f.document.tables.workspaces.first.extension={private:'PRIVATE'};f.document.global.extra='PRIVATE';f.document.tables.unknown={retained:'PRIVATE'};const r=audit(f);assert.equal(r.status,'audited');assert.ok(has(r,'WORKSPACE_EXTENSION_DATA_PRESERVED'));assert.notEqual(r.rawDigest,baseline.rawDigest);assert.notEqual(r.fingerprint,baseline.fingerprint)
})
test('workspace audit: bounded private input refuses getters, cycles and deep opaque trees without executing them',()=>{
 const f=fixture();let calls=0;Object.defineProperty(f.document,'extra',{enumerable:true,get(){calls++;throw Error('MUST NOT RUN')}});assert.throws(()=>audit(f),{code:'MIGRATION_WORKSPACE_INPUT_INVALID'});assert.equal(calls,0)
 const g=fixture();g.document.extra=g.document;assert.throws(()=>audit(g),{code:'MIGRATION_WORKSPACE_INPUT_INVALID'})
 const h=fixture();let deep={};for(let i=0;i<70;i++)deep={child:deep};h.document.extra=deep;assert.throws(()=>audit(h),{code:'MIGRATION_WORKSPACE_INPUT_LIMIT'})
})
test('workspace audit: invalid or duplicated Session identities and missing location policy are explicit',()=>{
 const f=fixture();f.sessions.push({header:{id:'s1'}});f.document.tables.workspaces.first.sessionIds.push('');assert.ok(has(audit(f),'WORKSPACE_SESSION_IDENTITY_INVALID'))
 const g=fixture();delete g.workspacePolicy;assert.ok(has(audit(g),'WORKSPACE_LOCATION_POLICY_REQUIRED'))
})
