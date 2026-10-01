import { audioEnvironment, normalizedVolume, playStoryScore, MINIMAX_SCORE_IDS } from './gal-story-audio.mjs'

export const GAL_MUSIC_OPTIONS = Object.freeze([
  { id: 'auto', label: '跟随剧情' },
  { id: 'title-city', label: '回声之城 · 序曲' },
  { id: 'kimi-flute', label: 'Kimi · 风中的笛声' },
  { id: 'claude-poem', label: 'Claude · 诗与花' },
  { id: 'bridge-anomaly', label: '千桥 · 异常回声' },
  { id: 'commons-atelier', label: '共有工坊' },
  { id: 'glass-dome', label: '玻璃穹顶' },
  { id: 'harbor-shift', label: '港湾轮班' },
  { id: 'local', label: '本地音乐文件' },
].map(option => Object.freeze(option)))

export function galThemeForNode(node = {}) {
  const source = node && typeof node === 'object' ? node : {}
  const candidates = [source.musicTheme, source.bgm, source.music, source.theme]
  for (const value of candidates) {
    const id = typeof value === 'string' ? value : value?.id
    if (MINIMAX_SCORE_IDS.includes(id)) return id
  }
  return 'title-city'
}

const MAX_LOCAL_AUDIO_BYTES = 30 * 1024 * 1024
const messageForFailure = error => error?.name === 'NotAllowedError'
  ? { state: 'blocked', message: '浏览器阻止了音频，请点击音乐播放按钮重试。' }
  : { state: 'error', message: '无法播放本地音乐，请检查文件编码：' + (error?.message || '解码失败') }

/** Lazy, offline audio. Constructing a controller never starts sound or creates
 * an AudioContext. Playback begins only when the caller explicitly calls start.
 * environment is an injectable browser API seam for deterministic tests.
 */
export function createGalAudioController({ onStatus, environment } = {}) {
  const runtime = audioEnvironment(environment)
  let status = Object.freeze({ state: 'idle', message: '音乐尚未播放。' })
  let volume = .35
  let muted = false
  let context = null
  let contextStateListener = null
  let scorePlayer = null
  let localPlayer = null
  let localErrorListener = null
  let localUrl = null
  let localName = ''
  let disposed = false
  let generation = 0
  let activeTheme = null

  function report(next) {
    status = Object.freeze({ ...next, themeId: activeTheme })
    try { onStatus?.(status) } catch { /* UI notification failures do not break audio cleanup. */ }
    return status
  }

  const effectiveVolume = () => muted ? 0 : volume
  function revokeLocalUrl(url) {
    try { if (url) runtime.URL?.revokeObjectURL?.(url) } catch { /* A stale URL must not prevent teardown. */ }
  }

  function stopPlayback() {
    if (scorePlayer) void scorePlayer.stop({ fadeOutMs: 0 })
    scorePlayer = null
    if (localPlayer) {
      if (localErrorListener) localPlayer.removeEventListener?.('error', localErrorListener)
      localErrorListener = null
      try { localPlayer.pause(); localPlayer.currentTime = 0; localPlayer.removeAttribute?.('src'); localPlayer.load?.() } catch { /* Cleanup remains safe after a decode failure. */ }
    }
    localPlayer = null
  }

  function stop() {
    generation += 1
    stopPlayback()
    activeTheme = null
    return report({ state: 'idle', message: '音乐已停止。' })
  }

  async function start(themeId, options = {}) {
    if (disposed) return report({ state: 'idle', message: '音频控制器已关闭。' })
    const token = ++generation
    stopPlayback()
    volume = normalizedVolume(options.volume ?? volume)
    activeTheme = themeId
    if (themeId !== 'local' && !MINIMAX_SCORE_IDS.includes(themeId)) return report({ state: 'error', message: '请选择已提供的音乐主题。' })
    if (themeId === 'local') {
      if (!localUrl) return report({ state: 'error', message: '请先选择本地音乐文件。' })
      if (!runtime.Audio) return report({ state: 'unavailable', message: '当前浏览器不支持本地音乐播放。' })
      try {
        const player = new runtime.Audio(localUrl)
        localPlayer = player
        player.loop = true
        player.volume = effectiveVolume()
        player.muted = muted
        localErrorListener = () => {
          if (token !== generation || disposed) return
          generation += 1
          stopPlayback()
          report({ state: 'error', message: '无法解码本地音乐，请选择浏览器支持的 MP3、WAV 或 OGG 文件。' })
        }
        player.addEventListener?.('error', localErrorListener)
        await player.play()
        if (token !== generation || disposed) return status
        return report({ state: 'playing', message: '正在循环播放：' + localName })
      } catch (error) {
        if (token !== generation || disposed) return status
        stopPlayback()
        return report(messageForFailure(error))
      }
    }
    if (!runtime.AudioContext) return report({ state: 'unavailable', message: '当前浏览器不支持 Web Audio，音乐无法播放。' })
    try {
      if (!context || context.state === 'closed') {
        if (contextStateListener) context?.removeEventListener?.('statechange', contextStateListener)
        context = new runtime.AudioContext()
        contextStateListener = () => {
          if (!scorePlayer || disposed) return
          if (context.state === 'suspended') report({ state: 'blocked', message: '浏览器暂停了音频，请点击音乐播放按钮重试。' })
          else if (context.state === 'closed') report({ state: 'unavailable', message: '音频设备已关闭，请点击音乐播放按钮重试。' })
          else if (context.state === 'running' && status.state === 'blocked' && scorePlayer.state === 'playing') report({ state: 'playing', message: '音乐正在播放。' })
        }
        context.addEventListener?.('statechange', contextStateListener)
      }
      const player = playStoryScore(themeId, {
        volume: effectiveVolume(), context, environment: runtime,
        onStatus: next => { if (token === generation && !disposed) report(next) },
      })
      scorePlayer = player
      const result = await player.ready
      if (token !== generation || disposed) return status
      if (result.state !== 'playing') scorePlayer = null
      return report(result)
    } catch (error) {
      if (token !== generation || disposed) return status
      stopPlayback()
      return report({ state: 'error', message: '无法初始化音乐：' + (error?.message || '音频设备不可用') })
    }
  }

  function setVolume(next) {
    volume = normalizedVolume(next)
    scorePlayer?.setVolume(effectiveVolume(), { rampMs: 100 })
    if (localPlayer) localPlayer.volume = effectiveVolume()
    return volume
  }

  function setMuted(next) {
    muted = Boolean(next)
    scorePlayer?.setVolume(effectiveVolume(), { rampMs: 0 })
    if (localPlayer) { localPlayer.muted = muted; localPlayer.volume = effectiveVolume() }
    return muted
  }

  function setLocalTrack(file) {
    if (disposed) return { ok: false, message: '音频控制器已关闭。' }
    if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_LOCAL_AUDIO_BYTES) return { ok: false, message: '请选择不超过 30 MB 的音乐文件。' }
    if (typeof file.type !== 'string' || !/^audio\/[\w.+-]+$/i.test(file.type)) return { ok: false, message: '请选择音频文件，无法识别的文件类型不能播放。' }
    if (!runtime.URL?.createObjectURL || !runtime.URL?.revokeObjectURL) return { ok: false, message: '当前浏览器不支持本地音乐文件。' }
    let replacement
    try { replacement = runtime.URL.createObjectURL(file) }
    catch { return { ok: false, message: '无法读取本地音乐文件。' } }
    if (activeTheme === 'local') stop()
    revokeLocalUrl(localUrl)
    localUrl = replacement
    localName = String(file.name || '本地音乐')
    return { ok: true, fileName: localName, message: '文件已选择；点击播放后开始，刷新页面后需要重新选择。' }
  }

  async function dispose() {
    if (disposed) return
    disposed = true
    stop()
    revokeLocalUrl(localUrl)
    localUrl = null
    localName = ''
    const closing = context
    if (contextStateListener) closing?.removeEventListener?.('statechange', contextStateListener)
    contextStateListener = null
    context = null
    try { if (closing && closing.state !== 'closed') await closing.close() } catch { /* Handled on component unmount. */ }
  }

  return { start, setVolume, setMuted, stop, dispose, setLocalTrack, get status() { return status }, get localTrackName() { return localName } }
}

/** Optional UI click/choice cues. Muted/zero-volume calls allocate no audio. */
export async function playGalEffect(kind, { volume = .4, muted = false, environment } = {}) {
  const runtime = audioEnvironment(environment)
  if (muted || normalizedVolume(volume) === 0) return { state: 'idle', message: '音效已静音。' }
  if (!runtime.AudioContext) return { state: 'unavailable', message: '当前浏览器不支持音效。' }
  let context
  let oscillator
  let gain
  try {
    context = new runtime.AudioContext()
    if (context.state !== 'running') await context.resume()
    if (context.state !== 'running') return { state: 'blocked', message: '浏览器暂停了音效。' }
    oscillator = context.createOscillator()
    gain = context.createGain()
    const now = context.currentTime
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(kind === 'choice' ? 660 : 440, now)
    oscillator.frequency.linearRampToValueAtTime(kind === 'choice' ? 880 : 520, now + .08)
    gain.gain.setValueAtTime(normalizedVolume(volume) * .08, now)
    gain.gain.linearRampToValueAtTime(0, now + .11)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + .12)
    await new Promise(resolve => { runtime.setTimeout(resolve, 160) })
    return { state: 'playing', message: '音效播放完成。' }
  } catch (error) {
    return { state: error?.name === 'NotAllowedError' ? 'blocked' : 'error', message: '音效播放失败。' }
  } finally {
    try { oscillator?.disconnect(); gain?.disconnect() } catch { /* Completed or never initialized. */ }
    try { if (context && context.state !== 'closed') await context.close() } catch { /* Always handled. */ }
  }
}
