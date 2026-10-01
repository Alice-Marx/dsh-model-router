/**
 * Gal 模块 · 官方桌面独立分块。
 *
 * 剧情模式：完整 gal 视图舞台（场景头、角色立绘位、对话框、选项、结局、
 * 历史与三槽存档），剧情引擎为确定性纯函数，全部在客户端运行。
 * 自由模式：选择官方模型目录中的路线与角色；可在面板内经官方 LLM
 * 服务对话，亦可复制开场提示词交给官方会话。
 */
import React from 'react'
import {
  STORY_EPISODES,
  STORY_CHARACTERS,
  STORY_SIDE_ROUTES,
  getStoryEpisode,
  createStory,
  currentStoryNode,
  advanceStory,
  storyHistory,
  normalizeStory,
  switchStoryChapter,
  storyChapterStates,
  storyAffinityPanel,
} from '../shared/gal-story-catalog.mjs'
import {
  STORY_STORAGE_KEY,
  episodeStorageKey,
  storySlotsKey,
  selectedStoryEpisode,
  readStory,
  writeStory,
  readStorySlots,
} from './gal-story-storage.mjs'
import galStylesheet from './gal-module.css'
import workspaceStylesheet from './router-main.css'
import { STORY_BACKGROUNDS, backgroundForStoryNode, sceneDescription } from './gal-story-backgrounds.mjs'
import { characterImageFor } from './characters.mjs'
import { CHARACTER_LABELS } from './character-identity.mjs'
import { stageCharactersFor } from './gal-stage-state.mjs'
import { expressionFor, fullBodyPortraitFor } from './gal-game-expressions.mjs'
import { readGalPreferences, writeGalPreferences, normalizeGalPreferences, portraitStyleFor, readSeenNodes, writeSeenNodes, nodeReadKey } from './gal-preferences.mjs'
import { createGalAudioController, galThemeForNode, playGalEffect } from './gal-audio-controller.mjs'
import { GalSettingsPanel, GalGallery, GalDialog } from './gal-settings-panel.jsx'
import { exportStorySave, importStorySave, saveQuickStory, loadQuickStory, saveManualStorySlot } from './gal-save-transfer.mjs'
import { readingAction, isStoryPausePoint, isGalShortcutTarget } from './gal-reading.mjs'

const SPEAKER_LABELS = { player: '你', narrator: '' }
const SPEAKER_COLORS = ['hsl(152,45%,44%)', 'hsl(208,60%,52%)', 'hsl(27,70%,55%)', 'hsl(262,45%,58%)', 'hsl(340,55%,56%)', 'hsl(190,50%,42%)', 'hsl(88,40%,42%)', 'hsl(315,40%,52%)']

/** Sidebar glyph for the Gal module: a dialogue bubble over a spark. */
export function GalPanelIcon({ size = 20, active = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.8C4 5.25 5.25 4 6.8 4h10.4C18.75 4 20 5.25 20 6.8v7.4c0 1.55-1.25 2.8-2.8 2.8H10l-4.4 3.6c-.5.4-1.1 0-1.1-.6V6.8Z"
        stroke="currentColor" strokeWidth="1.7" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.18 : 0}
      />
      <circle cx="9" cy="10.5" r="1.1" fill="currentColor" />
      <circle cx="12.5" cy="10.5" r="1.1" fill="currentColor" />
      <circle cx="16" cy="10.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

function speakerLabel(key) {
  return SPEAKER_LABELS[key] ?? STORY_CHARACTERS[key] ?? key
}

function speakerColor(key) {
  let hash = 0
  for (const ch of String(key ?? '')) hash = (hash * 31 + ch.charCodeAt(0)) % 997
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length]
}

function Avatar({ speaker, large = false, emotion = 'neutral' }) {
  const label = speakerLabel(speaker)
  const color = speakerColor(speaker)
  const source = characterImageFor(speaker) ? expressionFor(speaker, emotion) : null
  const [failedSource, setFailedSource] = React.useState(null)
  return (
    <span className={large ? 'gm-avatar gm-avatar-large' : 'gm-avatar'} style={{ background: color }} aria-hidden="true">
      {source && source !== failedSource
        ? <img src={source} alt="" onError={() => setFailedSource(source)} />
        : label ? label.slice(0, 1) : '？'}
    </span>
  )
}

function StagePortrait({ actor, companion = false, settings }) {
  const { speaker, emotion = 'neutral' } = actor
  const source = settings.portraits.source === 'expressions' ? characterImageFor(speaker) ? expressionFor(speaker, emotion) : null : fullBodyPortraitFor(speaker, emotion)
  const [failedSource, setFailedSource] = React.useState(null)
  if (!source) return null
  const className = companion ? 'gm-stage-portrait gm-stage-portrait-companion' : 'gm-stage-portrait'
  const style = portraitStyleFor(settings, speaker, companion)
  return source === failedSource
    ? <span className={`${className} gm-stage-portrait-fallback`} style={style} aria-hidden="true">{speakerLabel(speaker)}</span>
    : <img className={className} style={style} src={source} alt="" aria-hidden="true" onError={() => setFailedSource(source)} />
}

function StageArtwork({ background, actors, speaker, companion = null, emotion = 'neutral', settings }) {
  const visibleActors = actors ?? [
    speaker && { speaker, emotion },
    companion && { speaker: companion, emotion: 'neutral' },
  ].filter(Boolean)
  return (
    <>
      <div className="gm-stage-art" style={{ backgroundImage: `url("${background}")` }} aria-hidden="true" />
      <div className="gm-stage-actors" aria-hidden="true">
      {visibleActors[1] && <StagePortrait actor={visibleActors[1]} companion settings={settings} />}
      {visibleActors[0] && <StagePortrait actor={visibleActors[0]} settings={settings} />}
      </div>
    </>
  )
}

function useTypewriter(fullText, speed = 24) {
  const [shown, setShown] = React.useState('')
  React.useEffect(() => {
    setShown(speed === 0 ? fullText : '')
    if (speed === 0) return undefined
    if (!fullText) return undefined
    const timer = setInterval(() => {
      setShown(current => {
        if (current.length >= fullText.length) {
          clearInterval(timer)
          return current
        }
        return fullText.slice(0, current.length + 1)
      })
    }, speed)
    return () => clearInterval(timer)
  }, [fullText, speed])
  const complete = () => setShown(fullText)
  return { shown, complete, done: shown.length >= fullText.length }
}

function StageHeader({ node }) {
  return (
    <header className="gm-stage-head">
      <div className="gm-stage-place">
        <strong>{node.location ?? '未名之地'}</strong>
        {node.time && <span>{node.time}</span>}
      </div>
      {node.description && <p className="gm-stage-desc">{sceneDescription(node.description)}</p>}
    </header>
  )
}

const Dialogue = React.forwardRef(function Dialogue({ node, onAdvance, reading, mode, paused, readBefore, onRead, onStopReading }, ref) {
  const isNarration = node.speaker === 'narrator'
  const speed = reading.reduceMotion || mode === 'skip' && (readBefore || reading.skipUnread) ? 0 : reading.textSpeed
  const { shown, complete, done } = useTypewriter(node.text ?? '', speed)
  React.useEffect(() => {
    if (done && !paused) onRead()
    const action = readingAction({ node, mode, paused, done, readBefore, skipUnread: reading.skipUnread })
    if (action === 'stop') { onStopReading(); return undefined }
    if (action !== 'advance') return undefined
    const timer = setTimeout(() => onAdvance(null), mode === 'skip' ? 180 : reading.autoDelay)
    return () => clearTimeout(timer)
  }, [done, mode, paused, readBefore, reading.skipUnread, reading.autoDelay, onAdvance, onRead, onStopReading, node])
  const click = () => {
    if (!done) complete()
    else if (!isStoryPausePoint(node)) onAdvance(null)
  }
  React.useImperativeHandle(ref, () => ({ next: click }))
  const keyDown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    click()
  }
  return (
    <div className={isNarration ? 'gm-dialogue gm-dialogue-narration' : 'gm-dialogue'} onClick={click} onKeyDown={keyDown} role="button" tabIndex={0} aria-label={done ? isStoryPausePoint(node) ? '对话已显示，请选择剧情选项' : '继续剧情' : '显示完整对话'}>
      {!isNarration && (
        <div className="gm-speaker">
          <Avatar speaker={node.speaker} large emotion={node.emotion} />
          <span className="gm-speaker-name">{speakerLabel(node.speaker)}</span>
        </div>
      )}
      <p className="gm-dialogue-text">{shown}{!done && <span className="gm-caret">▍</span>}</p>
      {!isStoryPausePoint(node) && done && <span className="gm-next-hint">点击继续 ▸</span>}
    </div>
  )
})

/** Reserve the real dialogue/choice height so complete sprites keep their feet
 * visible above the text box, including when text wraps or a choice appears. */
function usePortraitClearance(stageRef, nodeId, uiHidden = false) {
  const [clearance, setClearance] = React.useState(180)
  React.useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const update = () => {
      const rect = stage.getBoundingClientRect()
      const boxes = [...stage.querySelectorAll('.gm-dialogue, .gm-choices, .gm-ending, .gm-free-dialogue')].filter(element => element.getBoundingClientRect().height > 0)
      if (!boxes.length) { setClearance(14); return }
      const top = Math.min(...boxes.map(element => element.getBoundingClientRect().top))
      setClearance(Math.max(14, Math.min(rect.height - 90, rect.bottom - top + 12)))
    }
    update()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    for (const element of stage.querySelectorAll('.gm-dialogue, .gm-choices, .gm-ending, .gm-free-dialogue')) observer.observe(element)
    return () => observer.disconnect()
  }, [stageRef, nodeId, uiHidden])
  return clearance
}

/** 章节下拉的锁/完成装饰；仅 echo-chronicle 提供锁定语义。 */
function chapterStatesFor(episodeId, story, episode) {
  const states = storyChapterStates(story)
  if (episodeId === 'echo-chronicle' && states.length > 0) {
    return states.map(state => ({ chapter: { id: state.id, title: state.title }, locked: state.locked === true, completed: state.completed === true, unlockHint: state.unlockHint }))
  }
  return (episode?.chapters ?? []).map(chapter => ({ chapter, locked: false, completed: false, unlockHint: null }))
}

function StoryMode({ settings, paused, onMusicTheme, onEffect, onSettings, initialEpisodeOverride, onEpisodeChange, startNew = false }) {
  const storage = React.useMemo(() => {
    try { return typeof window !== 'undefined' ? window.localStorage : null }
    catch { return null }
  }, [])
  const initialEpisode = React.useMemo(() => { if (STORY_EPISODES.some(item => item.id === initialEpisodeOverride)) return initialEpisodeOverride; try { return selectedStoryEpisode(storage) } catch { return 'bridges' } }, [storage, initialEpisodeOverride])
  const [episodeId, setEpisodeId] = React.useState(initialEpisode)
  const [story, setStory] = React.useState(() => {
    try {
      if (startNew) return createStory(initialEpisode)
      return readStory(storage, episodeStorageKey(STORY_STORAGE_KEY, initialEpisode), initialEpisode)
    } catch {
      return createStory(initialEpisode)
    }
  })
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    onEpisodeChange(episodeId)
    try { storage?.setItem(`${STORY_STORAGE_KEY}:episode`, episodeId) }
    catch (selectionError) { setError(selectionError.message) }
  }, [episodeId, onEpisodeChange, storage])
  const [notice, setNotice] = React.useState('')
  const [showHistory, setShowHistory] = React.useState(false)
  const [showAffinity, setShowAffinity] = React.useState(false)
  const [readingMode, setReadingMode] = React.useState('manual')
  const [uiHidden, setUiHidden] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState(null)
  const [backupJson, setBackupJson] = React.useState(null)
  const [backupStatus, setBackupStatus] = React.useState('')
  const [transferPending, setTransferPending] = React.useState(false)
  const stageRef = React.useRef(null)
  const dialogueRef = React.useRef(null)
  const importRef = React.useRef(null)
  const importGeneration = React.useRef(0)
  const undoStates = React.useRef([])
  const [undoCount, setUndoCount] = React.useState(0)
  const initialSeenNodes = React.useMemo(() => readSeenNodes(storage), [storage])
  const seenNodes = React.useRef(initialSeenNodes)
  const skipSnapshot = React.useRef(new Set())
  const [nameDraft, setNameDraft] = React.useState('')
  const [slots, setSlots] = React.useState(() => {
    try { return readStorySlots(storage, storySlotsKey(STORY_STORAGE_KEY, episodeId), episodeId) } catch { return [null, null, null] }
  })
  const node = React.useMemo(() => {
    try { return currentStoryNode(story) } catch { return null }
  }, [story])
  const readKey = nodeReadKey(episodeId, node, story)
  const clearance = usePortraitClearance(stageRef, readKey, uiHidden)
  const blocked = paused || showHistory || showAffinity || Boolean(confirmation) || Boolean(backupJson) || transferPending || uiHidden
  React.useEffect(() => { onMusicTheme(galThemeForNode(node)) }, [node, onMusicTheme])

  const baseKey = episodeStorageKey(STORY_STORAGE_KEY, episodeId)
  React.useEffect(() => {
    if (!startNew) return
    try { writeStory(storage, baseKey, story, episodeId); storage?.setItem(`${STORY_STORAGE_KEY}:episode`, episodeId) }
    catch (saveError) { setError(saveError.message) }
  }, [])
  const persist = next => {
    setError('')
    setStory(next)
    try { writeStory(storage, baseKey, next, episodeId) } catch (writeError) { setError(writeError.message) }
  }
  const advance = React.useCallback(choiceId => {
    if (transferPending) return
    setError('')
    try {
      const next = advanceStory(story, choiceId)
      undoStates.current = [...undoStates.current.slice(-29), story]
      setUndoCount(undoStates.current.length)
      persist(next)
      if (readingMode === 'manual') onEffect(choiceId === null ? 'click' : 'choice')
    } catch (advanceError) { setError(advanceError.message); setReadingMode('manual') }
  }, [story, baseKey, episodeId, onEffect, readingMode, transferPending])
  const clearReading = () => { importGeneration.current += 1; setReadingMode('manual'); undoStates.current = []; setUndoCount(0); setUiHidden(false); setNotice('') }
  const markRead = React.useCallback(() => {
    if (!readKey || seenNodes.current.has(readKey)) return
    seenNodes.current.add(readKey)
    try { writeSeenNodes(storage, seenNodes.current) } catch { /* 本次会话仍保留已读记录。 */ }
  }, [readKey, storage])
  const stopReading = React.useCallback(() => setReadingMode('manual'), [])
  const toggleReading = mode => {
    skipSnapshot.current = new Set(seenNodes.current)
    setReadingMode(current => current === mode ? 'manual' : mode)
  }
  const undo = () => {
    const previous = undoStates.current.pop()
    if (!previous) return
    setReadingMode('manual')
    setUndoCount(undoStates.current.length)
    persist(previous)
  }
  const fullScreen = async () => {
    try {
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen()
      else if (stageRef.current?.requestFullscreen) { await stageRef.current.requestFullscreen(); stageRef.current.focus() }
      else throw new Error('当前桌面不支持全屏，请最大化窗口。')
    } catch (fullscreenError) { setError(fullscreenError.message || '无法切换全屏，请最大化窗口。') }
  }
  const quickSave = () => {
    try { saveQuickStory(storage, episodeId, story); setError(''); setNotice('快捷存档已保存。'); onEffect('click') }
    catch (saveError) { setError(saveError.message) }
  }
  const quickLoad = () => {
    try {
      const restored = loadQuickStory(storage, episodeId)
      setConfirmation({ message: '读取快捷存档？当前进度会被替换。', run: () => { clearReading(); persist(restored) } })
    } catch (loadError) { setError(loadError.message) }
  }
  const exportSave = () => {
    let url
    try {
      url = URL.createObjectURL(new Blob([exportStorySave(story)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `gal-${episodeId}-${new Date().toISOString().slice(0, 10)}.json`
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
      setError('')
      setNotice('已开始导出存档，请保留下载的 JSON 文件。')
    } catch (exportError) { setError(exportError.message) }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 30000) }
  }
  const importSave = async file => {
    if (!file) return
    const generation = ++importGeneration.current
    setTransferPending(true)
    setReadingMode('manual')
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('存档文件最多 2 MB。')
      const restored = importStorySave(await file.text(), episodeId)
      if (generation !== importGeneration.current) return
      setConfirmation({ message: '导入此存档？当前进度会被替换，其他存档槽会保留。', run: () => { clearReading(); persist(restored) } })
    } catch (importError) { if (generation === importGeneration.current) setError(importError.message) }
    finally { setTransferPending(false) }
  }
  const viewBackup = () => {
    try { setBackupJson(exportStorySave(story)); setBackupStatus('') }
    catch (backupError) { setError(backupError.message) }
  }
  const copyBackup = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持自动复制，请选中下方文字后手动复制。')
      await navigator.clipboard.writeText(backupJson)
      setBackupStatus('存档 JSON 已复制，请粘贴到文本文件并保存为 .json。')
    } catch { setBackupStatus('无法自动复制，请选中下方文字后手动复制。') }
  }
  const stageKeys = event => {
    if (event.key === 'Escape' && uiHidden) { setUiHidden(false); return }
    if (blocked || !isGalShortcutTarget(event.target)) return
    const key = event.key.toLowerCase()
    const action = { a: () => toggleReading('auto'), s: () => toggleReading('skip'), h: () => setUiHidden(true), f: () => { void fullScreen() }, q: quickSave, l: quickLoad, arrowleft: undo, enter: () => dialogueRef.current?.next(), ' ': () => dialogueRef.current?.next() }[key]
    if (action && !event.ctrlKey && !event.altKey && !event.metaKey && !event.repeat) { event.preventDefault(); action() }
  }
  const switchEpisode = nextId => {
    clearReading()
    setError('')
    setEpisodeId(nextId)
    try { storage?.setItem(`${STORY_STORAGE_KEY}:episode`, nextId) } catch { /* 存储不可用时仅本次生效 */ }
    try {
      const key = episodeStorageKey(STORY_STORAGE_KEY, nextId)
      setStory(readStory(storage, key, nextId))
      setSlots(readStorySlots(storage, storySlotsKey(STORY_STORAGE_KEY, nextId), nextId))
    } catch {
      setStory(createStory(nextId))
      setSlots([null, null, null])
    }
  }
  const saveSlot = index => {
    setError('')
    try {
      const slotsKey = storySlotsKey(STORY_STORAGE_KEY, episodeId)
      saveManualStorySlot(storage, episodeId, index, story)
      setSlots(readStorySlots(storage, slotsKey, episodeId))
      setNotice(`存档槽 ${index + 1} 已保存。`)
    } catch (slotError) { setError(slotError.message) }
  }
  const loadSlot = index => {
    setError('')
    try {
      const slot = readStorySlots(storage, storySlotsKey(STORY_STORAGE_KEY, episodeId), episodeId)[index]
      if (!slot || slot.invalid) throw new Error('该存档槽为空或已损坏。')
      clearReading()
      persist(normalizeStory(slot.state))
    } catch (loadError) { setError(loadError.message) }
  }
  const restart = () => {
    clearReading()
    setError('')
    persist(createStory(episodeId))
  }

  const episode = getStoryEpisode(story) ?? STORY_EPISODES.find(item => item.id === episodeId)
  const history = React.useMemo(() => {
    if (!showHistory) return []
    try { return storyHistory(story) } catch { return [] }
  }, [story, showHistory])
  const sceneActors = React.useMemo(() => {
    if (!node) return []
    try {
      return stageCharactersFor(node, storyHistory(story)).filter(actor => characterImageFor(actor.speaker))
    } catch { /* 剧情状态异常时仍可展示当前角色。 */ }
    return stageCharactersFor(node).filter(actor => characterImageFor(actor.speaker))
  }, [story, node])
  const stageBackground = backgroundForStoryNode(node)
  const affinity = React.useMemo(() => {
    if (!showAffinity || episodeId !== 'echo-chronicle') return []
    try { return storyAffinityPanel(story) } catch { return [] }
  }, [story, showAffinity, episodeId])

  // 命名之夜：文本输入节点（echo-chronicle 专属）。
  const submitName = () => {
    advance(`__input__:${nameDraft.trim()}`)
    setNameDraft('')
  }

  return (
    <div className="gm-story">
      <div className="gm-story-toolbar">
        <label className="mr-control-label" htmlFor="gm-episode">剧目</label>
        <select id="gm-episode" className="gm-select" value={episodeId} disabled={transferPending} onChange={event => switchEpisode(event.target.value)}>
          {STORY_EPISODES.map(item => <option key={item.id} value={item.id}>{item.label} · {item.title}</option>)}
        </select>
        {episode?.chapters?.length > 0 && (
          <select
            className="gm-select"
            value={story?.chapterId ?? ''}
            onChange={event => {
              clearReading()
              setError('')
              try {
                const chapterId = event.target.value
                if (switchStoryChapter(story, chapterId) !== null) {
                  persist(switchStoryChapter(story, chapterId))
                  return
                }
                const routeId = chapterId === 'side-routes' ? STORY_SIDE_ROUTES[0]?.id : null
                persist(createStory(episodeId, { chapterId, routeId }))
              } catch (chapterError) { setError(chapterError.message) }
            }}
            aria-label="选择章节"
          >
            {chapterStatesFor(episodeId, story, episode).map(({ chapter, locked, completed, unlockHint }) => (
              <option key={chapter.id} value={chapter.id} disabled={locked}>
                {locked ? '🔒 ' : ''}{completed && !locked ? '✓ ' : ''}{chapter.title}{locked && unlockHint ? '（未解锁）' : ''}
              </option>
            ))}
          </select>
        )}
        {episodeId === 'echo-chronicle' && (
          <button className="mr-button mr-button-secondary" type="button" onClick={() => setShowAffinity(value => !value)}>
            {showAffinity ? '收起好感度' : '好感度'}
          </button>
        )}
        {episodeId === 'bridges' && story?.chapterId === 'side-routes' && (
          <select
            className="gm-select"
            value={story.routeId ?? STORY_SIDE_ROUTES[0]?.id ?? ''}
            onChange={event => {
              clearReading()
              setError('')
              try { persist(createStory('bridges', { chapterId: 'side-routes', routeId: event.target.value })) }
              catch (routeError) { setError(routeError.message) }
            }}
            aria-label="选择角色支线"
          >
            {STORY_SIDE_ROUTES.map(route => <option key={route.id} value={route.id}>{route.title}</option>)}
          </select>
        )}
        <button className="mr-button mr-button-secondary" type="button" onClick={() => setShowHistory(value => !value)}>{showHistory ? '收起历史' : '历史'}</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={() => setConfirmation({ message: '重新开始当前剧目？当前自动保存的进度将被替换，手动槽位不受影响。', run: restart })}>重新开始</button>
      </div>
      <p className="gm-episode-description"><strong>{episode?.title}</strong> · {episode?.description}</p>
      <div className="gm-playback" role="group" aria-label="剧情阅读控制">
        <button className="mr-button mr-button-secondary" type="button" aria-pressed={readingMode === 'auto'} onClick={() => toggleReading('auto')}>{readingMode === 'auto' ? '停止自动' : '自动阅读'}</button>
        <button className="mr-button mr-button-secondary" type="button" aria-pressed={readingMode === 'skip'} onClick={() => toggleReading('skip')}>{readingMode === 'skip' ? '停止快进' : settings.reading.skipUnread ? '快进全部' : '已读快进'}</button>
        <button className="mr-button mr-button-secondary" type="button" disabled={undoCount === 0} onClick={undo}>上一句</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={() => setUiHidden(true)}>隐藏界面</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={() => { void fullScreen() }}>舞台全屏</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={onSettings}>设置</button>
        <span className="mr-caption" role="status">{readingMode === 'auto' ? blocked ? '自动已暂停' : '自动阅读中' : readingMode === 'skip' ? '快进中，遇选项停止' : '手动阅读 · 点击舞台空白处后可使用快捷键'}</span>
      </div>
      <div className="gm-stage" ref={stageRef} style={{ '--gm-portrait-clearance': `${clearance}px` }} tabIndex={0} aria-label="剧情舞台" onKeyDown={stageKeys} data-ui-hidden={uiHidden} data-chapter={node?.chapterId ?? story?.chapterId ?? ''}>
        <StageArtwork background={stageBackground} actors={sceneActors} settings={settings} />
        <div className="gm-stage-interface" hidden={uiHidden}>
        {node && <StageHeader node={node} />}
        {node && <Dialogue ref={dialogueRef} key={readKey} node={node} onAdvance={advance} reading={settings.reading} mode={readingMode} paused={blocked} readBefore={skipSnapshot.current.has(readKey)} onRead={markRead} onStopReading={stopReading} />}
        {node?.input && (
          <div className="gm-choices gm-input-row" role="group" aria-label="输入">
            <input
              className="mr-input"
              value={nameDraft}
              maxLength={12}
              placeholder={node.input.placeholder ?? '请输入…'}
              aria-label={node.input.placeholder ?? '输入'}
              onChange={event => setNameDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitName() } }}
            />
            <button className="mr-button" type="button" onClick={submitName}>就用这个名字</button>
          </div>
        )}
        {node?.choices && (
          <div className="gm-choices" role="group" aria-label="剧情选项">
            {node.choices.map(choice => (
              <button key={choice.id} type="button" className="gm-choice" onClick={() => advance(choice.id)}>{choice.text}</button>
            ))}
          </div>
        )}
        {node?.ending && (
          <div className="gm-ending">
            <h3>{node.ending.title ?? '本段完结'}</h3>
            {node.ending.description && <p>{node.ending.description}</p>}
            {Array.isArray(node.ending.epilogue) && node.ending.epilogue.map((line, index) => <p key={index}>{line}</p>)}
            {Array.isArray(node.ending.relationshipEpilogues) && node.ending.relationshipEpilogues.map(ending => (
              <section className="gm-ending-epilogue" key={ending.id}>
                <h4>{ending.title}</h4>
                <p>{ending.description}</p>
              </section>
            ))}
            <button className="mr-button" type="button" onClick={() => setConfirmation({ message: '开启新的一周目？建议先导出或手动保存当前结局。', run: restart })}>开启新的一周目</button>
          </div>
        )}
        {!node && <div className="mr-empty">剧情引擎无法读取当前存档，请重新开始。</div>}
        <nav className="gm-stage-actions" aria-label="舞台操作栏">
          <button type="button" onClick={onSettings}>设置</button><button type="button" onClick={() => setShowHistory(value => !value)}>历史</button>
          <button type="button" aria-pressed={readingMode === 'auto'} onClick={() => toggleReading('auto')}>自动</button><button type="button" aria-pressed={readingMode === 'skip'} onClick={() => toggleReading('skip')}>快进</button>
          <button type="button" onClick={quickSave}>快存</button><button type="button" onClick={quickLoad}>快读</button><button type="button" onClick={() => setUiHidden(true)}>隐藏</button><button type="button" onClick={() => { void fullScreen() }}>全屏 / 退出</button>
        </nav>
        </div>
        {uiHidden && <button className="gm-restore mr-button" type="button" onClick={() => setUiHidden(false)}>恢复界面（Esc）</button>}
      </div>

      {showAffinity && affinity.length > 0 && (
        <div className="gm-affinity" role="group" aria-label="好感度">
          {affinity.map(item => (
            <span key={item.key} className="gm-affinity-item">
              <strong>{item.label}</strong>
              <span className={item.value >= 0 ? 'gm-affinity-plus' : 'gm-affinity-minus'}>{item.value >= 0 ? `+${item.value}` : item.value}</span>
            </span>
          ))}
          <span className="mr-caption">好感度由本章选择累积；跨章节保留。</span>
        </div>
      )}

      {showHistory && (
        <GalDialog title="剧情历史" onClose={() => setShowHistory(false)}>
        <div className="gm-history" role="log" aria-label="剧情历史">
          {history.length === 0 && <p>尚无已完成的台词，请继续阅读后再查看。</p>}
          {history.map((entry, index) => (
            <p key={`${entry.id}-${index}`} className={entry.speaker === 'player' ? 'gm-history-player' : ''}>
              {speakerLabel(entry.speaker) && <strong>{speakerLabel(entry.speaker)}：</strong>}
              {entry.text}
            </p>
          ))}
        </div>
        </GalDialog>
      )}

      <div className="gm-slots">
        <span className="mr-control-label">存档</span>
        {[0, 1, 2].map(index => {
          const slot = slots[index]
          return (
            <span key={index} className="gm-slot">
              <button className="mr-button mr-button-secondary" type="button" onClick={() => slot ? setConfirmation({ message: `覆盖存档槽 ${index + 1}？`, run: () => saveSlot(index) }) : saveSlot(index)}>存 {index + 1}</button>
              <button className="mr-button mr-button-secondary" type="button" disabled={!slot || slot.invalid} onClick={() => setConfirmation({ message: `读取存档槽 ${index + 1}？当前进度会被替换。`, run: () => loadSlot(index) })} title={slot?.savedAt ?? ''}>读 {index + 1}</button>
            </span>
          )
        })}
        <button className="mr-button mr-button-secondary" type="button" onClick={quickSave}>快捷存档</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={quickLoad}>快捷读档</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={exportSave}>导出存档</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={viewBackup}>查看备份 JSON</button>
        <button className="mr-button mr-button-secondary" type="button" disabled={transferPending} onClick={() => importRef.current?.click()}>导入存档</button>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importSave(file) }} />
        <span className="mr-caption">本地自动保存 · 3 个手动槽 · 各剧目独立快捷存档。跨设备请导出备份。</span>
      </div>
      {confirmation && <GalDialog title="确认操作" onClose={() => setConfirmation(null)}><p>{confirmation.message}</p><div className="mr-actions"><button className="mr-button" type="button" onClick={() => { const action = confirmation.run; setConfirmation(null); action() }}>确认</button><button className="mr-button mr-button-secondary" type="button" onClick={() => setConfirmation(null)}>取消</button></div></GalDialog>}
      {backupJson && <GalDialog title="存档备份 JSON" onClose={() => setBackupJson(null)}><p>下载未开始时可复制此备份，粘贴到文本文件并保存为 .json，再通过“导入存档”恢复。</p><textarea className="gm-backup-json" aria-label="存档 JSON" readOnly value={backupJson} /><div className="mr-actions"><button className="mr-button" type="button" onClick={() => { void copyBackup() }}>复制存档 JSON</button><button className="mr-button mr-button-secondary" type="button" onClick={exportSave}>下载 JSON</button></div>{backupStatus && <p role="status">{backupStatus}</p>}</GalDialog>}
      {error && <p className="mr-error" role="alert">{error}</p>}
      {notice && <p className="mr-caption" role="status">{notice}</p>}
    </div>
  )
}

const FREE_PRESETS = [
  { id: 'cafe', label: '开放日休息区', world: '百模协会开放日临近散场，展台边的灯仍亮着。', opener: '你从喧闹的人群走到一张安静的圆桌旁。', art: STORY_BACKGROUNDS['open-day'] },
  { id: 'lab', label: '千桥夜班', world: '深夜的千桥运维室，窗外桥灯和报警灯明灭。', opener: '你发现值班记录的时间戳对不上，抬起头。', art: STORY_BACKGROUNDS['bridges-night'] },
  { id: 'station', label: '千桥站台', world: '千桥站台，末班车即将开出。', opener: '你说：“今天也辛苦了。”', art: STORY_BACKGROUNDS.prologue },
  { id: 'old-library', label: '旧城月光图书馆', world: '迁移前的旧城图书馆，档案盒铺满地面，阅读灯还亮着。', opener: '你在一叠未归档的信件前停下脚步。', art: STORY_BACKGROUNDS['community-archive'] },
  { id: 'laurel', label: '月桂剧院', world: '演出结束后的月桂剧院，幕布尚未合拢，台上留着一页未写完的诗。', opener: '你走向舞台边缘，听见有人轻声念出第一句。', art: STORY_BACKGROUNDS.laurel },
  { id: 'echo-tower', label: '回声之城旧塔', world: '雪夜的城南旧塔，窗边亮着两芯颜色相同的灯。', opener: '你敲了敲门，等里面的人决定是否应答。', art: STORY_BACKGROUNDS['offline-workshop'] },
  { id: 'harbor', label: '三港调查', world: '三港的夜班刚刚交接，码头上的时钟与回执记录相差了一拍。', opener: '你摊开航图，指出尚未核对的那一段时间。', art: STORY_BACKGROUNDS['three-harbors'] },
]

function FreeMode({ routes, galReply, cancelGalReply, settings, onMusicTheme }) {
  const [routeKey, setRouteKey] = React.useState(routes[0] ? `${routes[0].provider}/${routes[0].model}` : '')
  const [character, setCharacter] = React.useState('harness')
  const [preset, setPreset] = React.useState('cafe')
  const [extra, setExtra] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const [copyError, setCopyError] = React.useState('')
  const [messages, setMessages] = React.useState([])
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const sendingRef = React.useRef(false)
  const [chatError, setChatError] = React.useState('')
  const chatGeneration = React.useRef(0)
  const pendingRequestId = React.useRef(null)
  const freeStageRef = React.useRef(null)
  const clearance = usePortraitClearance(freeStageRef, preset)
  React.useEffect(() => () => {
    chatGeneration.current += 1
    if (pendingRequestId.current && typeof cancelGalReply === 'function') void cancelGalReply(pendingRequestId.current)
  }, [])
  const resetChat = () => {
    chatGeneration.current += 1
    if (pendingRequestId.current && typeof cancelGalReply === 'function') void cancelGalReply(pendingRequestId.current)
    setMessages([])
    setChatError('')
  }
  const stop = async () => {
    const requestId = pendingRequestId.current
    if (!requestId || typeof cancelGalReply !== 'function') return
    chatGeneration.current += 1
    try {
      const response = await cancelGalReply(requestId)
      setChatError(response?.ok && response.value?.cancelled ? '已请求停止生成。' : '停止请求未被接受，请等待当前调用结束。')
    } catch (error) { setChatError(error?.message || '停止请求失败。') }
  }
  const route = routes.find(item => `${item.provider}/${item.model}` === routeKey) ?? routes[0]
  const presetData = FREE_PRESETS.find(item => item.id === preset)
  React.useEffect(() => { onMusicTheme(preset === 'laurel' ? 'claude-poem' : preset === 'lab' ? 'bridge-anomaly' : preset === 'harbor' ? 'harbor-shift' : 'title-city') }, [preset, onMusicTheme])
  const prompt = [
    `请以视觉小说角色的方式与我对话。`,
    `你扮演：${CHARACTER_LABELS[character] ?? character}。`,
    `场景：${presetData?.world.trim() ?? ''}`,
    presetData?.opener ? `开场动作提示：${presetData.opener}` : '',
    extra.trim() ? `补充设定：${extra.trim()}` : '',
    '',
    '要求：每次回复不超过三段；动作写在括号里；保持角色语气；不要跳出角色解释自己是 AI。',
  ].filter(Boolean).join('\n')
  const copy = async () => {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(`${prompt}\n\n（请在官方会话中选择模型 ${route ? `${route.provider}/${route.model}` : '任意可用模型'} 后发送本提示词。）`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch { setCopyError('自动复制不可用，请展开完整提示词后手动选中并复制。') }
  }
  const send = async () => {
    const userText = draft.trim()
    if (!userText || sendingRef.current) return
    if (!route || typeof galReply !== 'function') { setChatError('请先在官方“模型”页配置可用路线。'); return }
    if (userText.length > 1_500) { setChatError('单条消息最多 1500 字。'); return }
    sendingRef.current = true
    setSending(true)
    setChatError('')
    const generation = ++chatGeneration.current
    const requestId = globalThis.crypto?.randomUUID?.()
    if (!requestId) {
      sendingRef.current = false
      setSending(false)
      setChatError('当前桌面环境无法生成安全的请求 ID。')
      return
    }
    pendingRequestId.current = requestId
    try {
      const context = [...messages.slice(-8), { role: 'user', text: userText }]
        .map(item => ({ role: item.role, text: item.text.slice(0, 3_000) }))
      const response = await galReply({ requestId, provider: route.provider, model: route.model, persona: prompt, messages: context })
      if (generation !== chatGeneration.current) return
      if (!response?.ok) throw new Error(response?.error?.message || '官方模型调用失败。')
      if (!response.value?.ok || !response.value.text) throw new Error(response.value?.error || '模型没有返回文字。')
      setMessages(previous => [...previous, { role: 'user', text: userText }, { role: 'assistant', text: response.value.text, truncated: response.value.truncated === true }].slice(-100))
      setDraft('')
    } catch (error) { if (generation === chatGeneration.current) setChatError(error?.message || '发送失败，请检查账号和网络。') }
    finally {
      if (pendingRequestId.current === requestId) pendingRequestId.current = null
      sendingRef.current = false
      setSending(false)
    }
  }
  return (
    <div className="gm-free">
      <div className="gm-free-controls">
        <label className="mr-control-label" htmlFor="gm-free-route">模型路线（官方目录）</label>
        <select id="gm-free-route" className="gm-select" value={routeKey} onChange={event => { setRouteKey(event.target.value); resetChat() }} disabled={routes.length === 0}>
          {routes.length === 0 && <option value="">目录暂不可用，请在官方会话选模型</option>}
          {routes.map(item => <option key={`${item.provider}/${item.model}`} value={`${item.provider}/${item.model}`}>{item.provider}/{item.model} · {item.name}</option>)}
        </select>
        <label className="mr-control-label" htmlFor="gm-free-character">角色</label>
        <select id="gm-free-character" className="gm-select" value={character} onChange={event => { setCharacter(event.target.value); resetChat() }}>
          {Object.entries(CHARACTER_LABELS).filter(([key]) => characterImageFor(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="mr-control-label" htmlFor="gm-free-preset">场景</label>
        <select id="gm-free-preset" className="gm-select" value={preset} onChange={event => { setPreset(event.target.value); resetChat() }}>
          {FREE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <textarea className="mr-textarea" rows={4} value={extra} onChange={event => { setExtra(event.target.value); resetChat() }} placeholder="补充设定（可选）：关系、语气、禁区……" aria-label="补充设定" />
      <div className="gm-free-stage" ref={freeStageRef} style={{ '--gm-portrait-clearance': `${clearance}px` }} aria-label="开场预览">
        <StageArtwork background={presetData?.art ?? STORY_BACKGROUNDS.title} speaker={character} settings={settings} />
        <div className="gm-free-scene"><span>自由模式 · 开场预览</span><strong>{presetData?.label}</strong></div>
        <div className="gm-free-dialogue">
          <div className="gm-speaker"><Avatar speaker={character} large /><span className="gm-speaker-name">{CHARACTER_LABELS[character] ?? character}</span></div>
          <p>{presetData?.opener}</p>
        </div>
      </div>
      <section className="gm-free-chat" aria-label="自由模式对话">
        <div className="gm-free-chat-head"><strong>与 {CHARACTER_LABELS[character] ?? character} 对话</strong><span>{route ? `${route.provider}/${route.model}` : '尚无可用模型'}</span></div>
        <div className="gm-free-chat-log" role="log" aria-live="polite">
          {messages.length === 0 && <p className="mr-caption">输入第一句话后，插件会通过官方模型服务开始对话。</p>}
          {messages.map((item, index) => <div className={`gm-free-chat-message ${item.role}`} key={index}>
            <strong>{item.role === 'user' ? '你' : CHARACTER_LABELS[character] ?? character}{item.truncated ? ' · 回复已截断' : ''}</strong><p>{item.text}</p>
          </div>)}
          {sending && <p className="mr-caption" role="status">模型正在回复…</p>}
        </div>
        <label className="mr-control-label" htmlFor="gm-free-draft">你的台词</label>
        <textarea id="gm-free-draft" className="mr-textarea" rows={3} maxLength={1500} value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send() } }}
          placeholder="在场景中说些什么…（Ctrl+Enter 发送）" />
        <div className="mr-actions"><button className="mr-button" type="button" disabled={!route || sending || !draft.trim()} onClick={() => { void send() }}>发送给模型</button>
          {sending && <button className="mr-button mr-button-secondary" type="button" disabled={typeof cancelGalReply !== 'function'} onClick={() => { void stop() }}>停止生成</button>}
          <button className="mr-button mr-button-secondary" type="button" disabled={sending || messages.length === 0} onClick={resetChat}>开始新对话</button></div>
        {chatError && <p className="mr-error" role="alert">{chatError}</p>}
      </section>
      <details className="gm-free-details"><summary>查看可复制到官方会话的开场提示词</summary><pre className="gm-free-prompt">{prompt}</pre></details>
      <div className="mr-actions">
        <button className="mr-button" type="button" onClick={copy}>{copied ? '已复制，去官方会话粘贴发送' : '复制开场提示词'}</button>
        <span className="mr-caption">也可复制到官方会话使用；面板内发送会调用已配置模型，可能产生账号费用。插件不保存 API Key。</span>
      </div>
      {copyError && <p className="mr-error" role="alert">{copyError}</p>}
    </div>
  )
}

export function GalModulePage({ loadCatalog, galReply, cancelGalReply }) {
  const [tab, setTab] = React.useState('title')
  const storage = React.useMemo(() => { try { return window.localStorage } catch { return null } }, [])
  const [settings, setSettings] = React.useState(() => readGalPreferences(storage))
  const [showSettings, setShowSettings] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const [sceneTheme, setSceneTheme] = React.useState('title-city')
  const [musicWanted, setMusicWanted] = React.useState(false)
  const [musicStatus, setMusicStatus] = React.useState({ state: 'idle', message: '音乐尚未播放，请点击开启。' })
  const [localName, setLocalName] = React.useState('')
  const [localError, setLocalError] = React.useState('')
  const [titleEpisode, setTitleEpisode] = React.useState(() => { try { return selectedStoryEpisode(storage) } catch { return 'bridges' } })
  const [startNew, setStartNew] = React.useState(false)
  const [confirmNewStory, setConfirmNewStory] = React.useState(false)
  const [pageHidden, setPageHidden] = React.useState(() => document.hidden)
  const audio = React.useMemo(() => createGalAudioController({ onStatus: setMusicStatus }), [])
  const activeMusicKey = React.useRef(null)
  const disposalTimer = React.useRef(null)
  const currentTheme = settings.audio.theme === 'auto' ? sceneTheme : settings.audio.theme
  const backgroundPaused = pageHidden && settings.audio.pauseWhenHidden
  const changeSettings = React.useCallback(value => {
    const normalized = normalizeGalPreferences(value)
    setSettings(normalized)
    try { writeGalPreferences(storage, normalized); setSaveError('') }
    catch (error) { setSaveError(error.message) }
  }, [storage])
  const onMusicTheme = React.useCallback(theme => setSceneTheme(theme), [])
  const onEpisodeChange = React.useCallback(episodeId => setTitleEpisode(episodeId), [])
  React.useEffect(() => {
    const changed = () => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  React.useEffect(() => {
    // StrictMode replays setup/cleanup immediately; cancel that temporary
    // disposal, while a real unmount still releases the controller next tick.
    clearTimeout(disposalTimer.current)
    return () => { disposalTimer.current = setTimeout(() => { void audio.dispose() }, 0) }
  }, [audio])
  React.useEffect(() => { audio.setVolume(settings.audio.musicVolume / 100); audio.setMuted(settings.audio.muted) }, [audio, settings.audio.musicVolume, settings.audio.muted])
  React.useEffect(() => {
    if (!musicWanted || !settings.audio.enabled || backgroundPaused) {
      if (activeMusicKey.current !== null) { audio.stop(); activeMusicKey.current = null }
      if (!settings.audio.enabled && musicWanted) setMusicWanted(false)
      return
    }
    if (activeMusicKey.current !== currentTheme) {
      activeMusicKey.current = currentTheme
      void audio.start(currentTheme, { volume: settings.audio.musicVolume / 100 })
    }
  }, [audio, musicWanted, settings.audio.enabled, settings.audio.musicVolume, currentTheme, backgroundPaused])
  const startMusic = () => {
    changeSettings({ ...settings, audio: { ...settings.audio, enabled: true } })
    setMusicWanted(true)
    activeMusicKey.current = currentTheme
    audio.setMuted(settings.audio.muted)
    void audio.start(currentTheme, { volume: settings.audio.musicVolume / 100 })
  }
  const stopMusic = () => {
    setMusicWanted(false)
    changeSettings({ ...settings, audio: { ...settings.audio, enabled: false } })
    activeMusicKey.current = null
    audio.stop()
  }
  const loadLocalMusic = async file => {
    const result = audio.setLocalTrack(file)
    if (!result.ok) { setLocalError(result.message); return }
    setLocalError('')
    setLocalName(result.fileName)
    changeSettings({ ...settings, audio: { ...settings.audio, theme: 'local' } })
    activeMusicKey.current = null
    if (!musicWanted) setMusicStatus({ state: 'idle', message: result.message })
  }
  const onEffect = React.useCallback(kind => {
    if (musicWanted && !backgroundPaused) void playGalEffect(kind, { volume: settings.audio.effectsVolume / 100, muted: settings.audio.muted })
  }, [musicWanted, backgroundPaused, settings.audio.effectsVolume, settings.audio.muted])
  const music = { status: musicStatus, playing: musicWanted && musicStatus.state === 'playing', start: startMusic, stop: stopMusic, localName, error: localError, loadLocal: loadLocalMusic }
  const beginNew = () => { setStartNew(true); setTab('story'); setConfirmNewStory(false) }
  const requestNew = () => {
    let hasSave = false
    try { hasSave = Boolean(storage?.getItem(episodeStorageKey(STORY_STORAGE_KEY, titleEpisode))) } catch { /* 没有存储时仍可开始本次阅读。 */ }
    if (hasSave) setConfirmNewStory(true)
    else beginNew()
  }
  const continueStory = () => { setStartNew(false); setTab('story') }
  const readingStyle = { '--gm-font-size': `${settings.reading.fontSize}px`, '--gm-dialogue-alpha': settings.reading.dialogueOpacity / 100 }
  return (
    <main className="mr-workspace gm-root" style={readingStyle} data-reduce-motion={settings.reading.reduceMotion}>
      <style>{workspaceStylesheet}</style>
      <style>{galStylesheet}</style>
      <div className="mr-shell">
        <header className="mr-header">
          <div>
            <p className="mr-eyebrow">Gal Module · DeepSeek Harness</p>
            <h1 className="mr-title">Gal 模块</h1>
            <p className="mr-subtitle">剧情模式提供 Gal 视图舞台与存档；自由模式可在面板内使用官方已配置模型展开对话。</p>
          </div>
          <div className="mr-status"><span className="mr-status-dot" />剧情离线 · 自由模式按需调用模型</div>
        </header>
        <div className="mr-controls">
          <div className="mr-control-group"><span className="mr-control-label">模式</span>
            <div className="mr-segment" role="group" aria-label="Gal 模块模式">
              <button type="button" aria-pressed={tab === 'title'} onClick={() => { setTab('title'); setSceneTheme('title-city') }}>标题画面</button>
              <button type="button" aria-pressed={tab === 'story'} onClick={continueStory}>剧情模式 · Gal 视图</button>
              <button type="button" aria-pressed={tab === 'free'} onClick={() => setTab('free')}>自由模式</button>
              <button type="button" aria-pressed={tab === 'gallery'} onClick={() => setTab('gallery')}>素材鉴赏</button>
            </div>
          </div>
          <div className="gm-global-controls"><button className="mr-button mr-button-secondary" type="button" onClick={() => setShowSettings(true)}>Gal 设置</button>
            <button className="mr-button mr-button-secondary" type="button" onClick={music.playing ? stopMusic : startMusic}>{music.playing ? '暂停音乐' : '开启音乐'}</button>
            <span className="mr-caption" role="status">{backgroundPaused && musicWanted ? '后台暂停音乐' : musicStatus.message}</span></div>
        </div>
        {tab === 'title' ? <section className="gm-title-screen" style={{ backgroundImage: `url("${STORY_BACKGROUNDS.title}")` }} aria-label="Gal 标题画面">
          <div className="gm-title-copy"><p>ECHO CITY · VISUAL NOVEL</p><h2>回声之城</h2><span>每一句回应，都会留下回声。</span></div>
          <nav className="gm-title-menu" aria-label="标题菜单">
            <label>选择剧目<select className="gm-select" value={titleEpisode} onChange={event => setTitleEpisode(event.target.value)}>{STORY_EPISODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <button type="button" onClick={requestNew}>开始新故事<small>NEW STORY</small></button>
            <button type="button" onClick={continueStory}>继续阅读<small>CONTINUE</small></button>
            <button type="button" onClick={() => setShowSettings(true)}>系统设置<small>CONFIGURATION</small></button>
            <button type="button" onClick={() => setTab('gallery')}>素材鉴赏<small>GALLERY</small></button>
            <button type="button" onClick={() => setTab('free')}>自由模式<small>FREE TALK</small></button>
          </nav><span className="gm-title-footer">五部剧目 · 本地剧情 · 模型自由对话</span>
        </section> : tab === 'story' ? <StoryMode settings={settings} paused={showSettings || pageHidden} onMusicTheme={onMusicTheme} onEpisodeChange={onEpisodeChange} onEffect={onEffect} onSettings={() => setShowSettings(true)} initialEpisodeOverride={titleEpisode} startNew={startNew} />
          : tab === 'gallery' ? <GalGallery /> : <FreeModeWithRoutes loadCatalog={loadCatalog} galReply={galReply} cancelGalReply={cancelGalReply} settings={settings} onMusicTheme={onMusicTheme} />}
        {showSettings && <GalSettingsPanel settings={settings} onChange={changeSettings} onClose={() => setShowSettings(false)} saveError={saveError} music={music} />}
        {confirmNewStory && <GalDialog title="开始新故事" onClose={() => setConfirmNewStory(false)}><p>此剧目已有自动存档。开始新故事会替换当前进度，手动存档槽和快捷存档仍会保留。</p><div className="mr-actions"><button className="mr-button" type="button" onClick={beginNew}>确认开始</button><button className="mr-button mr-button-secondary" type="button" onClick={() => setConfirmNewStory(false)}>取消</button></div></GalDialog>}
      </div>
    </main>
  )
}

function FreeModeWithRoutes({ loadCatalog, galReply, cancelGalReply, settings, onMusicTheme }) {
  const [state, setState] = React.useState({ status: 'loading', routes: [] })
  React.useEffect(() => {
    let mounted = true
    Promise.resolve()
      .then(loadCatalog)
      .then(response => {
        if (!mounted) return
        if (response?.ok) {
          // Local import avoided at module scope to keep the gal bundle lean.
          return import('./catalog.mjs').then(catalog => {
            if (mounted) setState({ status: 'ready', routes: catalog.routesFromModelCatalog(response.value) })
          })
        }
        setState({ status: 'error', routes: [] })
        return undefined
      })
      .catch(() => { if (mounted) setState({ status: 'error', routes: [] }) })
    return () => { mounted = false }
  }, [loadCatalog])
  if (state.status === 'loading') return <div className="mr-empty">正在读取官方模型目录…</div>
  if (state.status === 'error') return <><div className="mr-empty">模型目录读取失败，请稍后重试；仍可复制提示词后在任意官方会话使用。</div><FreeMode routes={[]} galReply={galReply} cancelGalReply={cancelGalReply} settings={settings} onMusicTheme={onMusicTheme} /></>
  return <FreeMode routes={state.routes} galReply={galReply} cancelGalReply={cancelGalReply} settings={settings} onMusicTheme={onMusicTheme} />
}
