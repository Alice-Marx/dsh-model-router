import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fnv1a } from './characters.js'
import { makeEyePainter, PORTRAIT_RIGS, PORTRAIT_SIZE } from './model-portrait-eyes.js'
import { makePortraitArt } from './model-portrait-art.js'

// Poses are displacements at the neck in source pixels and degrees.
const states = {
  idle:      { pose: [0, 0, 0], clips: ['glance', 'tilt'], interval: [4200, 7100] },
  thinking:  { pose: [-.23, -.7, -1.8], eyes: [.28, -.46, .06], clips: ['ponder', 'glance'], interval: [2400, 3900] },
  searching: { pose: [0, -.45, 0], clips: ['scan', 'glance'], interval: [2050, 3100] },
  working:   { pose: [0, .65, .25], eyes: [0, .21, .09], clips: ['nod', 'focus'], interval: [2400, 3700] },
  sending:   { pose: [.4, -.1, .85], eyes: [.18, -.1, 0], clips: ['send', 'nod'], interval: [2400, 3700] },
  orbit:     { pose: [0, -.2, .5], clips: ['scan', 'tilt'], interval: [2800, 4600] },
  waiting:   { pose: [0, .4, -.75], eyes: [0, .10, .06], clips: ['tilt', 'glance'], interval: [4400, 6800] },
  alert:     { pose: [0, -.8, 2.2], clips: ['listen'], interval: null },
  done:      { pose: [0, 0, 0], clips: ['settle'], interval: null },
}

// The torso follows a delayed, lower-amplitude version of the neck curve.
// The springs carry momentum through points and across gesture changes.
const clips = {
  glance:  { duration: 1010, head: [[.33, 1.3, -.35, 2.6], [.65, .85, -.12, 1.8]],
    eyes: [[.15, .73, -.17, 0], [.55, .64, -.13, 0], [.85, 0, 0, 0]] },
  tilt:    { duration: 1340, head: [[.34, .44, .25, 2.6], [.68, .28, .15, 1.6]],
    eyes: [[.2, .34, .14, .08], [.57, .24, .10, .09]] },
  ponder:  { duration: 1390, head: [[.36, .2, -1.7, 1.8], [.67, .3, -.9, 1.35]],
    eyes: [[.22, .2, -.45, .06], [.68, .19, -.33, .05]] },
  scan:    { duration: 1390, head: [[.24, -1.2, -.33, -2.8], [.65, 1.45, -.25, 3.2], [.81, .7, .05, 1.35]],
    eyes: [[.13, -.93, .07, .05], [.32, -.68, .04, .04], [.47, .92, -.05, .03], [.74, .72, -.02, .03]] },
  nod:     { duration: 780, head: [[.23, 0, -.74, .15], [.52, .21, 3.4, .9], [.78, .05, .46, .24]] },
  focus:   { duration: 940, head: [[.39, .2, 1.2, .85], [.65, .1, .95, .42]],
    eyes: [[.2, 0, .23, .12], [.64, 0, .18, .10]] },
  send:    { duration: 850, head: [[.21, -.66, .27, -.92], [.51, 1.25, -1, 2.7], [.72, .8, -.45, 1.8]],
    eyes: [[.13, -.2, .12, .04], [.37, .61, -.21, 0], [.61, .49, -.13, 0]] },
  listen:  { duration: 940, head: [[.36, .34, -1.7, 1.7], [.7, .2, -.56, .87]],
    eyes: [[.18, .44, -.25, 0], [.6, .33, -.2, 0]] },
  settle:  { duration: 900, head: [[.35, 0, 1.5, .26], [.65, 0, -.39, -.14]], blink: .25 },
  greet:   { duration: 1180, head: [[.17, -.15, .82, -.85], [.46, .95, -3, 4.8],
    [.69, .65, -1.45, 3.2], [.89, .06, .33, -.25]],
    eyes: [[.12, 0, .22, .07], [.38, .27, -.29, 0], [.69, .23, -.2, 0]], blink: .15 },
  bow:     { duration: 1200, head: [[.19, -.15, -1.05, -.48], [.48, .58, 4.6, 1.94],
    [.7, .25, 2.3, 1.1], [.89, .06, -.43, -.13]],
    eyes: [[.14, 0, -.18, 0], [.46, .12, .38, .08], [.67, .07, .23, .06]], blink: .33 },
  peek:    { duration: 1230, head: [[.21, -.55, .35, -1.55], [.51, 2.1, -1.15, 5.05],
    [.72, 1.28, -.5, 3.6], [.91, -.12, .03, -.41]],
    eyes: [[.14, -.29, .12, .05], [.37, .83, -.17, 0], [.64, .59, -.11, 0]], blink: .19 },
  perk:    { duration: 1110, head: [[.17, .08, 1.3, -.2], [.4, .49, -3.8, 3.65],
    [.66, .36, -1.46, 2.28], [.89, -.03, .27, -.22]],
    eyes: [[.13, 0, .27, .08], [.34, .27, -.49, 0], [.59, .22, -.38, 0]], blink: .11 },
}

const reducedQuery = '(prefers-reduced-motion: reduce)'
const listeners = new Set()
let stopWatchingMotion

function motionSetting() {
  if (typeof document === 'undefined' || document.hidden || window.matchMedia?.(reducedQuery).matches) return 'off'
  return document.body?.dataset.btMotion ?? 'normal'
}

function watchMotion(listener) {
  listeners.add(listener)
  if (!stopWatchingMotion) {
    const publish = () => { for (const callback of listeners) callback() }
    const media = window.matchMedia?.(reducedQuery)
    const theme = new MutationObserver(publish)
    theme.observe(document.body, { attributes: true, attributeFilter: ['data-bt-motion'] })
    media?.addEventListener?.('change', publish)
    document.addEventListener('visibilitychange', publish)
    stopWatchingMotion = () => {
      theme.disconnect()
      media?.removeEventListener?.('change', publish)
      document.removeEventListener('visibilitychange', publish)
      stopWatchingMotion = undefined
    }
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopWatchingMotion?.()
  }
}

const intersections = new Map()
let viewportObserver
function watchViewport(node, onChange) {
  if (typeof IntersectionObserver !== 'function') { onChange(true); return undefined }
  viewportObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) intersections.get(entry.target)?.(entry.isIntersecting)
  })
  intersections.set(node, onChange)
  viewportObserver.observe(node)
  return () => {
    viewportObserver.unobserve(node)
    intersections.delete(node)
    if (intersections.size === 0) { viewportObserver.disconnect(); viewportObserver = undefined }
  }
}

const clamp = value => Math.max(-1, Math.min(1, value))
const unit = value => Math.max(0, Math.min(1, value))
const smooth = value => value * value * (3 - 2 * value)
const zero = [0, 0, 0]
const origin = [0, ...zero]
const end = [1, ...zero]

function cueAt(points, progress) {
  if (!points || progress <= 0 || progress >= 1) return zero
  const next = points.findIndex(([offset]) => offset >= progress)
  const from = points[next < 0 ? points.length - 1 : next - 1] ?? origin
  const to = points[next] ?? end
  const mix = (progress - from[0]) / (to[0] - from[0])
  return zero.map((_, index) => from[index + 1] + (to[index + 1] - from[index + 1]) * mix)
}

function spring() {
  const value = zero.slice(), velocity = zero.slice()
  return {
    value,
    step(target, dt, rate) {
      const decay = Math.exp(-rate * dt)
      let moving = false
      for (let i = 0; i < value.length; i++) {
        const distance = value[i] - target[i]
        const speed = velocity[i] + rate * distance
        value[i] = target[i] + (distance + speed * dt) * decay
        velocity[i] = (velocity[i] - rate * speed * dt) * decay
        if (Math.abs(value[i] - target[i]) > .003 || Math.abs(velocity[i]) > .035) moving = true
        else { value[i] = target[i]; velocity[i] = 0 }
      }
      return moving
    },
  }
}

const blinkAt = progress => smooth(unit(Math.min(progress / .34, (1 - progress) / .62)))

function createPortraitTrack({ art, canvas, image, rig, pace, strength, phase, compact, expressive }) {
  const paintArt = makePortraitArt(art, image, canvas, rig, compact)
  const head = spring(), torso = spring(), eyes = spring()
  const breath = expressive && !compact
  let painter, frame, lastFrame, lastPaint, cue, blinkStart, pointer, wasBusy
  let base = states.idle, direction = 1
  const blinkDuration = 186 * Math.min(pace, 1.16)
  const draw = time => {
    frame = undefined
    const dt = lastFrame === undefined ? .016 : Math.min(.065, Math.max(.001, (time - lastFrame) / 1000))
    lastFrame = time
    const progress = cue ? (time - cue.start) / cue.duration : 1.2
    const [px, py] = pointer ?? zero
    const [bx, by, br] = base.pose
    const side = cue?.side ?? 1
    const [hx, hy, hr] = cueAt(cue?.clip.head, progress)
    const [tx, ty, tr] = cueAt(cue?.clip.head, (progress - .08) / 1.12)
    const movingHead = head.step([(bx * direction + hx * side + px * 1.15) * strength,
      (by + hy + py * 1.65) * strength, (br * direction + hr * side + px * 1.8) * strength], dt, 22 / pace)
    const movingTorso = torso.step([(bx * direction + tx * side + px * .63) * strength * .37,
      (by + ty) * strength * .60 + py * .30, (br * direction + tr * side + px * 1.2) * strength * .39], dt, 12 / pace)
    let movingEyes = false
    if (expressive) {
      const [ex, ey, lid] = base.eyes ?? zero
      const [cueX, cueY, cueLid] = cueAt(cue?.clip.eyes, progress)
      const weight = pointer ? .29 : 1
      movingEyes = eyes.step([clamp(px * .97 + (ex * direction + cueX * side) * weight),
        clamp(py * .97 + (ey + cueY) * weight), unit(lid + cueLid)], dt, pointer ? 39 : 30)
    }
    const blinkOffset = cue?.clip.blink
    const cueBlink = blinkOffset === undefined ? Infinity : (time - cue.start - cue.duration * blinkOffset) / blinkDuration
    const idleBlink = blinkStart === undefined ? Infinity : (time - blinkStart) / blinkDuration
    const busy = !!cue || blinkStart !== undefined || movingHead || movingTorso || movingEyes
    if (busy || wasBusy || lastPaint === undefined || (breath && time - lastPaint >= 32)) {
      const [x, y, lid] = eyes.value
      const left = expressive ? Math.max(lid, blinkAt(idleBlink), blinkAt(cueBlink)) : 0
      const right = expressive ? Math.max(lid, blinkAt(idleBlink - .027), blinkAt(cueBlink - .027)) : 0
      if (x || y || left || right) painter ??= makeEyePainter(canvas, image, rig)
      painter?.(x, y, left, right)
      const inhale = breath ? Math.sin(time / (720 * pace) + phase * 2 * Math.PI) : 0
      const [a, b, c] = head.value, [d, e, f] = torso.value
      paintArt([a, b - inhale * .09, c], [d, e + inhale * .85, f + inhale * .12])
      lastPaint = time
    }
    wasBusy = busy
    if (progress >= 1.2) cue = undefined
    if (idleBlink >= 1.03) blinkStart = undefined
    if (busy || breath) queue()
    else lastFrame = undefined
  }
  function queue() {
    if (frame === undefined) frame = requestAnimationFrame(draw)
  }
  const load = () => { lastPaint = undefined; queue() }
  image.addEventListener('load', load)
  return {
    point(position) { pointer = position; queue() },
    pose(motion, side) { base = motion; direction = side; queue() },
    play(clip, side) { cue = clip && { clip, side, start: performance.now(), duration: clip.duration * pace }; queue() },
    blink() { blinkStart = performance.now(); queue() },
    stop() {
      image.removeEventListener('load', load)
      if (frame !== undefined) cancelAnimationFrame(frame)
      painter?.(0, 0, 0, 0)
      art.hidden = true
    },
  }
}

export function ModelPortrait({ entry, botId, state, size, gaze, pokeable, onError }) {
  const root = useRef(null), picture = useRef(null), eyelids = useRef(null), art = useRef(null)
  const driver = useRef(null), currentState = useRef(state)
  const setting = useSyncExternalStore(watchMotion, motionSetting, () => 'off')
  const [visible, setVisible] = useState(false)
  useEffect(() => watchViewport(root.current, setVisible), [])
  const active = visible && setting !== 'off'
  const canInteract = active && setting !== 'quiet'
  const rig = PORTRAIT_RIGS[entry.id]
  const compact = size <= 44
  const strength = (compact ? .82 : 1) * (setting === 'quiet' ? .58 : 1)
  const phase = (fnv1a(`${botId}:${entry.id}`) % 1000) / 1000

  useEffect(() => {
    currentState.current = state
    driver.current?.setState(state)
  }, [state])
  useEffect(() => {
    if (!gaze) driver.current?.point()
  }, [gaze])

  useEffect(() => {
    if (!active || !rig) return undefined
    const initialSide = phase < .5 ? -1 : 1
    let timer, blinkTimer, lastClip, state, pointing, side = initialSide
    const pace = rig.pace * (compact ? 1.13 : 1) * (setting === 'lively' ? .92 : 1)
    const track = createPortraitTrack({ art: art.current, canvas: eyelids.current, image: picture.current,
      rig, pace, strength, phase, compact, expressive: canInteract })
    const play = clip => {
      track.play(clip, side)
      side = -side
    }
    const schedule = (fraction = Math.random(), first = false) => {
      const motion = states[state]
      if (!canInteract || !motion.interval) return
      const [low, high] = motion.interval
      const span = first && state === 'idle' && !compact ? 2200 + 1400 * fraction : low + (high - low) * fraction
      const delay = span * pace * (setting === 'lively' && state === 'idle' ? .76 : 1)
      timer = setTimeout(() => {
        if (!pointing || state !== 'idle') {
          const choices = motion.clips.filter(name => name !== lastClip)
          lastClip = choices[Math.floor(Math.random() * choices.length)]
          play(clips[lastClip])
        }
        schedule()
      }, delay)
    }
    const scheduleBlink = fraction => {
      const delay = (2850 + 3050 * fraction) * pace * (setting === 'lively' ? .82 : 1)
      blinkTimer = setTimeout(() => { track.blink(); scheduleBlink(Math.random()) }, delay)
    }
    const setState = next => {
      const name = Object.hasOwn(states, next) ? next : 'idle'
      if (state === name) return
      state = name
      clearTimeout(timer)
      const motion = states[state]
      track.pose(motion, initialSide)
      lastClip = state === 'idle' ? undefined : motion.clips[0]
      track.play(clips[lastClip], initialSide)
      schedule(phase, true)
    }
    driver.current = {
      setState,
      point(position) {
        pointing = !!position
        track.point(position)
      },
      greet() {
        clearTimeout(timer)
        clearTimeout(blinkTimer)
        scheduleBlink(.32 + Math.random() * .68)
        play(clips[rig.greeting])
        schedule()
      },
    }
    setState(currentState.current)
    if (canInteract) scheduleBlink(phase)
    return () => {
      driver.current = null
      clearTimeout(timer)
      clearTimeout(blinkTimer)
      track.stop()
    }
  }, [active, canInteract, compact, phase, rig, setting, strength])

  const pointAt = event => {
    if (event.pointerType === 'touch') return
    const box = event.currentTarget.getBoundingClientRect()
    const x = clamp((event.clientX - box.left) / box.width * 2 - 1)
    const y = clamp((event.clientY - box.top) / box.height * 2 - 1)
    const radius = Math.max(1, Math.hypot(x, y))
    driver.current?.point([x / radius, y / radius])
  }
  const clearPoint = () => driver.current?.point()
  return h('span', {
    ref: root, className: 'bt-model-portrait', 'data-portrait': entry.id,
    style: { backgroundColor: rig?.backdrop },
    'data-portrait-motion': active ? setting : undefined,
    'data-portrait-breathing': canInteract && !compact ? '' : undefined,
    onPointerMove: canInteract && gaze ? pointAt : undefined,
    onPointerLeave: canInteract && gaze ? clearPoint : undefined,
    onPointerCancel: canInteract && gaze ? clearPoint : undefined,
    onClick: canInteract && pokeable ? () => driver.current?.greet() : undefined,
  }, h('img', { ref: picture, src: entry.image, alt: '', draggable: false, onError }),
    h('canvas', { ref: eyelids, className: 'bt-portrait-eyes', width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, hidden: true }),
    h('canvas', { ref: art, className: 'bt-portrait-art', width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, hidden: true }))
}

export const MODEL_PORTRAIT_CSS = `
.bt-model-portrait{display:block;position:relative;width:100%;height:100%;overflow:hidden;border-radius:50%;isolation:isolate}
.bt-model-portrait img,.bt-model-portrait canvas{position:absolute;inset:0;width:100%;height:100%}
.bt-model-portrait canvas{pointer-events:none}
@media(prefers-reduced-motion:reduce){.bt-model-portrait canvas{display:none!important}}
`
