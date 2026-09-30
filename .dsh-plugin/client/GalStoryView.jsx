import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Accessibility, ArrowRight, BookOpen, Bug, Check, Download, History, House, MapPin, Music2, Palette, Pause, Play, RotateCcw, Save, Settings2, Upload, Volume2, VolumeX, X } from 'lucide-react'
import { STORY_EPISODES, STORY_CHARACTERS, STORY_SIDE_ROUTES, STORY_MUSIC_THEMES, getStoryEpisode, createStory, normalizeStory, currentStoryNode, advanceStory, storyHistory } from '../shared/gal-story-catalog.mjs'
import { readStory, readStorySlots, writeStory, STORY_STORAGE_KEY, episodeStorageKey, selectedStoryEpisode } from './gal-story-storage.mjs'
import { characterImageFor } from './characters.mjs'
import { stageCharactersFor } from './gal-stage-state.mjs'
import { STORY_BACKGROUNDS, backgroundForStoryNode, sceneDescription } from './gal-story-backgrounds.mjs'
import { expressionClassFor, expressionFor, expressionLabelFor } from './gal-game-expressions.mjs'
import { playStoryScore } from './gal-story-audio.mjs'
import { GalDialogue } from './GalDialogue.jsx'
import { GalDialogueGallery } from './GalDialogueGallery.jsx'
import { Panel, Tool } from './gal-game-controls.jsx'
import { GAL_GAME_CSS } from './gal-game-styles.mjs'

const storage = () => { try { return window.localStorage } catch { return null } }
const speakerName = key => key === 'player' ? '你' : key === 'narrator' ? '旁白' : STORY_CHARACTERS[key] || key
const PREFERENCE_DEFAULTS = Object.freeze({ music: true, volume: .26, cueCaptions: true, reducedMotion: false, highContrast: false, largeText: false, readableFont: false })
const preferenceKey = key => `${key}:accessibility:v1`
function musicLevelFor(node, { home, hasChoices }) {
  if (home) return .68
  if (node.ending) return .58
  if (node.soundCue) return .5
  if (hasChoices) return .62
  if (['angry', 'worried', 'surprised'].includes(node.emotion)) return .7
  return .6
}
function readPreferences(key) {
  const systemReduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  try {
    const raw = JSON.parse(storage()?.getItem(preferenceKey(key)) || '{}')
    return { ...PREFERENCE_DEFAULTS, ...raw, reducedMotion: raw.reducedMotion ?? systemReduced, volume: Math.max(0, Math.min(1, Number(raw.volume ?? PREFERENCE_DEFAULTS.volume))) }
  } catch { return { ...PREFERENCE_DEFAULTS, reducedMotion: systemReduced } }
}

export function GalStoryView({ storageKey = STORY_STORAGE_KEY, scene: dialogueScene, assetsMap, sessionState, onStateChange }) {
  const [episodeId, setEpisodeId] = useState(() => {
    if (sessionState?.episodeId) return sessionState.episodeId
    try { return selectedStoryEpisode(storage(), storageKey) } catch { return 'bridges' }
  })
  const sessions = useRef(sessionState?.sessions || {})
  function chooseEpisode(next) {
    if (next === episodeId) return
    setEpisodeId(next)
    try { storage()?.setItem(`${storageKey}:episode`, next) } catch { /* Session memory still retains the selected episode. */ }
    onStateChange?.({ episodeId: next, sessions: { ...sessions.current } })
  }
  function updateSession(next) {
    sessions.current[episodeId] = next
    onStateChange?.({ episodeId, sessions: { ...sessions.current } })
  }
  return <StoryReader key={`${storageKey}:${episodeId}`} storageKey={episodeStorageKey(storageKey, episodeId)} episodeId={episodeId} onChooseEpisode={chooseEpisode} scene={dialogueScene} assetsMap={assetsMap} sessionState={sessions.current[episodeId]} onStateChange={updateSession} />
}

function StoryReader({ storageKey, episodeId, onChooseEpisode, scene: dialogueScene, assetsMap, sessionState, onStateChange }) {
  const episode = STORY_EPISODES.find(item => item.id === episodeId)
  const [initial] = useState(() => {
    if (sessionState) return sessionState
    try { return { state: readStory(storage(), storageKey, episodeId), error: '' } }
    catch (error) { return { state: createStory(episodeId), error: error.message } }
  })
  const [state, setState] = useState(initial.state)
  const stateRef = useRef(state)
  const protectedSave = useRef(initial.protected ?? Boolean(initial.error))
  const [error, setError] = useState(initial.error)
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [slots, setSlots] = useState([null, null, null])
  const [debug, setDebug] = useState(false)
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey))
  const [animate, setAnimate] = useState(() => !readPreferences(storageKey).reducedMotion)
  const [speed, setSpeed] = useState(28)
  const [shown, setShown] = useState(0)
  const [auto, setAuto] = useState(false)
  const [home, setHome] = useState(true)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const fileRef = useRef(null)
  const historyRef = useRef(null)
  const dialogueRef = useRef(null)
  const scoreRef = useRef(null)
  const node = useMemo(() => currentStoryNode(state), [state])
  const history = useMemo(() => storyHistory(state), [state])
  const stageActors = useMemo(() => {
    return stageCharactersFor(node, history).filter(actor => characterImageFor(actor.speaker))
  }, [node, history])
  const background = backgroundForStoryNode(node)
  const complete = !animate || shown >= node.text.length
  const hasChoices = Boolean(node.choices?.length)
  const hasInstitutionalEnding = Boolean(node.ending?.relationshipEpilogues?.length)
  const activeMusic = home ? 'title-city' : node.musicTheme || 'title-city'
  const currentTheme = STORY_MUSIC_THEMES[activeMusic]
  const musicVolume = preferences.volume * musicLevelFor(node, { home, hasChoices })
  const hasProgress = Boolean(state.trail.length || state.routeId)

  function setPreference(name, value) {
    setPreferences(current => ({ ...current, [name]: value }))
    if (name === 'reducedMotion' && value) setAnimate(false)
  }

  function unlockAudio() { setAudioUnlocked(true) }

  useEffect(() => {
    try { setSlots(readStorySlots(storage(), storageKey, episodeId)) }
    catch (slotError) { setError(slotError.message) }
  }, [storageKey])

  useEffect(() => {
    try { storage()?.setItem(preferenceKey(storageKey), JSON.stringify(preferences)) } catch { /* Accessibility choices remain active for this session. */ }
  }, [preferences, storageKey])

  useEffect(() => {
    const current = scoreRef.current
    if (!preferences.music || !audioUnlocked) {
      current?.stop({ fadeOutMs: 700 })
      scoreRef.current = null
      return
    }
    if (current?.themeId === activeMusic) {
      current.setVolume(musicVolume, { rampMs: node.soundCue ? 720 : 360 })
      return
    }
    const next = playStoryScore(activeMusic, { volume: musicVolume, fadeInMs: current ? 1400 : 900 })
    scoreRef.current = next
    current?.stop({ fadeOutMs: 1400 })
  }, [activeMusic, musicVolume, preferences.music, audioUnlocked, node.soundCue])

  useEffect(() => () => {
    scoreRef.current?.stop({ fadeOutMs: 120 })
    scoreRef.current = null
  }, [])

  useEffect(() => {
    setShown(animate ? 0 : node.text.length)
    if (!animate) return undefined
    let count = 0
    const timer = setInterval(() => {
      count = Math.min(node.text.length, count + 1)
      setShown(value => Math.max(value, count))
      if (count >= node.text.length) clearInterval(timer)
    }, speed)
    return () => clearInterval(timer)
  }, [node.id, node.text, animate, speed])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 2600)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => { if (panel === 'history') historyRef.current?.scrollIntoView({ block: 'end' }) }, [panel])

  useEffect(() => {
    if (!auto || !complete || hasChoices || node.ending || panel || confirm || error) return undefined
    const timer = setInterval(() => {
      if (!document.hidden) dialogueRef.current?.advance()
    }, Math.max(1600, Math.min(6500, node.text.length * 65)))
    return () => clearInterval(timer)
  }, [auto, complete, hasChoices, node.id, panel, confirm, error])

  useEffect(() => {
    const pause = () => { if (document.hidden) setAuto(false) }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [])

  useEffect(() => {
    const keydown = event => {
      if (home || panel || confirm || error || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target?.tagName)) return
      if (/^[1-9]$/.test(event.key) && hasChoices) {
        const choice = node.choices[Number(event.key) - 1]
        if (choice) { event.preventDefault(); progress(choice.id) }
      } else if ((event.key === 'Enter' || event.key === ' ') && !node.ending) {
        event.preventDefault(); dialogueRef.current?.advance()
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault(); unlockAudio(); setPreference('music', !preferences.music)
      } else if (event.key.toLowerCase() === 'h') {
        event.preventDefault(); setAuto(false); setPanel('history')
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault(); setAuto(false); setPanel('saves')
      } else if (event.key === 'Escape') {
        event.preventDefault(); setAuto(false); setHome(true)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [home, panel, confirm, error, hasChoices, node.id, preferences.music])

  function store(next, recover = false) {
    if (protectedSave.current && !recover) { setAuto(false); setError('原存档已保留，请先导入备份或在设置中重新开始。'); return false }
    stateRef.current = next
    setState(next)
    setShown(animate ? 0 : currentStoryNode(next).text.length)
    try {
      writeStory(storage(), storageKey, next, episodeId)
      protectedSave.current = false
      setError('')
      onStateChange?.({ state: next, error: '', protected: false })
    } catch (saveError) {
      const message = saveError.message || '剧情存档未保存，请导出备份。'
      setAuto(false)
      setError(message)
      onStateChange?.({ state: next, error: message, protected: false })
    }
    return true
  }

  function progress(choiceId = null) {
    if (panel || confirm) return
    if (!complete && choiceId === null) { setShown(node.text.length); return }
    if (node.ending) return
    if (hasChoices && choiceId === null) return
    try { store(advanceStory(stateRef.current, choiceId)) }
    catch (storyError) { setError(storyError.message); setAuto(false) }
  }

  function saveSlot(index) {
    const next = slots.map((slot, at) => at === index ? { savedAt: new Date().toISOString(), state: stateRef.current } : slot)
    try {
      const target = storage()
      if (!target) throw new Error('浏览器存储不可用，请导出剧情存档。')
      target.setItem(`${storageKey}:slots`, JSON.stringify(next))
      setSlots(next)
      setNotice(`已保存至存档 ${index + 1}`)
    } catch (saveError) { setError(saveError.message) }
  }

  function exportSave() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'model-router-gal-story-save', savedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `model-city-story-${episodeId}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importSave(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 1024 * 1024) throw new Error('剧情存档文件过大。')
      const raw = JSON.parse(await file.text())
      if (raw.kind !== 'model-router-gal-story-save') throw new Error('请选择剧情模式导出的存档。')
      const next = normalizeStory(raw.state)
      if (getStoryEpisode(next).id !== episodeId) throw new Error(`这是《${getStoryEpisode(next).label}》存档，请在“剧目与章节”中切换后导入。`)
      setConfirm({ title: '导入剧情存档？', detail: '当前剧情自动存档将被替换。', action: () => { store(next, true); setPanel(null); setNotice('剧情存档已导入') } })
    } catch (importError) { setError(importError.message || '剧情存档无法读取。') }
  }

  function restart() {
    setAuto(false)
    setConfirm({ title: '重新开始剧情？', detail: '当前剧目的自动存档将被替换，手动存档会保留。', action: () => { store(createStory(episodeId), true); setPanel(null); setHome(false); unlockAudio(); setNotice('新故事已经开始') } })
  }

  function startChapter(chapter) {
    setAuto(false)
    setConfirm({ title: `从《${chapter.title}》开始试玩？`, detail: '本剧目的自动存档将被替换，手动存档保留。章节独立起点不继承之前的选择；完整体验请从序章开始。', action: () => { store(createStory(episodeId, { chapterId: chapter.id }), true); setPanel(null); setHome(false); unlockAudio(); setNotice('章节试玩已经开始') } })
  }

  function startRoute(route) {
    setAuto(false)
    store(createStory(episodeId, { routeId: route.id }), true)
    setPanel(null)
    setHome(false)
    unlockAudio()
    setNotice(`已进入 ${speakerName(route.character)} 支线`)
  }

  function startFromTitle() {
    store(createStory(episodeId), true)
    setHome(false)
    unlockAudio()
  }

  function continueFromTitle() {
    setHome(false)
    unlockAudio()
  }

  return <div className={`gg-root gg-story${preferences.highContrast ? ' is-high-contrast' : ''}${preferences.largeText ? ' is-large-text' : ''}${preferences.readableFont ? ' is-readable-font' : ''}${preferences.reducedMotion ? ' is-reduced-motion' : ''}`} data-testid="gal-story" data-node-id={node.id} data-episode-id={episodeId} data-chapter-id={node.chapterId || ''} data-route-id={node.routeId || ''} data-music-theme={activeMusic} data-debug-enabled={debug}>
    <style>{GAL_GAME_CSS}</style>
    {home && <section className="gg-title-screen" aria-labelledby="gg-title-heading" style={{ backgroundImage: `url(${STORY_BACKGROUNDS.title})` }}>
      <div className="gg-title-shade" />
      <img className="gg-title-character gg-title-character-kimi" src={characterImageFor('kimi')} alt="" aria-hidden="true" />
      <img className="gg-title-character gg-title-character-claude" src={characterImageFor('claude')} alt="" aria-hidden="true" />
      <div className="gg-title-copy">
        <p className="gg-title-kicker">MODEL CITY VISUAL NOVEL</p>
        <h1 id="gg-title-heading">{episode.title}</h1>
        <p className="gg-title-subtitle">{episode.label}</p>
        <p className="gg-title-description">{episode.description}</p>
        <div className="gg-title-actions">
          {hasProgress && <button type="button" className="gg-title-primary" onClick={continueFromTitle}><Play size={17} />继续旅程</button>}
          <button type="button" className={hasProgress ? '' : 'gg-title-primary'} onClick={startFromTitle}><RotateCcw size={17} />从开篇开始</button>
          {episodeId === 'bridges' && <button type="button" onClick={() => { unlockAudio(); setPanel('routes') }}><BookOpen size={17} />角色支线</button>}
          <button type="button" onClick={() => { unlockAudio(); setPanel('episodes') }}><MapPin size={17} />剧目与章节</button>
          <button type="button" onClick={() => { unlockAudio(); setPanel('settings') }}><Accessibility size={17} />无障碍与声音</button>
        </div>
        <p className="gg-title-audio"><Music2 size={14} />{audioUnlocked && preferences.music ? `正在演奏：${currentTheme?.title || '城市序曲'}` : '选择任一入口后启用音乐'}</p>
      </div>
    </section>}
    {!home && <><header className="gg-header">
      <div className="gg-brand"><h1>{episode.title}</h1></div>
      <div className="gg-header-actions">
        <Tool label="返回游戏首页" icon={House} onClick={() => { setAuto(false); setHome(true) }} />
        <Tool label="剧目与章节" icon={BookOpen} onClick={() => { setAuto(false); setPanel('episodes') }} />
        <Tool label={preferences.music ? '关闭音乐' : '开启音乐'} icon={preferences.music ? Volume2 : VolumeX} aria-pressed={preferences.music} onClick={() => { unlockAudio(); setPreference('music', !preferences.music) }} />
        <Tool label={auto ? '暂停自动播放' : '自动播放'} icon={auto ? Pause : Play} aria-pressed={auto} disabled={Boolean(node.ending)} onClick={() => setAuto(value => !value)} />
        <Tool label="对话回顾" icon={History} onClick={() => setPanel('history')} />
        <Tool label="存档与读档" icon={Save} onClick={() => setPanel('saves')} />
        {debug && <Tool label="查看开发调试" icon={Bug} onClick={() => setPanel('debug')} />}
        <Tool label="剧情与显示设置" icon={Settings2} onClick={() => setPanel('settings')} />
      </div>
    </header>
    <main className={`gg-main${hasChoices ? ' has-choices' : ''}${hasInstitutionalEnding ? ' is-institutional-ending' : ''}`}>
      <section className={`gg-stage${background ? ' has-background' : ''}`} aria-label={`${node.location}。${sceneDescription(node.description)}`} style={background ? { backgroundImage: `url(${background})` } : undefined}>
        <div className="gg-scene-meta"><span><MapPin size={13} />{node.location}</span><time>{node.time}</time></div>
        {preferences.cueCaptions && node.soundCue && <div className={`gg-sound-cue is-${node.soundCue.id}`} role="status"><Music2 size={14} aria-hidden="true" /><span><strong>{node.soundCue.label}</strong>{node.soundCue.description}</span></div>}
        {!background && <div className="gg-scene-placeholder"><h2>{node.location}</h2><span className="gg-placeholder-rule" /><p>{sceneDescription(node.description)}</p></div>}
        {stageActors.map((actor, index) => (
          <img
            className={`gg-character ${expressionClassFor(actor.emotion)}`}
            key={`${actor.speaker}:${actor.emotion}`}
            src={expressionFor(actor.speaker, actor.emotion)}
            alt={`${speakerName(actor.speaker)}，表情：${expressionLabelFor(actor.emotion)}`}
            draggable="false"
            style={stageActors.length > 1 ? index === 0
              ? { right: '0%', width: '57%', zIndex: 3 }
              : { right: '42%', width: '53%', height: '100%', zIndex: 2, opacity: .86 } : undefined}
          />
        ))}
        {stageActors[0] && <span className={`gg-expression-badge ${expressionClassFor(stageActors[0].emotion)}`} aria-hidden="true">{expressionLabelFor(stageActors[0].emotion)}</span>}
      </section>
      <p className="gg-sr-only" aria-live="polite">{speakerName(node.speaker)}：{node.text}</p>
      <GalDialogue ref={dialogueRef} character={node.speaker} speaker={speakerName(node.speaker)} text={node.text} shown={animate ? node.text.slice(0, shown) : node.text} onAdvance={() => progress()} canAdvance={!hasChoices && !node.ending} scene={dialogueScene} assetsMap={assetsMap} />
      <div className={`gg-input-band gg-story-actions${hasInstitutionalEnding ? ' is-institutional-ending' : ''}`}>
        {error && <div className="gg-error" role="alert"><span>{error}</span><Tool label="关闭提示" icon={X} onClick={() => setError('')} /></div>}
        {node.ending ? <div className="gg-ending gg-story-ending"><div className="gg-ending-copy">{hasInstitutionalEnding && <span className="gg-ending-kicker">制度结局</span>}<h2>{node.ending.title}</h2><p>{node.ending.description}</p>{hasInstitutionalEnding && <section className="gg-relationship-epilogues"><h3>关系尾声</h3><div>{node.ending.relationshipEpilogues.map(item => <article key={item.id}><h4>{item.title}</h4><p>{item.description}</p></article>)}</div></section>}</div><Tool label="重新开始" icon={RotateCcw} onClick={restart} /></div> : hasChoices ? <div className="gg-story-choices" role="group" aria-label="你的选择">{node.choices.map(choice => <button type="button" key={choice.id} data-choice-id={choice.id} onClick={() => progress(choice.id)}>{choice.text}<ArrowRight size={16} /></button>)}</div> : <div className="gg-story-next"><button type="button" className="gg-next" onClick={() => dialogueRef.current?.advance()}>继续<ArrowRight size={16} /></button></div>}
      </div>
    </main></>}
    {notice && <div className="gg-notice" role="status"><Check size={15} />{notice}</div>}

    {panel === 'routes' && episodeId === 'bridges' && <Panel title="二十二条角色支线" wide onClose={() => setPanel(null)}>
      <p className="gg-route-intro">每条支线从独立状态开始，保留一项角色承诺和一份可核验证据。结局不会覆盖主线的制度结局。</p>
      <div className="gg-route-grid">{STORY_SIDE_ROUTES.map(route => <button type="button" className="gg-route-card" data-route-id={route.id} key={route.id} onClick={() => startRoute(route)}>
        <img src={characterImageFor(route.character)} alt="" aria-hidden="true" />
        <span><strong>{speakerName(route.character)} · {route.title}</strong><small>{route.subtitle}</small><em>{route.summary}</em></span><ArrowRight size={16} />
      </button>)}</div>
    </Panel>}

    {panel === 'episodes' && <Panel title="剧目与章节" onClose={() => setPanel(null)}>
      <div className="gg-episode-list">{STORY_EPISODES.map(item => <article className="gg-episode-card" key={item.id}>
        <h3>{item.label}{item.id === episodeId ? ' · 当前剧目' : ''}</h3><p>{item.description}</p>
        <button className="gg-button" type="button" onClick={() => { if (item.id === episodeId) setPanel(null); else onChooseEpisode(item.id) }}>继续{item.label}</button>
      </article>)}</div>
      {episode.chapters.length > 0 && <div className="gg-chapter-list"><h3>章节试玩</h3><p>从开篇顺序阅读可保留所有选择的后续影响。也可直接从以下章节开始。</p>{episode.chapters.filter(chapter => !chapter.optional).map(chapter => <button className="gg-button" type="button" key={chapter.id} onClick={() => startChapter(chapter)}>试玩：{chapter.title}<ArrowRight size={14} /></button>)}</div>}
      {episodeId === 'bridges' && <div className="gg-panel-actions"><button className="gg-button" type="button" onClick={() => setPanel('routes')}><BookOpen size={16} />打开角色支线</button></div>}
    </Panel>}

    {panel === 'history' && <Panel title="对话回顾" wide onClose={() => setPanel(null)}><div className="gg-history">{history.map((line, index) => <React.Fragment key={`${line.id}:${index}`}>{line.location !== history[index - 1]?.location && <div className="gg-history-scene">{line.location} · {line.time}</div>}<article className={`gg-history-line ${line.speaker === 'player' ? 'is-player' : ''}`}><span>{speakerName(line.speaker)}</span><p>{line.text}</p></article></React.Fragment>)}<div ref={historyRef} /></div></Panel>}

    {panel === 'saves' && <Panel title="存档与读档" onClose={() => setPanel(null)}>
      {error && <p className="gg-form-error" role="alert">{error}</p>}
      <div className="gg-save-list">{slots.map((slot, index) => { const saved = slot?.state ? currentStoryNode(slot.state) : null; return <article className="gg-save-slot" key={index}><span className="gg-save-number">0{index + 1}</span><div><h3>{slot?.invalid ? '存档无法读取' : saved ? saved.location : '空白存档'}</h3><p>{saved?.text || '尚未记录'}</p>{slot?.savedAt && <time>{new Date(slot.savedAt).toLocaleString('zh-CN', { hour12: false })}</time>}</div><div className="gg-save-actions"><Tool label={`保存到存档 ${index + 1}`} icon={Save} onClick={() => slot ? setConfirm({ title: `覆盖存档 ${index + 1}？`, detail: '这个手动存档将替换为当前剧情。', action: () => saveSlot(index) }) : saveSlot(index)} /><Tool label={`读取存档 ${index + 1}`} icon={Upload} disabled={!slot || slot.invalid} onClick={() => setConfirm({ title: `读取存档 ${index + 1}？`, detail: '当前剧情自动存档将被替换。', action: () => { store(normalizeStory(slot.state), true); setPanel(null); setNotice('剧情存档已读取') } })} /></div></article> })}</div>
      <div className="gg-panel-actions"><button type="button" className="gg-button" onClick={exportSave}><Download size={16} />导出存档</button><button type="button" className="gg-button" onClick={() => fileRef.current?.click()}><Upload size={16} />导入存档</button></div><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importSave} />
    </Panel>}

    {panel === 'settings' && <Panel title="剧情与显示设置" onClose={() => setPanel(null)}>
      <label className="gg-setting-row"><span>逐字显示</span><input type="checkbox" checked={animate} onChange={event => setAnimate(event.target.checked)} /></label>
      <label className="gg-setting-row"><span>文字速度</span><input aria-label="文字速度" type="range" min="10" max="60" step="5" value={70 - speed} disabled={!animate} onChange={event => setSpeed(70 - Number(event.target.value))} /></label>
      <h3 className="gg-settings-heading">声音</h3>
      <label className="gg-setting-row"><span>背景音乐</span><input type="checkbox" checked={preferences.music} onChange={event => { unlockAudio(); setPreference('music', event.target.checked) }} /></label>
      <label className="gg-setting-row"><span>音乐音量</span><input aria-label="音乐音量" type="range" min="0" max="100" step="5" value={Math.round(preferences.volume * 100)} disabled={!preferences.music} onChange={event => setPreference('volume', Number(event.target.value) / 100)} /></label>
      <label className="gg-setting-row"><span>显示声音线索字幕</span><input type="checkbox" checked={preferences.cueCaptions} onChange={event => setPreference('cueCaptions', event.target.checked)} /></label>
      <h3 className="gg-settings-heading">无障碍</h3>
      <label className="gg-setting-row"><span>减少动态与关闭逐字动画</span><input type="checkbox" checked={preferences.reducedMotion} onChange={event => setPreference('reducedMotion', event.target.checked)} /></label>
      <label className="gg-setting-row"><span>高对比度</span><input type="checkbox" checked={preferences.highContrast} onChange={event => setPreference('highContrast', event.target.checked)} /></label>
      <label className="gg-setting-row"><span>大号文字</span><input type="checkbox" checked={preferences.largeText} onChange={event => setPreference('largeText', event.target.checked)} /></label>
      <label className="gg-setting-row"><span>易读字体与加宽字距</span><input type="checkbox" checked={preferences.readableFont} onChange={event => setPreference('readableFont', event.target.checked)} /></label>
      <div className="gg-keyboard-help"><h3>键盘操作</h3><p><kbd>Enter</kbd>/<kbd>Space</kbd> 继续　<kbd>1</kbd>–<kbd>9</kbd> 选择　<kbd>M</kbd> 音乐　<kbd>H</kbd> 回顾　<kbd>S</kbd> 存档　<kbd>Esc</kbd> 首页</p></div>
      <label className="gg-setting-row"><span>开发调试</span><input type="checkbox" checked={debug} onChange={event => setDebug(event.target.checked)} /></label>
      <div className="gg-panel-actions"><button className="gg-button" type="button" onClick={() => setPanel('gallery')}><Palette size={16} />对话框图鉴</button><button className="gg-button" type="button" onClick={restart}><RotateCcw size={16} />重新开始</button></div>
    </Panel>}
    {panel === 'gallery' && <GalDialogueGallery scene={dialogueScene} assetsMap={assetsMap} onClose={() => setPanel(null)} />}
    {panel === 'debug' && debug && <Panel title="开发调试" wide onClose={() => setPanel(null)}><div className="gg-debug" data-testid="gal-story-debug"><h3>剧情后台状态</h3><pre>{JSON.stringify(state, null, 2)}</pre></div></Panel>}
    {confirm && <Panel title={confirm.title} onClose={() => setConfirm(null)}><p>{confirm.detail}</p><div className="gg-panel-actions gg-align-end"><button type="button" className="gg-button" onClick={() => setConfirm(null)}>取消</button><button type="button" className="gg-button gg-primary" autoFocus onClick={() => { const action = confirm.action; setConfirm(null); action() }}>确认</button></div></Panel>}
  </div>
}
