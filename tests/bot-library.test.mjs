import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'

const make = () => { const root = mkdtempSync(join(tmpdir(), 'bot-library-')); return { root, library: createBotLibrary({ root, fs }) } }
const code = expected => error => { assert.equal(error.code, expected, error.message); return true }

test('library: each Bot sees only its own directory', () => {
  const { library } = make()
  library.write('bot-a', 'notes/a.md', 'hello')
  library.write('bot-b', 'notes/b.md', 'world')
  assert.deepEqual(library.list('bot-a', 'notes').map(row => row.name), ['a.md'])
  assert.equal(library.read('bot-a', 'notes/a.md'), 'hello')
  assert.throws(() => library.read('bot-a', 'notes/b.md'), code('LIBRARY_NOT_FOUND'))
})

test('library: escaping the directory is refused before touching the disk', () => {
  const { library } = make()
  assert.throws(() => library.list('bot-a', '../../etc'), code('LIBRARY_PATH_INVALID'))
  assert.throws(() => library.read('bot-a', '/etc/passwd'), code('LIBRARY_PATH_INVALID'))
  assert.throws(() => library.read('../bot-b', 'x'), code('LIBRARY_BOT_ID_INVALID'))
  assert.throws(() => library.read('bot/a', 'x'), code('LIBRARY_BOT_ID_INVALID'))
})

test('library: a symlink pointing outside is refused even when the path looks relative', () => {
  const { root, library } = make()
  const outside = mkdtempSync(join(tmpdir(), 'bot-outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'secret')
  mkdirSync(join(root, 'bot-a'), { recursive: true })
  try { symlinkSync(outside, join(root, 'bot-a', 'link'), 'junction') } catch { return }
  assert.throws(() => library.read('bot-a', 'link/secret.txt'), code('LIBRARY_PATH_ESCAPE'))
  rmSync(outside, { recursive: true, force: true })
})

test('library: reads and writes stay bounded', () => {
  const { library } = make()
  assert.throws(() => library.write('bot-a', 'big.txt', 'x'.repeat(1024 * 1024 + 1)), code('LIBRARY_FILE_TOO_LARGE'))
  library.write('bot-a', 'ok.txt', 'small')
  assert.equal(library.read('bot-a', 'ok.txt'), 'small')
})

test('library: a missing directory lists as empty, and a missing file says so', () => {
  const { library } = make()
  assert.deepEqual(library.list('bot-a', 'nothing-here'), [])
  assert.throws(() => library.read('bot-a', 'ghost.md'), code('LIBRARY_NOT_FOUND'))
  assert.throws(() => library.write('bot-a', '', 'x'), code('LIBRARY_PATH_INVALID'))
})
