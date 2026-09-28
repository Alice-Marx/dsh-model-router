import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const ENTRY = join(ROOT, '.dsh-plugin', 'client', 'official-harness.jsx')
const OUTPUT = join(ROOT, '.dsh-plugin', 'client.js')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function wrapper(body) {
  return [
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(PACKAGE.name)},`,
    '  factory: (require) => {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    body.trimEnd(),
    '    return module.exports;',
    '  },',
    '});',
    '',
  ].join('\n')
}

export async function generate({ check = false } = {}) {
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    // The desktop loader consumes a single self-contained client.js file.
    // Selected Gal artwork is embedded so installed plugins have no source-path dependency.
    loader: { '.css': 'text', '.png': 'dataurl', '.webp': 'dataurl' },
    external: [
      'react', 'react/*', 'react-dom', 'react-dom/*',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    outfile: OUTPUT,
    write: false,
  })
  const output = result.outputFiles.find(file => file.path.endsWith('.js'))
  if (output === undefined) throw new Error('esbuild did not return a JavaScript bundle')
  const code = wrapper(output.text)
  if (!check) {
    writeFileSync(OUTPUT, code)
    return { ok: true, output: OUTPUT, bytes: Buffer.byteLength(code) }
  }
  let committed = ''
  try { committed = readFileSync(OUTPUT, 'utf8') } catch { return { ok: false, errors: ['client.js does not exist'] } }
  return committed === code ? { ok: true, output: OUTPUT, bytes: Buffer.byteLength(code) }
    : { ok: false, errors: ['client.js is not generated from official-harness.jsx'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await generate({ check: process.argv.includes('--check') })
  if (!result.ok) {
    for (const error of result.errors ?? []) console.error(`[build-client] ${error}`)
    process.exitCode = 1
  } else {
    console.log(process.argv.includes('--check') ? '[build-client] OK' : `[build-client] generated ${result.bytes} bytes`)
  }
}
