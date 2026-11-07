import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir, readFile} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

// Layering that only exists in a document is layering that erodes. Each rule
// below is enforced over the real tree, and every exception is a frozen entry
// with a reason: adding one fails, and removing the code fails too, so the list
// can only shrink on purpose.
//
// This is a ratchet, not a proof: it reads import specifiers, so a dynamic
// import built from a variable is invisible to it.

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'tmp', 'test-artifacts', 'vendor'])
const SOURCE = /\.(mjs|js|jsx|ts|tsx)$/

const posix = (value) => value.split(sep).join('/')

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(full, out) }
    else if (SOURCE.test(entry.name)) out.push(full)
  }
  return out
}

/** Import specifiers with their line, from static import/export and dynamic import(). */
function importsOf(text) {
  const found = []
  const lines = text.split('\n')
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[^'"\n]*?from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+[^'"\n]*?from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const spec = match[1]
      const at = text.slice(0, match.index).split('\n').length
      found.push({spec, line: at, source: lines[at - 1]?.trim() ?? ''})
    }
  }
  return found
}

const files = await walk(ROOT)
const rel = (abs) => posix(relative(ROOT, abs))
const sources = new Map()
for (const abs of files) sources.set(rel(abs), await readFile(abs, 'utf8'))

/** Every edge whose target matches `pattern`, outside `ownPrefix`. */
function edges(ownPrefix, pattern) {
  const out = []
  for (const [file, text] of sources) {
    if (!file.startsWith(ownPrefix)) continue
    for (const entry of importsOf(text)) {
      if (!pattern.test(entry.spec)) continue
      out.push({file, line: entry.line, spec: entry.spec})
    }
  }
  return out.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
}

const describe = (list) => list.map((entry) => `${entry.file}:${entry.line} → ${entry.spec}`).join('\n')

// ── R1: the host-side shared layer may not reach into packages/ ────────────────
const SHARED_TO_PACKAGES_ALLOWED = [
  // The managed terminal is the only implementation of that PTY; moving it into
  // shared would duplicate a native binding wrapper.
  {file: '.dsh-plugin/shared/cli-terminal.mjs', spec: '../../packages/cli-runtime/src/native-terminal.mjs'},
  // One capability list is shared by the legacy policy bridge and the task tools.
  {file: '.dsh-plugin/shared/legacy-policy.mjs', spec: '../../packages/orchestration/src/task-tools.mjs'},
]

test('boundaries: the shared host layer does not reach into packages/', () => {
  const found = edges('.dsh-plugin/shared/', /packages\//)
  const unexpected = found.filter((entry) => !SHARED_TO_PACKAGES_ALLOWED.some((allowed) => allowed.file === entry.file && allowed.spec === entry.spec))
  assert.deepEqual(unexpected, [], `shared/ may not import packages/ (add the edge to a package instead):\n${describe(unexpected)}`)
  assert.equal(found.length, SHARED_TO_PACKAGES_ALLOWED.length, 'the allowlist is a ratchet: it may only shrink on purpose')
  for (const allowed of SHARED_TO_PACKAGES_ALLOWED) {
    assert.ok(found.some((entry) => entry.file === allowed.file && entry.spec === allowed.spec),
      `${allowed.file} no longer carries that import; drop the exception`)
  }
})

// ── R2: server code may not depend on the client bundle ───────────────────────
test('boundaries: packages/ never import the client bundle', () => {
  const found = edges('packages/', /dsh-plugin\/client/)
  assert.deepEqual(found, [], `the server must not depend on the client:\n${describe(found)}`)
})

// ── R3: the pinned vendor tree has a closed set of importers ─────────────────
const VENDOR_IMPORTERS_ALLOWED = [
  {file: 'modules/bot-runtime/index.mjs', spec: './vendor/ds-bot/index.js'},
  {file: 'modules/bot-runtime/web-search.mjs', spec: './vendor/ds-bot/web-search.js'},
  {file: 'apps/integration-client/index.jsx', spec: '../../modules/bot-runtime/vendor/ds-bot/src/client/index.js'},
  {file: 'apps/integration-client/index.jsx', spec: '../../modules/bot-runtime/vendor/ds-bot/src/client/sidebar.js'},
  {file: 'packages/orchestration/src/machine-secrets.mjs', spec: '../../../modules/bot-runtime/vendor/ds-bot/src/host/secrets.js'},
  {file: 'packages/orchestration/src/migration-supporting-domains.mjs', spec: '../../../modules/bot-runtime/vendor/ds-bot/src/host/memory.js'},
  {file: 'packages/orchestration/src/migration-supporting-domains.mjs', spec: '../../../modules/bot-runtime/vendor/ds-bot/src/host/capabilities.js'},
  {file: 'tests/fixtures/migration-legacy-ds-writer.mjs', spec: '../../modules/bot-runtime/vendor/ds-bot/src/host/store.js'},
]

test('boundaries: the vendored runtime is imported only where it is declared', () => {
  // The public tree is a reduced one: an importer outside this checkout cannot be
  // checked, so its entry is not required here either. Everything present must
  // still match exactly, and nothing new may appear.
  const expected = VENDOR_IMPORTERS_ALLOWED.filter((entry) => sources.has(entry.file))
  const found = []
  for (const [file, text] of sources) {
    if (file.startsWith('modules/bot-runtime/vendor/')) continue
    for (const entry of importsOf(text)) {
      if (!/bot-runtime\/vendor|vendor\/ds-bot/.test(entry.spec)) continue
      found.push({file, line: entry.line, spec: entry.spec})
    }
  }
  const unexpected = found.filter((entry) => !expected.some((allowed) => allowed.file === entry.file && allowed.spec === entry.spec))
  assert.deepEqual(unexpected, [], `vendor/ is pinned and may not gain importers (edit product-overlay instead):\n${describe(unexpected)}`)
  assert.equal(found.length, expected.length, 'the importer set is frozen; a removed importer must remove its entry')
})

// ── R4: one truth for which backends owe a stop proof ───────────────────────
test('boundaries: the stop-proof backend set is defined exactly once', () => {
  const definitions = []
  for (const [file, text] of sources) {
    if (!/STOP_PROOF_BACKENDS\s*=/.test(text)) continue
    definitions.push(file)
  }
  assert.deepEqual(definitions, ['packages/orchestration/src/stop-proof.mjs'], 'the backend set has one definition site')
  // And it is read through the module, never re-listed where it is used.
  const literal = []
  for (const [file, text] of sources) {
    if (file === 'packages/orchestration/src/stop-proof.mjs') continue
    // Fixtures may spell a list out to describe an old behaviour; that is the
    // point of a fixture, and it cannot authorize anything.
    if (file.startsWith('tests/')) continue
    if (/'codex-read','remote-write'|'bot-turn-read','bot-turn-write'\],?'/.test(text)) literal.push(file)
  }
  assert.deepEqual(literal, [], `a backend list is spelled out here instead of imported: ${literal.join(', ')}`)
})

// ── the rules themselves must be able to fail ───────────────────────────────
test('boundaries: each rule actually rejects a violation', () => {
  const sample = (file) => [['', `import { thing } from '${file}'`].join('\n')].join('\n')
  // R1 matcher
  assert.ok(importsOf(sample('../../packages/orchestration/src/task-tools.mjs')).some((entry) => /packages\//.test(entry.spec)))
  // R2 matcher
  assert.ok(importsOf(sample('../dsh-plugin/client/index.mjs')).some((entry) => /dsh-plugin\/client/.test(entry.spec)))
  // R3 matcher
  assert.ok(importsOf(sample('../../modules/bot-runtime/vendor/ds-bot/src/host/store.js')).some((entry) => /bot-runtime\/vendor/.test(entry.spec)))
  // Dynamic import and re-export are covered too, not only the plain form.
  assert.ok(importsOf("const mod = await import('../../packages/x.mjs')").some((entry) => /packages\//.test(entry.spec)))
  assert.ok(importsOf("export { y } from '../../packages/y.mjs'").some((entry) => /packages\//.test(entry.spec)))
})
