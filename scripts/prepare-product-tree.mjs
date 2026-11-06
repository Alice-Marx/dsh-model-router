import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import * as esbuild from 'esbuild'

// Produce a reviewable source tree; committing and uploading remain separate steps.
const root = resolve(import.meta.dirname, '..')
const output = process.argv[2] && resolve(process.argv[2])
assert.ok(output && output !== root, 'Provide a new output directory')
assert.ok(!existsSync(output), 'Refusing to overwrite an existing directory')
const portable = value => value.replaceAll('\\', '/')
const tracked = [...new Set(execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}).split('\0').filter(Boolean))]
const top = new Set(['.gitignore', '.gitattributes', 'AGENTS.md', 'LICENSE', 'README.md', 'README.zh.md',
  'README.i18n.yaml', 'package.json', 'package-lock.json', 'cordis.patch.yml'])
const prefixes = ['.dsh-plugin/', 'apps/integration-client/', 'apps/desktop-client/', 'packages/',
  'modules/bot-runtime/', 'native/', 'remote-computer-agent/', 'deploy/']
const scripts = ['build-client.mjs', 'build-router-package.mjs', 'sync-ds-bot.mjs', 'prepack.mjs', 'check-readme.mjs',
  'check-package.mjs', 'check-router-package.mjs', 'verify-release.mjs', 'integration-product-source.mjs', 'run-tests.mjs',
  'test-plan.json', 'package-remote-agent.ps1', 'prepare-product-tree.mjs', 'prepare-product-tests.mjs'].map(name => `scripts/${name}`)
const scriptGraph = await esbuild.build({
  absWorkingDir: root, entryPoints: scripts.filter(file => file.endsWith('.mjs')),
  bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
  metafile: true, outdir: 'tmp/integration/product-build-closure', logLevel: 'silent',
})
const buildDependencies = new Set(Object.keys(scriptGraph.metafile.inputs).map(portable))
const originalPlan = JSON.parse(readFileSync(resolve(root, 'scripts/test-plan.json'), 'utf8'))
const focused = originalPlan.stages.at(-1).filter(arg => arg !== 'tests/upstream-parity.test.mjs')
const plan = { schemaVersion: 1, stages: [['scripts/check-readme.mjs'],
  ['--test', 'tests/readme-math.test.mjs', 'tests/desktop-compat.test.mjs'], focused] }
const tests = new Set(plan.stages.flat().filter(arg => arg.startsWith('tests/')))
// Keep only helpers imported by the focused tests, plus their native fixture source.
for (const file of tests) {
  const text = readFileSync(resolve(root, file), 'utf8')
  for (const match of text.matchAll(/(?:from\s*|import\s*\()?['"](\.[^'"]+)['"]/g)) {
    const dependency = portable(relative(root, resolve(root, dirname(file), match[1])))
    if (dependency.startsWith('tests/') && existsSync(resolve(root, dependency))) tests.add(dependency)
  }
}
for (const file of tracked.filter(file => file.startsWith('tests/fixtures/desktop-lease/'))) tests.add(file)
const files = tracked.filter(file => top.has(file) || scripts.includes(file) || buildDependencies.has(file) || tests.has(file)
  || prefixes.some(prefix => file.startsWith(prefix)))
assert.ok(files.every(file => !isAbsolute(file) && !file.split('/').includes('..')))
assert.ok(!files.some(file => /^(?:docs|output|tmp|node_modules)\//.test(file)))
mkdirSync(output, { recursive: true })
for (const file of files) {
  const target = resolve(output, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, readFileSync(resolve(root, file)))
}
const pkg = JSON.parse(readFileSync(resolve(output, 'package.json'), 'utf8'))
const included = new Set(files)
pkg.files = pkg.files.filter(file => !file.startsWith('docs/') && file !== 'CHANGELOG.md')
  .filter(file => included.has(file) || files.some(path => path.startsWith(file.endsWith('/') ? file : `${file}/`))
    || file === 'remote-computer-agent/dist/')
pkg.scripts = {
  'build:client': 'node scripts/build-client.mjs',
  'build:router-package': 'node scripts/build-router-package.mjs',
  'check:client': 'node scripts/build-client.mjs --check',
  'build:agent': 'node remote-computer-agent/build.mjs',
  'check:source': 'node scripts/integration-product-source.mjs',
  pretest: 'node scripts/prepare-product-tests.mjs',
  test: 'node scripts/run-tests.mjs',
  prepack: 'node remote-computer-agent/build.mjs && node scripts/prepack.mjs',
}
writeFileSync(resolve(output, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
writeFileSync(resolve(output, 'scripts/test-plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
const archive = 'https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/'
for (const file of ['README.md', 'README.zh.md']) {
  let text = readFileSync(resolve(output, file), 'utf8')
  text = text.replace(/\]\((?:\.\/)?(docs\/[^)]+|CHANGELOG\.md(?:#[^)]*)?)\)/g,
    (_, target) => `](${archive}${target})`)
  const note = file === 'README.md'
    ? 'This GitHub tree contains the current program, build tools and focused product tests. The complete test suite, history and validation reports are in the [GitLab archive](https://gitlab.com/Alice_marx/dsh-model-router).'
    : 'GitHub 保留当前程序、构建工具和针对产品的测试；完整测试、历史文档和验收报告位于 [GitLab 全量归档](https://gitlab.com/Alice_marx/dsh-model-router)。'
  text = text.replace('<a id="development"></a>', `${note}\n\n<a id="development"></a>`)
  writeFileSync(resolve(output, file), text)
}
let pairing = readFileSync(resolve(output, 'README.i18n.yaml'), 'utf8')
for (const file of ['README.md', 'README.zh.md']) {
  const bytes = readFileSync(resolve(output, file))
  const hash = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
  pairing = pairing.replace(new RegExp(`^${file.replaceAll('.', '\\.')}: .+$`, 'm'), `${file}: ${hash}`)
}
writeFileSync(resolve(output, 'README.i18n.yaml'), pairing)
console.log(JSON.stringify({ output, version: pkg.version, files: files.length, focusedTestFiles: tests.size }))
