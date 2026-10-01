import { normalizeStory, getStoryEpisode, currentStoryNode } from '../shared/gal-story-catalog.mjs'
import { STORY_STORAGE_KEY, storySlotsKey } from './gal-story-storage.mjs'

const LIMIT = 2 * 1024 * 1024
const quickKey = episodeId => `${STORY_STORAGE_KEY}:quick:${episodeId}`
function validate(state, episodeId) {
  const normalized = normalizeStory(state)
  if (episodeId && getStoryEpisode(normalized)?.id !== episodeId) throw new Error('存档属于另一部剧目，请先切换剧目。')
  return normalized
}
export function exportStorySave(state) {
  const normalized = validate(state)
  return JSON.stringify({ format: 'model-router-gal-story', version: 1, exportedAt: new Date().toISOString(), episodeId: getStoryEpisode(normalized).id, state: normalized }, null, 2)
}
export function importStorySave(source, expectedEpisodeId) {
  if (typeof source !== 'string' || source.length > LIMIT || new TextEncoder().encode(source).length > LIMIT) throw new Error('存档文件过大，最多支持 2 MB。')
  let raw
  try { raw = JSON.parse(source) } catch { throw new Error('存档不是有效的 JSON 文件。') }
  if (raw?.format !== undefined) {
    if (raw.format !== 'model-router-gal-story' || raw.version !== 1) throw new Error('不支持此存档格式或版本。')
    const state = validate(raw.state, expectedEpisodeId)
    if (raw.episodeId !== getStoryEpisode(state).id) throw new Error('存档剧目标识与内容不一致。')
    return state
  }
  return validate(raw, expectedEpisodeId)
}
export function saveQuickStory(storage, episodeId, state) {
  if (!storage) throw new Error('本地存储不可用，请导出存档备份。')
  try { storage.setItem(quickKey(episodeId), exportStorySave(validate(state, episodeId))) }
  catch (error) { throw new Error(`快捷存档失败：${error.message}`) }
}
export function loadQuickStory(storage, episodeId) {
  let source
  try { source = storage?.getItem(quickKey(episodeId)) } catch { throw new Error('本地存储无法读取，请导入存档备份。') }
  if (!source) throw new Error('本剧目还没有快捷存档。')
  return importStorySave(source, episodeId)
}
export function saveManualStorySlot(storage, episodeId, index, state) {
  if (!Number.isInteger(index) || index < 0 || index > 2) throw new Error('存档槽编号无效。')
  if (!storage) throw new Error('本地存储不可用，请导出存档备份。')
  const key = `${storySlotsKey(STORY_STORAGE_KEY, episodeId)}:slots`
  let slots
  try { slots = JSON.parse(storage.getItem(key) || '[]') } catch { throw new Error('原存档槽数据损坏，已保留；请先导出当前剧情。') }
  if (!Array.isArray(slots)) throw new Error('原存档槽数据格式错误，已保留。')
  slots[index] = { state: validate(state, episodeId), savedAt: new Date().toLocaleString() }
  try { storage.setItem(key, JSON.stringify(slots)) } catch { throw new Error('存档槽保存失败，本地空间不足或存储权限受限，请导出备份。') }
}
export function getStorySaveMeta(state) {
  const normalized = validate(state)
  const node = currentStoryNode(normalized)
  const episode = getStoryEpisode(normalized)
  return { episodeId: episode.id, title: episode.title, chapterId: normalized.chapterId, nodeId: normalized.nodeId, location: node.location ?? '', text: String(node.text ?? '').slice(0, 70) }
}
