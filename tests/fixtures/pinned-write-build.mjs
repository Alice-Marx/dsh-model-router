import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../remote-computer-agent/src/pinned-write.ts')
const outfile = resolve(here, '../../tmp/integration/step-pinned-write/build/pinned-write.mjs')

/**
 * Bundle the standalone pinned-write component; it is not part of the Agent
 * entry graph yet, so the product build does not emit it.
 */
export async function loadPinnedWrite() {
  mkdirSync(dirname(outfile), { recursive: true })
  await build({ absWorkingDir: resolve(here, '../..'), entryPoints: [source], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}
