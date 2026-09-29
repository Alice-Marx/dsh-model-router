import * as legacy from './gal-story.mjs'
import * as bridges from './gal-story-v2.mjs'
import * as echoCity from './gal-story-echo.mjs'
import * as spring from './gal-story-spring.mjs'
import * as echoChronicle from './gal-story-echocity.mjs'

export const STORY_EPISODES = Object.freeze([
  Object.freeze({ id: 'bridges', title: '未写完的约定：千桥协议', label: '千桥协议', description: '八章主线 · 六种制度结局 · 二十二条角色支线与独立关系承诺', chapters: bridges.STORY_CHAPTERS }),
  Object.freeze({ id: 'legacy', title: legacy.STORY_TITLE, label: '旧城迁移篇', description: '第一版完整故事 · 旧城迁移与 DeepSeek 的约定', chapters: [] }),
  Object.freeze({ id: 'echo-city', title: echoCity.STORY_TITLE, label: '雪灯来信', description: echoCity.STORY_DESCRIPTION, chapters: echoCity.STORY_CHAPTERS }),
  Object.freeze({ id: 'echo-spring', title: spring.STORY_TITLE, label: '未寄出的春天', description: spring.STORY_DESCRIPTION, chapters: spring.STORY_CHAPTERS }),
  Object.freeze({ id: 'echo-chronicle', title: echoChronicle.STORY_TITLE, label: '回声之城·正篇', description: echoChronicle.STORY_DESCRIPTION, chapters: echoChronicle.STORY_CHAPTERS }),
])
// Keep the established names in the older episodes; the new story adds only
// names that are not already part of the shared roster.
export const STORY_CHARACTERS = Object.freeze({ ...spring.STORY_CHARACTERS, ...echoChronicle.STORY_CHARACTERS, ...echoCity.STORY_CHARACTERS, ...legacy.STORY_CHARACTERS, ...bridges.STORY_CHARACTERS })
export const STORY_SIDE_ROUTES = bridges.STORY_SIDE_ROUTES
export const STORY_MUSIC_THEMES = bridges.STORY_MUSIC_THEMES
export function getStoryEpisode(state) {
  const episodeId = { 1: 'legacy', 2: 'bridges', 3: 'echo-city', 4: 'echo-spring', 5: 'echo-chronicle' }[state?.version]
  return STORY_EPISODES.find(episode => episode.id === episodeId)
}
function engine(raw) {
  if (raw?.version === 2) return bridges
  if (raw?.version === 1) return legacy
  if (raw?.version === 3) return echoCity
  if (raw?.version === 4) return spring
  if (raw?.version === 5) return echoChronicle
  throw new Error('不支持的剧情存档版本。')
}
export function createStory(episodeId = 'bridges', options = {}) {
  if (episodeId === 'bridges') return bridges.createStory(options)
  if (episodeId === 'legacy') return legacy.createStory()
  if (episodeId === 'echo-city') return echoCity.createStory(options)
  if (episodeId === 'echo-spring') return spring.createStory(options)
  if (episodeId === 'echo-chronicle') return echoChronicle.createStory(options)
  throw new Error('这部剧目尚未开放。')
}
export const normalizeStory = raw => engine(raw).normalizeStory(raw)
export const currentStoryNode = raw => engine(raw).currentStoryNode(raw)
export const advanceStory = (raw, choiceId = null) => engine(raw).advanceStory(raw, choiceId)
export const storyHistory = raw => engine(raw).storyHistory(raw)

/** 章节切换（仅支持显式实现的剧目；返回 null 表示该剧目不支持）。 */
export function switchStoryChapter(raw, chapterId) {
  const module = engine(raw)
  return typeof module.switchChapter === 'function' ? module.switchChapter(raw, chapterId) : null
}

/** 章节锁与完成态（含解锁提示；不支持的剧目返回空数组）。 */
export function storyChapterStates(raw) {
  const module = engine(raw)
  return typeof module.chapterStates === 'function' ? module.chapterStates(raw) : []
}

/** 好感度面板数据（不支持的剧目返回空数组）。 */
export function storyAffinityPanel(raw) {
  const module = engine(raw)
  return typeof module.storyAffinities === 'function' ? module.storyAffinities(raw) : []
}
