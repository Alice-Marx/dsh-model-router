// Eye bounds and hand-placed neck anchors are in the original 256×256 portrait.
export const PORTRAIT_RIGS = Object.freeze({
  chatgpt:    { eyes: [[81, 126, 122, 151], [141, 118, 176, 145]], neck: 184, greeting: 'bow', pace: 1.15, backdrop: '#eddffe' },
  claude:     { eyes: [[79, 116, 118, 143], [139, 109, 175, 138]], greeting: 'bow', pace: 1.06, backdrop: '#fff0e6' },
  deepseek:   { eyes: [[84, 119, 123, 149], [139, 113, 177, 144]], neck: 182, greeting: 'greet', pace: 0.91, backdrop: '#d6ecfd' },
  doubao:     { eyes: [[74, 113, 113, 141], [132, 105, 170, 134]], neck: 181, greeting: 'perk', pace: 0.88, backdrop: '#dffcfd' },
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
  qwen:       { eyes: [[82, 119, 121, 146], [140, 111, 178, 140]], neck: 174, greeting: 'peek', pace: 1.06, backdrop: '#ebdefe' },
  rwkv:       { eyes: [[81, 129, 122, 157], [138, 120, 174, 148]], greeting: 'greet', pace: 1.00, backdrop: '#ebe0fd' },
  stepfun:    { eyes: [[83, 115, 123, 144], [138, 108, 176, 136]], neck: 176, greeting: 'perk', pace: 0.95, backdrop: '#d0eafe' },
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

function eyeColumns({ width, top, bottom, slant }) {
  const half = (width - 1) / 2
  return Array.from({ length: width }, (_, x) => {
    const edge = Math.abs((x - half) / half)
    const arc = Math.sqrt(1 - edge * edge)
    const slope = (x - half) * slant
    const start = top + slope + (1 - arc) * (bottom - top) * .38
    const end = bottom + slope - (1 - arc) * (bottom - top) * .50
    return { start, end, arc, side: smoothstep(unit((1 - edge) * 8)) }
  })
}

// Move the texture inside the eye and anchor the corners and outline.
function shiftGaze({ width, height, source, columns }, frame, gazeX, gazeY) {
  frame.set(source)
  for (let x = 0; x < width; x++) {
    const { start, end, arc } = columns[x]
    for (let y = Math.max(0, Math.ceil(start)); y <= Math.min(height - 1, Math.floor(end)); y++) {
      const weight = arc * arc * smoothstep(unit(Math.min(y - start, end - y) / 7))
      const sx = Math.max(0, Math.min(width - 1.01, x - gazeX * weight * 5))
      const sy = Math.max(0, Math.min(height - 1.01, y - gazeY * weight * 3.4))
      const col = Math.floor(sx), row = Math.floor(sy), dx = sx - col, dy = sy - row
      const above = (row * width + col) * 4, below = above + width * 4
      const index = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const upper = source[above + channel] * (1 - dx) + source[above + 4 + channel] * dx
        const lower = source[below + channel] * (1 - dx) + source[below + 4 + channel] * dx
        frame[index + channel] = upper * (1 - dy) + lower * dy
      }
    }
  }
}

// Contract the eye around its current gaze position. Feather the eyelid into the illustration.
function closeEye({ width, height, columns, skin, lash }, source, frame, amount) {
  frame.set(source)
  for (let x = 0; x < width; x++) {
    const { start, end, arc, side } = columns[x]
    const hinge = start + (end - start) * .62
    const upper = start + (hinge - start) * amount
    const lower = end + (hinge + 1.8 * arc - end) * amount
    for (let y = Math.max(0, Math.floor(start - 3)); y <= Math.min(height - 1, Math.ceil(end + 3)); y++) {
      const feather = side * smoothstep(unit(Math.min((y - start + 3) / 3, (end + 3 - y) / 3)))
      const index = (y * width + x) * 4
      const line = unit((1.4 - Math.abs(y - hinge)) / .8) * unit((amount - .72) / .28) * side
      const visible = smoothstep(unit(Math.min(y - upper, lower - y) + .62))
      const sy = Math.max(0, Math.min(height - 1.01, start + (end - start) * unit((y - upper) / Math.max(1, lower - upper))))
      const row = Math.floor(sy), eyeOffset = (row * width + x) * 4
      const lowerOffset = eyeOffset + width * 4
      const blend = feather * smoothstep(unit(amount * 3.6))
      for (let channel = 0; channel < 3; channel++) {
        const upperColor = source[eyeOffset + channel]
        const eyeColor = upperColor + (source[lowerOffset + channel] - upperColor) * (sy - row)
        const color = skin[channel] + (eyeColor - skin[channel]) * visible
        const sample = color * (1 - line) + lash[channel] * line
        frame[index + channel] = source[index + channel] * (1 - blend) + sample * blend
      }
    }
  }
}

export function makeEyePainter(canvas, image, rig) {
  if (!image?.complete || image.naturalWidth !== PORTRAIT_SIZE || image.naturalHeight !== PORTRAIT_SIZE) return null
  const ctx = canvas?.getContext('2d')
  const patches = ctx && eyePatches(image, rig)
  if (!patches) return null
  ctx.clearRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE)
  const buffers = patches.map(patch => ({
    patch: { ...patch, columns: eyeColumns(patch) },
    frame: ctx.createImageData(patch.width, patch.height),
    shifted: new Uint8ClampedArray(patch.source.length),
  }))
  return (x, y, leftLid, rightLid) => {
    canvas.hidden = x === 0 && y === 0 && leftLid === 0 && rightLid === 0
    if (canvas.hidden) return
    for (const [index, { patch, frame, shifted }] of buffers.entries()) {
      const lid = index === 0 ? leftLid : rightLid
      let source = patch.source
      if (x || y) {
        shiftGaze(patch, shifted, x, y)
        source = shifted
      }
      if (lid) closeEye(patch, source, frame.data, lid)
      else frame.data.set(source)
      ctx.putImageData(frame, patch.x, patch.y)
    }
  }
}
