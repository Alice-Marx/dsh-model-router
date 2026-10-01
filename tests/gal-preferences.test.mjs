import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GAL_PREFERENCES_KEY,
  GAL_READ_KEY,
  DEFAULT_GAL_PREFERENCES,
  normalizeGalPreferences,
  readGalPreferences,
  writeGalPreferences,
  portraitLayoutFor,
  portraitStyleFor,
  nodeReadKey,
  readSeenNodes,
  writeSeenNodes,
} from '../.dsh-plugin/client/gal-preferences.mjs'

function memoryStorage() {
  const data = new Map()
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}

test('Gal preferences use immutable defaults and independent fresh instances', () => {
  assert.deepEqual(normalizeGalPreferences(null), DEFAULT_GAL_PREFERENCES)
  const first = normalizeGalPreferences(null)
  first.portraits.main.scale = 180
  first.portraits.characters.claude = { scale: 40, x: 0, y: 0 }
  assert.equal(normalizeGalPreferences(null).portraits.main.scale, 100)
  assert.deepEqual(normalizeGalPreferences(null).portraits.characters, {})
  assert.equal(Object.isFrozen(DEFAULT_GAL_PREFERENCES.portraits.main), true)
  assert.equal(Object.isFrozen(DEFAULT_GAL_PREFERENCES.audio), true)
})

test('Gal numeric preferences are bounded, finite and omit unrelated fields', () => {
  const actual = normalizeGalPreferences({
    version: 1,
    unrelated: 'do not persist',
    portraits: { main: { scale: 900, x: -9, y: -90 }, companion: { scale: 5, x: 200, y: 90 } },
    audio: { musicVolume: 300, effectsVolume: -1, url: 'https://unknown.example' },
    reading: { textSpeed: -10, fontSize: 100, autoDelay: 1e9, dialogueOpacity: 0 },
  })
  assert.deepEqual(actual.portraits.main, { scale: 180, x: 0, y: -30 })
  assert.deepEqual(actual.portraits.companion, { scale: 40, x: 100, y: 50 })
  assert.equal(actual.audio.musicVolume, 100)
  assert.equal(actual.audio.effectsVolume, 0)
  assert.equal(actual.reading.textSpeed, 0)
  assert.equal(actual.reading.fontSize, 32)
  assert.equal(actual.reading.autoDelay, 10000)
  assert.equal(actual.reading.dialogueOpacity, 20)
  assert.equal(Object.hasOwn(actual, 'unrelated'), false)
  assert.equal(Object.hasOwn(actual.audio, 'url'), false)
  assert.equal(normalizeGalPreferences({ portraits: { main: { scale: NaN, x: Infinity, y: -Infinity } } }).portraits.main.scale, 100)
})

test('slider numeric strings normalize but coercions, invalid booleans and themes do not', () => {
  const actual = normalizeGalPreferences({
    portraits: { main: { scale: '82.5', x: '', y: false } },
    audio: { enabled: 'false', muted: 1, pauseWhenHidden: false, theme: 'local', musicVolume: '50' },
    reading: { textSpeed: '0', fontSize: '20', skipUnread: true, reduceMotion: true },
  })
  assert.deepEqual(actual.portraits.main, { scale: 82.5, x: 73, y: 5 })
  assert.equal(actual.audio.enabled, false)
  assert.equal(actual.audio.muted, false)
  assert.equal(actual.audio.pauseWhenHidden, false)
  assert.equal(actual.audio.theme, 'local')
  assert.equal(actual.audio.musicVolume, 50)
  assert.equal(actual.reading.textSpeed, 0)
  assert.equal(actual.reading.skipUnread, true)
  assert.equal(actual.reading.reduceMotion, true)
  assert.equal(normalizeGalPreferences({ audio: { theme: 'claude-poem' } }).audio.theme, 'claude-poem')
  assert.equal(normalizeGalPreferences({ audio: { theme: 'https://remote.example/music.mp3' } }).audio.theme, 'auto')
})

test('character overrides canonicalize aliases and stay independent of stage role', () => {
  const actual = normalizeGalPreferences({
    portraits: {
      main: { scale: 90, x: 80, y: 5 },
      companion: { scale: 60, x: 20, y: 0 },
      characters: { 'c_Claude': { scale: 125, x: 48, y: -5 }, 'ds-myst': { scale: 70, x: 36, y: 4 }, unknown: { scale: 180 } },
    },
  })
  assert.deepEqual(Object.keys(actual.portraits.characters), ['claude', 'deepseek'])
  assert.deepEqual(portraitLayoutFor(actual, 'CLAUDE'), { scale: 125, x: 48, y: -5 })
  assert.deepEqual(portraitLayoutFor(actual, 'c_claude', true), { scale: 125, x: 48, y: -5 })
  assert.deepEqual(portraitLayoutFor(actual, 'ds_myst'), { scale: 70, x: 36, y: 4 })
  assert.deepEqual(portraitLayoutFor(actual, 'kimi'), { scale: 90, x: 80, y: 5 })
  assert.deepEqual(portraitLayoutFor(actual, 'kimi', true), { scale: 60, x: 20, y: 0 })
  assert.deepEqual(portraitLayoutFor(actual, 'narrator', true), { scale: 60, x: 20, y: 0 })
})

test('portrait styles use scene-relative size and numeric safe offsets', () => {
  const settings = normalizeGalPreferences({ portraits: { main: { scale: 180, x: 99, y: -20 }, companion: { scale: 50, x: 21, y: 10 } } })
  assert.deepEqual(portraitStyleFor(settings, 'claude'), {
    height: '140.4%', left: '99%', bottom: '-20%', transform: 'translateX(-50%)', maxWidth: 'none', objectFit: 'contain',
  })
  assert.equal(portraitStyleFor(settings, 'claude', true).height, '36%')
  assert.equal(portraitStyleFor({}, 'claude').height, '78%')
  assert.equal(portraitStyleFor({}, 'claude', true).height, '72%')
})

test('unknown versions and malformed top-level preference data safely use defaults', () => {
  for (const bad of [null, [], 'settings', true, 10, { version: 2, audio: { enabled: true } }, { version: '1', portraits: { main: { scale: 120 } } }]) {
    assert.deepEqual(normalizeGalPreferences(bad), DEFAULT_GAL_PREFERENCES)
  }
  const nullPrototype = Object.create(null)
  nullPrototype.audio = { enabled: true }
  assert.equal(normalizeGalPreferences(nullPrototype).audio.enabled, true)
})

test('prototype pollution, inherited values and accessors cannot reach preferences', () => {
  const malicious = JSON.parse('{"portraits":{"characters":{"__proto__":{"polluted":true},"constructor":{"scale":160},"claude":{"scale":80}}},"__proto__":{"polluted":true}}')
  assert.deepEqual(normalizeGalPreferences(malicious).portraits.characters, { claude: { scale: 80, x: 73, y: 5 } })
  assert.equal({}.polluted, undefined)
  assert.deepEqual(normalizeGalPreferences(Object.create({ audio: { enabled: true } })), DEFAULT_GAL_PREFERENCES)
  const accessor = { audio: {} }
  Object.defineProperty(accessor.audio, 'enabled', { enumerable: true, get() { throw new Error('do not execute getters') } })
  assert.equal(normalizeGalPreferences(accessor).audio.enabled, false)
  assert.deepEqual(portraitLayoutFor(malicious, '__proto__'), DEFAULT_GAL_PREFERENCES.portraits.main)
})

test('preference storage writes only its key and retains story and free-mode saves', () => {
  const storage = memoryStorage()
  storage.setItem('model-router:gal-story:v1', 'existing-story')
  storage.setItem('model-router:gal-game:v1', 'existing-free-mode')
  const settings = writeGalPreferences(storage, { audio: { enabled: true, theme: 'kimi-flute' }, portraits: { main: { scale: 75 } } })
  assert.deepEqual(readGalPreferences(storage), settings)
  assert.equal(storage.getItem('model-router:gal-story:v1'), 'existing-story')
  assert.equal(storage.getItem('model-router:gal-game:v1'), 'existing-free-mode')
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(GAL_PREFERENCES_KEY))), ['version', 'portraits', 'audio', 'reading'])
})

test('corrupt and inaccessible preference reads preserve source and failed writes explain recovery', () => {
  const storage = memoryStorage()
  for (const raw of ['{broken', '[]', 'null', '{"version":200}', 'x'.repeat(100001)]) {
    storage.setItem(GAL_PREFERENCES_KEY, raw)
    assert.deepEqual(readGalPreferences(storage), DEFAULT_GAL_PREFERENCES)
    assert.equal(storage.getItem(GAL_PREFERENCES_KEY), raw)
  }
  const blocked = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.deepEqual(readGalPreferences(blocked), DEFAULT_GAL_PREFERENCES)
  assert.deepEqual(readGalPreferences(null), DEFAULT_GAL_PREFERENCES)
  assert.throws(() => writeGalPreferences(blocked, {}), /本次调整仍可使用/)
  assert.throws(() => writeGalPreferences(null, {}), /本地存储不可用或空间不足/)
})

test('read keys scope episode, chapter, route and node with no delimiter collisions', () => {
  const base = nodeReadKey('bridges', { id: 'same-node', chapterId: 'chapter-1' }, { routeId: 'kimi' })
  assert.deepEqual(JSON.parse(base), ['bridges', 'chapter-1', 'kimi', 'same-node'])
  assert.notEqual(base, nodeReadKey('echo-city', { id: 'same-node', chapterId: 'chapter-1' }, { routeId: 'kimi' }))
  assert.notEqual(base, nodeReadKey('bridges', { id: 'same-node', chapterId: 'chapter-2' }, { routeId: 'kimi' }))
  assert.notEqual(base, nodeReadKey('bridges', { id: 'same-node', chapterId: 'chapter-1' }, { routeId: 'claude' }))
  assert.deepEqual(JSON.parse(nodeReadKey('legacy', null, { nodeId: 'arrival-01' })), ['legacy', 'legacy', '', 'arrival-01'])
  assert.notEqual(nodeReadKey('a:b', { id: 'n', chapterId: 'c' }), nodeReadKey('a', { id: 'n', chapterId: 'b:c' }))
  assert.equal(nodeReadKey('bridges', {}, {}), '')
  assert.equal(nodeReadKey('', { id: 'n' }), '')
})

test('seen-node records deduplicate, reject malformed keys and preserve unrelated saves', () => {
  const storage = memoryStorage()
  const first = nodeReadKey('bridges', { id: 'a', chapterId: 'one' }, {})
  const second = nodeReadKey('bridges', { id: 'b', chapterId: 'one' }, {})
  storage.setItem('model-router:gal-story:v1', 'story')
  const written = writeSeenNodes(storage, [first, first, second, null, 'unsafe', '[]', '["a","c","","n",1]'])
  assert.deepEqual([...written], [first, second])
  assert.deepEqual([...readSeenNodes(storage)], [first, second])
  assert.equal(storage.getItem('model-router:gal-story:v1'), 'story')
  assert.equal(JSON.parse(storage.getItem(GAL_READ_KEY)).version, 1)
})

test('seen-node cap keeps the most recent 10000 entries', () => {
  const storage = memoryStorage()
  const keys = Array.from({ length: 10004 }, (_, index) => nodeReadKey('bridges', { id: `line-${index}`, chapterId: 'one' }, {}))
  const written = writeSeenNodes(storage, new Set(keys))
  assert.equal(written.size, 10000)
  assert.equal(written.has(keys[0]), false)
  assert.equal(written.has(keys[3]), false)
  assert.equal(written.has(keys[4]), true)
  assert.equal(written.has(keys.at(-1)), true)
  assert.deepEqual(readSeenNodes(storage), written)
})

test('seen-node reads fail closed and storage failures never touch story saves', () => {
  const storage = memoryStorage()
  for (const raw of ['{bad', '[]', '{"version":2,"keys":[]}', '{"version":1,"keys":{}}']) {
    storage.setItem(GAL_READ_KEY, raw)
    assert.equal(readSeenNodes(storage).size, 0)
    assert.equal(storage.getItem(GAL_READ_KEY), raw)
  }
  assert.equal(readSeenNodes(null).size, 0)
  assert.equal(readSeenNodes({ getItem() { throw new Error('blocked') } }).size, 0)
  assert.throws(() => writeSeenNodes(null, new Set()), /剧情存档不会受影响/)
  assert.throws(() => writeSeenNodes({ setItem() { throw new Error('quota') } }, []), /本地存储不可用/)
})
test('full-body source is the default and half-body expressions require an explicit preference', () => {
  assert.equal(normalizeGalPreferences(null).portraits.source, 'full-body')
  assert.equal(normalizeGalPreferences({ portraits: { source: 'expressions' } }).portraits.source, 'expressions')
  assert.equal(normalizeGalPreferences({ portraits: { source: 'unknown' } }).portraits.source, 'full-body')
  const storage = memoryStorage()
  writeGalPreferences(storage, { portraits: { source: 'expressions' } })
  assert.equal(readGalPreferences(storage).portraits.source, 'expressions')
})
