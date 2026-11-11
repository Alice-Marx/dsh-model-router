import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {syncOpenmausProtocol} from './sync-openmaus-protocol.mjs'
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'modules/openmaus-protocol/dist/protocol.mjs')

/** Installed packages cannot rely on Node stripping TypeScript under node_modules. */
export async function buildOpenmausProtocol({check=false}={}){
  await syncOpenmausProtocol({check:true})
  const result=await build({absWorkingDir:root,entryPoints:['scripts/openmaus-protocol-entry.mjs'],bundle:true,write:false,
    platform:'node',format:'esm',target:'node22',charset:'utf8',preserveSymlinks:true})
  if(result.warnings.length)throw new Error(result.warnings.map(warning=>warning.text).join('\n'))
  const code='// Generated from frozen OpenMausBot protocol sources; Apache-2.0; see ../SOURCE.json, ../NOTICE and ../vendor/LICENSE.\n'+result.outputFiles[0].text
  if(check){
    const current=await readFile(output,'utf8').catch(()=>null)
    if(current?.replaceAll('\r\n','\n')!==code)throw new Error('OPENMAUS_PROTOCOL_BUILD_STALE')
  }else{await mkdir(dirname(output),{recursive:true});await writeFile(output,code)}
  return {status:'passed',output,bytes:Buffer.byteLength(code)}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildOpenmausProtocol({check:process.argv.includes('--check')})))
