import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('.', import.meta.url))
const options={absWorkingDir:root,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',sourcemap:true}
await build({...options,entryPoints:['src/index.ts','src/cli.ts'],outdir:'dist',outExtension:{'.js':'.mjs'}})
await mkdir(`${root}dist`,{recursive:true})
await build({...options,entryPoints:['../packages/capability-broker/src/cli-stdio-bridge.mjs'],outfile:'dist/cli-stdio-bridge.mjs'})
for(const helper of ['native-peer.ps1','native-peer.py'])await copyFile(`${root}../packages/cli-runtime/src/${helper}`,`${root}dist/${helper}`)
