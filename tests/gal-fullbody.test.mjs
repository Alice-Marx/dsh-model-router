import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Resolve the actual image imports to small path identifiers. File metadata
// verifies the references without reading every large source portrait again.
const browserModules = build({
  absWorkingDir: root,
  stdin: {
    contents: [
      "import * as characters from './.dsh-plugin/client/characters.mjs'",
      "import * as expressions from './.dsh-plugin/client/gal-game-expressions.mjs'",
      "import * as identity from './.dsh-plugin/client/character-identity.mjs'",
      'export { characters, expressions, identity }',
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'gal-fullbody-test-entry.mjs',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'registered-art-path',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\.(?:png|webp|avif)$/i }, args => ({
        path: path.resolve(args.resolveDir, args.path),
        namespace: 'registered-art-path',
      }))
      pluginBuild.onLoad({ filter: /.*/, namespace: 'registered-art-path' }, async args => {
        const metadata = await stat(args.path)
        if (!metadata.isFile() || metadata.size === 0) throw new Error('Missing or empty art file: ' + args.path)
        const relative = path.relative(root, args.path).replaceAll('\\', '/')
        return { contents: 'export default ' + JSON.stringify('art:' + relative), loader: 'js' }
      })
    },
  }],
}).then(result => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')))

test('every character and emotion uses its registered full-length original', async () => {
  const { characters, expressions } = await browserModules
  assert.equal(Object.keys(characters.CHARACTER_IMAGES).length, 28)
  const moods = [...expressions.STORY_EMOTIONS, 'smile', 'serious', 'shock', 'unknown-mood', null]
  for (const [key, original] of Object.entries(characters.CHARACTER_IMAGES)) {
    assert.equal(expressions.fullBodyPortraitFor(key), original, key + ': default full-body source')
    for (const emotion of moods) {
      assert.equal(expressions.fullBodyPortraitFor(key, emotion), original, key + ': ' + emotion + ' keeps complete original')
    }
    assert.doesNotMatch(original, /(?:echo|spring)-portraits|output\/imagegen/, key + ': no cropped generated expression in full-body mode')
  }
})

test('full-body sources agree with the committed source portrait inventory', async () => {
  const { characters, expressions, identity } = await browserModules
  const inventory = JSON.parse(await readFile(path.join(root, 'docs/assets/gal-portrait-sources.json'), 'utf8'))
  assert.equal(inventory.schemaVersion, 1)
  assert.equal(inventory.portraits.length, Object.keys(characters.CHARACTER_IMAGES).length)
  const inventoryKeys = new Set()
  for (const portrait of inventory.portraits) {
    const key = identity.normalizeCharacterKey(portrait.characterKey)
    assert.equal(inventoryKeys.has(key), false, key + ': unique inventory key')
    inventoryKeys.add(key)
    assert.equal(expressions.fullBodyPortraitFor(key), 'art:' + portrait.pluginBasePath, key + ': exact original asset mapping')
    assert.ok(portrait.sourceRelativePath && portrait.sourceWidth > 0 && portrait.sourceHeight > 0, key + ': original source metadata')
    assert.ok(['byte-identical-original', 'converted-from-original'].includes(portrait.pluginBaseRelation), key + ': original or source conversion')
  }
  assert.deepEqual([...inventoryKeys].sort(), Object.keys(characters.CHARACTER_IMAGES).sort())
})

test('Claude aliases always use the user-selected complete Claude.png artwork', async () => {
  const { expressions } = await browserModules
  for (const alias of ['claude', 'Claude', ' CLAUDE ', 'c_claude', 'c_Claude']) {
    for (const emotion of expressions.STORY_EMOTIONS) assert.equal(expressions.fullBodyPortraitFor(alias, emotion), 'art:aipicture/Claude1.png')
  }
  const inventory = JSON.parse(await readFile(path.join(root, 'docs/assets/gal-portrait-sources.json'), 'utf8'))
  const claude = inventory.portraits.find(portrait => portrait.characterKey === 'claude')
  assert.equal(claude.sourceRelativePath, 'Claude/Claude.png')
  assert.equal(claude.pluginBasePath, 'aipicture/Claude1.png')
  assert.equal(claude.pluginBaseRelation, 'byte-identical-original')
  assert.equal(claude.pluginBaseSha256, claude.sourceSha256)
})

test('story aliases resolve to their own original without substituting another character', async () => {
  const { characters, expressions } = await browserModules
  const aliases = {
    deepseekharness: 'harness', deepseek_harness: 'harness', 衔雪: 'harness',
    'ds-myst': 'deepseek', ds_myst: 'deepseek', c_minmax: 'minimax',
    cf: 'cloudflare', hf: 'huggingface', comfy: 'comfyui', nai: 'novelai',
    'gpt-image': 'gptimage', gittee: 'gitee', perp: 'perplexity',
  }
  for (const [alias, canonical] of Object.entries(aliases)) assert.equal(expressions.fullBodyPortraitFor(alias, 'happy'), characters.CHARACTER_IMAGES[canonical], alias)
  for (const unknown of [null, undefined, '', 'player', 'narrator', 'no-such-character', 'constructor', '__proto__', 'toString', {}]) {
    assert.equal(expressions.fullBodyPortraitFor(unknown, 'happy'), null, String(unknown) + ': unknown speakers have no full-body art')
  }
})

test('existing expressionFor close-up and legacy contracts remain intact', async () => {
  const { expressions, characters } = await browserModules
  assert.equal(expressions.expressionFor('happy'), expressions.DEEPSEEK_EXPRESSIONS.happy)
  assert.equal(expressions.expressionFor('thoughtful'), expressions.DEEPSEEK_EXPRESSIONS.thoughtful)
  assert.equal(expressions.expressionFor('unknown-mood'), expressions.DEEPSEEK_EXPRESSIONS.neutral)
  assert.match(expressions.expressionFor('claude', 'neutral'), /^art:\.dsh-plugin\/client\/echo-portraits\/claude-neutral\.webp$/)
  assert.match(expressions.expressionFor('kimi', 'happy'), /^art:\.dsh-plugin\/client\/spring-portraits\/kimi-happy\.webp$/)
  assert.notEqual(expressions.expressionFor('claude', 'neutral'), expressions.fullBodyPortraitFor('claude', 'neutral'))
  assert.equal(expressions.expressionFor('unknown-character', 'happy'), characters.CHARACTER_IMAGES.harness)
})
