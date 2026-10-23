import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const portable = path => path.replaceAll('\\', '/')
const exportTargets = value => typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(exportTargets) : []

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
  const graph = await esbuild.build({
    absWorkingDir: sourceRoot,
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    metafile: true,
    logLevel: 'silent',
    outdir: join(sourceRoot, 'dist', 'runtime-closure'),
  })
  const runtimeFiles = Object.keys(graph.metafile.inputs).map(path => portable(relative(sourceRoot, resolve(sourceRoot, path)))).sort()
  for (const path of runtimeFiles) {
    assert.ok(path !== '..' && !path.startsWith('../') && !isAbsolute(path), `Runtime import is outside the package: ${path}`)
    assert.ok(packed.has(path), `Package is missing runtime dependency: ${path}`)
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
