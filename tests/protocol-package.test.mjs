import test from 'node:test'
import assert from 'node:assert/strict'
import {cp,mkdir,mkdtemp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {buildOpenmausProtocol} from '../scripts/build-openmaus-protocol.mjs'

test('frozen protocol builds reproducibly and the production entry loads inside an installed node_modules package',async()=>{
  await buildOpenmausProtocol({check:true})
  const parent=resolve('tmp/integration/protocol-package');await mkdir(parent,{recursive:true})
  const root=await mkdtemp(join(parent,'installed-')),target=join(root,'node_modules/fixture-protocol')
  await cp('modules/openmaus-protocol',target,{recursive:true})
  const script=`const p=await import(${JSON.stringify(pathToFileURL(join(target,'index.mjs')).href)});const key=p.generateKeyPair();if(!p.isPublicKey(key.publicKey))throw new Error('invalid point');console.log(JSON.stringify({protocol:p.PROTOCOL_NAME,bytes:key.publicKey.length}))`
  const output=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true})
  assert.deepEqual(JSON.parse(output),{protocol:'Noise_NKpsk0_P256_AESGCM_SHA256',bytes:65})
})
