// Open eye bounds in each original 256×256 portrait, with the character's
// response to a tap and its timing.
export const PORTRAIT_RIGS = Object.freeze({
  chatgpt:    { eyes: [[81, 126, 122, 151], [141, 118, 176, 145]], greeting: 'bow', pace: 1.15, backdrop: '#eddffe' },
  claude:     { eyes: [[79, 116, 118, 143], [139, 109, 175, 138]], greeting: 'bow', pace: 1.06, backdrop: '#fff0e6' },
  deepseek:   { eyes: [[84, 119, 123, 149], [139, 113, 177, 144]], greeting: 'greet', pace: 0.91, backdrop: '#d6ecfd' },
  doubao:     { eyes: [[74, 113, 113, 141], [132, 105, 170, 134]], greeting: 'perk', pace: 0.88, backdrop: '#dffcfd' },
  ernie:      { eyes: [[81, 128, 120, 154], [139, 120, 175, 147]], greeting: 'bow', pace: 1.10, backdrop: '#dee9fe' },
  gemini:     { eyes: [[81, 127, 120, 155], [137, 120, 173, 150]], greeting: 'peek', pace: 0.95, backdrop: '#dfdefe' },
  glm:        { eyes: [[83, 126, 123, 154], [140, 119, 177, 148]], greeting: 'bow', pace: 1.12, backdrop: '#d7e2f9' },
  grok:       { eyes: [[86, 125, 125, 154], [139, 117, 174, 146]], greeting: 'peek', pace: 0.86, backdrop: '#fff0e4' },
  hunyuan:    { eyes: [[80, 111, 118, 140], [140, 103, 175, 134]], greeting: 'bow', pace: 1.14, backdrop: '#dbeefe' },
  jev:        { eyes: [[81, 119, 118, 144], [138, 109, 175, 136]], greeting: 'peek', pace: 1.08, backdrop: '#f5e7f4', skinSample: [[117, 141]] },
  kimi:       { eyes: [[82, 119, 120, 147], [140, 112, 178, 140]], greeting: 'greet', pace: 1.03, backdrop: '#e2e9fb' },
  llama:      { eyes: [[85, 128, 125, 153], [140, 119, 177, 145]], greeting: 'bow', pace: 1.17, backdrop: '#fef8f5' },
  mimo:       { eyes: [[80, 131, 120, 157], [134, 129, 174, 155]], greeting: 'perk', pace: 0.95, backdrop: '#fef6f0' },
  minimax:    { eyes: [[79, 121, 120, 157], [138, 115, 177, 148]], greeting: 'perk', pace: 0.88, backdrop: '#fee5e2' },
  mistral:    { eyes: [[82, 127, 125, 153], [140, 119, 177, 147]], greeting: 'greet', pace: 0.97, backdrop: '#ffeadb' },
  perplexity: { eyes: [[83, 121, 120, 151], [138, 116, 173, 145]], greeting: 'peek', pace: 1.12, backdrop: '#e1fbf4' },
  qwen:       { eyes: [[82, 119, 121, 146], [140, 111, 178, 140]], greeting: 'peek', pace: 1.06, backdrop: '#ebdefe' },
  rwkv:       { eyes: [[81, 129, 122, 157], [138, 120, 174, 148]], greeting: 'greet', pace: 1.00, backdrop: '#ebe0fd' },
  stepfun:    { eyes: [[83, 115, 123, 144], [138, 108, 176, 136]], greeting: 'perk', pace: 0.95, backdrop: '#d0eafe' },
})

export const PORTRAIT_SIZE = 256
const patchesByRig = new WeakMap()
const smoothstep = t => t * t * (3 - 2 * t)
const unit = value => Math.max(0, Math.min(1, value))

function palette(source, width, height, top, bottom) {
  const sample = (x, y) => {
    const i = (y * width + x) * 4
    return [source[i], source[i + 1], source[i + 2]]
  }
  const light = ([r, g, b]) => r * .3 + g * .59 + b * .11
  const skin = [], lashes = []
  for (let x = Math.floor(width * .34); x < width * .7; x += 2) {
    for (let y = bottom + 2; y < height - 1; y += 2) skin.push(sample(x, y))
    for (let y = top; y < top + 7; y += 2) lashes.push(sample(x, y))
  }
  skin.sort((a, b) => light(a) - light(b))
  lashes.sort((a, b) => light(a) - light(b))
  return { skin: skin[Math.floor(skin.length * .7)], lash: lashes[Math.floor(lashes.length * .16)] }
}

function eyePatches(image, rig) {
  if (patchesByRig.has(rig)) return patchesByRig.get(rig)
  const scratch = document.createElement('canvas')
  scratch.width = scratch.height = PORTRAIT_SIZE
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  // Follow the line between the centers of the two eyes as the lids close.
  const [[leftX, leftTop, leftEnd, leftBottom], [rightX, rightTop, rightEnd, rightBottom]] = rig.eyes
  const slant = (rightTop + rightBottom - leftTop - leftBottom) / (rightX + rightEnd - leftX - leftEnd)
  const patches = rig.eyes.map(([left, top, right, bottom], index) => {
    const x = left - 4, y = top - 3, width = right - left + 8, height = bottom - top + 12
    const upper = top - y, lower = bottom - y
    const source = ctx.getImageData(x, y, width, height).data
    const colors = palette(source, width, height, upper, lower)
    const sample = rig.skinSample?.[index]
    if (sample) colors.skin = ctx.getImageData(...sample, 1, 1).data
    return { x, y, top: upper, bottom: lower, width, height, slant, source, ...colors }
  })
  patchesByRig.set(rig, patches)
  return patches
}

// Reveal a narrow eyelid inside the marked eye as the visible eye contracts.
// The feathered boundary leaves surrounding hair and features undisturbed.
function paintEye({ width, height, top, bottom, slant, source, skin, lash }, frame, amount) {
  frame.set(source)
  const half = (width - 1) / 2
  for (let x = 0; x < width; x++) {
    const edge = Math.abs((x - half) / half)
    const arc = Math.sqrt(1 - edge * edge)
    const slope = (x - half) * slant
    const start = top + slope + (1 - arc) * (bottom - top) * .38
    const end = bottom + slope - (1 - arc) * (bottom - top) * .50
    const hinge = start + (end - start) * .62
    const upper = start + (hinge - start) * amount
    const lower = end + (hinge + 1.8 * arc - end) * amount
    const side = smoothstep(unit((1 - edge) * 8))
    for (let y = Math.max(0, Math.floor(start - 3)); y <= Math.min(height - 1, Math.ceil(end + 3)); y++) {
      const feather = side * smoothstep(unit(Math.min((y - start + 3) / 3, (end + 3 - y) / 3)))
      const index = (y * width + x) * 4
      const line = unit((1.4 - Math.abs(y - hinge)) / .8) * unit((amount - .72) / .28) * side
      let eyeOffset = -1
      if (y >= upper && y <= lower) {
        const row = Math.round(start + (end - start) * (y - upper) / Math.max(1, lower - upper))
        eyeOffset = (row * width + x) * 4
      }
      const blend = feather * unit(amount * 4)
      for (let channel = 0; channel < 3; channel++) {
        const color = eyeOffset === -1 ? skin[channel] : source[eyeOffset + channel]
        const sample = color * (1 - line) + lash[channel] * line
        frame[index + channel] = source[index + channel] * (1 - blend) + sample * blend
      }
    }
  }
}

export function makeBlinkPainter(canvas, image, rig) {
  if (!image?.complete || image.naturalWidth !== PORTRAIT_SIZE || image.naturalHeight !== PORTRAIT_SIZE) return null
  const ctx = canvas?.getContext('2d')
  const patches = ctx && eyePatches(image, rig)
  if (!patches) return null
  ctx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE)
  const frames = patches.map(({ width, height }) => ctx.createImageData(width, height))
  return amount => {
    canvas.hidden = amount === 0
    if (canvas.hidden) return
    for (const [index, patch] of patches.entries()) {
      paintEye(patch, frames[index].data, amount)
      ctx.putImageData(frames[index], patch.x, patch.y)
    }
  }
}
