import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

import * as legacy from '../.dsh-plugin/shared/gal-story.mjs'
import * as bridges from '../.dsh-plugin/shared/gal-story-v2.mjs'
import * as echoCity from '../.dsh-plugin/shared/gal-story-echo.mjs'
import * as spring from '../.dsh-plugin/shared/gal-story-spring.mjs'
import * as chronicle from '../.dsh-plugin/shared/gal-story-echocity.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePortraits = path.resolve(root, '../galgame/EchoCity/game/images/chars/aipersona')

// Bundle the actual browser modules, resolving every image import from disk.
// Exporting small asset identifiers keeps this test independent of image size
// while still failing on a missing or empty file (as the client build would).
const browserModules = build({
  absWorkingDir: root,
  stdin: {
    contents: [
      "import * as characters from './.dsh-plugin/client/characters.mjs'",
      "import * as expressions from './.dsh-plugin/client/gal-game-expressions.mjs'",
      "import * as backgrounds from './.dsh-plugin/client/gal-story-backgrounds.mjs'",
      "import * as stage from './.dsh-plugin/client/gal-stage-state.mjs'",
      "import * as identity from './.dsh-plugin/client/character-identity.mjs'",
      'export { characters, expressions, backgrounds, stage, identity }',
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'gal-art-test-entry.mjs',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'verified-art-file',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\.(?:png|webp|avif)$/i }, args => ({
        path: path.resolve(args.resolveDir, args.path),
        namespace: 'verified-art-file',
      }))
      pluginBuild.onLoad({ filter: /.*/, namespace: 'verified-art-file' }, async args => {
        const bytes = await readFile(args.path)
        if (bytes.length === 0) throw new Error(`Empty art file: ${args.path}`)
        const relative = path.relative(root, args.path).replaceAll('\\', '/')
        return { contents: `export default ${JSON.stringify(`art:${relative}`)}`, loader: 'js' }
      })
    },
  }],
}).then(result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`))

function artworkKey(speaker) {
  return typeof speaker === 'string' ? speaker : speaker?.speaker ?? speaker?.key
}

function chronicleNodes() {
  const results = []
  // The chronicle intentionally keeps its graph private. Walk every chapter
  // and every visible branch through its public story API instead.
  const visited = new Set()
  const queue = chronicle.STORY_CHAPTERS.map(chapter => chronicle.createStory({ chapterId: chapter.id }))
  while (queue.length > 0) {
    const state = queue.shift()
    const node = chronicle.currentStoryNode(state)
    if (visited.has(node.id)) continue
    visited.add(node.id)
    results.push(node)
    if (node.ending) continue
    if (node.input) {
      queue.push(chronicle.advanceStory(state, '__input__:衔雪'))
    } else if (node.choices?.length) {
      for (const choice of node.choices) queue.push(chronicle.advanceStory(state, choice.id))
    } else {
      queue.push(chronicle.advanceStory(state, null))
    }
    assert.ok(visited.size < 5000, 'chronicle traversal must stay finite')
  }
  return results
}

function visibleStoryNodes() {
  return [
    ...[legacy, bridges, echoCity, spring].flatMap(module => module.STORY_GRAPH ?? []),
    ...chronicleNodes(),
  ]
}

test('every authored actor and scene cast resolves to bundled artwork', async () => {
  const { characters, stage, identity } = await browserModules
  const missing = []
  const nodes = visibleStoryNodes()
  for (const node of nodes) {
    const speakers = [node.speaker, ...(node.cast ?? []).map(artworkKey), ...(node.stageCharacters ?? []).map(artworkKey)]
    for (const speaker of speakers) {
      if (!speaker || ['player', 'narrator'].includes(speaker)) continue
      if (!characters.characterImageFor(speaker)) missing.push(`${node.id}: ${speaker}`)
    }
    if (node.stageCharacters?.length) {
      const actors = stage.stageCharactersFor(node)
      for (const actor of actors) {
        assert.equal(actor.speaker, identity.normalizeCharacterKey(actor.speaker), `${node.id}: canonical stage key`)
        assert.ok(characters.characterImageFor(actor.speaker), `${node.id}: ${actor.speaker} stage portrait`)
      }
    }
  }
  assert.deepEqual(missing, [], `missing portraits among ${nodes.length} authored nodes`)
})

test('the original portrait folders map to real client images when source checkout is present', async t => {
  if (!existsSync(sourcePortraits)) return t.skip('sibling galgame source checkout is not installed')
  const { characters, identity } = await browserModules
  const folders = await readdir(sourcePortraits, { withFileTypes: true })
  const missing = []
  let imageCount = 0
  for (const folder of folders.filter(item => item.isDirectory())) {
    const files = (await readdir(path.join(sourcePortraits, folder.name))).filter(name => /\.png$/i.test(name))
    for (const name of files) {
      imageCount += 1
      const original = await readFile(path.join(sourcePortraits, folder.name, name))
      assert.ok(original.length > 0, `${folder.name}/${name} source image is nonempty`)
      if (!characters.characterImageFor(identity.normalizeCharacterKey(folder.name))) missing.push(`${folder.name}/${name}`)
    }
  }
  assert.ok(imageCount > 0, 'source portrait inventory was read')
  assert.deepEqual(missing, [], 'each source character has a bundled client portrait')
})

test('chronicle background mappings resolve to scene art rather than the title fallback', async () => {
  const { backgrounds } = await browserModules
  const mapped = [...Object.entries(chronicle.ECHO_BACKGROUNDS), ...Object.entries(chronicle.ECHO_CHAPTER_BG)]
  for (const [id, key] of mapped) {
    assert.ok(backgrounds.STORY_BACKGROUNDS[key], `${id} maps to registered ${key}`)
    assert.notEqual(backgrounds.STORY_BACKGROUNDS[key], backgrounds.STORY_BACKGROUNDS.title, `${id} is not title art`)
  }
  for (const node of chronicleNodes()) {
    if (node.bg) assert.ok(chronicle.ECHO_BACKGROUNDS[node.bg], `${node.id}: semantic background ${node.bg}`)
    assert.ok(node.backgroundId, `${node.id}: background id`)
    assert.ok(backgrounds.STORY_BACKGROUNDS[node.backgroundId], `${node.id}: registered ${node.backgroundId}`)
    assert.notEqual(backgrounds.backgroundForStoryNode(node), backgrounds.STORY_BACKGROUNDS.title, `${node.id}: scene art`)
  }
})

test('a two-character scene preserves each actor’s own emotion and image', async () => {
  const { stage, expressions, characters } = await browserModules
  const node = spring.STORY_GRAPH.find(item => {
    const actors = item.stageCharacters ?? []
    return actors.length === 2 && actors[0].emotion !== actors[1].emotion
  })
  assert.ok(node, 'story includes a two-character scene with distinct moods')
  const actors = stage.stageCharactersFor(node)
  assert.equal(actors.length, 2)
  assert.notEqual(actors[0].emotion, actors[1].emotion)
  for (const actor of actors) {
    assert.ok(characters.characterImageFor(actor.speaker), `${actor.speaker} base portrait exists`)
    assert.ok(expressions.expressionFor(actor.speaker, actor.emotion), `${actor.speaker} ${actor.emotion} expression exists`)
  }
  const aliases = stage.stageCharactersFor({ stageCharacters: [
    { speaker: 'ds-myst', emotion: 'sad' },
    { speaker: 'xianxue', emotion: 'happy' },
  ] })
  assert.deepEqual(aliases.map(actor => actor.speaker), ['deepseek', 'harness'])
  assert.deepEqual(aliases.map(actor => actor.emotion), ['sad', 'happy'])
})

test('a speaker beyond the first two cast entries stays visible after alias deduplication', async () => {
  const { stage, identity, characters } = await browserModules
  const nodes = chronicleNodes()
  const aliasNode = nodes.find(node => node.speaker === 'ds-myst' && node.cast?.some(actor => actor.key === 'ds-myst'))
  assert.ok(aliasNode, 'the chronicle includes a real DeepSeek alias with a cast entry')
  const speakerKey = identity.normalizeCharacterKey(aliasNode.speaker)
  const otherActors = []
  for (const node of nodes) {
    for (const actor of node.cast ?? []) {
      const key = identity.normalizeCharacterKey(actor.key)
      if (key !== speakerKey && !otherActors.some(item => identity.normalizeCharacterKey(item.key) === key)) otherActors.push(actor)
    }
  }
  assert.ok(otherActors.length >= 2, 'the chronicle provides two other distinct cast actors')
  const currentActor = aliasNode.cast.find(actor => identity.normalizeCharacterKey(actor.key) === speakerKey)
  const scene = { ...aliasNode, cast: [otherActors[0], otherActors[1], currentActor] }
  const visible = stage.stageCharactersFor(scene)
  assert.deepEqual(visible.map(actor => actor.speaker), [speakerKey, identity.normalizeCharacterKey(otherActors[0].key)])
  assert.equal(visible[0].emotion, chronicle.ECHO_EMOTIONS[currentActor.mood])
  assert.ok(visible.every(actor => characters.characterImageFor(actor.speaker)), 'both actors have visible portraits')

  const aliasDuplicate = stage.stageCharactersFor({
    ...aliasNode,
    cast: [otherActors[0], { key: speakerKey, mood: 'normal' }, currentActor],
  })
  assert.equal(aliasDuplicate[0].speaker, speakerKey)
  assert.equal(aliasDuplicate.filter(actor => actor.speaker === speakerKey).length, 1, 'alias and canonical key produce one actor')
  assert.equal(aliasDuplicate[0].emotion, chronicle.ECHO_EMOTIONS[currentActor.mood], 'the active alias keeps its own expression')
})

test('Claude default and special fallback use the exact source portrait', async t => {
  const { characters } = await browserModules
  const sourceFile = path.join(sourcePortraits, 'Claude', 'Claude.png')
  const bundledFile = path.join(root, 'aipicture', 'Claude1.png')
  assert.equal(characters.CHARACTER_VARIANTS.claude.default, characters.characterImageFor('claude'))
  assert.equal(characters.CHARACTER_VARIANTS.claude.special, characters.characterImageFor('claude'))
  assert.equal(characters.characterImageFor('claude'), 'art:aipicture/Claude1.png')
  if (!existsSync(sourceFile)) return t.skip('source Claude image is unavailable outside the original checkout')
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  assert.equal(digest(await readFile(bundledFile)), digest(await readFile(sourceFile)))
})
