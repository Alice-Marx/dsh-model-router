import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,link,symlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
await mkdir(resolve('tmp/integration/private-roots'),{recursive:true})
const output=await mkdtemp(resolve('tmp/integration/private-roots/build-'))
await build({entryPoints:['remote-computer-agent/src/scope.ts','remote-computer-agent/src/agent.ts'],outdir:output,outExtension:{'.js':'.mjs'},bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'})
const {Roots}=await import(pathToFileURL(join(output,'scope.mjs')))
const {Agent}=await import(pathToFileURL(join(output,'agent.mjs')))
const require=createRequire(import.meta.url),Database=(await import(process.env.DSH_REMOTE_AGENT_DRIVER??pathToFileURL(require.resolve('better-sqlite3')).href)).default
const code=expected=>e=>e.code===expected
async function fixture(){
  const dir=await mkdtemp(resolve('tmp/integration/private-roots/case-')),data=join(dir,'control'),secret=join(dir,'keys','pipe.secret')
  await mkdir(data);await mkdir(join(dir,'keys'));await mkdir(join(dir,'public'))
  await writeFile(join(data,'agent.db'),'generated private database');await writeFile(secret,'generated pipe secret');await writeFile(join(dir,'public','hello'),'public data')
  return {dir,data,secret,roots:new Roots({project:dir},{protectedPaths:[data,secret]})}
}
test('private roots: parent authorization preserves public files and hides control files',async()=>{
  const f=await fixture()
  assert.equal((await f.roots.read('project','public/hello',0,100)).data.toString(),'public data')
  assert.deepEqual((await f.roots.list('project','')).map(e=>e.name).sort(),['keys','public'])
  assert.deepEqual((await f.roots.list('project','keys')).map(e=>e.name),[])
  for(const p of ['control','control/agent.db','keys/pipe.secret'])await assert.rejects(f.roots.resolve('project',p),code('WORKSPACE_PRIVATE_PATH'))
  await assert.rejects(f.roots.read('project','keys/pipe.secret',0,1),code('WORKSPACE_PRIVATE_PATH'))
})
test('private roots: creation reserves missing secrets and refuses replacing private ancestors',async()=>{
  const f=await fixture(),future=join(f.dir,'keys','future.secret'),roots=new Roots({project:f.dir},{protectedPaths:[future]})
  for(const p of ['keys/future.secret','keys',''])await assert.rejects(roots.resolve('project',p,true),code('WORKSPACE_PRIVATE_PATH'))
  assert.equal(await roots.resolve('project','keys/public.txt',true),join(f.dir,'keys','public.txt'))
  await writeFile(future,'new generated secret');await assert.rejects(roots.read('project','keys/future.secret',0,100),code('WORKSPACE_PRIVATE_PATH'))
})
test('private roots: hard links to rotating private files cannot disclose content',async()=>{
  const f=await fixture();await link(f.secret,join(f.dir,'public','alias'))
  await assert.rejects(f.roots.read('project','public/alias',0,100),code('WORKSPACE_PRIVATE_PATH'))
  await assert.rejects(f.roots.resolve('project','public/alias',true),code('WORKSPACE_PRIVATE_PATH'))
  assert.deepEqual((await f.roots.list('project','public')).map(e=>e.name),['hello'])
  await writeFile(join(f.data,'later.db'),'new database');await link(join(f.data,'later.db'),join(f.dir,'public','later'))
  await assert.rejects(f.roots.read('project','public/later',0,100),code('WORKSPACE_PRIVATE_PATH'))
})
test('private roots: ordinary hard links work, while bounded identity scans fail closed',async()=>{
  const f=await fixture();await link(join(f.dir,'public','hello'),join(f.dir,'public','ordinary'))
  assert.equal((await f.roots.read('project','public/ordinary',0,100)).data.toString(),'public data')
  const bounded=new Roots({project:f.dir},{protectedPaths:[f.data,f.secret],identityScanLimit:1})
  await assert.rejects(bounded.read('project','public/ordinary',0,100),code('PRIVATE_PATH_UNVERIFIED'))
  await writeFile(join(f.dir,'public','single'),'single')
  assert.equal((await bounded.read('project','public/single',0,100)).data.toString(),'single')
})
test('private roots: junction aliases and future secret real paths remain private',async()=>{
  const f=await fixture();await symlink(join(f.dir,'keys'),join(f.dir,'key-alias'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(f.roots.resolve('project','key-alias/pipe.secret'),code('WORKSPACE_OUTSIDE_SCOPE'))
  const roots=new Roots({keys:join(f.dir,'keys')},{protectedPaths:[join(f.dir,'key-alias','future.secret')]})
  await assert.rejects(roots.resolve('keys','future.secret',true),code('WORKSPACE_PRIVATE_PATH'))
  const aliases=await f.roots.list('project','');assert.ok(aliases.some(e=>e.name==='key-alias')) // public directory name alone is safe
})
test('private roots: inherited root IDs and Windows casing cannot bypass protection',async()=>{
  const f=await fixture(),roots=new Roots(Object.create({inherited:f.dir}),{protectedPaths:[f.data]})
  await assert.rejects(roots.resolve('inherited','public/hello'),code('WORKSPACE_OUTSIDE_SCOPE'))
  await assert.rejects(f.roots.resolve('constructor',''),code('WORKSPACE_OUTSIDE_SCOPE'))
  if(process.platform==='win32')await assert.rejects(f.roots.read('project','CONTROL/AGENT.DB',0,100),code('WORKSPACE_PRIVATE_PATH'))
})
test('private roots: Git tree access refuses an ancestor while public sibling trees work',async()=>{
  const f=await fixture();await assert.rejects(f.roots.assertPublicTree(f.dir),code('WORKSPACE_PRIVATE_PATH'))
  await f.roots.assertPublicTree(join(f.dir,'public'))
})
test('private roots: Agent always protects its real control store and desktop secret',async()=>{
  const dir=await mkdtemp(resolve('tmp/integration/private-roots/agent-')),secret=join(dir,'desktop.secret');await writeFile(secret,'generated fixture token')
  const agent=new Agent({dataDir:join(dir,'data'),roots:{project:dir},desktop:{pipeName:'not-started-fixture',secretFile:secret}},Database)
  try{
    const pair=agent.store.pair('host',{botIds:['bot'],roots:['project'],tools:['fs_list','fs_read','fs_write','worktree_create']})
    const c=agent.store.grant(agent.store.issue(agent.store.client(pair.token),{botId:'bot',taskId:'task',attemptId:'attempt',roots:['project'],tools:['fs_list','fs_read','fs_write','worktree_create']}).grantToken)
    assert.deepEqual((await agent.call('fs_list',{rootId:'project'},c)).entries,[])
    await assert.rejects(agent.call('fs_read',{rootId:'project',relativePath:'desktop.secret'},c),code('WORKSPACE_PRIVATE_PATH'))
    const write=await agent.call('fs_write',{rootId:'project',relativePath:'desktop.secret',content:'bad',expectedHash:null},c,'write-private');assert.equal(write.error.code,'WORKSPACE_PRIVATE_PATH');assert.equal(await readFile(secret,'utf8'),'generated fixture token')
    const tree=await agent.call('worktree_create',{rootId:'project',relativePath:'',worktreeRelativePath:'worktree'},c,'tree-private');assert.equal(tree.error.code,'WORKSPACE_PRIVATE_PATH')
  }finally{await agent.close()}
})
