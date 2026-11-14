import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { avatarBytes } from '../modules/bot-runtime/vendor/ds-bot/src/host/avatar.js'
import { generateModelAvatarCatalog } from '../scripts/build-model-avatar-catalog.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  stdin: { contents: "export * from './modules/bot-runtime/vendor/ds-bot/src/client/model-avatar-picker.js'; export * from './modules/bot-runtime/vendor/ds-bot/src/client/model-avatar-catalog.js'", resolveDir: root },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['react'],
})
const module = { exports: {} }
const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) }
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: () => react })
const { MODEL_AVATARS, ModelAvatarPicker, modelAvatarOf, avatarSourceOf } = module.exports

test('all 19 distinct built-in portraits fit the existing Host avatar contract', () => {
  assert.equal(MODEL_AVATARS.length, 19)
  assert.equal(new Set(MODEL_AVATARS.map(entry => entry.id)).size, 19)
  assert.equal(new Set(MODEL_AVATARS.map(entry => entry.image)).size, 19)
  for (const entry of MODEL_AVATARS) {
    const decoded = avatarBytes(entry.image)
    assert.equal(decoded.mime, 'image/webp', entry.id)
    assert.equal(decoded.url, entry.image, `${entry.id}: Host canonicalization must preserve preset recognition`)
    assert.ok(decoded.bytes.length <= 120 * 1024, entry.id)
    assert.equal(modelAvatarOf(decoded.url).id, entry.id)
  }
})

test('reopening selects the built-in source while uploads and default shapes retain their own source', () => {
  for (const entry of MODEL_AVATARS) assert.equal(avatarSourceOf(entry.image), 'models')
  assert.equal(avatarSourceOf('data:image/png;base64,custom'), 'upload')
  assert.equal(avatarSourceOf(undefined), 'bot')
  assert.equal(modelAvatarOf(undefined), undefined)
})

test('picker names every model, marks only the current portrait, and sends the clicked entry', () => {
  const picked = []
  const current = MODEL_AVATARS.find(entry => entry.id === 'deepseek')
  const tree = ModelAvatarPicker({ image: current.image, onPick: entry => picked.push(entry) })
  assert.equal(tree.children.length, 19)
  assert.equal(tree.children.filter(button => button.props['aria-pressed']).length, 1)
  assert.equal(tree.children.find(button => button.props['aria-pressed']).props['data-model-avatar'], 'deepseek')
  const last = tree.children.at(-1)
  assert.ok(last.props['aria-label'].includes(MODEL_AVATARS.at(-1).label))
  assert.equal(last.children[0].props.src, MODEL_AVATARS.at(-1).image)
  last.props.onClick()
  assert.equal(picked.length, 1)
  assert.equal(picked[0], MODEL_AVATARS.at(-1))
})

test('the embedded catalog matches every checked-in optimized image and digest', async () => {
  assert.equal((await generateModelAvatarCatalog({ check: true })).avatars, 19)
})
