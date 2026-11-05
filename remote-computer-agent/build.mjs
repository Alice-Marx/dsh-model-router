import { build } from 'esbuild'
import { copyFile, mkdir, lstat, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative } from 'node:path'
import assert from 'node:assert/strict'
const root=fileURLToPath(new URL('.', import.meta.url))
const output=resolve(root,'dist')
assert.equal(relative(resolve(root),output),'dist','Build output must remain in the Agent dist directory')
const previous=await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error})
assert.ok(!previous?.isSymbolicLink(),'Refusing to replace a linked build output')
await rm(output,{recursive:true,force:true})
const options={absWorkingDir:root,bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',sourcemap:true}
await build({...options,entryPoints:['src/index.ts','src/cli.ts'],outbase:'src',outdir:'dist',outExtension:{'.js':'.mjs'}})
await mkdir(`${root}dist`,{recursive:true})
await build({...options,entryPoints:['../packages/capability-broker/src/cli-stdio-bridge.mjs'],outfile:'dist/cli-stdio-bridge.mjs'})
for(const helper of ['native-peer.ps1','native-peer.py'])await copyFile(`${root}../packages/cli-runtime/src/${helper}`,`${root}dist/${helper}`)
