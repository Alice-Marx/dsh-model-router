import { normalizeCharacterKey, CHARACTER_LABELS } from './character-identity.mjs'

export function stageCharactersFor(node, history = []) {
  if (!node) return []
  const normalize = value => typeof value === 'string' ? { speaker: normalizeCharacterKey(value), emotion: 'neutral' }
    : { speaker: normalizeCharacterKey(value.speaker), emotion: value.emotion || 'neutral' }
  if (Array.isArray(node.stageCharacters)) {
    const unique = new Map()
    for (const value of node.stageCharacters) {
      const actor = normalize(value)
      if (CHARACTER_LABELS[actor.speaker]) unique.set(actor.speaker, actor)
    }
    return [...unique.values()].slice(0, 2)
  }
  const actors = []
  const add = line => {
    const speaker = normalizeCharacterKey(line.speaker)
    if (CHARACTER_LABELS[speaker] && !actors.some(actor => actor.speaker === speaker)) actors.push({ speaker, emotion: line.emotion || 'neutral' })
  }
  add(node)
  for (let index = history.length - 1; index >= 0 && actors.length < 2; index -= 1) {
    const line = history[index]
    if (node.sceneId && line.sceneId ? line.sceneId !== node.sceneId : line.location !== node.location || line.time !== node.time) break
    add(line)
  }
  return actors
}
