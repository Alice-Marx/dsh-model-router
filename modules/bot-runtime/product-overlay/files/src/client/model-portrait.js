import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fnv1a } from './characters.js'
import { makeBlinkPainter, PORTRAIT_RIGS, PORTRAIT_SIZE } from './model-portrait-eyes.js'

// A pose communicates the current state. Short gestures start and finish at
// that pose, and the eye track can blink independently of either.
const states = {
  idle:      { pose: [0, 0, 0], clips: ['breathe', 'glance', 'tilt'], interval: [3700, 6700] },
  thinking:  { pose: [0, -1.7, -4.5], clips: ['ponder', 'glance'], interval: [1700, 3000] },
  searching: { pose: [0, -0.6, 0], clips: ['scan', 'glance'], interval: [1150, 1850] },
  working:   { pose: [0, 1.2, 0], clips: ['nod', 'focus'], interval: [1300, 2200] },
  sending:   { pose: [0.7, 0, 2], clips: ['send', 'nod'], interval: [1400, 2350] },
  orbit:     { pose: [0, 0, 1], clips: ['scan', 'breathe'], interval: [2000, 3200] },
  waiting:   { pose: [0, 0.6, -1.5], clips: ['breathe', 'tilt'], interval: [3700, 5900] },
  alert:     { pose: [0, -0.8, 4], clips: ['listen'], interval: null },
  done:      { pose: [0, 0, 0], clips: ['settle'], interval: null },
}

// Each point contains time, x/y as a percentage of the portrait, roll, and the
// optional x/y scales. Repeated points hold the readable part of a gesture
// before it returns to the base pose.
const clips = {
  breathe: { duration: 1440, points: [[.4, 0, -1.7, 0, 1.008, 1.029], [.57, 0, -1.7, 0, 1.008, 1.029]] },
  glance:  { duration: 1180, points: [[.29, 3.1, -.8, 6], [.61, 3.1, -.8, 6]] },
  tilt:    { duration: 1240, points: [[.35, 1.2, -.8, 6.5], [.65, 1.2, -.8, 6.5]] },
  ponder:  { duration: 1240, points: [[.3, 0, -3, 3.5], [.72, 0, -3, 3.5]] },
  scan:    { duration: 1180, points: [[.18, -3.6, -.6, -7.5], [.37, -3.6, -.6, -7.5],
    [.61, 3.6, -.6, 7.5], [.8, 3.6, -.6, 7.5]] },
  nod:     { duration: 860, points: [[.2, 0, -1.1, 0, .99, 1.017],
    [.43, 0, 3.5, 0, 1.026, .952], [.56, 0, 3.5, 0, 1.026, .952], [.8, 0, -.8, 0, 1, 1.012]] },
  focus:   { duration: 940, points: [[.3, 0, 1.5, 0, 1.045, 1.045], [.62, 0, 1.5, 0, 1.045, 1.045]] },
  send:    { duration: 790, points: [[.2, -1.4, .3, -1.3], [.5, 3.9, -.7, 6.1], [.67, 3.9, -.7, 6.1]] },
  listen:  { duration: 790, points: [[.32, 0, -2.6, 3.6, 1.028, 1.038], [.59, 0, -2.6, 3.6, 1.028, 1.038]] },
  settle:  { duration: 790, points: [[.27, 0, 2.3, 0, 1.028, .958], [.55, 0, -.9, 0, .989, 1.02]] },
  greet:   { duration: 980, points: [[.17, 0, 2.1, -1.2, 1.029, .956],
    [.43, 1.2, -5, 7.6, .99, 1.059], [.61, 1.2, -5, 7.6, .99, 1.059],
    [.8, .15, 1.1, -.8, 1.014, .988]] },
  bow:     { duration: 1060, points: [[.19, 0, -1.8, -1.3, .993, 1.023],
    [.42, .6, 4.7, 3, 1.035, .942], [.64, .6, 4.7, 3, 1.035, .942],
    [.83, 0, -.9, 0, 1, 1.016]] },
  peek:    { duration: 1100, points: [[.23, -1.3, .5, -2.1],
    [.43, 3.5, -.9, 8.3], [.66, 3.5, -.9, 8.3]] },
  perk:    { duration: 940, points: [[.15, 0, 2.7, 0, 1.033, .95],
    [.38, .8, -4.8, 4.8, .988, 1.062], [.58, .8, -4.8, 4.8, .988, 1.062],
    [.81, 0, 1, -1, 1.016, .982]] },
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

const ease = 'cubic-bezier(.32,.04,.26,1)'
const clamp = value => Math.max(-1, Math.min(1, value))
function poseTransform([x, y, roll, sx = 1, sy = 1], strength, side = 1, zoom = 1) {
  return `translate(${x * strength * side}%,${y * strength}%) rotate(${roll * strength * side}deg) scale(${zoom + (sx - 1) * strength},${zoom + (sy - 1) * strength})`
}

export function ModelPortrait({ entry, botId, state, size, gaze, pokeable, onError }) {
  const root = useRef(null), gesture = useRef(null), picture = useRef(null), eyelids = useRef(null), interact = useRef(null)
  const setting = useSyncExternalStore(watchMotion, motionSetting, () => 'off')
  const [visible, setVisible] = useState(false)
  useEffect(() => watchViewport(root.current, setVisible), [])
  const active = visible && setting !== 'off'
  const canInteract = active && setting !== 'quiet'
  const rig = PORTRAIT_RIGS[entry.id]
  const motion = states[state] ?? states.idle
  const compact = size <= 44
  const strength = (compact ? .8 : 1) * (setting === 'quiet' ? .7 : 1)

  useEffect(() => {
    if (!active || !rig) return undefined
    const node = gesture.current
    const rootNode = root.current
    let timer, animation, blinkFrame, paint, lastClip, side = fnv1a(botId) % 2 ? 1 : -1
    const pace = rig.pace * (compact ? 1.15 : 1)
    const blink = () => {
      if (blinkFrame) return
      try { paint ??= makeBlinkPainter(eyelids.current, picture.current, rig) } catch { return }
      if (!paint) return
      const start = performance.now()
      const duration = 255 * Math.min(pace, 1.2)
      const draw = time => {
        const position = Math.min(1, Math.max(0, (time - start) / duration))
        const lid = position < .32 ? position / .32 : Math.min(1, (1 - position) / .5)
        paint(lid * lid * (3 - 2 * lid))
        blinkFrame = position < 1 ? requestAnimationFrame(draw) : undefined
      }
      blinkFrame = requestAnimationFrame(draw)
    }
    const play = name => {
      if (typeof node.animate !== 'function') return
      const { duration, points } = clips[name]
      const startingPose = animation?.playState === 'running' ? getComputedStyle(node).transform : 'none'
      animation?.cancel()
      const frames = [{ offset: 0, transform: startingPose, easing: ease },
        ...points.map(([offset, ...pose]) => ({ offset, transform: poseTransform(pose, strength, side), easing: ease })),
        { offset: 1, transform: 'none' }]
      animation = node.animate(frames, { duration: duration * pace })
      side = -side
    }
    const rest = motion.interval
    const schedule = (fraction = Math.random(), first = false) => {
      const [low, high] = rest
      const span = first && state === 'idle' && !compact ? 1050 + 1100 * fraction : low + (high - low) * fraction
      const delay = span * pace * (setting === 'lively' && state === 'idle' ? .78 : 1)
      timer = setTimeout(() => {
        const choices = motion.clips.filter(name => name !== lastClip)
        lastClip = choices[Math.floor(Math.random() * choices.length)]
        play(lastClip)
        if (state === 'idle' || state === 'waiting' || Math.random() < .4) blink()
        schedule()
      }, delay)
    }
    if (state !== 'idle') { lastClip = motion.clips[0]; play(lastClip) }
    if (setting !== 'quiet' && rest) {
      const phase = (fnv1a(`${botId}:${entry.id}`) % 1000) / 1000
      schedule(phase, true)
    }
    if (canInteract) interact.current = () => { play(rig.greeting); blink() }
    return () => {
      interact.current = null
      clearTimeout(timer)
      animation?.cancel()
      if (blinkFrame) cancelAnimationFrame(blinkFrame)
      paint?.(0)
      rootNode.style.removeProperty('--bt-portrait-x')
      rootNode.style.removeProperty('--bt-portrait-y')
    }
  }, [active, botId, canInteract, compact, entry.id, motion, rig, setting, state, strength])

  const pointAt = event => {
    if (event.pointerType === 'touch') return
    const node = event.currentTarget, box = node.getBoundingClientRect()
    node.style.setProperty('--bt-portrait-x', clamp((event.clientX - box.left - box.width / 2) / (box.width / 2)).toFixed(2))
    node.style.setProperty('--bt-portrait-y', clamp((event.clientY - box.top - box.height / 2) / (box.height / 2)).toFixed(2))
  }
  const clearPoint = event => {
    event.currentTarget.style.removeProperty('--bt-portrait-x')
    event.currentTarget.style.removeProperty('--bt-portrait-y')
  }
  return h('span', {
    ref: root, className: 'bt-model-portrait', 'data-portrait': entry.id,
    style: { backgroundColor: rig?.backdrop },
    'data-portrait-motion': active ? setting : undefined,
    onPointerMove: canInteract && gaze ? pointAt : undefined,
    onPointerLeave: canInteract && gaze ? clearPoint : undefined,
    onClick: canInteract && pokeable ? () => interact.current?.() : undefined,
  }, h('span', { className: 'bt-portrait-look' },
    h('span', { className: 'bt-portrait-pose', style: { transform: active ? poseTransform(motion.pose, strength, 1, 1.045) : 'none' } },
      h('span', { ref: gesture, className: 'bt-portrait-gesture' },
        h('img', { ref: picture, src: entry.image, alt: '', draggable: false, onError }),
        h('canvas', { ref: eyelids, width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, hidden: true })))))
}

export const MODEL_PORTRAIT_CSS = `
.bt-model-portrait{display:block;position:relative;width:100%;height:100%;overflow:hidden;border-radius:50%;isolation:isolate}
.bt-model-portrait :is(.bt-portrait-pose,.bt-portrait-look,.bt-portrait-gesture){display:block;position:absolute;inset:0;transform-origin:50% 64%}
.bt-model-portrait img,.bt-model-portrait canvas{position:absolute;inset:0;width:100%;height:100%}
.bt-model-portrait canvas{pointer-events:none}
.bt-model-portrait[data-portrait-motion] .bt-portrait-pose{transition:transform .4s cubic-bezier(.21,.68,.29,1)}
.bt-model-portrait[data-portrait-motion] .bt-portrait-look{transition:transform .22s ease-out;transform:translate(calc(var(--bt-portrait-x,0)*2.1%),calc(var(--bt-portrait-y,0)*1.65%)) rotate(calc(var(--bt-portrait-x,0)*3.5deg))}
@media(prefers-reduced-motion:reduce){.bt-model-portrait *{transform:none!important;animation:none!important;transition:none!important}}
`
