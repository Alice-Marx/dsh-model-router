/**
 * Built-in GAL character roster. Images are bundled as data URLs by esbuild,
 * so an installed plugin never depends on the developer's absolute paths.
 */
import chatgpt from '../../aipicture/ChatGPT1.png'
import claude from '../../aipicture/Claude1.png'
import claudeSpecial from '../../aipicture/Claude.png'
import harness from '../../aipicture/DeepSeek_Harness1.png'
import deepseek from '../../aipicture/DeepSeek1.png'
import doubao from '../../aipicture/Doubao1.png'
import ernie from '../../aipicture/ernie1.png'
import gemini from '../../aipicture/Gemini1.png'
import glm from '../../aipicture/GLM1.png'
import grok from '../../aipicture/Grok1.png'
import kimi from '../../aipicture/Kimi1.png'
import mimo from '../../aipicture/Mimo1.png'
import minimax from '../../aipicture/Minmax1.png'
import opencode from '../../aipicture/opencode1.png'
import qwen from '../../aipicture/Qwen1.png'
import huggingface from '../../aipicture/huggingface.webp'
import llama from '../../aipicture/llama.webp'
import rwkv from '../../aipicture/rwkv.webp'
import perplexity from '../../aipicture/perplexity.webp'
import github from '../../aipicture/github.webp'
import gitlab from '../../aipicture/gitlab.webp'
import gitee from '../../aipicture/gitee.webp'
import cloudflare from '../../aipicture/cloudflare.webp'
import zcode from '../../aipicture/Zcode.png'
import { CHARACTER_LABELS, characterKeyForModel, normalizeCharacterKey } from './character-identity.mjs'
import { SPRING_ORIGINALS } from './gal-spring-portraits.mjs'

export { CHARACTER_LABELS, characterKeyForModel } from './character-identity.mjs'

export const CHARACTER_IMAGES = Object.freeze({
  harness,
  chatgpt,
  claude,
  deepseek,
  doubao,
  ernie,
  gemini,
  glm,
  grok,
  kimi,
  mimo,
  minimax,
  opencode,
  qwen,
  huggingface, llama, rwkv, perplexity, github, gitlab, gitee, cloudflare, zcode,
  hy: SPRING_ORIGINALS.hy, comfyui: SPRING_ORIGINALS.comfyui,
  novelai: SPRING_ORIGINALS.novelai, gptimage: SPRING_ORIGINALS.gptimage,
})

export const hasCharacterImage = key => Boolean(CHARACTER_IMAGES[normalizeCharacterKey(key)])
export const characterImageFor = key => CHARACTER_IMAGES[normalizeCharacterKey(key)] || null

export const CHARACTER_VARIANTS = Object.freeze({
  claude: Object.freeze({ default: claude, special: claudeSpecial }),
})

export function characterForModel(model, provider = '') {
  const key = characterKeyForModel(model, provider)
  return {
    key,
    name: String(model ?? '').trim() || CHARACTER_LABELS[key],
    label: CHARACTER_LABELS[key],
    dataUrl: CHARACTER_IMAGES[key] ?? CHARACTER_IMAGES.harness,
  }
}
