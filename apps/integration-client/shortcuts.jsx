import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { UiIcon } from './ui-icons.jsx'

/** `g` then a letter opens a workspace page; only outside text fields, so typing is never taken. */
export const JUMPS = [
  ['i', 'inbox', '收件箱'], ['b', 'bindings', 'Bot 与模型'], ['e', 'engines', 'AI 引擎'], ['t', 'tasks', '任务'],
  ['c', 'machines', '远程电脑'], ['l', 'library', '资料库'], ['r', 'routine', '例行任务'], ['u', 'usage', '费用与用量'],
]
const WORKBENCH = ['w', 'model-router-galgame', '高级工作台']
const SEQUENCE_MS = 1200
const editable = target => typeof target?.closest === 'function'
  && Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]'))
const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '')

/** One keydown handler; `config()` is read on every key so a remounted navigation keeps working. */
export function shortcutHandler(config, now = () => Date.now()) {
  let lead = 0
  return (event) => {
    if (event.defaultPrevented || event.isComposing) return
    const { panels, go, toggle } = config() ?? {}
    if (!go) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === '/' || event.code === 'Slash')) {
      event.preventDefault(); toggle(); return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) { lead = 0; return }
    const key = String(event.key ?? '').toLowerCase()
    if (lead && now() - lead <= SEQUENCE_MS) {
      lead = 0
      const jump = [...JUMPS, WORKBENCH].find(([letter]) => letter === key)
      const id = jump === WORKBENCH ? WORKBENCH[1] : jump && panels?.[jump[1]]
      if (id) { event.preventDefault(); go(id) }
      return
    }
    lead = key === 'g' && !event.shiftKey ? now() : 0
  }
}

const store = { open: false, version: 0, subscribers: new Set(), window: null }
const emit = () => { store.version++; for (const notify of store.subscribers) notify() }
const subscribe = notify => { store.subscribers.add(notify); return () => store.subscribers.delete(notify) }
const snapshot = () => `${store.open}:${store.version}`
export const setShortcutSheet = open => { store.open = open; emit() }
const closeSheet = () => setShortcutSheet(false)
const layers = new Set()
const firstLayer = () => layers.values().next().value
const onKey = shortcutHandler(() => firstLayer()?.config)

function ShortcutSheet({ onClose }) {
  const close = useRef(null)
  useEffect(() => {
    close.current?.focus()
    const win = close.current?.ownerDocument.defaultView ?? window
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    win.addEventListener('keydown', escape, true)
    return () => win.removeEventListener('keydown', escape, true)
  }, [onClose])
  const mod = isMac() ? '⌘' : 'Ctrl'
  return <div className="bp-shortcuts" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="bp-shortcuts-card" role="dialog" aria-modal="true" aria-label="键盘快捷键">
      <div className="bp-card-title"><h2>键盘快捷键</h2><button ref={close} type="button" className="bp-icon-button" aria-label="关闭" onClick={onClose}><UiIcon name="close" size={16} /></button></div>
      <dl>
        <dt>显示或关闭本面板</dt><dd><kbd>{mod}</kbd><kbd>/</kbd></dd>
        {[...JUMPS, WORKBENCH].map(([letter, , label]) => <React.Fragment key={letter}><dt>打开{label}</dt><dd><kbd>G</kbd><kbd>{letter.toUpperCase()}</kbd></dd></React.Fragment>)}
        <dt>关闭菜单或面板</dt><dd><kbd>Esc</kbd></dd>
        <dt>在模型菜单中上下移动</dt><dd><kbd>↑</kbd><kbd>↓</kbd></dd>
      </dl>
      <p className="bp-muted">字母快捷键只在没有输入框获得焦点时生效，打字不会被拦截。</p>
    </section>
  </div>
}

/**
 * Mounted with the workspace navigation. The sidebar can be mounted more than once (wide
 * and compact), so one listener serves every copy and only the first copy draws the sheet.
 */
export function ShortcutLayer({ panels, go }) {
  const self = useRef(null)
  if (self.current === null) self.current = {}
  useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    const layer = self.current, win = window
    layers.add(layer)
    if (layers.size === 1) { store.window = win; win.addEventListener('keydown', onKey) }
    emit()
    return () => {
      layers.delete(layer)
      if (layers.size === 0) { store.window?.removeEventListener('keydown', onKey); store.window = null; store.open = false }
      emit()
    }
  }, [])
  useEffect(() => { self.current.config = { panels, go, toggle: () => setShortcutSheet(!store.open) } }, [panels, go])
  const owner = firstLayer() === self.current
  if (!store.open || !owner) return null
  return createPortal(<ShortcutSheet onClose={closeSheet} />, document.body)
}
