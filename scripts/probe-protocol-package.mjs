import {cp,mkdir,mkdtemp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
const parent=resolve('tmp/integration/protocol-package');await mkdir(parent,{recursive:true})
const root=await mkdtemp(join(parent,'probe-')),target=join(root,'node_modules/fixture-protocol')
await cp('modules/openmaus-protocol',target,{recursive:true})
const script=`import(${JSON.stringify(pathToFileURL(join(target,'index.mjs')).href)}).then(p=>console.log(p.PROTOCOL_NAME)).catch(error=>{console.log(error.code??error.message);process.exitCode=1})`
const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true})
console.log(JSON.stringify({exitCode:result.status,output:result.stdout.trim()}))
