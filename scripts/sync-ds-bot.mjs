// Synchronizes the vendored DS Bot runtime (modules/bot-runtime/vendor/ds-bot) from an
// explicit, trusted upstream checkout, and records where every vendored byte came from.
//
//   node scripts/sync-ds-bot.mjs --source <upstream checkout> [--source-commit <sha>] [--rebase-overlay]
//   node scripts/sync-ds-bot.mjs --check [--source <upstream checkout>]
//
// The source is never guessed. An ambient `ds-bot/` folder or `../ds-bot` sibling must not be
// able to replace the pinned runtime by accident, so a sync names the checkout it copies from
// and pins the commit it copied; `--source-commit` refuses a checkout whose HEAD differs.
// Without `--source` nothing is copied: a packaged repository has no sibling checkout and can
// still record and verify the tree it ships. No step reaches the network.
//
// The product owns a few changes on top of upstream — the desktop tab in the Bot drawer, the
// sidebar addon and the slot probe. They live in modules/bot-runtime/product-overlay as a
// recorded upstream base plus a patch, so a sync can never silently drop them, and `client.js`
// is rebuilt from the patched sources with the esbuild version upstream itself pins.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(import.meta.dirname, '..')
const RUNTIME = join(PROJECT, 'modules/bot-runtime')
const VENDOR = join(RUNTIME, 'vendor/ds-bot')
const OVERLAY = join(RUNTIME, 'product-overlay')
const OVERLAY_FILE = join(OVERLAY, 'OVERLAY.json')
const SOURCE_FILE = join(RUNTIME, 'SOURCE.json')
const REPOSITORY = 'https://github.com/Fei2411/DS-Bot'
const RUNTIME_NAME = 'ds-bot'
// A vendored copy never carries another checkout's install or harness bench.
const excluded = new Set(['node_modules', 'harness'])
// What a vendored file is: upstream bytes, a patched upstream file, a build of the patched
// sources, or a copy of the upstream notices.
const ORIGIN = { upstream: 'upstream', overlay: 'overlay', generated: 'generated', notice: 'notice' }
const FULL_SHA = /^[0-9a-f]{40}$/
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

async function files(root, base = root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).replaceAll('\\', '/'))
  }
  return result.sort()
}

// ---------------------------------------------------------------- line diff and patch

// Content lines without their terminator, so a patch reads the same on a CRLF and an LF
// checkout; the terminator of the file being patched is put back when it is written. A text
// that ends in a newline splits to a final empty element, and joining with the same separator
// puts that newline back, so no terminator is added here.
const splitLines = text => text.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
const lineEnding = text => (text.includes('\r\n') ? '\r\n' : '\n')
const joinLines = (lines, ending) => lines.join(ending)

// The classic longest-common-subsequence walk. The files patched here are a few hundred
// lines, so the quadratic table is cheaper than pulling in a diff library.
function diffOps(from, to) {
  const rows = from.length, columns = to.length
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1))
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      table[i][j] = from[i] === to[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const ops = []
  let i = 0, j = 0
  while (i < rows && j < columns) {
    if (from[i] === to[j]) { ops.push([' ', from[i]]); i++; j++ }
    else if (table[i + 1][j] >= table[i][j + 1]) { ops.push(['-', from[i]]); i++ }
    else { ops.push(['+', to[j]]); j++ }
  }
  while (i < rows) { ops.push(['-', from[i]]); i++ }
  while (j < columns) { ops.push(['+', to[j]]); j++ }
  return ops
}

const CONTEXT = 3

function hunksOf(ops) {
  const changed = ops.map((op, index) => (op[0] === ' ' ? -1 : index)).filter(index => index >= 0)
  if (changed.length === 0) return []
  const groups = []
  for (const index of changed) {
    const last = groups.at(-1)
    // Two changes within two context widths share one hunk, the way unified diffs do.
    if (last && index - last.end <= CONTEXT * 2) last.end = index
    else groups.push({ start: index, end: index })
  }
  return groups.map(({ start, end }) => {
    const from = Math.max(0, start - CONTEXT), to = Math.min(ops.length - 1, end + CONTEXT)
    const body = ops.slice(from, to + 1)
    const before = sign => ops.slice(0, from).filter(([mark]) => mark !== sign).length
    return {
      oldStart: before('+') + 1,
      oldCount: body.filter(([mark]) => mark !== '+').length,
      newStart: before('-') + 1,
      newCount: body.filter(([mark]) => mark !== '-').length,
      body,
    }
  })
}

/** A unified diff that turns `from` into `to`, in the product overlay's patch format. */
export function formatPatch(path, from, to) {
  const hunks = hunksOf(diffOps(from, to))
  if (hunks.length === 0) return ''
  const lines = [`--- a/${path}`, `+++ b/${path}`]
  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)
    for (const [mark, line] of hunk.body) lines.push(`${mark}${line}`)
  }
  return `${lines.join('\n')}\n`
}

export function parsePatch(text) {
  const lines = splitLines(text)
  // The text ends with a newline; its split leaves one empty tail that is not a patch line.
  if (lines.at(-1) === '') lines.pop()
  const hunks = []
  for (let index = 0; index < lines.length; index++) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index])
    if (!header) continue
    const hunk = {
      oldStart: Number(header[1]),
      oldCount: header[2] === undefined ? 1 : Number(header[2]),
      newStart: Number(header[3]),
      newCount: header[4] === undefined ? 1 : Number(header[4]),
      body: [],
    }
    index++
    // A body line always carries a mark, so an empty line ends the hunk.
    while (index < lines.length && lines[index] !== '' && !lines[index].startsWith('@@') && !lines[index].startsWith('--- ') && !lines[index].startsWith('+++ ')) {
      const line = lines[index]
      // `\ No newline at end of file` carries no content.
      if (!line.startsWith('\\')) hunk.body.push([line[0], line.slice(1)])
      index++
    }
    index--
    hunks.push(hunk)
  }
  return hunks
}

const matchesAt = (from, at, expected) => at >= 0 && at + expected.length <= from.length
  && expected.every((line, index) => from[at + index] === line)

// Upstream moves lines under a patch. Look for the hunk's own block near where it was
// written, the way `patch` does, before calling the overlay stale.
function locate(from, expected, at, reach = 2000) {
  if (matchesAt(from, at, expected)) return at
  for (let offset = 1; offset <= reach; offset++) {
    for (const candidate of [at - offset, at + offset]) {
      if (matchesAt(from, candidate, expected)) return candidate
    }
  }
  return -1
}

/** Applies parsed hunks to content lines; a hunk that no longer matches fails the call. */
export function applyHunks(from, hunks) {
  const out = []
  let cursor = 0
  for (const hunk of hunks) {
    const expected = hunk.body.filter(([mark]) => mark !== '+').map(([, line]) => line)
    const at = locate(from, expected, hunk.oldStart - 1)
    if (at === -1) return { ok: false, hunk }
    if (at < cursor) return { ok: false, hunk, reason: 'overlapping hunks' }
    out.push(...from.slice(cursor, at))
    for (const [mark, line] of hunk.body) if (mark !== '-') out.push(line)
    cursor = at + expected.length
  }
  out.push(...from.slice(cursor))
  return { ok: true, lines: out }
}

/** Applies a patch text to a file text, keeping that file's line endings. */
export function applyPatchText(text, patch) {
  const outcome = applyHunks(splitLines(text), parsePatch(patch))
  if (!outcome.ok) return outcome
  return { ok: true, text: joinLines(outcome.lines, lineEnding(text)) }
}

// ---------------------------------------------------------------- upstream source

/** Resolves an explicit `--source` into the checkout root and its runtime directory. */
export function resolveSource(source) {
  const root = resolve(source)
  const nested = join(root, RUNTIME_NAME, 'package.json')
  const direct = join(root, 'package.json')
  if (existsSync(nested)) return { root, runtime: join(root, RUNTIME_NAME) }
  if (existsSync(direct)) return { root: dirname(root), runtime: root }
  throw new Error(`SOURCE_NOT_FOUND: ${root} holds no ${RUNTIME_NAME}/package.json`)
}

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

function commitOf(root) {
  // A plain directory is not a repository; the probe stays quiet about it.
  try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}

// A dirty checkout could carry unreviewed bytes into the vendor tree, so it is refused.
function assertClean(root) {
  const status = git(root, 'status', '--porcelain').trim()
  assert.equal(status, '', `SOURCE_DIRTY: ${root} has uncommitted changes; sync from a clean checkout`)
}
function runtimeOf(runtime) {
  const manifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
  assert.equal(manifest.name, RUNTIME_NAME, `SOURCE_NOT_RUNTIME: ${runtime} is not the ${RUNTIME_NAME} package`)
  return manifest
}

/** Pins the source: the commit it is at, and that it is the one asked for. */
export function pinSource({ source, sourceCommit }) {
  const resolved = resolveSource(source)
  const head = commitOf(resolved.root)
  if (sourceCommit) {
    assert.match(sourceCommit, FULL_SHA, 'SOURCE_COMMIT_INVALID: expected a full 40-character commit id')
    if (head) assert.equal(head, sourceCommit, `SOURCE_COMMIT_MISMATCH: ${resolved.root} is at ${head}, not ${sourceCommit}`)
  } else if (head) sourceCommit = head
  else throw new Error(`SOURCE_COMMIT_REQUIRED: ${resolved.root} is not a git checkout; pass --source-commit`)
  // A plain directory (an extracted tarball, say) has no status to read.
  if (head) assertClean(resolved.root)
  return { ...resolved, commit: sourceCommit, version: runtimeOf(resolved.runtime).version }
}

// ---------------------------------------------------------------- product overlay

const overlayPath = (folder, path) => join(OVERLAY, folder, ...path.split('/'))
const patchFile = path => overlayPath('patches', `${path}.patch`)
const baseFile = path => overlayPath('base', path)
const productFile = path => overlayPath('files', path)

export async function readOverlay() {
  const overlay = JSON.parse(await readFile(OVERLAY_FILE, 'utf8'))
  assert.equal(overlay.schemaVersion, 1, 'product overlay: unsupported schemaVersion')
  assert.ok(Array.isArray(overlay.entries) && overlay.entries.length > 0, 'product overlay: no entries')
  for (const entry of overlay.entries) {
    assert.ok(entry.path && entry.kind, `product overlay: incomplete entry ${JSON.stringify(entry)}`)
    if (entry.kind === 'patched') {
      assert.match(entry.base?.sha256 ?? '', /^[0-9a-f]{64}$/, `product overlay: ${entry.path} has no recorded base digest`)
      assert.ok(existsSync(patchFile(entry.path)), `product overlay: ${entry.path} has no patch`)
      assert.ok(existsSync(baseFile(entry.path)), `product overlay: ${entry.path} has no recorded base`)
    } else if (entry.kind === 'product-file') {
      assert.ok(existsSync(productFile(entry.path)), `product overlay: ${entry.path} has no product file`)
    } else throw new Error(`product overlay: unknown kind ${entry.kind} for ${entry.path}`)
  }
  return overlay
}

const sameLines = (a, b) => {
  const left = splitLines(a), right = splitLines(b)
  return left.length === right.length && left.every((line, index) => line === right[index])
}

/**
 * Puts the product's own changes back on top of a freshly copied upstream tree. A patched
 * entry is applied from its patch, so upstream's own changes in the same file survive; the
 * patch is expressed against a recorded base, and `rebase` rewrites that base once the
 * product's hunks have been re-read against the new one.
 */
async function applyOverlays({ runtime, commit, rebase }) {
  const overlay = await readOverlay()
  const report = []
  for (const entry of overlay.entries) {
    const target = join(VENDOR, entry.path)
    if (entry.kind === 'product-file') {
      await mkdir(dirname(target), { recursive: true })
      await cp(productFile(entry.path), target)
      report.push({ path: entry.path, kind: entry.kind, status: 'applied' })
      continue
    }
    const base = await readFile(join(runtime, entry.path), 'utf8')
    const baseDigest = digest(Buffer.from(base))
    const patch = await readFile(patchFile(entry.path), 'utf8')
    const outcome = applyPatchText(base, patch)
    if (!outcome.ok) {
      throw new Error(`OVERLAY_CONFLICT: ${entry.path} no longer applies at line ${outcome.hunk.oldStart}`
        + `${outcome.reason ? ` (${outcome.reason})` : ''}; update modules/bot-runtime/product-overlay by hand`)
    }
    if (baseDigest !== entry.base.sha256) {
      // The patch still applied, only offset. Record the new base so the next sync is exact.
      if (!rebase) {
        report.push({ path: entry.path, kind: entry.kind, status: 'applied-with-offset', base: entry.base.commit })
      } else {
        await writeFile(baseFile(entry.path), base)
        const rebased = formatPatch(entry.path, splitLines(base), splitLines(outcome.text))
        assert.equal(applyPatchText(base, rebased).text, outcome.text, `OVERLAY_REBASE: ${entry.path} does not round-trip`)
        await writeFile(patchFile(entry.path), rebased)
        entry.base = { commit, sha256: baseDigest }
        report.push({ path: entry.path, kind: entry.kind, status: 'rebased', base: commit })
      }
    } else {
      report.push({ path: entry.path, kind: entry.kind, status: 'applied', base: entry.base.commit })
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, outcome.text)
  }
  if (rebase) await writeFile(OVERLAY_FILE, `${JSON.stringify(overlay, null, 2)}\n`)
  return report
}

/** The product's diff for one entry, for review. */
export async function overlayDiff(entry) {
  if (entry.kind === 'product-file') return { path: entry.path, kind: entry.kind, patch: `// product file: ${entry.path}\n` }
  const base = await readFile(baseFile(entry.path), 'utf8')
  const patch = await readFile(patchFile(entry.path), 'utf8')
  const result = applyPatchText(base, patch)
  assert.ok(result.ok, `product overlay: ${entry.path} does not apply to its recorded base`)
  return { path: entry.path, kind: entry.kind, patch }
}

// ---------------------------------------------------------------- vendored client bundle

let bundleClientOnce
// The vendored client.js is a build of the vendored sources, the way upstream commits it. It
// is rebuilt after the overlay so the frozen `client.js is the build of src/client` test holds.
async function bundleVendorClient() {
  if (bundleClientOnce) return bundleClientOnce
  const entry = pathToFileURL(join(VENDOR, 'scripts/build-client.mjs')).href
  bundleClientOnce = (await import(entry)).bundleClient()
  return bundleClientOnce
}

const esbuildAvailable = () => {
  try { createRequire(import.meta.url).resolve('esbuild'); return true } catch { return false }
}

// ---------------------------------------------------------------- manifest

const noticeFor = path => (path === 'UPSTREAM_LICENSE' || path === 'UPSTREAM_NOTICE' ? ORIGIN.notice : undefined)

/**
 * Records every vendored file: where it came from and its digest. `overlays` names the files
 * the product owns, so a reader of the shipped manifest can tell them from upstream bytes.
 */
export async function manifest({ commit, version, overlays = [] }) {
  const owned = new Set(overlays.map(entry => entry.path))
  const records = []
  for (const path of await files(VENDOR)) {
    const bytes = await readFile(join(VENDOR, path))
    const sourcePath = path === 'UPSTREAM_LICENSE' ? 'LICENSE' : path === 'UPSTREAM_NOTICE' ? 'NOTICE' : `${RUNTIME_NAME}/${path}`
    const origin = noticeFor(path) ?? (owned.has(path) ? ORIGIN.overlay : path === 'client.js' ? ORIGIN.generated : ORIGIN.upstream)
    records.push({ path: `vendor/ds-bot/${path}`, sourcePath, sha256: digest(bytes), gitBlob: blob(bytes), origin })
  }
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    commit,
    license: 'Apache-2.0',
    runtime: { name: RUNTIME_NAME, version },
    overlays,
    files: records,
  }
}

const recorded = async () => JSON.parse(await readFile(SOURCE_FILE, 'utf8'))

// The manifest's overlay rows, in the order and shape the shipped SOURCE.json records them.
const overlayRows = overlay => overlay.entries.map(entry => ({
  path: entry.path,
  kind: entry.kind,
  summary: entry.summary ?? '',
  ...(entry.base ? { base: { commit: entry.base.commit, sha256: entry.base.sha256 } } : {}),
}))

async function copySource(pinned, { rebase }) {
  const temporary = `${VENDOR}.next`
  await rm(temporary, { recursive: true, force: true })
  await mkdir(dirname(temporary), { recursive: true })
  await cp(pinned.runtime, temporary, {
    recursive: true,
    filter: source => ![...excluded].some(name => source.split(/[\\/]/).includes(name)),
  })
  await cp(join(pinned.root, 'LICENSE'), join(temporary, 'UPSTREAM_LICENSE'))
  await cp(join(pinned.root, 'NOTICE'), join(temporary, 'UPSTREAM_NOTICE'))
  await rm(VENDOR, { recursive: true, force: true })
  await cp(temporary, VENDOR, { recursive: true })
  await rm(temporary, { recursive: true, force: true })
  const applied = await applyOverlays({ runtime: pinned.runtime, commit: pinned.commit, rebase })
  await writeFile(join(VENDOR, 'client.js'), await bundleVendorClient())
  return applied
}

/**
 * Proves the vendored tree is this source's bytes, plus the recorded overlay, plus the
 * rebuilt client bundle. Only meaningful with `--source`: without one, the tree and its
 * manifest are checked against each other.
 */
async function verifyAgainstSource(pinned) {
  const overlay = await readOverlay()
  const current = await recorded()
  const expected = await manifest({ commit: pinned.commit, version: pinned.version, overlays: overlayRows(overlay) })
  assert.equal(current.commit, pinned.commit, `DS Bot source is stale: SOURCE.json records ${current.commit}, the source is at ${pinned.commit}`)
  assert.equal(current.runtime?.version, pinned.version, `DS Bot runtime version differs: ${current.runtime?.version} against ${pinned.version}`)
  assert.deepEqual(current, expected, 'The vendored DS Bot source or SOURCE.json is stale')
  const drifted = []
  for (const entry of overlay.entries) {
    if (entry.kind !== 'patched') continue
    const bytes = await readFile(join(pinned.runtime, entry.path))
    if (digest(bytes) !== entry.base.sha256) drifted.push({ path: entry.path, base: entry.base.commit, source: pinned.commit })
  }
  // Every file the product does not own must be this source's bytes, byte for byte.
  const stale = []
  for (const file of expected.files) {
    if (file.origin !== ORIGIN.upstream) continue
    const bytes = await readFile(join(pinned.root, file.sourcePath))
    if (digest(bytes) !== file.sha256) stale.push(file.sourcePath)
  }
  assert.deepEqual(stale, [], `DS Bot source is stale: ${stale.join(', ')}`)
  const rebuilt = esbuildAvailable()
    ? { client: digest(Buffer.from(await bundleVendorClient())) === expected.files.find(file => file.path.endsWith('/client.js')).sha256 ? 'passed' : 'failed' }
    : { client: 'skipped (esbuild unavailable)' }
  return { status: rebuilt.client === 'failed' ? 'failed' : 'passed', files: expected.files.length, commit: pinned.commit, version: pinned.version, overlays: overlay.entries.length, drifted, rebuilt }
}

// ---------------------------------------------------------------- entry points

/**
 * Records or verifies the vendored DS Bot runtime. `source` is the only way bytes enter the
 * tree: without it the call can only refresh or check what is already vendored, which is
 * what a packaged repository does at build and check time.
 */
export async function syncDsBot({ check = false, source = null, sourceCommit = null, rebaseOverlay = false } = {}) {
  if (source) {
    const pinned = pinSource({ source, sourceCommit })
    if (check) return verifyAgainstSource(pinned)
    const applied = await copySource(pinned, { rebase: rebaseOverlay })
    const overlay = await readOverlay()
    const next = await manifest({ commit: pinned.commit, version: pinned.version, overlays: overlayRows(overlay) })
    await writeFile(SOURCE_FILE, `${JSON.stringify(next, null, 2)}\n`)
    return { status: 'synced', files: next.files.length, commit: next.commit, version: next.runtime.version, overlays: applied }
  }
  const current = await recorded()
  const next = await manifest({ commit: current.commit, version: current.runtime?.version, overlays: current.overlays ?? [] })
  if (check) {
    assert.deepEqual(current, next, 'The vendored DS Bot source or SOURCE.json is stale')
    return { status: 'passed', files: next.files.length, commit: next.commit }
  }
  await writeFile(SOURCE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  return { status: 'recorded', files: next.files.length, commit: next.commit }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = name => process.argv.includes(name)
  const value = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
  const result = await syncDsBot({
    check: flag('--check'),
    source: value('--source'),
    sourceCommit: value('--source-commit'),
    rebaseOverlay: flag('--rebase-overlay'),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
