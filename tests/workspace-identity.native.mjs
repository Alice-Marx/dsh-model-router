import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,rename,symlink,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
await import('../remote-computer-agent/build.mjs')
const {WorkspacePin}=await import('../remote-computer-agent/dist/index.mjs')
async function fixture(t){const root=resolve('tmp/integration/workspace-identity');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'case-')),workspace=join(dir,'workspace');await mkdir(workspace);const pin=await WorkspacePin.capture(workspace);t.after(()=>pin.close());return {dir,workspace,pin}}
test('workspace identity: native snapshot has stable generation and bounded physical ancestry',async t=>{
 const {workspace,pin}=await fixture(t);assert.match(pin.identity.key,/^[a-f0-9]{64}$/);assert.equal(pin.identity.ancestors[0],pin.identity.key);assert.ok(pin.identity.ancestors.length>1&&pin.identity.ancestors.length<=128);assert.ok(Object.isFrozen(pin.identity));assert.ok(Object.isFrozen(pin.identity.ancestors));await writeFile(join(workspace,'new-file'),'changed directory metadata');await pin.verify();assert.ok(BigInt(JSON.parse(pin.mountIdentity).birth)>0n)
})
test('workspace identity: junction/symlink alias resolves to the same physical root',async t=>{
 const {dir,workspace,pin}=await fixture(t),alias=join(dir,'alias');await symlink(workspace,alias,process.platform==='win32'?'junction':'dir');const other=await WorkspacePin.capture(alias);try{assert.deepEqual(other.identity,pin.identity);assert.equal(other.mountIdentity,pin.mountIdentity)}finally{await other.close()}
})
test('workspace identity: parent/child keys overlap but independent roots only share ancestors',async t=>{
 const {dir,workspace,pin}=await fixture(t),child=join(workspace,'child'),separate=join(dir,'separate');await mkdir(child);await mkdir(separate);const a=await WorkspacePin.capture(child),b=await WorkspacePin.capture(separate);try{assert.ok(a.identity.ancestors.includes(pin.identity.key));assert.ok(!b.identity.ancestors.includes(pin.identity.key));assert.ok(!pin.identity.ancestors.includes(b.identity.key));assert.ok(a.identity.ancestors.some(k=>b.identity.ancestors.includes(k)))}finally{await a.close();await b.close()}
})
test('workspace identity: a renamed/replaced root invalidates the saved admission snapshot',async t=>{
 const {dir,workspace,pin}=await fixture(t);await rename(workspace,join(dir,'moved'));await mkdir(workspace);await assert.rejects(pin.verify(),/WORKSPACE_CHANGED/)
})
test('workspace identity: closing is idempotent and disables later verification',async t=>{
 const {pin}=await fixture(t);await pin.close();await pin.close();await assert.rejects(pin.verify(),/WORKSPACE_PIN_CLOSED/);assert.throws(()=>pin.scanPath,/WORKSPACE_PIN_CLOSED/)
})
test('workspace identity: files and relative/NUL paths never become roots',async t=>{
 const {dir}=await fixture(t),file=join(dir,'file');await writeFile(file,'data');for(const target of [file,'relative','invalid\0'])await assert.rejects(WorkspacePin.capture(target))
})
test('workspace identity: Linux scan stays on the retained descriptor after a host path replacement',{skip:process.platform!=='linux'},async t=>{
 const {dir,workspace,pin}=await fixture(t);await writeFile(join(workspace,'marker'),'original');await rename(workspace,join(dir,'moved'));await mkdir(workspace);await writeFile(join(workspace,'marker'),'replacement');assert.equal(await readFile(pin.scanPath+'/marker','utf8'),'original');await assert.rejects(pin.verify(),/WORKSPACE_CHANGED/)
})
