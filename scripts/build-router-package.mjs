import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import { build } from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const portable = path => path.replaceAll('\\', '/')
const forbidden = path => /^(?:modules\/(?:bot-runtime|independent-runtime)|apps\/(?:integration-client|desktop-client)|remote-computer-agent)\//.test(portable(path))
const packageName = name => name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]

export async function bundleRouterClient({ root = ROOT } = {}) {
  const pkg = JSON.parse(await readFile(join(root, 'packages/model-router-plugin/package.json'), 'utf8'))
  const result = await build({ absWorkingDir: root, entryPoints: ['.dsh-plugin/client/official-harness.jsx'],
    bundle: true, preserveSymlinks: true, platform: 'browser', format: 'cjs', target: 'es2022',
    minifySyntax: true, charset: 'utf8', write: false, metafile: true, logLevel: 'silent',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/dsh-client-ui-primitives'],
    loader: { '.css': 'text' }, define: { __ROUTER_CLIENT_VERSION__: JSON.stringify(pkg.version), __ROUTER_PACKAGE_NAME__: JSON.stringify(pkg.name) },
    plugins: [{ name: 'router-lf-css', setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace(/\r\n/g, '\n'), loader: 'text' }))
    } }],
  })
  const inputs = Object.keys(result.metafile.inputs)
  if (inputs.some(forbidden)) throw new Error('Router client imports Bot product source')
  if (result.warnings.length) throw new Error(result.warnings.map(item => item.text).join('\n'))
  const code = ['// Generated router-only client. No DS Bot UI is included.',
    'window.__ModuleLoader__.load({', `  id: ${JSON.stringify(pkg.name)},`, '  factory: (require) => {',
    '    var module = { exports: {} };', '    var exports = module.exports;', result.outputFiles[0].text.trimEnd(),
    '    return module.exports;', '  },', '});', ''].join('\n')
  return { code, inputs }
}

export async function buildRouterPackage({ root = ROOT, output = join(ROOT, 'dist/packages/router') } = {}) {
  output = resolve(output)
  if (output === root || !output.startsWith(root + '\\') && !output.startsWith(root + '/')) throw new Error('Output must be an isolated project staging directory')
  if (existsSync(output)) throw new Error(`Refusing to overwrite a staged package: ${output}`)
  const base = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(root, 'packages/model-router-plugin/package.json'), 'utf8'))
  if (base.version !== manifest.version) throw new Error('Package versions differ')
  const graph = await build({ absWorkingDir: root, entryPoints: ['.dsh-plugin/router-only.mjs'], bundle: true,
    platform: 'node', format: 'esm', packages: 'external', write: false, metafile: true, logLevel: 'silent' })
  const files = new Set(Object.keys(graph.metafile.inputs).map(portable))
  const externals = new Set(Object.values(graph.metafile.inputs).flatMap(input => input.imports)
    .filter(item => item.external && !isBuiltin(item.path)).map(item => packageName(item.path)))
  // cli-terminal loads this optional PTY backend through createRequire.
  if (files.has('.dsh-plugin/shared/cli-terminal.mjs')) externals.add('@lydell/node-pty')
  if ([...files].some(forbidden)) throw new Error('Router Host imports Bot product source')
  // These helpers are launched by file path rather than imported by JavaScript.
  if(files.has('.dsh-plugin/shared/official-runtime-state.mjs'))files.add('.dsh-plugin/shared/official-runtime-bootstrap.mjs')
  if ([...files].some(path => path.startsWith('packages/cli-runtime/src/'))) {
    for (const file of ['native-peer.ps1', 'native-peer.py', 'native-terminal-peer.ps1']) files.add(`packages/cli-runtime/src/${file}`)
  }
  for (const file of files) {
    if (isAbsolute(file) || file.split('/').includes('..')) throw new Error(`Source outside the project: ${file}`)
    const target = join(output, file)
    await mkdir(dirname(target), { recursive: true }); await copyFile(join(root, file), target)
  }
  manifest.dependencies = Object.fromEntries(Object.entries(base.dependencies ?? {}).filter(([name]) => externals.has(name)))
  manifest.optionalDependencies = Object.fromEntries(Object.entries(base.optionalDependencies ?? {}).filter(([name]) => externals.has(name)))
  manifest.peerDependencies = Object.fromEntries(Object.entries(manifest.peerDependencies).filter(([name]) => externals.has(name)))
  for (const name of externals) {
    if (!manifest.dependencies[name] && !manifest.optionalDependencies[name] && !manifest.peerDependencies[name]) throw new Error(`Undeclared router dependency: ${name}`)
  }
  const client = await bundleRouterClient({ root })
  const included = new Set([...files, '.dsh-plugin/client.js', 'README.md', 'README.zh.md', 'LICENSE', 'cordis.patch.yml'])
  manifest.files = manifest.files.filter(file => included.has(file) || [...included].some(path => path.startsWith(file.endsWith('/') ? file : `${file}/`)))
  await writeFile(join(output, '.dsh-plugin/client.js'), client.code)
  for (const file of ['README.md', 'README.zh.md', 'cordis.patch.yml']) await copyFile(join(root, 'packages/model-router-plugin', file), join(output, file))
  await copyFile(join(root, 'LICENSE'), join(output, 'LICENSE'))
  await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { output, name: manifest.name, version: manifest.version, hostFiles: files.size,
    clientInputs: client.inputs, hostInputs: [...files], dependencies: [...externals].sort() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--output')
  const report = await buildRouterPackage(at >= 0 ? { output: resolve(process.argv[at + 1]) } : {})
  const reportAt = process.argv.indexOf('--report')
  if (reportAt >= 0) await writeFile(resolve(process.argv[reportAt + 1]), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, hostInputs: report.hostInputs.length, clientInputs: report.clientInputs.length }))
}
