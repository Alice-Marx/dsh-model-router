import React from 'react'
import { CHARACTER_LABELS } from './character-identity.mjs'
import { characterImageFor } from './characters.mjs'
import { expressionFor, fullBodyPortraitFor, STORY_EMOTION_LABELS } from './gal-game-expressions.mjs'
import { STORY_BACKGROUNDS } from './gal-story-backgrounds.mjs'
import { DEFAULT_GAL_PREFERENCES, portraitLayoutFor, portraitStyleFor } from './gal-preferences.mjs'
import { GAL_MUSIC_OPTIONS } from './gal-audio-controller.mjs'

export function GalDialog({ title, onClose, children }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const previous = document.activeElement
    const dialog = ref.current
    dialog.showModal()
    return () => { dialog.close(); if (previous?.isConnected) previous.focus?.() }
  }, [])
  return <dialog ref={ref} className="gm-panel" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header className="gm-panel-head"><h2>{title}</h2><button className="mr-button mr-button-secondary" type="button" onClick={onClose}>关闭</button></header>
    {children}
  </dialog>
}

function Range({ label, value, min, max, step = 1, suffix = '', onChange }) {
  return <label className="gm-setting-range"><span>{label}<output>{value}{suffix}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>
}

export function GalSettingsPanel({ settings, onChange, onClose, saveError, music }) {
  const [target, setTarget] = React.useState('main')
  const [confirmReset, setConfirmReset] = React.useState(false)
  const localFileRef = React.useRef(null)
  const characterTarget = target !== 'main' && target !== 'companion'
  const speaker = characterTarget ? target : target === 'companion' ? 'kimi' : 'claude'
  const companion = target === 'companion'
  const layout = characterTarget ? portraitLayoutFor(settings, speaker, companion) : settings.portraits[target]
  const previewSettings = characterTarget ? settings : { ...settings, portraits: { ...settings.portraits, characters: {} } }
  const inherited = characterTarget && !Object.hasOwn(settings.portraits.characters, target)
  const updateLayout = (field, value) => {
    const portraits = characterTarget
      ? { ...settings.portraits, characters: { ...settings.portraits.characters, [target]: { ...layout, [field]: value } } }
      : { ...settings.portraits, [target]: { ...settings.portraits[target], [field]: value } }
    onChange({ ...settings, portraits })
  }
  const resetLayout = () => {
    if (characterTarget) {
      const characters = { ...settings.portraits.characters }
      delete characters[target]
      onChange({ ...settings, portraits: { ...settings.portraits, characters } })
    } else onChange({ ...settings, portraits: { ...settings.portraits, [target]: DEFAULT_GAL_PREFERENCES.portraits[target] } })
  }
  const changeAudio = (field, value) => onChange({ ...settings, audio: { ...settings.audio, [field]: value } })
  const changeReading = (field, value) => onChange({ ...settings, reading: { ...settings.reading, [field]: value } })
  return <GalDialog title="Gal 设置" onClose={onClose}>
    <p className="mr-caption">调整立即生效，并自动保存在当前浏览器或桌面 profile；不会修改剧情存档。</p>
    {saveError && <p className="mr-error" role="alert">{saveError} 本次调整仍可使用。</p>}
    <div className="gm-settings-grid">
      <section className="gm-setting-card"><h3>立绘 · 大小与位置</h3>
        <label className="gm-setting-label">立绘显示方式<select className="gm-select" value={settings.portraits.source} onChange={event => onChange({ ...settings, portraits: { ...settings.portraits, source: event.target.value } })}>
          <option value="full-body">完整全身原画</option><option value="expressions">表情特写（半身差分）</option>
        </select></label>
        <p className="mr-caption">全身模式保留完整原画，头像仍可切换表情；半身差分用于表情特写。</p>
        <label className="gm-setting-label">调整对象<select className="gm-select" value={target} onChange={event => setTarget(event.target.value)}>
          <option value="main">主角色默认</option><option value="companion">同伴默认</option>
          {Object.entries(CHARACTER_LABELS).filter(([key]) => characterImageFor(key)).map(([key, label]) => <option key={key} value={key}>{label} · 单独设置</option>)}
        </select></label>
        <p className="mr-caption">{characterTarget ? inherited ? '此角色当前继承主角色默认值；拖动后建立单独设置。' : '该角色使用单独设置，剧情与自由模式共用。' : '没有单独设置的角色会使用此默认值。'}</p>
        <Range label="立绘缩放" value={layout.scale} min={40} max={180} suffix="%" onChange={value => updateLayout('scale', value)} />
        <Range label="水平位置" value={layout.x} min={0} max={100} suffix="%" onChange={value => updateLayout('x', value)} />
        <Range label="距舞台底部" value={layout.y} min={-30} max={50} suffix="%" onChange={value => updateLayout('y', value)} />
        <div className="gm-layout-preview" aria-label="立绘设置实时预览" style={{ backgroundImage: `url("${STORY_BACKGROUNDS.laurel}")` }}>
          <img src={settings.portraits.source === 'expressions' ? expressionFor(speaker, 'neutral') : fullBodyPortraitFor(speaker)} alt={`${CHARACTER_LABELS[speaker]} 立绘预览`} style={portraitStyleFor(previewSettings, speaker, companion)} />
          <span>实时预览 · 舞台边界会裁切超出部分</span>
        </div>
        <button className="mr-button mr-button-secondary" type="button" onClick={resetLayout}>{characterTarget ? '清除该角色设置，继承默认' : '恢复此位置默认值'}</button>
      </section>
      <section className="gm-setting-card"><h3>音乐与音效</h3>
        <div className="mr-actions"><button className="mr-button" type="button" onClick={music.playing ? music.stop : music.start}>{music.playing ? '暂停音乐' : '开启音乐'}</button>
          <button className="mr-button mr-button-secondary" type="button" aria-pressed={settings.audio.muted} onClick={() => changeAudio('muted', !settings.audio.muted)}>{settings.audio.muted ? '取消静音' : '全部静音'}</button></div>
        <p className="mr-caption" role="status">{music.status.message || (music.playing ? '音乐播放中' : '音乐尚未播放，请点击开启。')}</p>
        <Range label="背景音乐音量" value={settings.audio.musicVolume} min={0} max={100} suffix="%" onChange={value => changeAudio('musicVolume', value)} />
        <Range label="操作音效音量" value={settings.audio.effectsVolume} min={0} max={100} suffix="%" onChange={value => changeAudio('effectsVolume', value)} />
        <label className="gm-setting-label">背景音乐<select className="gm-select" value={settings.audio.theme} onChange={event => changeAudio('theme', event.target.value)}>
          {GAL_MUSIC_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>
        <input ref={localFileRef} type="file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.flac" hidden onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void music.loadLocal(file)
        }} />
        <button className="mr-button mr-button-secondary" type="button" onClick={() => localFileRef.current?.click()}>选择本地音乐（最多 30 MB）</button>
        {music.localName && <p className="mr-caption">本次选择：{music.localName}。文件留在本机，重开插件需重新选择。</p>}
        {music.error && <p className="mr-error" role="alert">{music.error}</p>}
        <label className="gm-check"><input type="checkbox" checked={settings.audio.pauseWhenHidden} onChange={event => changeAudio('pauseWhenHidden', event.target.checked)} />切到后台时暂停音乐（后台阅读始终暂停）</label>
        <p className="mr-caption">内置七首循环配乐可离线使用。首次播放需点击；音量为 0 时完全静音。操作音效只在开启音乐后播放。</p>
      </section>
      <section className="gm-setting-card"><h3>文字与阅读</h3>
        <Range label="逐字间隔（0 为立即显示）" value={settings.reading.textSpeed} min={0} max={120} suffix=" ms" onChange={value => changeReading('textSpeed', value)} />
        <Range label="对话字号" value={settings.reading.fontSize} min={12} max={32} suffix=" px" onChange={value => changeReading('fontSize', value)} />
        <Range label="自动阅读等待" value={settings.reading.autoDelay} min={300} max={10000} step={100} suffix=" ms" onChange={value => changeReading('autoDelay', value)} />
        <Range label="对话框不透明度" value={settings.reading.dialogueOpacity} min={20} max={100} suffix="%" onChange={value => changeReading('dialogueOpacity', value)} />
        <label className="gm-check"><input type="checkbox" checked={settings.reading.skipUnread} onChange={event => changeReading('skipUnread', event.target.checked)} />允许快进未读文字（可能错过内容）</label>
        <label className="gm-check"><input type="checkbox" checked={settings.reading.reduceMotion} onChange={event => changeReading('reduceMotion', event.target.checked)} />减少动画，立即显示文字</label>
        <p className="mr-caption">自动与快进都会停在选项、命名输入和结局，切到后台或打开对话框时暂停。</p>
      </section>
      <section className="gm-setting-card"><h3>快捷操作</h3>
        <dl className="gm-shortcuts"><dt>Enter / 空格</dt><dd>显示整句，再次按下继续</dd><dt>A / S</dt><dd>自动阅读 / 快进切换</dd><dt>H / Escape</dt><dd>隐藏界面 / 恢复界面或关闭窗口</dd><dt>F</dt><dd>切换舞台全屏</dd><dt>Q / L</dt><dd>快捷存档 / 确认读取快捷存档</dd><dt>←</dt><dd>返回本次阅读的上一句（最多 30 步）</dd></dl>
        <p className="mr-caption">快捷键在剧情舞台获得焦点时生效；输入框、选择框和按钮不会触发剧情快捷键。</p>
        {confirmReset ? <div className="gm-confirm-inline"><p>恢复全部设置？剧情存档和已读记录会保留。</p><button className="mr-button" type="button" onClick={() => { onChange(DEFAULT_GAL_PREFERENCES); setConfirmReset(false) }}>确认恢复</button><button className="mr-button mr-button-secondary" type="button" onClick={() => setConfirmReset(false)}>取消</button></div>
          : <button className="mr-button mr-button-secondary" type="button" onClick={() => setConfirmReset(true)}>恢复全部默认设置</button>}
      </section>
    </div>
  </GalDialog>
}

export function GalGallery() {
  const [kind, setKind] = React.useState('characters')
  const [character, setCharacter] = React.useState('claude')
  const [emotion, setEmotion] = React.useState('neutral')
  const [source, setSource] = React.useState('full-body')
  const backgrounds = React.useMemo(() => {
    const unique = new Set()
    return Object.entries(STORY_BACKGROUNDS).filter(([, image]) => { if (unique.has(image)) return false; unique.add(image); return true })
  }, [])
  const [scene, setScene] = React.useState('title')
  return <section className="gm-gallery">
    <h2>素材鉴赏</h2><p className="mr-caption">查看已打包的立绘与场景素材（全部开放，可能包含剧透）。缺少特定表情时使用该角色的基础立绘。</p>
    <div className="mr-segment" role="group" aria-label="鉴赏类型"><button type="button" aria-pressed={kind === 'characters'} onClick={() => setKind('characters')}>人物立绘</button><button type="button" aria-pressed={kind === 'scenes'} onClick={() => setKind('scenes')}>场景画廊</button></div>
    {kind === 'characters' ? <>
      <div className="gm-story-toolbar"><label>角色 <select className="gm-select" value={character} onChange={event => setCharacter(event.target.value)}>{Object.entries(CHARACTER_LABELS).filter(([key]) => characterImageFor(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>显示 <select className="gm-select" value={source} onChange={event => setSource(event.target.value)}><option value="full-body">全身原画</option><option value="expressions">表情特写</option></select></label>
        <label>表情 <select className="gm-select" disabled={source === 'full-body'} value={emotion} onChange={event => setEmotion(event.target.value)}>{Object.entries(STORY_EMOTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className="gm-gallery-art gm-gallery-character"><img src={source === 'full-body' ? fullBodyPortraitFor(character) : expressionFor(character, emotion)} alt={`${CHARACTER_LABELS[character]} · ${source === 'full-body' ? '全身原画' : STORY_EMOTION_LABELS[emotion]}`} /></div>
    </> : <><label>场景 <select className="gm-select" value={scene} onChange={event => setScene(event.target.value)}>{backgrounds.map(([id], index) => <option key={id} value={id}>场景 {index + 1} · {id}</option>)}</select></label><div className="gm-gallery-art"><img src={STORY_BACKGROUNDS[scene]} alt={`场景 ${scene}`} /></div></>}
  </section>
}
