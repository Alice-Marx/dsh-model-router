import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateProductClient } from './integration-product-client.mjs'

const ROOT = resolve(import.meta.dirname, '..')
// One shipped client bundle: the unified product client (DS surface + MR panel +
// product navigation) built from apps/integration-client/index.jsx.
const OUTPUT = join(ROOT, '.dsh-plugin', 'client.js')

/**
 * Build or verify the single packaged client. The bundle logic (esbuild
 * options, LF-CSS normalization, GAL guard and the module-loader wrapper)
 * lives in integration-product-client.mjs so the build and the product probe
 * can never drift apart.
 */
export async function generate({ check = false } = {}) {
  const result = await generateProductClient({ check, output: OUTPUT })
  if (result.status !== 'passed') {
    return { ok: false, output: OUTPUT, errors: [check ? 'client.js is stale; run npm run build:client' : 'product client generation failed'] }
  }
  return { ok: true, output: result.output, bytes: result.bytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generate({ check: process.argv.includes('--check') })
  if (!result.ok) {
    for (const error of result.errors) console.error(`[build-client] ${error}`)
    process.exitCode = 1
  } else {
    console.log(process.argv.includes('--check') ? '[build-client] OK' : `[build-client] generated ${result.bytes} bytes`)
  }
}
