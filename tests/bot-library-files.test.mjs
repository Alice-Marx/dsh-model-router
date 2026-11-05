import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join, resolve } from 'node:path'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'

const make = () => {
  const parent = resolve('tmp/integration/library-files')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(join(parent, 'case-'))
  return { root, library: createBotLibrary({ root, fs }) }
}

test('library preserves binary uploads, refuses accidental replacement, and downloads the original bytes', () => {
  const { library } = make(), bytes = Buffer.from([0, 255, 1, 2, 128, 0, 13, 10])
  assert.equal(library.upload('bot-a', 'papers/source.pdf', bytes.toString('base64')).bytes, bytes.length)
  assert.equal(library.list('bot-a', 'papers')[0].mediaType, 'application/pdf')
  assert.deepEqual(Buffer.from(library.download('bot-a', 'papers/source.pdf').contentBase64, 'base64'), bytes)
  assert.throws(() => library.upload('bot-a', 'papers/source.pdf', 'bmV3'), { code: 'LIBRARY_FILE_EXISTS' })
  assert.throws(() => library.download('bot-b', 'papers/source.pdf'), { code: 'LIBRARY_NOT_FOUND' })
})

test('library rejects writes through a linked parent even when the final nested file does not exist', () => {
  const { root, library } = make(), outside = join(root, 'outside')
  fs.mkdirSync(outside); library.mkdir('bot-a', 'notes')
  fs.symlinkSync(outside, join(root, 'bot-a/notes/link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => library.upload('bot-a', 'notes/link/new/note.md', 'aGVsbG8='), { code: 'LIBRARY_PATH_ESCAPE' })
  assert.equal(fs.existsSync(join(outside, 'new/note.md')), false)
  fs.symlinkSync(outside, join(root, 'bot-linked'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => library.write('bot-linked', 'note.md', 'no'), { code: 'LIBRARY_PATH_ESCAPE' })
})

test('library navigation and text search preserve Bot ownership and exact source lines', () => {
  const { library } = make()
  library.mkdir('bot-a', 'notes')
  library.write('bot-a', 'notes/plan.md', 'first\nEvidence is here\nlast')
  library.write('bot-b', 'private.md', 'Evidence belongs to another Bot')
  assert.deepEqual(library.search('bot-a', 'evidence'), [{ path: 'notes/plan.md', line: 2, text: 'Evidence is here' }])
  library.remove('bot-a', 'notes/plan.md')
  assert.deepEqual(library.list('bot-a', 'notes'), [])
})
