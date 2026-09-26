import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STORY_EPISODES,
  STORY_CHARACTERS,
  getStoryEpisode,
  createStory,
  currentStoryNode,
  advanceStory,
  storyHistory,
} from '../.dsh-plugin/shared/gal-story-catalog.mjs'
import {
  STORY_STORAGE_KEY,
  episodeStorageKey,
  readStory,
  writeStory,
  readStorySlots,
} from '../.dsh-plugin/client/gal-story-storage.mjs'

function fakeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

test('both episodes expose a playable first node through the shared engine', () => {
  for (const episode of STORY_EPISODES) {
    const story = createStory(episode.id)
    const node = currentStoryNode(story)
    assert.equal(node.chapterId, story.chapterId)
    assert.ok(typeof node.text === 'string' && node.text.length > 0, `${episode.id} first node has text`)
    assert.ok(node.speaker, `${episode.id} first node has a speaker`)
    const advanced = advanceStory(story, null)
    assert.notEqual(advanced.nodeId, story.nodeId, `${episode.id} advances without choices`)
  }
})

test('story characters roster covers the displayed cast', () => {
  assert.ok(STORY_CHARACTERS.harness, 'DeepSeek Harness has a display name')
  assert.ok(STORY_CHARACTERS.kimi, 'Kimi has a display name')
  assert.ok(getStoryEpisode(createStory('bridges')).id === 'bridges')
  assert.ok(getStoryEpisode(createStory('legacy')).id === 'legacy')
})

test('story saves round-trip through episode-scoped storage keys', () => {
  const storage = fakeStorage()
  const bridgesKey = episodeStorageKey(STORY_STORAGE_KEY, 'bridges')
  const original = createStory('bridges')
  const progressed = advanceStory(original, null)
  writeStory(storage, bridgesKey, progressed, 'bridges')
  const restored = readStory(storage, bridgesKey, 'bridges')
  assert.equal(restored.nodeId, progressed.nodeId)
  assert.equal(restored.chapterId, progressed.chapterId)
  // Episode validation keeps saves from leaking across episodes.
  assert.throws(() => readStory(storage, bridgesKey, 'legacy'))
})

test('manual save slots validate episode and report empty slots', () => {
  const storage = fakeStorage()
  assert.deepEqual(readStorySlots(storage, STORY_STORAGE_KEY, 'bridges'), [null, null, null])
  const state = advanceStory(createStory('bridges'), null)
  storage.setItem(`${STORY_STORAGE_KEY}:slots`, JSON.stringify([
    { state: JSON.parse(JSON.stringify(state)), savedAt: '2026-09-26 12:00' },
  ]))
  const slots = readStorySlots(storage, STORY_STORAGE_KEY, 'bridges')
  assert.equal(slots[0].savedAt, '2026-09-26 12:00')
  assert.equal(slots[1], null)
  // A save from another episode degrades to an invalid slot instead of loading.
  const foreign = readStorySlots(storage, STORY_STORAGE_KEY, 'legacy')
  assert.equal(foreign[0].invalid, true)
})

test('story history replays the walked path with player choices', () => {
  const original = createStory('bridges')
  const first = currentStoryNode(original)
  if (first.choices?.length) {
    const progressed = advanceStory(original, first.choices[0].id)
    const history = storyHistory(progressed)
    assert.ok(history.length >= 3, 'history includes nodes and the choice line')
    assert.equal(history.some(entry => entry.speaker === 'player'), true)
  }
})
