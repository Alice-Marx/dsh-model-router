import test from 'node:test'
import assert from 'node:assert/strict'
import { featureSources, parseTree } from '../scripts/integration-inventory.mjs'

const blob = 'a'.repeat(40)
test('inventory: Git blob identity and byte size come from the frozen tree', () => {
  const tree = parseTree(`100644 blob ${blob}      12\tds-bot/src/host/tools.js\n`)
  assert.deepEqual(tree.get('ds-bot/src/host/tools.js'), { path: 'ds-bot/src/host/tools.js', gitBlob: blob, bytes: 12 })
  assert.throws(() => parseTree('bad tree'), /Malformed/)
})

test('inventory: DS relative subdirectories follow the last full source path', () => {
  const tree = new Map(['ds-bot/src/host/browser.js', 'ds-bot/src/host/browser/session.js'].map(path => [path, { path, gitBlob: blob, bytes: 1 }]))
  const result = featureSources({ id: 'F12', sourceDescription: 'DS `src/host/browser.js`、`browser/session.js`' }, tree)
  assert.equal(result.files[1].path, 'ds-bot/src/host/browser/session.js')
})

test('inventory: a unique shorthand resolves across MR folders, ambiguity fails', () => {
  const tree = new Map(['.dsh-plugin/index.mjs', '.dsh-plugin/shared/official-tools-remote.mjs'].map(path => [path, { path, gitBlob: blob, bytes: 1 }]))
  const feature = { id: 'F39', sourceDescription: 'MR `.dsh-plugin/index.mjs`、`official-tools-remote.mjs`' }
  assert.equal(featureSources(feature, tree).files[1].path, '.dsh-plugin/shared/official-tools-remote.mjs')
  tree.set('duplicate/official-tools-remote.mjs', { path: 'duplicate/official-tools-remote.mjs', gitBlob: blob, bytes: 1 })
  assert.throws(() => featureSources(feature, tree), /unresolved/)
})

test('inventory: new remote agent is explicitly missing in the baseline', () => {
  const result = featureSources({ id: 'F40', sourceDescription: '原方案§4；新建' }, new Map())
  assert.equal(result.side, 'new')
  assert.deepEqual(result.files, [])
})
