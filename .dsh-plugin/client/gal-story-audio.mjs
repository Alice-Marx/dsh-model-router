import { MINIMAX_STORY_SCORES } from './gal-story-score-data.mjs'

const frequency = midi => 440 * (2 ** ((midi - 69) / 12))
export const normalizedVolume = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0

export function storyScoreFor(themeId) {
  return Object.hasOwn(MINIMAX_STORY_SCORES, themeId) ? MINIMAX_STORY_SCORES[themeId] : MINIMAX_STORY_SCORES['title-city']
}

export function audioEnvironment(environment = {}) {
  const browser = typeof window === 'undefined' ? globalThis : window
  return {
    AudioContext: browser.AudioContext || browser.webkitAudioContext,
    Audio: browser.Audio,
    URL: browser.URL,
    setTimeout: (callback, delay) => browser.setTimeout(callback, delay),
    clearTimeout: timer => browser.clearTimeout(timer),
    ...environment,
  }
}

const closeContext = context => {
  try { return Promise.resolve(context?.close?.()).catch(() => {}) }
  catch { return Promise.resolve() }
}

function unavailablePlayer(themeId, state, message) {
  const result = Object.freeze({ state, message })
  return { themeId, available: false, state, ready: Promise.resolve(result), setVolume() {}, stop: () => Promise.resolve() }
}

/** Offline scores. A supplied context is reused across theme changes.
 * ready resolves to a status, including blocked/unavailable; it never rejects.
 */
export function playStoryScore(themeId, { volume = .28, fadeInMs = 0, context: suppliedContext, environment, onStatus } = {}) {
  const runtime = audioEnvironment(environment)
  if (!suppliedContext && !runtime.AudioContext) return unavailablePlayer(themeId, 'unavailable', '当前浏览器不支持 Web Audio，音乐无法播放。')
  let context
  let master
  try {
    context = suppliedContext || new runtime.AudioContext()
    master = context.createGain()
    master.gain.value = fadeInMs > 0 ? 0 : normalizedVolume(volume)
    master.connect(context.destination)
  } catch (error) {
    if (!suppliedContext) void closeContext(context)
    return unavailablePlayer(themeId, 'error', '无法初始化音乐：' + (error?.message || '音频设备不可用'))
  }
  const score = storyScoreFor(themeId)
  const beat = 60 / score.bpm
  const cycle = beat * 16
  const voices = new Set()
  let targetVolume = normalizedVolume(volume)
  let stopped = false
  let state = 'idle'
  let timer = null
  let closeTimer = null
  let nextStart = 0
  let finishStop
  let stopPromise

  function notify(next) {
    state = next.state
    try { onStatus?.(next) } catch { /* Audio teardown must not depend on UI code. */ }
    return next
  }

  function releaseVoice(voice) {
    voices.delete(voice)
    try { voice.oscillator.disconnect() } catch { /* Already disconnected. */ }
    try { voice.envelope.disconnect() } catch { /* Already disconnected. */ }
  }

  function note(when, seconds, midi, wave, level, flute = false) {
    if (stopped) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const voice = { oscillator, envelope }
    voices.add(voice)
    oscillator.onended = () => releaseVoice(voice)
    oscillator.type = wave
    oscillator.frequency.setValueAtTime(frequency(midi), when)
    if (flute) oscillator.detune.linearRampToValueAtTime(4, when + Math.min(seconds, .7))
    envelope.gain.setValueAtTime(.0001, when)
    envelope.gain.exponentialRampToValueAtTime(Math.max(.001, level), when + Math.min(.045, seconds * .18))
    envelope.gain.exponentialRampToValueAtTime(.0001, when + Math.max(.06, seconds))
    oscillator.connect(envelope).connect(master)
    oscillator.start(when)
    oscillator.stop(when + Math.max(.08, seconds) + .03)
  }

  function scheduleCycle(start) {
    const flute = score.id === 'kimi-flute'
    for (const [at, midi, duration] of score.melody) note(start + at * beat, duration * beat * .86, midi, score.wave, score.gain, flute)
    for (const [at, midi, duration] of score.bass) note(start + at * beat, duration * beat * .9, midi, score.bassWave, score.gain * .34)
    for (const at of score.accent) {
      note(start + at * beat, .32, 84, 'sine', score.gain * .25)
      note(start + at * beat + .018, .25, 91, 'sine', score.gain * .095)
    }
  }

  function pump() {
    if (stopped) return
    const now = context.currentTime
    // Hidden tabs can throttle timers: skip expired cycles, keep the musical
    // clock absolute, and never send old notes to the audio scheduler.
    if (nextStart < now + .025) nextStart += Math.ceil((now + .025 - nextStart) / cycle) * cycle
    try {
      if (nextStart <= now + .45) {
        scheduleCycle(nextStart)
        nextStart += cycle
      }
    } catch (error) {
      state = 'error'
      void stop({ fadeOutMs: 0 })
      notify({ state: 'error', message: '音乐调度失败：' + (error?.message || '音频设备不可用') })
      return
    }
    timer = runtime.setTimeout(pump, Math.max(50, Math.min(500, (nextStart - now - .4) * 1000)))
  }

  function setVolume(next, { rampMs = 120 } = {}) {
    targetVolume = normalizedVolume(next)
    if (stopped) return
    try {
      const now = context.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(normalizedVolume(master.gain.value), now)
      master.gain.linearRampToValueAtTime(targetVolume, now + Math.max(0, Number(rampMs) || 0) / 1000)
    } catch (error) {
      state = 'error'
      void stop()
      notify({ state: 'error', message: '无法调整音乐音量：' + (error?.message || '音频设备已关闭') })
    }
  }

  function cleanup() {
    if (closeTimer !== null) runtime.clearTimeout(closeTimer)
    closeTimer = null
    for (const voice of [...voices]) {
      voice.oscillator.onended = null
      try { voice.oscillator.stop() } catch { /* A completed note may be stopped already. */ }
      releaseVoice(voice)
    }
    try { master.disconnect() } catch { /* Already disconnected. */ }
    const closing = suppliedContext ? Promise.resolve() : closeContext(context)
    void closing.then(() => finishStop?.())
  }

  function stop({ fadeOutMs = 0 } = {}) {
    if (stopPromise) return stopPromise
    stopped = true
    if (state !== 'error') state = 'idle'
    if (timer !== null) runtime.clearTimeout(timer)
    timer = null
    stopPromise = new Promise(resolve => { finishStop = resolve })
    const delay = Math.max(0, Number(fadeOutMs) || 0)
    // A suspended context cannot finish a fade: release it immediately.
    if (delay > 0 && context.state === 'running') {
      try {
        const now = context.currentTime
        master.gain.cancelScheduledValues(now)
        master.gain.setValueAtTime(normalizedVolume(master.gain.value), now)
        master.gain.linearRampToValueAtTime(0, now + delay / 1000)
        closeTimer = runtime.setTimeout(cleanup, delay + 30)
      } catch { cleanup() }
    } else cleanup()
    return stopPromise
  }

  const ready = (async () => {
    try {
      if (context.state !== 'running') await context.resume()
      if (stopped) return { state: 'idle', message: '音乐已停止。' }
      if (context.state !== 'running') {
        await stop()
        state = 'blocked'
        return notify({ state, message: '浏览器暂停了音频，请点击音乐播放按钮重试。' })
      }
      if (fadeInMs > 0) master.gain.linearRampToValueAtTime(targetVolume, context.currentTime + Math.max(0, Number(fadeInMs) || 0) / 1000)
      const start = context.currentTime + .06
      scheduleCycle(start)
      nextStart = start + cycle
      state = 'playing'
      pump()
      return notify({ state, message: '音乐正在播放。' })
    } catch (error) {
      if (stopped) return { state: 'idle', message: '音乐已停止。' }
      const failure = error?.name === 'NotAllowedError' || context.state === 'suspended' ? 'blocked' : 'error'
      await stop()
      state = failure
      return notify({ state, message: failure === 'blocked' ? '浏览器阻止了音频，请点击音乐播放按钮重试。' : '音乐播放失败：' + (error?.message || '音频错误') })
    }
  })()
  return { themeId: score.id, available: true, get state() { return state }, ready, setVolume, stop }
}

export const MINIMAX_SCORE_IDS = Object.freeze(Object.keys(MINIMAX_STORY_SCORES))
