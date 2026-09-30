import { normalizeCharacterKey, CHARACTER_LABELS } from './character-identity.mjs'
import { ECHO_EMOTIONS } from '../shared/gal-story-echocity.mjs'

export function stageCharactersFor(node, history = []) {
  if (!node) return []
  const normalize = value => {
    if (typeof value === 'string') return { speaker: normalizeCharacterKey(value), emotion: 'neutral' }
    return {
      speaker: normalizeCharacterKey(value.speaker ?? value.key),
      emotion: value.emotion ?? ECHO_EMOTIONS[value.mood] ?? value.mood ?? 'neutral',
    }
  }
  const explicit = Array.isArray(node.stageCharacters) ? node.stageCharacters
    : Array.isArray(node.cast) && node.cast.length > 0 ? node.cast : null
  if (explicit) {
    const unique = new Map()
    for (const value of explicit) {
      const actor = normalize(value)
      if (CHARACTER_LABELS[actor.speaker]) unique.set(actor.speaker, actor)
    }
    const actors = [...unique.values()]
    const current = normalizeCharacterKey(node.speaker)
    const currentIndex = actors.findIndex(actor => actor.speaker === current)
    if (currentIndex > 0) actors.unshift(actors.splice(currentIndex, 1)[0])
    else if (currentIndex < 0 && actors.length > 0 && CHARACTER_LABELS[current]) {
      actors.unshift({ speaker: current, emotion: node.emotion || 'neutral' })
    }
    return actors.slice(0, 2)
  }
  const actors = []
  const add = line => {
    const actor = normalize(line)
    if (CHARACTER_LABELS[actor.speaker] && !actors.some(item => item.speaker === actor.speaker)) actors.push(actor)
  }
  add(node)
  for (let index = history.length - 1; index >= 0 && actors.length < 2; index -= 1) {
    const line = history[index]
    if (node.sceneId && line.sceneId ? line.sceneId !== node.sceneId : line.location !== node.location || line.time !== node.time) break
    add(line)
  }
  return actors.slice(0, 2)
}
