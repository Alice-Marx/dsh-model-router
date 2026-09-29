import { createStory, normalizeStory, getStoryEpisode, STORY_EPISODES } from '../shared/gal-story-catalog.mjs'

export const STORY_STORAGE_KEY = 'model-router:gal-story:v1'
export const storyStorageKey = freeKey => freeKey === 'model-router:gal-game:v1' ? STORY_STORAGE_KEY : `${freeKey}:story`
export const episodeStorageKey = (baseKey, episodeId) => {
  if (episodeId === 'legacy') return baseKey
  if (STORY_EPISODES.some(episode => episode.id === episodeId)) return `${baseKey}:episode:${episodeId}`
  throw new Error('未知的剧情剧目。')
}

// The first two episodes originally shared three manual slots. Keep that key
// readable and reserve independent slots for the new story.
export const storySlotsKey = (baseKey, episodeId) => episodeId === 'echo-city'
  ? episodeStorageKey(baseKey, episodeId)
  : baseKey

export function selectedStoryEpisode(storage, baseKey = STORY_STORAGE_KEY) {
  const selected = storage?.getItem(`${baseKey}:episode`)
  if (STORY_EPISODES.some(episode => episode.id === selected)) return selected
  return storage?.getItem(baseKey) ? 'legacy' : 'bridges'
}

function validateEpisode(state, episodeId) {
  if (episodeId && getStoryEpisode(state).id !== episodeId) throw new Error('存档属于另一部剧目，请先切换剧目再导入。')
  return state
}

export function readStory(storage, key = STORY_STORAGE_KEY, episodeId = null) {
  const source = storage?.getItem(key)
  if (!source) return createStory(episodeId || 'legacy')
  try { return validateEpisode(normalizeStory(JSON.parse(source)), episodeId) }
  catch { throw new Error('剧情存档无法读取，原存档已保留。可导入备份或重新开始。') }
}

export function writeStory(storage, key, state, episodeId = null) {
  if (!storage) throw new Error('浏览器存储不可用，请导出剧情存档。')
  storage.setItem(key, JSON.stringify(validateEpisode(normalizeStory(state), episodeId)))
}

export function readStorySlots(storage, key = STORY_STORAGE_KEY, episodeId = null) {
  const raw = JSON.parse(storage?.getItem(`${key}:slots`) || '[]')
  if (!Array.isArray(raw)) throw new Error('剧情手动存档无法读取。')
  return Array.from({ length: 3 }, (_, index) => {
    const slot = raw[index]
    if (!slot) return null
    try { return { state: validateEpisode(normalizeStory(slot.state), episodeId), savedAt: typeof slot.savedAt === 'string' ? slot.savedAt : '' } }
    catch { return { invalid: true } }
  })
}
