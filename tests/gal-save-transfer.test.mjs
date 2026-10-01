import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STORY_EPISODES,
  createStory,
  currentStoryNode,
  advanceStory,
  normalizeStory,
  getStoryEpisode,
} from '../.dsh-plugin/shared/gal-story-catalog.mjs'
import { STORY_STORAGE_KEY, storySlotsKey, readStorySlots } from '../.dsh-plugin/client/gal-story-storage.mjs'
import {
  exportStorySave,
  importStorySave,
  saveQuickStory,
  loadQuickStory,
  saveManualStorySlot,
  getStorySaveMeta,
} from '../.dsh-plugin/client/gal-save-transfer.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
function memoryStorage() {
  const data = new Map()
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) }
}
function progressedStory(episodeId) {
  let state = createStory(episodeId)
  for (let index = 0; index < 4; index += 1) {
    const node = currentStoryNode(state)
    if (node.ending || node.input) break
    state = advanceStory(state, node.choices?.[0]?.id ?? null)
  }
  return state
}

test('JSON exports and imports preserve the exact replayed path of all five episodes', () => {
  assert.equal(STORY_EPISODES.length, 5)
  for (const episode of STORY_EPISODES) {
    const state = progressedStory(episode.id)
    const source = exportStorySave(state)
    const envelope = JSON.parse(source)
    assert.equal(envelope.format, 'model-router-gal-story')
    assert.equal(envelope.version, 1)
    assert.equal(envelope.episodeId, episode.id)
    assert.equal(Number.isFinite(Date.parse(envelope.exportedAt)), true)
    assert.deepEqual(importStorySave(source, episode.id), state, `${episode.id} round-trip keeps state`)
    assert.deepEqual(importStorySave(source), state, `${episode.id} can identify its own episode`)
    assert.deepEqual(currentStoryNode(importStorySave(source)), currentStoryNode(state))
  }
})

test('legacy raw-state JSON remains importable for every supported engine version', () => {
  for (const episode of STORY_EPISODES) {
    const state = progressedStory(episode.id)
    const original = JSON.stringify(state)
    assert.deepEqual(importStorySave(original, episode.id), state)
    assert.equal(getStoryEpisode(importStorySave(original)).id, episode.id)
    assert.equal(JSON.stringify(state), original, 'import does not mutate its source state')
  }
})

test('invalid JSON, unsupported envelopes and oversized sources fail explicitly', () => {
  assert.throws(() => importStorySave('{broken'), /有效的 JSON/)
  for (const source of [null, 1, {}, 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    assert.throws(() => importStorySave(source), /存档文件过大/)
  }
  const state = clone(createStory('bridges'))
  for (const envelope of [
    { format: 'foreign-game', version: 1, episodeId: 'bridges', state },
    { format: 'model-router-gal-story', version: 2, episodeId: 'bridges', state },
    { format: 'model-router-gal-story', version: '1', episodeId: 'bridges', state },
  ]) {
    assert.throws(() => importStorySave(JSON.stringify(envelope)), /不支持此存档格式或版本/)
  }
  for (const damaged of [null, [], {}, { kind: 'model-router-gal-game', version: 1 }]) {
    assert.throws(() => importStorySave(JSON.stringify(damaged)))
  }
})

test('import limit counts UTF-8 bytes so oversized Chinese data cannot bypass the 2 MB cap', () => {
  const source = JSON.stringify({ padding: '春'.repeat(800_000) })
  assert.ok(source.length < 2 * 1024 * 1024)
  assert.ok(new TextEncoder().encode(source).length > 2 * 1024 * 1024)
  assert.throws(() => importStorySave(source), /存档文件过大/)
  const valid = JSON.stringify(createStory('bridges'))
  const boundary = valid + ' '.repeat(2 * 1024 * 1024 - new TextEncoder().encode(valid).length)
  assert.equal(new TextEncoder().encode(boundary).length, 2 * 1024 * 1024)
  assert.deepEqual(importStorySave(boundary, 'bridges'), createStory('bridges'))
  assert.throws(() => importStorySave(`${boundary} `, 'bridges'), /存档文件过大/)
})

test('cross-episode import and forged envelope episode metadata are rejected', () => {
  const source = exportStorySave(progressedStory('bridges'))
  assert.throws(() => importStorySave(source, 'legacy'), /另一部剧目/)
  assert.throws(() => importStorySave(JSON.stringify(progressedStory('legacy')), 'bridges'), /另一部剧目/)
  const envelope = JSON.parse(source)
  envelope.episodeId = 'echo-city'
  assert.throws(() => importStorySave(JSON.stringify(envelope)), /剧目标识与内容不一致/)
  assert.throws(() => importStorySave(JSON.stringify({ ...envelope, episodeId: undefined })), /剧目标识与内容不一致/)
})

test('forged current nodes and noncontinuous replay trails cannot redirect an imported save', () => {
  for (const episode of STORY_EPISODES) {
    const state = clone(progressedStory(episode.id))
    const fakeNode = { ...state, nodeId: 'forged-true-ending' }
    assert.throws(() => importStorySave(JSON.stringify(fakeNode), episode.id), `${episode.id} forged current node is rejected`)
    assert.ok(state.trail.length > 0)
    const fakeTrail = clone(state)
    fakeTrail.trail[0].nodeId = 'not-the-authored-start'
    assert.throws(() => importStorySave(JSON.stringify(fakeTrail), episode.id), `${episode.id} forged trail is rejected`)
    const fakeChoice = clone(state)
    fakeChoice.trail[0].choiceId = 'fake-unlock-all-routes'
    assert.throws(() => importStorySave(JSON.stringify(fakeChoice), episode.id), `${episode.id} forged choice is rejected`)
  }
})

test('supplied flags and scores never replace authored replay results', () => {
  for (const episodeId of ['legacy', 'bridges', 'echo-chronicle']) {
    const state = progressedStory(episodeId)
    const raw = clone(state)
    raw.flags = { ...raw.flags, fakeUnlockAllRoutes: true, aff_claude: 999999 }
    raw.affection = 999999
    raw.axes = { safety: 999999 }
    const restored = importStorySave(JSON.stringify(raw), episodeId)
    assert.deepEqual(restored, normalizeStory(state), `${episodeId} metadata is rebuilt from the authored trail`)
    assert.equal(restored.flags.fakeUnlockAllRoutes, undefined)
  }
  for (const episodeId of ['echo-city', 'echo-spring']) {
    const raw = clone(progressedStory(episodeId))
    raw.flags.fakeUnlockAllRoutes = true
    assert.throws(() => importStorySave(JSON.stringify(raw), episodeId), `${episodeId} inconsistent flags are rejected`)
  }
})

test('quick saves are episode-scoped and independent of autosaves and all three manual slots', () => {
  const storage = memoryStorage()
  storage.setItem(STORY_STORAGE_KEY, 'existing-story-autosave')
  storage.setItem('model-router:gal-game:v1', 'existing-free-mode')
  const sharedSlots = JSON.stringify([
    { state: clone(createStory('legacy')), savedAt: 'old-1' },
    { state: clone(createStory('bridges')), savedAt: 'old-2' },
    null,
  ])
  storage.setItem(`${STORY_STORAGE_KEY}:slots`, sharedSlots)
  for (const episode of STORY_EPISODES) {
    const state = progressedStory(episode.id)
    saveQuickStory(storage, episode.id, state)
    assert.deepEqual(loadQuickStory(storage, episode.id), state)
  }
  assert.equal(storage.getItem(`${STORY_STORAGE_KEY}:slots`), sharedSlots)
  assert.equal(storage.getItem(STORY_STORAGE_KEY), 'existing-story-autosave')
  assert.equal(storage.getItem('model-router:gal-game:v1'), 'existing-free-mode')
  assert.equal([...storage.data.keys()].filter(key => key.startsWith(`${STORY_STORAGE_KEY}:quick:`)).length, 5)
})

test('quick save errors preserve the previous valid quick save', () => {
  const storage = memoryStorage()
  const state = progressedStory('bridges')
  assert.throws(() => loadQuickStory(storage, 'bridges'), /没有快捷存档/)
  saveQuickStory(storage, 'bridges', state)
  const before = new Map(storage.data)
  assert.throws(() => saveQuickStory(storage, 'bridges', createStory('legacy')), /另一部剧目/)
  assert.deepEqual(storage.data, before)
  const key = `${STORY_STORAGE_KEY}:quick:bridges`
  storage.setItem(key, '{broken')
  assert.throws(() => loadQuickStory(storage, 'bridges'), /有效的 JSON/)
  assert.equal(storage.getItem(key), '{broken')
  assert.throws(() => saveQuickStory(null, 'bridges', state), /本地存储不可用/)
  assert.throws(() => saveQuickStory({ setItem() { throw new Error('quota') } }, 'bridges', state), /快捷存档失败/)
  assert.throws(() => loadQuickStory({ getItem() { throw new Error('denied') } }, 'bridges'), /本地存储无法读取.*导入存档备份/)
})

test('manual saves keep the established shared legacy/bridges slots and untouched entries', () => {
  const storage = memoryStorage()
  const old = [
    { state: clone(createStory('legacy')), savedAt: 'retained-slot-1' },
    { state: clone(createStory('bridges')), savedAt: 'replaced-slot-2' },
    { state: clone(progressedStory('legacy')), savedAt: 'retained-slot-3' },
  ]
  const key = `${STORY_STORAGE_KEY}:slots`
  storage.setItem(key, JSON.stringify(old))
  const state = progressedStory('bridges')
  saveManualStorySlot(storage, 'bridges', 1, state)
  const after = JSON.parse(storage.getItem(key))
  assert.deepEqual(after[0], old[0])
  assert.deepEqual(after[2], old[2])
  assert.deepEqual(after[1].state, state)
  assert.ok(typeof after[1].savedAt === 'string' && after[1].savedAt.length > 0)
  assert.equal(readStorySlots(storage, STORY_STORAGE_KEY, 'bridges')[1].state.nodeId, state.nodeId)
  assert.equal(storage.data.size, 1, 'no migration or alternative slots key is introduced')
})

test('new episodes retain independent manual slot keys and keep other episodes intact', () => {
  const storage = memoryStorage()
  storage.setItem(`${STORY_STORAGE_KEY}:slots`, 'existing-shared-slots')
  for (const episodeId of ['echo-city', 'echo-spring', 'echo-chronicle']) {
    const state = progressedStory(episodeId)
    saveManualStorySlot(storage, episodeId, 2, state)
    const key = storySlotsKey(STORY_STORAGE_KEY, episodeId)
    assert.deepEqual(readStorySlots(storage, key, episodeId), [null, null, { state, savedAt: JSON.parse(storage.getItem(`${key}:slots`))[2].savedAt }])
  }
  assert.equal(storage.getItem(`${STORY_STORAGE_KEY}:slots`), 'existing-shared-slots')
  assert.equal(storage.data.size, 4)
})

test('corrupt manual slot data remains byte-identical and is never silently cleared', () => {
  const storage = memoryStorage()
  const key = `${STORY_STORAGE_KEY}:slots`
  for (const source of ['{broken', '{}', 'null', '42', '"wrong type"']) {
    storage.setItem(key, source)
    assert.throws(() => saveManualStorySlot(storage, 'bridges', 0, createStory('bridges')), /已保留/)
    assert.equal(storage.getItem(key), source)
  }
})

test('invalid slot indices are rejected before storage is read or changed', () => {
  const storage = {
    getItem() { assert.fail('invalid index must not read storage') },
    setItem() { assert.fail('invalid index must not write storage') },
  }
  for (const index of [-1, 3, 0.5, NaN, Infinity, '1', null, undefined]) {
    assert.throws(() => saveManualStorySlot(storage, 'bridges', index, createStory('bridges')), /槽编号无效/)
  }
})

test('manual slot failures and cross-episode state never overwrite stored slots', () => {
  const storage = memoryStorage()
  const key = `${STORY_STORAGE_KEY}:slots`
  const previous = JSON.stringify([{ state: clone(createStory('bridges')), savedAt: 'old' }])
  storage.setItem(key, previous)
  assert.throws(() => saveManualStorySlot(storage, 'bridges', 0, createStory('legacy')), /另一部剧目/)
  assert.equal(storage.getItem(key), previous)
  assert.throws(() => saveManualStorySlot(null, 'bridges', 0, createStory('bridges')), /本地存储不可用/)
  assert.throws(() => saveManualStorySlot({ getItem() { throw new Error('denied') }, setItem() { assert.fail('no write after denied read') } }, 'bridges', 0, createStory('bridges')), /已保留.*导出/)
  assert.throws(() => saveManualStorySlot({ getItem() { return '[]' }, setItem() { throw new Error('quota') } }, 'bridges', 0, createStory('bridges')), /存档槽保存失败.*空间不足.*导出备份/)
})

test('save metadata comes from the normalized live node and uses a short text preview', () => {
  for (const episode of STORY_EPISODES) {
    const state = progressedStory(episode.id)
    const node = currentStoryNode(state)
    const meta = getStorySaveMeta(state)
    assert.equal(meta.episodeId, episode.id)
    assert.equal(meta.title, episode.title)
    assert.equal(meta.chapterId, state.chapterId)
    assert.equal(meta.nodeId, node.id)
    assert.equal(meta.location, node.location ?? '')
    assert.equal(meta.text, String(node.text ?? '').slice(0, 70))
    assert.ok(meta.text.length <= 70)
    assert.deepEqual(Object.keys(meta).sort(), ['chapterId', 'episodeId', 'location', 'nodeId', 'text', 'title'])
  }
  assert.throws(() => getStorySaveMeta({ version: 99 }))
})
