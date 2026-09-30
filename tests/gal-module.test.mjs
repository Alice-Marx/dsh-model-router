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


test('echo-chronicle plays the full journey through every route', async () => {
  const echo = await import('../.dsh-plugin/shared/gal-story-echocity.mjs')
  const catalog = await import('../.dsh-plugin/shared/gal-story-catalog.mjs')
  assert.equal(echo.storyGraphIssues().length, 0)
  const episode = catalog.STORY_EPISODES.find(item => item.id === 'echo-chronicle')
  assert.ok(episode, 'echo-chronicle registered in catalog')
  const play = (story, pick) => {
    let state = story
    let hops = 0
    while (hops < 400) {
      const node = catalog.currentStoryNode(state)
      if (node.ending) break
      if (node.input) state = catalog.advanceStory(state, '__input__:衔雪')
      else if (node.choices) state = catalog.advanceStory(state, pick(node, state))
      else state = catalog.advanceStory(state, null)
      hops += 1
    }
    return { state, hops }
  }
  let state = catalog.createStory('echo-chronicle')
  assert.equal(state.version, 5)
  const pick = node => ({
    'petition-01': 'c', 'note-03': 'a', 'stele-01': 'a', 'diary-01': 'b', 'follow-01': 'a',
  })[node.id] ?? node.choices[0].id
  const common = play(state, pick)
  state = common.state
  assert.equal(state.flags.flag_recite_names, true)
  assert.equal(state.flags.flag_transcribe_light, true)
  assert.equal(state.flags.flag_x4_count, 2)
  const chapters = catalog.storyChapterStates(state)
  assert.equal(chapters.find(item => item.id === 'hidden-harness').locked, true, 'hidden locked before DeepSeek route')
  for (const chapterId of ['route-deepseek', 'route-chatgpt', 'route-claude', 'route-llama', 'route-grok', 'route-rwkv', 'hidden-harness', 'true-end']) {
    state = catalog.switchStoryChapter(state, chapterId)
    assert.ok(state, `${chapterId} switch supported`)
    const run = play(state, node => node.choices[0].id)
    state = run.state
  }
  const finale = catalog.currentStoryNode(state)
  assert.match(finale.ending?.title ?? '', /回声之城/)
  assert.equal(state.flags.hidden_true, true)
  assert.equal(state.flags.harness_name, '衔雪')
  const loaded = catalog.normalizeStory(JSON.parse(JSON.stringify(state)))
  assert.equal(loaded.nodeId, state.nodeId)
  const affinity = catalog.storyAffinityPanel(state)
  assert.ok(affinity.length >= 14)
  assert.ok(affinity[0].value >= affinity[1].value)
})

test('spring compiles with bridged acts and reaches the finale choice', async () => {
  const catalog = await import('../.dsh-plugin/shared/gal-story-catalog.mjs')
  const spring = await import('../.dsh-plugin/shared/gal-story-spring.mjs')
  assert.ok(spring.STORY_CHAPTERS.length === 12, 'spring has all 12 chapters')
  let state = catalog.createStory('echo-spring')
  let hops = 0
  while (hops < 400) {
    const node = catalog.currentStoryNode(state)
    if (node.ending || node.choices) break
    state = catalog.advanceStory(state, null)
    hops += 1
  }
  assert.ok(hops > 0, 'spring plays from s01')
})

function walkSpring(spring, initial, choose, stopAt = node => Boolean(node.ending)) {
  let state = initial
  for (let hops = 0; hops < spring.STORY_STATS.nodes + 10; hops += 1) {
    const node = spring.currentStoryNode(state)
    if (stopAt(node)) return state
    state = spring.advanceStory(state, node.choices ? choose(node) : null)
  }
  throw new Error('Spring path did not reach its requested node.')
}

test('spring true ending requires authored evidence, consent and two completed side routes', async () => {
  const spring = await import('../.dsh-plugin/shared/gal-story-spring.mjs')
  const choose = node => {
    if (node.id === 's01a-008') return 's01-evidence-dual'
    if (node.id === 's04a-004') return 's04-consent-ask'
    if (node.id === 'r01-visit' || node.id === 'r02-visit') return 'visit'
    if (/^r\d+-visit$/.test(node.id)) return 'skip'
    return node.choices[0].id
  }
  const atFinale = walkSpring(spring, spring.createStory(), choose, node => node.id === 'spring-final-choice')
  assert.equal(atFinale.flags.evidence, 'dual')
  assert.equal(atFinale.flags.consent, 'ask')
  assert.equal(atFinale.flags.relay, 'distributed')
  assert.equal(atFinale.flags.anchor, 'shared')
  assert.equal(atFinale.flags.side_r01, true)
  assert.equal(atFinale.flags.side_r02, true)
  assert.equal(spring.trueEndingReady(atFinale.flags), true)
  const completed = walkSpring(spring, spring.advanceStory(atFinale, 'coauthor'), choose)
  assert.equal(spring.currentStoryNode(completed).ending.id, 'letters')
  const loaded = spring.normalizeStory(JSON.parse(JSON.stringify(completed)))
  assert.equal(loaded.nodeId, completed.nodeId)
})

test('spring coauthor choice keeps a reachable ordinary ending when a prerequisite is missing', async () => {
  const spring = await import('../.dsh-plugin/shared/gal-story-spring.mjs')
  const choose = node => {
    if (node.id === 's01a-008') return 's01-evidence-summary'
    if (node.id === 's04a-004') return 's04-consent-ask'
    if (node.id === 'r01-visit' || node.id === 'r02-visit') return 'visit'
    if (/^r\d+-visit$/.test(node.id)) return 'skip'
    return node.choices[0].id
  }
  const atFinale = walkSpring(spring, spring.createStory(), choose, node => node.id === 'spring-final-choice')
  assert.equal(atFinale.flags.evidence, 'summary')
  assert.equal(spring.trueEndingReady(atFinale.flags), false)
  const completed = walkSpring(spring, spring.advanceStory(atFinale, 'coauthor'), choose)
  assert.equal(spring.currentStoryNode(completed).ending.id, 'lamps')
  assert.throws(() => spring.normalizeStory({ ...JSON.parse(JSON.stringify(completed)), flags: { ...completed.flags, evidence: 'dual' } }), /存档条件与重放轨迹不一致/)
})

test('spring revision 1 saves replay through former dialogue nodes without inventing new flags', async () => {
  const spring = await import('../.dsh-plugin/shared/gal-story-spring.mjs')
  let state = walkSpring(spring, spring.createStory(), node => node.choices[0].id, node => node.id === 's01a-008')
  state = spring.normalizeStory({ ...JSON.parse(JSON.stringify(state)), contentRevision: 1 })
  state = spring.advanceStory(state, null)
  assert.equal(state.nodeId, 's01a-009')
  assert.equal(state.flags.evidence, undefined)
  state = walkSpring(spring, state, node => /^r\d+-visit$/.test(node.id) ? 'skip' : node.choices[0].id, node => node.id === 's04a-004')
  state = spring.advanceStory(state, null)
  assert.equal(state.nodeId, 's04a-005')
  assert.equal(state.flags.consent, undefined)
  const restored = spring.normalizeStory(JSON.parse(JSON.stringify(state)))
  assert.equal(restored.nodeId, state.nodeId)
  assert.equal(restored.contentRevision, 1)
  assert.equal(spring.trueEndingReady(restored.flags), false)
  assert.throws(() => spring.advanceStory(spring.createStory(), 's01-evidence-dual'))
  const freshChoice = walkSpring(spring, spring.createStory(), node => node.choices[0].id, node => node.id === 's01a-008')
  assert.throws(() => spring.advanceStory(freshChoice, null), /请从当前选项中选择/)
})
