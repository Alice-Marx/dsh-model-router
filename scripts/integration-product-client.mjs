import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { syncDsBot } from './sync-ds-bot.mjs'

const ROOT = resolve(import.meta.dirname, '..')
// One shipped client bundle: the unified product (DS surface + MR panel +
// product navigation) is the plugin client the package exports.
const DEFAULT_OUTPUT = join(ROOT, '.dsh-plugin', 'client.js')

/** One loader factory includes the whole DS surface and the existing MR panel. */
export async function bundleProductClient({root=ROOT}={}) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const result = await build({ absWorkingDir: root, entryPoints: ['apps/integration-client/index.jsx'], bundle: true,
    // Reused pinned dependency trees may be linked from another checkout.
    // Keep source labels relative to this project, without embedding that path.
    preserveSymlinks:true,
    format: 'cjs', platform: 'browser', target: 'es2022', minifySyntax: true, charset: 'utf8', write: false,
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/dsh-client-ui-primitives'],
    loader: { '.css': 'text', '.png': 'dataurl', '.webp': 'dataurl' }, metafile: true,
    define: { __ROUTER_CLIENT_VERSION__: JSON.stringify(pkg.version), __ROUTER_PACKAGE_NAME__: JSON.stringify(pkg.name) },
    plugins: [{ name: 'product-lf-css', setup(builder) { builder.onLoad({ filter: /\.css$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace(/\r\n/g, '\n'), loader: 'text' })) } }],
  })
  if (result.warnings.length) throw new Error(result.warnings.map(warning => warning.text).join('\n'))
  // The unified bundle must never pull GAL game code back into the router client.
  const galInputs = Object.keys(result.metafile.inputs).filter(path => /(?:gal-|Gal[A-Z]|aipicture|echo-portraits|echo-sprites)/.test(path))
  if (galInputs.length) throw new Error(`Product bundle contains GAL dependencies: ${galInputs.join(', ')}`)
  const code = [
    '// Generated from apps/integration-client. Includes Apache-2.0 DS Bot sources; see modules/bot-runtime/SOURCE.json and vendor/ds-bot/UPSTREAM_NOTICE.',
    'window.__ModuleLoader__.load({', `  id: ${JSON.stringify(pkg.name)},`, '  factory: (require) => {',
    '    var module = { exports: {} };', '    var exports = module.exports;', result.outputFiles[0].text.trimEnd(),
    '    return module.exports;', '  },', '});', '',
  ].join('\n')
  return { code, inputs: Object.keys(result.metafile.inputs), bytes: Buffer.byteLength(code) }
}

export async function generateProductClient({ output = DEFAULT_OUTPUT, check = false } = {}) {
  await syncDsBot({ check })
  const result = await bundleProductClient()
  if (check) {
    let current = ''
    try { current = await readFile(output, 'utf8') } catch { /* missing is stale */ }
    if (current.replace(/\r\n/g, '\n') !== result.code) throw new Error(`Product client is stale: ${output}`)
  } else {
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, result.code)
  }
  return { output, bytes: result.bytes, inputs: result.inputs.length, status: 'passed' }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--output')
  const result = await generateProductClient({ check: process.argv.includes('--check'), ...(index >= 0 ? { output: resolve(process.argv[index + 1]) } : {}) })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
