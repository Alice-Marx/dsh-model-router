import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { checkUpstreamParity } from '../scripts/check-upstream-parity.mjs'
import { applyPatchText, formatPatch, pinSource, readOverlay, syncDsBot } from '../scripts/sync-ds-bot.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const RUNTIME = join(ROOT, 'modules/bot-runtime')
const VENDOR = join(RUNTIME, 'vendor/ds-bot')
const OVERLAY = join(RUNTIME, 'product-overlay')
// The upstream checkout this runtime was synced from. A packaged repository has no sibling
// checkout, so the tests that need one stand down there and say why.
const UPSTREAM = process.env.DS_BOT_UPSTREAM ? resolve(process.env.DS_BOT_UPSTREAM) : resolve(ROOT, '../DS-Bot-upstream')
const PINNED_COMMIT = '71d344bf193f3f18185f25de3d8e5c483046910a'
const hasUpstream = () => existsSync(join(UPSTREAM, 'ds-bot', 'package.json'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const contentLines = text => text.split('\n').map(line => line.replace(/\r$/, ''))
const sameLines = (a, b) => {
  const left = contentLines(a), right = contentLines(b)
  return left.length === right.length && left.every((line, index) => line === right[index])
}

async function walk(root, base = root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path, base))
    else if (entry.isFile()) result.push(`vendor/ds-bot/${relative(base, path).replaceAll('\\', '/')}`)
  }
  return result.sort()
}

test('upstream parity: the vendored runtime is the pinned DS Bot 0.2.7 and every byte is recorded', async () => {
  const manifest = JSON.parse(await readFile(join(RUNTIME, 'SOURCE.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.repository, 'https://github.com/Fei2411/DS-Bot')
  assert.equal(manifest.commit, PINNED_COMMIT)
  assert.deepEqual(manifest.runtime, { name: 'ds-bot', version: '0.2.7' })
  assert.equal(JSON.parse(await readFile(join(VENDOR, 'package.json'), 'utf8')).version, '0.2.7')
  const origins = manifest.files.reduce((counts, file) => ({ ...counts, [file.origin]: (counts[file.origin] ?? 0) + 1 }), {})
  assert.ok(origins.upstream > 300, `expected the vendored tree to be mostly upstream bytes: ${JSON.stringify(origins)}`)
  assert.equal(origins.notice, 2, 'UPSTREAM_LICENSE and UPSTREAM_NOTICE are recorded as notices')
  assert.equal(origins.generated, 1, 'client.js is recorded as a build of the patched sources')
  assert.equal(origins.overlay, manifest.overlays.length)
  // Every recorded file is the vendored bytes, and nothing vendored is unrecorded.
  for (const file of manifest.files) {
    assert.equal(digest(await readFile(join(RUNTIME, file.path))), file.sha256, `${file.path} differs from its recorded digest`)
    assert.equal(file.path.startsWith('vendor/ds-bot/'), true, file.path)
    assert.match(file.sourcePath, /^(ds-bot\/|LICENSE$|NOTICE$)/, file.sourcePath)
  }
  const recorded = manifest.files.map(file => file.path).sort()
  assert.deepEqual(await walk(VENDOR), recorded)
})

test('upstream parity: the matrix proves every declared upstream feature, and the two features that are not upstream', async () => {
  const report = await checkUpstreamParity()
  assert.equal(report.status, 'passed', report.problems.join('; '))
  assert.ok(report.features.length >= 25, 'the matrix must name the upstream feature set')
  for (const row of report.features) {
    assert.equal(row.status, 'present', `${row.id} is missing from ${row.evidence.join(', ')}`)
    assert.ok(row.found.length > 0, `${row.id} has no file carrying ${row.marker}`)
  }
  // Neither a remote computer nor a document knowledge library is upstream DS Bot code.
  assert.deepEqual(report.notUpstream.map(row => row.id), ['remote-computer', 'document-library'])
  for (const row of report.notUpstream) {
    assert.equal(row.status, 'absent-upstream', `${row.id} was found in ${Object.keys(row.hits).join(', ')}`)
    assert.deepEqual(row.hits, {})
    assert.ok(row.product.every(path => existsSync(join(ROOT, path))), `${row.id}: the product must implement it somewhere`)
  }
  for (const row of report.adaptations) {
    assert.equal(row.status, 'present', `product adaptation lost: ${row.id}`)
    assert.ok(existsSync(join(VENDOR, row.path)), row.path)
  }
})

test('upstream parity: every product overlay patch reproduces the vendored file from its recorded base', async () => {
  const overlay = await readOverlay()
  for (const entry of overlay.entries) {
    if (entry.kind === 'product-file') {
      assert.ok(sameLines(await readFile(join(OVERLAY, 'files', entry.path), 'utf8'), await readFile(join(VENDOR, entry.path), 'utf8')), entry.path)
      continue
    }
    const base = await readFile(join(OVERLAY, 'base', entry.path), 'utf8')
    const patch = await readFile(join(OVERLAY, 'patches', `${entry.path}.patch`), 'utf8')
    const applied = applyPatchText(base, patch)
    assert.ok(applied.ok, `${entry.path} does not apply to its recorded base`)
    assert.ok(sameLines(applied.text, await readFile(join(VENDOR, entry.path), 'utf8')), `${entry.path} does not reproduce the vendored file`)
    // The stored patch is the canonical diff of its own base, so a rebase stays reproducible.
    assert.equal(formatPatch(entry.path, contentLines(base), contentLines(applied.text)), patch, `${entry.path} patch is not canonical`)
    assert.equal(entry.base.commit, PINNED_COMMIT, `${entry.path} records an older base`)
  }
})

test('upstream parity: the desktop tab hands itself to the product pane when the bridge offers one', async () => {
  const { outputFiles } = await build({
    stdin: { contents: "export { DesktopPane } from './src/client/desktop-pane.js'", resolveDir: VENDOR },
    bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', external: ['react'],
  })
  const load = bridge => {
    const module = { exports: {} }
    runInNewContext(outputFiles[0].text, {
      module, exports: module.exports,
      require: () => ({
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: initial => [initial, () => {}],
        useRef: initial => ({ current: initial }),
        useCallback: value => value,
        useEffect: () => {},
      }),
      globalThis: { __dshDesktop: bridge },
    })
    return module.exports.DesktopPane
  }
  const bot = { id: 'bot-1', name: 'Chief' }
  // With the product client's own pane registered, the vendored shim draws nothing itself.
  const renderPane = function ProductDesktopPane() { return null }
  const delegated = load({ renderPane, view: async () => ({}), machines: async () => [] })({ bot })
  assert.equal(delegated.type, renderPane)
  assert.equal(delegated.props.bot, bot)
  assert.equal(typeof delegated.props.api.view, 'function')
  // Without it the old pane stays, so a host that never installed one still has the tab.
  assert.equal(load({ view: async () => ({}), machines: async () => [] })({ bot }).type, 'div')
  // And with no bridge at all the tab says what to open instead of failing.
  assert.equal(load(undefined)({ bot }).type, 'div')
})

test('upstream parity: a sync never guesses its source, and only records what is already vendored', async () => {
  assert.throws(() => pinSource({ source: join(ROOT, 'no-such-checkout') }), /SOURCE_NOT_FOUND/)
  assert.throws(() => pinSource({ source: RUNTIME }), /SOURCE_NOT_RUNTIME|SOURCE_NOT_FOUND/)
  const before = digest(await readFile(join(RUNTIME, 'SOURCE.json'), 'utf8'))
  // Recording refreshes the manifest from the vendored tree; it copies nothing.
  const recorded = await syncDsBot()
  assert.equal(recorded.status, 'recorded')
  assert.equal(recorded.commit, PINNED_COMMIT)
  assert.equal(digest(await readFile(join(RUNTIME, 'SOURCE.json'), 'utf8')), before)
  assert.deepEqual(await syncDsBot({ check: true }), { status: 'passed', files: recorded.files, commit: PINNED_COMMIT })
})

test('upstream parity: a source that is not the pinned commit, or whose bytes drifted, is refused', async t => {
  if (!hasUpstream()) {
    t.skip(`no upstream checkout at ${UPSTREAM}; the byte-for-byte checks need one (set DS_BOT_UPSTREAM)`)
    return
  }
  assert.throws(() => pinSource({ source: UPSTREAM, sourceCommit: '0'.repeat(40) }), /SOURCE_COMMIT_MISMATCH/)
  // A plain directory copy stands in for a checkout that is not the pinned commit's bytes.
  // It lives outside this repository, so no ambient git metadata can answer for its commit.
  const home = await mkdtemp(join(tmpdir(), 'upstream-parity-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await cp(join(UPSTREAM, 'ds-bot'), join(home, 'ds-bot'), { recursive: true, filter: path => !path.split(/[\\/]/).includes('node_modules') })
  assert.equal((await syncDsBot({ check: true, source: home, sourceCommit: PINNED_COMMIT })).status, 'passed')
  const roster = join(home, 'ds-bot', 'src', 'host', 'roster.js')
  await writeFile(roster, `${await readFile(roster, 'utf8')}\n// drifted candidate bytes\n`)
  await assert.rejects(syncDsBot({ check: true, source: home, sourceCommit: PINNED_COMMIT }), /DS Bot source is stale/)
  const report = await checkUpstreamParity({ source: UPSTREAM })
  assert.equal(report.status, 'passed', report.problems.join('; '))
  assert.equal(report.source.commit, PINNED_COMMIT)
  assert.equal(report.source.version, '0.2.7')
  assert.equal(report.source.clientBundle, 'passed')
  assert.deepEqual(report.source.drifted, [])
})
