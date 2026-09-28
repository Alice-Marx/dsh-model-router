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
import workspaceStylesheet from './router-main.css'
import prologueStation from '../../aipicture/story-backgrounds/prologue-station.webp'
import associationOpenDay from '../../aipicture/story-backgrounds/association-open-day.webp'
import laurelTheatre from '../../aipicture/story-backgrounds/laurel-theatre.webp'
import bridgesNight from '../../aipicture/story-backgrounds/bridges-night.webp'
import threeHarbors from '../../aipicture/story-backgrounds/three-harbors.webp'
import openDomeHearing from '../../aipicture/story-backgrounds/open-dome-hearing.webp'
import protocolComposition from '../../aipicture/story-backgrounds/protocol-composition.webp'
import sixEndings from '../../aipicture/story-backgrounds/six-endings.webp'
import modelCityTitle from '../../aipicture/story-backgrounds/model-city-title.webp'
import laurelObservatory from '../../aipicture/story-backgrounds/laurel-observatory.webp'
import kimiRehearsal from '../../aipicture/story-backgrounds/kimi-rehearsal.webp'
import communityArchive from '../../aipicture/story-backgrounds/community-archive.webp'
import offlineWorkshop from '../../aipicture/story-backgrounds/offline-workshop.webp'
import evidenceLighthouse from '../../aipicture/story-backgrounds/evidence-lighthouse.webp'
import operationsBridge from '../../aipicture/story-backgrounds/operations-bridge.webp'
import harnessPortrait from '../../aipicture/DeepSeek_Harness1.png'
import deepseekPortrait from '../../aipicture/DeepSeek1.png'
import claudePortrait from '../../aipicture/Claude1.png'
import chatgptPortrait from '../../aipicture/ChatGPT1.png'
import kimiPortrait from '../../aipicture/Kimi1.png'
import perplexityPortrait from '../../aipicture/perplexity.webp'
import githubPortrait from '../../aipicture/github.webp'

const SPEAKER_LABELS = { player: '你', narrator: '' }
const SPEAKER_COLORS = ['hsl(152,45%,44%)', 'hsl(208,60%,52%)', 'hsl(27,70%,55%)', 'hsl(262,45%,58%)', 'hsl(340,55%,56%)', 'hsl(190,50%,42%)', 'hsl(88,40%,42%)', 'hsl(315,40%,52%)']
const STORY_ART = Object.freeze({
  prologue: prologueStation,
  'open-day': associationOpenDay,
  laurel: laurelTheatre,
  'bridges-night': bridgesNight,
  'three-harbors': threeHarbors,
  'open-dome-hearing': openDomeHearing,
  'protocol-composition': protocolComposition,
  'six-endings': sixEndings,
  'laurel-observatory': laurelObservatory,
  'kimi-rehearsal': kimiRehearsal,
  'community-archive': communityArchive,
  'offline-workshop': offlineWorkshop,
  'evidence-lighthouse': evidenceLighthouse,
  'operations-bridge': operationsBridge,
})
const CHARACTER_ART = Object.freeze({
  harness: harnessPortrait,
  deepseek: deepseekPortrait,
  claude: claudePortrait,
  chatgpt: chatgptPortrait,
  kimi: kimiPortrait,
  perplexity: perplexityPortrait,
  github: githubPortrait,
})

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
      {CHARACTER_ART[speaker]
        ? <img src={CHARACTER_ART[speaker]} alt="" />
        : label ? label.slice(0, 1) : '？'}
    </span>
  )
}

function StageArtwork({ background, speaker }) {
  return (
    <>
      <div className="gm-stage-art" style={{ backgroundImage: `url("${background}")` }} aria-hidden="true" />
      {CHARACTER_ART[speaker] && <img className="gm-stage-portrait" src={CHARACTER_ART[speaker]} alt="" aria-hidden="true" />}
    </>
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
  const keyDown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    click()
  }
  return (
    <div className={isNarration ? 'gm-dialogue gm-dialogue-narration' : 'gm-dialogue'} onClick={click} onKeyDown={keyDown} role="button" tabIndex={0} aria-label={done ? node.choices || node.ending ? '对话已显示，请选择剧情选项' : '继续剧情' : '显示完整对话'}>
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
  const storage = React.useMemo(() => {
    try { return typeof window !== 'undefined' ? window.localStorage : null }
    catch { return null }
  }, [])
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
      setSlots([null, null, null])
    }
  }
  const saveSlot = index => {
    setError('')
    try {
      if (!storage) throw new Error('浏览器存储不可用，无法保存剧情。')
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
  const stageSpeaker = React.useMemo(() => {
    if (CHARACTER_ART[node?.speaker]) return node.speaker
    if (node?.speaker !== 'player' && node?.speaker !== 'narrator') return null
    try { return [...storyHistory(story)].reverse().find(entry => CHARACTER_ART[entry.speaker])?.speaker ?? null }
    catch { return null }
  }, [story, node?.speaker])
  const stageBackground = STORY_ART[node?.backgroundId] ?? STORY_ART[node?.chapterId] ?? modelCityTitle

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
            onChange={event => {
              setError('')
              try {
                const chapterId = event.target.value
                const routeId = chapterId === 'side-routes' ? STORY_SIDE_ROUTES[0]?.id : null
                persist(createStory('bridges', { chapterId, routeId }))
              } catch (chapterError) { setError(chapterError.message) }
            }}
            aria-label="选择章节"
          >
            {episode.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
          </select>
        )}
        {episodeId === 'bridges' && story?.chapterId === 'side-routes' && (
          <select
            className="gm-select"
            value={story.routeId ?? STORY_SIDE_ROUTES[0]?.id ?? ''}
            onChange={event => {
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
        <button className="mr-button mr-button-secondary" type="button" onClick={restart}>重新开始</button>
      </div>

      <div className="gm-stage" data-chapter={node?.chapterId ?? story?.chapterId ?? ''}>
        <StageArtwork background={stageBackground} speaker={stageSpeaker} />
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
            {node.ending.description && <p>{node.ending.description}</p>}
            {Array.isArray(node.ending.epilogue) && node.ending.epilogue.map((line, index) => <p key={index}>{line}</p>)}
            {Array.isArray(node.ending.relationshipEpilogues) && node.ending.relationshipEpilogues.map(ending => (
              <section className="gm-ending-epilogue" key={ending.id}>
                <h4>{ending.title}</h4>
                <p>{ending.description}</p>
              </section>
            ))}
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
  { id: 'cafe', label: '开放日休息区', world: '百模协会开放日临近散场，展台边的灯仍亮着。', opener: '你从喧闹的人群走到一张安静的圆桌旁。', art: associationOpenDay },
  { id: 'lab', label: '千桥夜班', world: '深夜的千桥运维室，窗外桥灯和报警灯明灭。', opener: '你发现值班记录的时间戳对不上，抬起头。', art: bridgesNight },
  { id: 'station', label: '千桥站台', world: '千桥站台，末班车即将开出。', opener: '你说：“今天也辛苦了。”', art: prologueStation },
]

function FreeMode({ routes, galReply, cancelGalReply }) {
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
  const prompt = [
    `请以视觉小说角色的方式与我对话。`,
    `你扮演：${STORY_CHARACTERS[character] ?? character}。`,
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
          {Object.entries(STORY_CHARACTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="mr-control-label" htmlFor="gm-free-preset">场景</label>
        <select id="gm-free-preset" className="gm-select" value={preset} onChange={event => { setPreset(event.target.value); resetChat() }}>
          {FREE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <textarea className="mr-textarea" rows={4} value={extra} onChange={event => { setExtra(event.target.value); resetChat() }} placeholder="补充设定（可选）：关系、语气、禁区……" aria-label="补充设定" />
      <div className="gm-free-stage" aria-label="开场预览">
        <StageArtwork background={presetData?.art ?? modelCityTitle} speaker={character} />
        <div className="gm-free-scene"><span>自由模式 · 开场预览</span><strong>{presetData?.label}</strong></div>
        <div className="gm-free-dialogue">
          <div className="gm-speaker"><Avatar speaker={character} large /><span className="gm-speaker-name">{STORY_CHARACTERS[character] ?? character}</span></div>
          <p>{presetData?.opener}</p>
        </div>
      </div>
      <section className="gm-free-chat" aria-label="自由模式对话">
        <div className="gm-free-chat-head"><strong>与 {STORY_CHARACTERS[character] ?? character} 对话</strong><span>{route ? `${route.provider}/${route.model}` : '尚无可用模型'}</span></div>
        <div className="gm-free-chat-log" role="log" aria-live="polite">
          {messages.length === 0 && <p className="mr-caption">输入第一句话后，插件会通过官方模型服务开始对话。</p>}
          {messages.map((item, index) => <div className={`gm-free-chat-message ${item.role}`} key={index}>
            <strong>{item.role === 'user' ? '你' : STORY_CHARACTERS[character] ?? character}{item.truncated ? ' · 回复已截断' : ''}</strong><p>{item.text}</p>
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
  const [tab, setTab] = React.useState('story')
  return (
    <main className="mr-workspace gm-root">
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
              <button type="button" aria-pressed={tab === 'story'} onClick={() => setTab('story')}>剧情模式 · Gal 视图</button>
              <button type="button" aria-pressed={tab === 'free'} onClick={() => setTab('free')}>自由模式</button>
            </div>
          </div>
        </div>
        {tab === 'story' ? <StoryMode /> : <FreeModeWithRoutes loadCatalog={loadCatalog} galReply={galReply} cancelGalReply={cancelGalReply} />}
      </div>
    </main>
  )
}

function FreeModeWithRoutes({ loadCatalog, galReply, cancelGalReply }) {
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
  if (state.status === 'error') return <><div className="mr-empty">模型目录读取失败，请稍后重试；仍可复制提示词后在任意官方会话使用。</div><FreeMode routes={[]} galReply={galReply} cancelGalReply={cancelGalReply} /></>
  return <FreeMode routes={state.routes} galReply={galReply} cancelGalReply={cancelGalReply} />
}
