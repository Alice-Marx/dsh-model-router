/**
 * Gal 模块 · 官方桌面独立分块。
 *
 * 剧情模式：完整 gal 视图舞台（场景头、角色立绘位、对话框、选项、结局、
 * 历史与三槽存档），剧情引擎为确定性纯函数，全部在客户端运行。
 * 自由模式：选择官方模型目录中的路线与角色，合成一段角色扮演开场提示词，
 * 交给官方会话执行；本面板不直接调用模型。
 */
import React from 'react'
import {
  STORY_EPISODES,
  STORY_CHARACTERS,
  getStoryEpisode,
  createStory,
  currentStoryNode,
  advanceStory,
  storyHistory,
  normalizeStory,
} from '../shared/gal-story-catalog.mjs'
import {
  STORY_STORAGE_KEY,
  episodeStorageKey,
  selectedStoryEpisode,
  readStory,
  writeStory,
  readStorySlots,
} from './gal-story-storage.mjs'
import galStylesheet from './gal-module.css'

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

function Avatar({ speaker, large = false }) {
  const label = speakerLabel(speaker)
  const color = speakerColor(speaker)
  return (
    <span className={large ? 'gm-avatar gm-avatar-large' : 'gm-avatar'} style={{ background: color }} aria-hidden="true">
      {label ? label.slice(0, 1) : '？'}
    </span>
  )
}

function useTypewriter(fullText, speed = 24) {
  const [shown, setShown] = React.useState('')
  const doneRef = React.useRef(false)
  React.useEffect(() => {
    doneRef.current = false
    setShown('')
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
      {node.description && <p className="gm-stage-desc">{node.description}</p>}
    </header>
  )
}

function Dialogue({ node, onAdvance }) {
  const isNarration = node.speaker === 'narrator'
  const { shown, complete, done } = useTypewriter(node.text ?? '')
  const click = () => {
    if (!done) complete()
    else if (!node.choices && !node.ending) onAdvance(null)
  }
  return (
    <div className={isNarration ? 'gm-dialogue gm-dialogue-narration' : 'gm-dialogue'} onClick={click} role="presentation">
      {!isNarration && (
        <div className="gm-speaker">
          <Avatar speaker={node.speaker} large />
          <span className="gm-speaker-name">{speakerLabel(node.speaker)}</span>
        </div>
      )}
      <p className="gm-dialogue-text">{shown}{!done && <span className="gm-caret">▍</span>}</p>
      {!node.choices && !node.ending && done && <span className="gm-next-hint">点击继续 ▸</span>}
    </div>
  )
}

function StoryMode() {
  const storage = typeof window !== 'undefined' ? window.localStorage : null
  const [episodeId, setEpisodeId] = React.useState(() => selectedStoryEpisode(storage))
  const [story, setStory] = React.useState(() => {
    try {
      return readStory(storage, episodeStorageKey(STORY_STORAGE_KEY, selectedStoryEpisode(storage)), selectedStoryEpisode(storage))
    } catch {
      return createStory(selectedStoryEpisode(storage))
    }
  })
  const [error, setError] = React.useState('')
  const [showHistory, setShowHistory] = React.useState(false)
  const [slots, setSlots] = React.useState(() => {
    try { return readStorySlots(storage, STORY_STORAGE_KEY, episodeId) } catch { return [null, null, null] }
  })
  const node = React.useMemo(() => {
    try { return currentStoryNode(story) } catch { return null }
  }, [story])

  const baseKey = episodeStorageKey(STORY_STORAGE_KEY, episodeId)
  const persist = next => {
    setStory(next)
    try { writeStory(storage, baseKey, next, episodeId) } catch (writeError) { setError(writeError.message) }
  }
  const advance = choiceId => {
    setError('')
    try { persist(advanceStory(story, choiceId)) } catch (advanceError) { setError(advanceError.message) }
  }
  const switchEpisode = nextId => {
    setError('')
    setEpisodeId(nextId)
    try { storage?.setItem(`${STORY_STORAGE_KEY}:episode`, nextId) } catch { /* 存储不可用时仅本次生效 */ }
    try {
      const key = episodeStorageKey(STORY_STORAGE_KEY, nextId)
      setStory(readStory(storage, key, nextId))
      setSlots(readStorySlots(storage, STORY_STORAGE_KEY, nextId))
    } catch {
      setStory(createStory(nextId))
    }
  }
  const saveSlot = index => {
    setError('')
    try {
      const current = JSON.parse(storage?.getItem(`${STORY_STORAGE_KEY}:slots`) || '[]')
      current[index] = { state: JSON.parse(JSON.stringify(story)), savedAt: new Date().toLocaleString() }
      storage?.setItem(`${STORY_STORAGE_KEY}:slots`, JSON.stringify(current))
      setSlots(readStorySlots(storage, STORY_STORAGE_KEY, episodeId))
    } catch (slotError) { setError(slotError.message) }
  }
  const loadSlot = index => {
    setError('')
    try {
      const slot = readStorySlots(storage, STORY_STORAGE_KEY, episodeId)[index]
      if (!slot || slot.invalid) throw new Error('该存档槽为空或已损坏。')
      persist(normalizeStory(slot.state))
    } catch (loadError) { setError(loadError.message) }
  }
  const restart = () => {
    setError('')
    persist(createStory(episodeId))
  }

  const episode = getStoryEpisode(story) ?? STORY_EPISODES.find(item => item.id === episodeId)
  const history = React.useMemo(() => {
    if (!showHistory) return []
    try { return storyHistory(story) } catch { return [] }
  }, [story, showHistory])

  return (
    <div className="gm-story">
      <div className="gm-story-toolbar">
        <label className="mr-control-label" htmlFor="gm-episode">剧目</label>
        <select id="gm-episode" className="gm-select" value={episodeId} onChange={event => switchEpisode(event.target.value)}>
          {STORY_EPISODES.map(item => <option key={item.id} value={item.id}>{item.label} · {item.title}</option>)}
        </select>
        {episode?.chapters?.length > 0 && (
          <select
            className="gm-select"
            value={story?.chapterId ?? ''}
            onChange={event => { try { persist(createStory({ chapterId: event.target.value })) } catch (chapterError) { setError(chapterError.message) } }}
            aria-label="选择章节"
          >
            {episode.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
          </select>
        )}
        <button className="mr-button mr-button-secondary" type="button" onClick={() => setShowHistory(value => !value)}>{showHistory ? '收起历史' : '历史'}</button>
        <button className="mr-button mr-button-secondary" type="button" onClick={restart}>重新开始</button>
      </div>

      <div className="gm-stage" data-chapter={node?.chapterId ?? story?.chapterId ?? ''}>
        {node && <StageHeader node={node} />}
        {node && <Dialogue node={node} onAdvance={advance} />}
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
            {Array.isArray(node.ending.epilogue) && node.ending.epilogue.map((line, index) => <p key={index}>{line}</p>)}
            <button className="mr-button" type="button" onClick={restart}>开启新的一周目</button>
          </div>
        )}
        {!node && <div className="mr-empty">剧情引擎无法读取当前存档，请重新开始。</div>}
      </div>

      {showHistory && (
        <div className="gm-history" role="log" aria-label="剧情历史">
          {history.map((entry, index) => (
            <p key={`${entry.id}-${index}`} className={entry.speaker === 'player' ? 'gm-history-player' : ''}>
              {speakerLabel(entry.speaker) && <strong>{speakerLabel(entry.speaker)}：</strong>}
              {entry.text}
            </p>
          ))}
        </div>
      )}

      <div className="gm-slots">
        <span className="mr-control-label">存档</span>
        {[0, 1, 2].map(index => {
          const slot = slots[index]
          return (
            <span key={index} className="gm-slot">
              <button className="mr-button mr-button-secondary" type="button" onClick={() => saveSlot(index)}>存 {index + 1}</button>
              <button className="mr-button mr-button-secondary" type="button" disabled={!slot || slot.invalid} onClick={() => loadSlot(index)} title={slot?.savedAt ?? ''}>读 {index + 1}</button>
            </span>
          )
        })}
        <span className="mr-caption">存档保存在浏览器本地。</span>
      </div>
      {error && <p className="mr-error" role="alert">{error}</p>}
    </div>
  )
}

const FREE_PRESETS = [
  { id: 'cafe', label: '雨夜咖啡店', world: ' near 一家打烊前的小咖啡馆，窗外下着雨。', opener: '你推门进来，抖了抖伞上的水。' },
  { id: 'lab', label: '深夜实验室', world: '深夜的机房，服务器指示灯像星星。', opener: '巡检脚本突然停在第 47 行，你抬起头。' },
  { id: 'station', label: '末班车站', world: '末班车站台，广播已经停止。', opener: '你说：“今天也辛苦了。”' },
]

function FreeMode({ routes }) {
  const [routeKey, setRouteKey] = React.useState(routes[0] ? `${routes[0].provider}/${routes[0].model}` : '')
  const [character, setCharacter] = React.useState('harness')
  const [preset, setPreset] = React.useState('cafe')
  const [extra, setExtra] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const route = routes.find(item => `${item.provider}/${item.model}` === routeKey) ?? routes[0]
  const presetData = FREE_PRESETS.find(item => item.id === preset)
  const prompt = [
    `请以视觉小说角色的方式与我对话。`,
    `你扮演：${STORY_CHARACTERS[character] ?? character}。`,
    `场景：${presetData?.world.trim() ?? ''}`,
    presetData?.opener ? `开场动作提示：${presetData.opener}` : '',
    extra.trim() ? `补充设定：${extra.trim()}` : '',
    '',
    '要求：每次回复不超过三段；动作写在括号里；保持角色语气；不要跳出角色解释自己是 AI。',
    route ? `（请在官方会话中选择模型 ${route.provider}/${route.model} 后发送本提示词。）` : '',
  ].filter(Boolean).join('\n')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch { /* 用户可手动全选复制 */ }
  }
  return (
    <div className="gm-free">
      <div className="gm-free-controls">
        <label className="mr-control-label" htmlFor="gm-free-route">模型路线（官方目录）</label>
        <select id="gm-free-route" className="gm-select" value={routeKey} onChange={event => setRouteKey(event.target.value)}>
          {routes.map(item => <option key={`${item.provider}/${item.model}`} value={`${item.provider}/${item.model}`}>{item.provider}/{item.model} · {item.name}</option>)}
        </select>
        <label className="mr-control-label" htmlFor="gm-free-character">角色</label>
        <select id="gm-free-character" className="gm-select" value={character} onChange={event => setCharacter(event.target.value)}>
          {Object.entries(STORY_CHARACTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="mr-control-label" htmlFor="gm-free-preset">场景</label>
        <select id="gm-free-preset" className="gm-select" value={preset} onChange={event => setPreset(event.target.value)}>
          {FREE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <textarea className="mr-textarea" rows={4} value={extra} onChange={event => setExtra(event.target.value)} placeholder="补充设定（可选）：关系、语气、禁区……" aria-label="补充设定" />
      <div className="gm-free-stage" aria-label="开场预览">
        <div className="gm-speaker"><Avatar speaker={character} large /><span className="gm-speaker-name">{STORY_CHARACTERS[character] ?? character}</span></div>
        <pre className="gm-free-prompt">{prompt}</pre>
      </div>
      <div className="mr-actions">
        <button className="mr-button" type="button" onClick={copy} disabled={!route}>{copied ? '已复制，去官方会话粘贴发送' : '复制开场提示词'}</button>
        <span className="mr-caption">自由对话在官方会话中进行：先在官方会话选择上面的模型，再粘贴提示词。本面板不直接调用模型、不保存 API Key。</span>
      </div>
    </div>
  )
}

export function GalModulePage({ loadCatalog }) {
  const [tab, setTab] = React.useState('story')
  return (
    <main className="mr-workspace gm-root">
      <style>{galStylesheet}</style>
      <div className="mr-shell">
        <header className="mr-header">
          <div>
            <p className="mr-eyebrow">Gal Module · DeepSeek Harness</p>
            <h1 className="mr-title">Gal 模块</h1>
            <p className="mr-subtitle">剧情模式提供完整 gal 视图舞台与存档；自由模式把角色扮演开场交给官方会话中的任意已配置模型。</p>
          </div>
          <div className="mr-status"><span className="mr-status-dot" />客户端运行 · 不调用模型</div>
        </header>
        <div className="mr-controls">
          <div className="mr-control-group"><span className="mr-control-label">模式</span>
            <div className="mr-segment" role="group" aria-label="Gal 模块模式">
              <button type="button" aria-pressed={tab === 'story'} onClick={() => setTab('story')}>剧情模式 · Gal 视图</button>
              <button type="button" aria-pressed={tab === 'free'} onClick={() => setTab('free')}>自由模式</button>
            </div>
          </div>
        </div>
        {tab === 'story' ? <StoryMode /> : <FreeModeWithRoutes loadCatalog={loadCatalog} />}
      </div>
    </main>
  )
}

function FreeModeWithRoutes({ loadCatalog }) {
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
            setState({ status: 'ready', routes: catalog.routesFromModelCatalog(response.value) })
          })
        }
        setState({ status: 'error', routes: [] })
        return undefined
      })
      .catch(() => { if (mounted) setState({ status: 'error', routes: [] }) })
    return () => { mounted = false }
  }, [loadCatalog])
  if (state.status === 'loading') return <div className="mr-empty">正在读取官方模型目录…</div>
  if (state.status === 'error') return <div className="mr-empty">模型目录读取失败，请稍后重试；仍可复制提示词后在任意官方会话使用。</div>
  return <FreeMode routes={state.routes} />
}
