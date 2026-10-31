import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,symlink} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {bundleProductClient} from '../scripts/integration-product-client.mjs'

test('product client build: an external linked dependency tree produces the same bytes and portable source labels as a local tree',async()=>{
  const parent=resolve('tmp/integration/product-client-layout');await mkdir(parent,{recursive:true})
  const dir=await mkdtemp(join(parent,'case-')),local=join(dir,'local'),linked=join(dir,'linked'),external=join(dir,'external-pinned-tree')
  const manifest={name:'fixture-product',version:'1.0.0'}
  for(const root of [local,linked]){
    await mkdir(join(root,'apps/integration-client'),{recursive:true});await mkdir(join(root,'node_modules/@dsh-fixture'),{recursive:true})
    await writeFile(join(root,'package.json'),JSON.stringify(manifest))
    await writeFile(join(root,'apps/integration-client/index.jsx'),"export { value } from '@dsh-fixture/dependency'\n")
  }
  for(const directory of [join(local,'node_modules/@dsh-fixture/dependency'),external]){
    await mkdir(directory,{recursive:true});await writeFile(join(directory,'package.json'),JSON.stringify({name:'@dsh-fixture/dependency',version:'1.0.0',type:'module',exports:'./index.js'}))
    await writeFile(join(directory,'index.js'),'export const value=42\n')
  }
  await symlink(external,join(linked,'node_modules/@dsh-fixture/dependency'),process.platform==='win32'?'junction':'dir')
  const normal=await bundleProductClient({root:local}),reuse=await bundleProductClient({root:linked})
  assert.equal(reuse.code,normal.code);assert.deepEqual(reuse.inputs,normal.inputs)
  assert.ok(reuse.inputs.every(path=>!path.startsWith('../')))
  assert.ok(!reuse.code.includes('external-pinned-tree'))
})
