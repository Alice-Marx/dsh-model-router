import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../remote-computer-agent/src/workspace-admission.ts')
const outfile = resolve(here, '../../tmp/integration/step-workspace-admission/build/workspace-admission.mjs')

/** Bundle the standalone admissions module; it is not part of the Agent entry graph. */
export async function loadWorkspaceAdmissions() {
  mkdirSync(dirname(outfile), { recursive: true })
  await build({ absWorkingDir: resolve(here, '../..'), entryPoints: [source], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external', logLevel: 'silent' })
  return import(pathToFileURL(outfile).href)
}
