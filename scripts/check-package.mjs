import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { isBuiltin } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const portable = path => path.replaceAll('\\', '/')
const exportTargets = value => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(exportTargets) : []
// These scripts are launched by path, so they are not import-graph edges.
const launchedDependencies = {
  'packages/capability-broker/src/cli-bootstrap.mjs': ['packages/capability-broker/src/cli-stdio-bridge.mjs'],
  'packages/cli-runtime/src/native-terminal.mjs': ['packages/cli-runtime/src/native-terminal-peer.ps1'],
}

/** Check membership without importing or executing any plugin or vendor code. */
export async function assertRuntimeClosure({ root = ROOT, files, manifest } = {}) {
  const sourceRoot = resolve(root)
  const pkg = manifest ?? JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  const packed = new Set(files)
  const required = new Set(['package.json', pkg.main, ...exportTargets(pkg.exports), pkg.dsh?.bundle?.patch,
    // This repository deliberately lists its release files individually. Keep
    // explicit documentation/assets covered as well as executable entry points.
    ...(pkg.files ?? []).filter(path => !/[*?\[\]{}!]/.test(path))].filter(Boolean).map(path => path.replace(/^\.\//, '')))
  for (const path of required) assert.ok(packed.has(path), `Package is missing declared file: ${path}`)

  const entries = [...new Set([pkg.main, ...exportTargets(pkg.exports)]
    .filter(path => typeof path === 'string' && /\.(?:mjs|cjs)$/.test(path)))]
  assert.ok(entries.length, 'Package has no Node runtime entry point')
  const runtime = new Set()
  let pending = entries
  while (pending.length) {
    const graph = await esbuild.build({
      absWorkingDir: sourceRoot,
      entryPoints: pending,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      write: false,
      metafile: true,
      logLevel: 'silent',
      outdir: join(sourceRoot, 'dist', 'runtime-closure'),
    })
    const discovered = Object.keys(graph.metafile.inputs).map(path => portable(relative(sourceRoot, resolve(sourceRoot, path))))
    for (const path of discovered) {
      assert.ok(path !== '..' && !path.startsWith('../') && !isAbsolute(path), `Runtime import is outside the package: ${path}`)
      assert.ok(packed.has(path), `Package is missing runtime dependency: ${path}`)
      runtime.add(path)
    }
    pending = []
    for (const path of discovered) {
      for (const dependency of launchedDependencies[path] ?? []) {
        assert.ok(packed.has(dependency), `Package is missing launched runtime dependency: ${dependency}`)
        if (/\.(?:mjs|cjs)$/.test(dependency) && !runtime.has(dependency) && !pending.includes(dependency)) pending.push(dependency)
      }
    }
    for (const input of Object.values(graph.metafile.inputs)) {
      for (const dependency of input.imports.filter(item => item.external && !isBuiltin(item.path))) {
        const name = dependency.path.startsWith('@') ? dependency.path.split('/').slice(0, 2).join('/') : dependency.path.split('/')[0]
        assert.ok(pkg.dependencies?.[name] || pkg.optionalDependencies?.[name] || pkg.peerDependencies?.[name],
          `Runtime external dependency is not declared for production: ${name} (${dependency.path})`)
      }
    }
  }
  const runtimeFiles = [...runtime].sort()
  // The native peer scripts are launched as child processes, not imported;
  // esbuild cannot discover them in the module graph.
  if (runtimeFiles.includes('packages/cli-runtime/src/native-process.mjs')) {
    for (const path of ['packages/cli-runtime/src/native-peer.ps1', 'packages/cli-runtime/src/native-peer.py']) {
      assert.ok(packed.has(path), `Package is missing native runtime dependency: ${path}`)
    }
  }
  return runtimeFiles
}

/** Compare the real npm archive with Git, then verify its local import closure. */
export async function checkPackage({ root = ROOT, tarball, revision = 'HEAD' } = {}) {
  const sourceRoot = resolve(root)
  const pkg = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  const archive = tarball ? resolve(tarball)
    : join(sourceRoot, 'dist', `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`)
  // verify-release reads raw Git blobs, so CRLF changes or a stale generated
  // client fail rather than being hidden by text normalization or git diff.
  const report = JSON.parse(execFileSync(process.execPath, [join(sourceRoot, 'scripts', 'verify-release.mjs'), archive, revision], {
    cwd: sourceRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }))
  assert.equal(report.package, pkg.name, 'Packed package name differs from the checkout')
  assert.equal(report.version, pkg.version, 'Packed package version differs from the checkout')
  const runtimeFiles = await assertRuntimeClosure({ root: sourceRoot, manifest: pkg, files: report.files.map(file => file.path) })
  const result = { ...report, runtimeFilesVerified: runtimeFiles.length, runtimeFiles }
  await writeFile(join(dirname(archive), 'package-verification.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await checkPackage({ tarball: process.argv[2], revision: process.argv[3] || 'HEAD' })
  console.log(`[check-package] ${report.package}@${report.version}: ${report.filesVerified} files match ${report.revision}; ${report.runtimeFilesVerified} runtime files are included.`)
  console.log(`[check-package] ${report.integrity}`)
}
