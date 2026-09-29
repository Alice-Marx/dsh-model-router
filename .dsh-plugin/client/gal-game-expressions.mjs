import neutral from '../../aipicture/DeepSeek1.png'
import happy from '../../output/imagegen/deepseek-happy.webp'
import shy from '../../output/imagegen/deepseek-shy.webp'
import sad from '../../output/imagegen/deepseek-sad.webp'
import angry from '../../output/imagegen/deepseek-angry.webp'
import thoughtful from '../../output/imagegen/deepseek-thoughtful.webp'
import { CHARACTER_IMAGES, CHARACTER_VARIANTS } from './characters.mjs'
import { normalizeCharacterKey } from './character-identity.mjs'
import { SPRING_PORTRAITS } from './gal-spring-portraits.mjs'

export const DEEPSEEK_EXPRESSIONS = Object.freeze({ neutral, happy, shy, sad, angry, thoughtful })
export const STORY_EMOTIONS = Object.freeze(['neutral', 'happy', 'shy', 'sad', 'angry', 'thoughtful', 'worried', 'determined', 'surprised', 'calm'])
export const STORY_EMOTION_LABELS = Object.freeze({
  neutral: '平静', happy: '微笑', shy: '羞涩', sad: '低落', angry: '生气', thoughtful: '思索', worried: '担忧', determined: '坚定', surprised: '惊讶', calm: '释然',
})

export function normalizeEmotion(emotion) {
  const key = String(emotion || 'neutral').toLowerCase()
  const aliases = { normal: 'neutral', smile: 'happy', smiling: 'happy', serious: 'determined', shock: 'surprised', blush: 'shy' }
  return aliases[key] || (STORY_EMOTIONS.includes(key) ? key : 'neutral')
}

/**
 * Six genuine expression sprites now exist for all 27 characters. Existing
 * DeepSeek extra moods remain available; additional mood synonyms resolve to
 * the closest authored expression, never a color filter.
 */
export function expressionFor(characterOrEmotion, requestedEmotion) {
  const legacyCall = requestedEmotion === undefined
  const character = legacyCall ? 'deepseek' : normalizeCharacterKey(characterOrEmotion)
  const emotion = normalizeEmotion(legacyCall ? characterOrEmotion : requestedEmotion)
  // Preserve the old one-argument contract for existing free-mode callers.
  if (!legacyCall && SPRING_PORTRAITS[character]) {
    const rasterMood = { angry: 'determined', thoughtful: 'neutral', worried: 'sad', calm: 'neutral' }[emotion] || emotion
    return SPRING_PORTRAITS[character][rasterMood] || SPRING_PORTRAITS[character].neutral
  }
  if (character === 'deepseek') return DEEPSEEK_EXPRESSIONS[emotion] || DEEPSEEK_EXPRESSIONS.neutral
  if (character === 'claude') return ['determined', 'angry', 'surprised'].includes(emotion)
    ? CHARACTER_VARIANTS.claude.special
    : CHARACTER_VARIANTS.claude.default
  return CHARACTER_IMAGES[character] || CHARACTER_IMAGES.harness
}

export function expressionClassFor(emotion) {
  return `gg-expression-${normalizeEmotion(emotion)}`
}

export function expressionLabelFor(emotion) {
  return STORY_EMOTION_LABELS[normalizeEmotion(emotion)]
}
