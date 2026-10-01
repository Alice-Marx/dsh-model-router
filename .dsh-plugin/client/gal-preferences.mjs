import { CHARACTER_LABELS, normalizeCharacterKey } from './character-identity.mjs'
import { MINIMAX_STORY_SCORES } from './gal-story-score-data.mjs'

export const GAL_PREFERENCES_KEY = 'model-router:gal-preferences:v1'
export const GAL_READ_KEY = 'model-router:gal-read:v1'
const MAX_SEEN_NODES = 10_000
// A valid 1000-character JSON key may double in length when serialized again.
// Keep the read limit above the maximum payload our capped writer can produce.
const MAX_READ_SOURCE = 21_000_000
const MUSIC_THEMES = new Set(['auto', 'local', ...Object.keys(MINIMAX_STORY_SCORES)])
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export const DEFAULT_GAL_PREFERENCES = Object.freeze({
  version: 1,
  portraits: Object.freeze({
    source: 'full-body',
    main: Object.freeze({ scale: 100, x: 73, y: 5 }),
    companion: Object.freeze({ scale: 100, x: 23, y: 5 }),
    characters: Object.freeze({}),
  }),
  audio: Object.freeze({ enabled: false, muted: false, musicVolume: 35, effectsVolume: 40, theme: 'auto', pauseWhenHidden: true }),
  reading: Object.freeze({ textSpeed: 24, fontSize: 17, autoDelay: 1600, skipUnread: false, reduceMotion: false, dialogueOpacity: 85 }),
})

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value : {}
}

// Read data properties only: imported objects cannot inject getters or inherited
// values into the persisted settings, even when a caller bypasses JSON.parse.
function own(value, key) {
  return Object.getOwnPropertyDescriptor(record(value), key)?.value
}

function number(value, fallback, min, max, integer = false) {
  const numeric = typeof value === 'number' ? value
    : typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : NaN
  if (!Number.isFinite(numeric)) return fallback
  const clamped = Math.max(min, Math.min(max, numeric))
  return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function layout(value, fallback) {
  return {
    scale: number(own(value, 'scale'), fallback.scale, 40, 180),
    x: number(own(value, 'x'), fallback.x, 0, 100),
    y: number(own(value, 'y'), fallback.y, -30, 50),
  }
}

function characterKey(value) {
  if (typeof value !== 'string' || value.length > 80 || FORBIDDEN_KEYS.has(value)) return null
  const key = normalizeCharacterKey(value)
  return typeof key === 'string' && !FORBIDDEN_KEYS.has(key) && Object.hasOwn(CHARACTER_LABELS, key) ? key : null
}

/** Return a fresh, bounded settings object containing only known fields. */
export function normalizeGalPreferences(value) {
  const version = own(value, 'version')
  const source = version === undefined || version === 1 ? record(value) : {}
  const portraits = own(source, 'portraits')
  const main = layout(own(portraits, 'main'), DEFAULT_GAL_PREFERENCES.portraits.main)
  const companion = layout(own(portraits, 'companion'), DEFAULT_GAL_PREFERENCES.portraits.companion)
  const characters = {}
  const overrides = record(own(portraits, 'characters'))
  // The whitelist also caps the number of overrides to the shipped roster.
  for (const rawKey of Object.keys(overrides).slice(0, 200)) {
    const key = characterKey(rawKey)
    const rawLayout = own(overrides, rawKey)
    if (!key || !rawLayout || typeof rawLayout !== 'object' || Array.isArray(rawLayout)) continue
    // An explicit character override is a complete, role-independent layout.
    characters[key] = layout(rawLayout, main)
  }
  const audio = own(source, 'audio')
  const reading = own(source, 'reading')
  const theme = own(audio, 'theme')
  return {
    version: 1,
    portraits: { source: own(portraits, 'source') === 'expressions' ? 'expressions' : 'full-body', main, companion, characters },
    audio: {
      enabled: boolean(own(audio, 'enabled'), false),
      muted: boolean(own(audio, 'muted'), false),
      musicVolume: number(own(audio, 'musicVolume'), 35, 0, 100, true),
      effectsVolume: number(own(audio, 'effectsVolume'), 40, 0, 100, true),
      theme: typeof theme === 'string' && MUSIC_THEMES.has(theme) ? theme : 'auto',
      pauseWhenHidden: boolean(own(audio, 'pauseWhenHidden'), true),
    },
    reading: {
      textSpeed: number(own(reading, 'textSpeed'), 24, 0, 120, true),
      fontSize: number(own(reading, 'fontSize'), 17, 12, 32, true),
      autoDelay: number(own(reading, 'autoDelay'), 1600, 300, 10_000, true),
      skipUnread: boolean(own(reading, 'skipUnread'), false),
      reduceMotion: boolean(own(reading, 'reduceMotion'), false),
      dialogueOpacity: number(own(reading, 'dialogueOpacity'), 85, 20, 100, true),
    },
  }
}

/** Corrupt or blocked storage falls back without erasing the original data. */
export function readGalPreferences(storage) {
  try {
    const source = storage?.getItem(GAL_PREFERENCES_KEY)
    if (typeof source !== 'string' || !source || source.length > 100_000) return normalizeGalPreferences(null)
    return normalizeGalPreferences(JSON.parse(source))
  } catch { return normalizeGalPreferences(null) }
}

/** A failed save remains usable in memory; the caller can show this error. */
export function writeGalPreferences(storage, value) {
  const normalized = normalizeGalPreferences(value)
  try {
    if (typeof storage?.setItem !== 'function') throw new Error('unavailable')
    storage.setItem(GAL_PREFERENCES_KEY, JSON.stringify(normalized))
  } catch {
    throw new Error('Gal 设置无法保存：本地存储不可用或空间不足。本次调整仍可使用，请检查存储权限后重试。')
  }
  return normalized
}

export function portraitLayoutFor(settings, speaker, companion = false) {
  const normalized = normalizeGalPreferences(settings)
  const key = characterKey(speaker)
  return key && Object.hasOwn(normalized.portraits.characters, key)
    ? { ...normalized.portraits.characters[key] }
    : { ...normalized.portraits[companion ? 'companion' : 'main'] }
}

export function portraitStyleFor(settings, speaker, companion = false) {
  const { scale, x, y } = portraitLayoutFor(settings, speaker, companion)
  return {
    height: `${Math.round((companion ? 72 : 78) * scale) / 100}%`,
    left: `${x}%`,
    bottom: `${y}%`,
    transform: 'translateX(-50%)',
    maxWidth: 'none',
    objectFit: 'contain',
  }
}

function scopePart(value, fallback = '') {
  return typeof value === 'string' && value.length <= 160 && !/[\u0000-\u001f]/.test(value) ? value : fallback
}

/** A chapter/route-scoped key prevents reused node IDs counting as read. */
export function nodeReadKey(episodeId, node, story) {
  const episode = scopePart(episodeId)
  const nodeId = scopePart(own(node, 'id')) || scopePart(own(story, 'nodeId'))
  if (!episode || !nodeId) return ''
  const chapterId = scopePart(own(node, 'chapterId')) || scopePart(own(story, 'chapterId')) || 'legacy'
  const routeId = scopePart(own(node, 'routeId')) || scopePart(own(story, 'routeId'))
  return JSON.stringify([episode, chapterId, routeId, nodeId])
}

function validReadKey(value) {
  if (typeof value !== 'string' || value.length > 1000) return false
  try {
    const scope = JSON.parse(value)
    return Array.isArray(scope) && scope.length === 4 && Boolean(scope[0]) && Boolean(scope[1]) && Boolean(scope[3])
      && scope.every(part => typeof part === 'string' && part.length <= 160 && !/[\u0000-\u001f]/.test(part))
      && JSON.stringify(scope) === value
  } catch { return false }
}

function normalizeSeenNodes(value) {
  const keys = value instanceof Set ? value : Array.isArray(value) ? value : []
  const normalized = new Set()
  // Keep the newest items when the cap is exceeded; duplicate entries do not
  // consume capacity and malformed imported keys never become read chapters.
  for (const key of keys) {
    if (!validReadKey(key)) continue
    normalized.delete(key)
    normalized.add(key)
    if (normalized.size > MAX_SEEN_NODES) normalized.delete(normalized.values().next().value)
  }
  return normalized
}

export function readSeenNodes(storage) {
  try {
    const source = storage?.getItem(GAL_READ_KEY)
    if (typeof source !== 'string' || !source || source.length > MAX_READ_SOURCE) return new Set()
    const raw = JSON.parse(source)
    return own(raw, 'version') === 1 ? normalizeSeenNodes(own(raw, 'keys')) : new Set()
  } catch { return new Set() }
}

export function writeSeenNodes(storage, value) {
  const keys = normalizeSeenNodes(value)
  try {
    if (typeof storage?.setItem !== 'function') throw new Error('unavailable')
    storage.setItem(GAL_READ_KEY, JSON.stringify({ version: 1, keys: [...keys] }))
  } catch {
    throw new Error('Gal 已读记录无法保存：本地存储不可用或空间不足。剧情存档不会受影响。')
  }
  return keys
}
