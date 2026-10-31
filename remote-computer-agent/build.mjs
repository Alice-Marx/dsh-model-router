import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
await build({absWorkingDir:fileURLToPath(new URL('.', import.meta.url)),entryPoints:['src/index.ts','src/cli.ts'],outdir:'dist',outExtension:{'.js':'.mjs'},bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',sourcemap:true})
