// The Bot's remote desktop, inside the details drawer — shaped like the Grok Bot screen: a small
// card on the right, and the same picture enlarged when you want to look closer or drive it.
//
// Two things a person decides explicitly:
//  - 仅观看 (watch) vs 取得控制权 (control): a click only reaches the machine in control mode, so
//    looking around never types or clicks by accident.
//  - the card vs the big window: the card is for glancing; the window is for working.
//
// This pane owns no authority: the product client registers a bridge on `globalThis`
// (`__dshDesktop`) whose calls already run as the owner through the plugin's remote channel. A
// frame is single use, so every action carries the id of the picture that person saw.

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'

const bridge = () => {
  const value = globalThis.__dshDesktop
  return value && typeof value.view === 'function' ? value : null
}

/** Map a click inside the rendered box back to pixels of the original frame. */
function pointOf(event, element, frame) {
  if (!element || !frame?.width || !frame?.height) return null
  const rect = element.getBoundingClientRect()
  const ratio = Math.min(rect.width / frame.width, rect.height / frame.height)
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  const x = Math.floor((event.clientX - rect.left - (rect.width - frame.width * ratio) / 2) / ratio)
  const y = Math.floor((event.clientY - rect.top - (rect.height - frame.height * ratio) / 2) / ratio)
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null
  return { x, y }
}

export function DesktopPane({ bot }) {
  const [machines, setMachines] = useState([])
  const [machineId, setMachineId] = useState('')
  const [frame, setFrame] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [control, setControl] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const smallRef = useRef(null)
  const bigRef = useRef(null)

  const api = bridge()

  useEffect(() => {
    if (!api) return undefined
    let current = true
    Promise.resolve(api.machines?.()).then(
      (rows) => {
        if (!current || !Array.isArray(rows)) return
        setMachines(rows)
        setMachineId((before) => before || rows[0]?.machineId || '')
      },
      () => {},
    )
    return () => { current = false }
  }, [api])

  const capture = useCallback(async () => {
    if (!api || !machineId) return
    setStatus('capturing')
    setError('')
    try {
      const next = await api.view(bot.id, machineId)
      if (next?.unavailable) {
        setFrame(null)
        setStatus('unavailable')
        setError(next.reason === 'FRAME_MISSING' ? '没有拿到画面帧。' : '桌面暂不可用：检查那台机器是否在线、是否锁屏。')
        return
      }
      setFrame(next)
      setStatus('ready')
    } catch (failure) {
      setStatus('error')
      setError(String(failure?.message ?? failure))
    }
  }, [api, bot.id, machineId])

  // One frame when the tab opens, then fresh frames only while asked.
  useEffect(() => {
    if (!api || !machineId || frame) return
    void capture()
  }, [api, machineId, frame, capture])

  useEffect(() => {
    if (!live || !api || !machineId) return undefined
    const timer = setInterval(() => { void capture() }, 1500)
    return () => clearInterval(timer)
  }, [live, api, machineId, capture])

  const act = async (action) => {
    if (!api || !frame?.screenshotId) return
    if (!control) { setError('当前是仅观看模式，点「取得控制权」后才会真正操作这台电脑。'); return }
    setError('')
    try {
      const result = await api.act(bot.id, machineId, frame.screenshotId, action)
      if (result?.status && result.status !== 'succeeded') setError(`操作未成功：${result.status}`)
      if (!live) await capture()
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }

  const clickOn = (event, element) => {
    const point = pointOf(event, element, frame)
    if (point) void act({ tool: 'click', x: point.x, y: point.y })
  }

  if (!api) {
    return h('div', { className: 'bt-muted' }, '远程桌面需要工作台已加载：打开一次「电脑」页，再回到这里。')
  }

  const screen = (elementRef, big) => frame?.base64
    ? h('img', {
      ref: elementRef,
      className: big ? 'bt-desktop-frame-big' : 'bt-desktop-frame',
      alt: '远程桌面画面',
      src: `data:${frame.mediaType ?? 'image/png'};base64,${frame.base64}`,
      onClick: event => clickOn(event, elementRef.current),
      style: { cursor: control ? 'crosshair' : 'zoom-in' },
    })
    : h('div', { className: 'bt-muted bt-desktop-empty' }, machineId ? (status === 'capturing' ? '正在取画面…' : '还没有画面，点「刷新画面」。') : '先配对一台电脑。')

  return h('div', { className: 'bt-desktop-pane' },
    h('div', { className: 'bt-desktop-head' },
      h('span', { className: 'bt-section-title' }, '远程桌面'),
      h('select', {
        className: 'bt-input bt-desktop-select', value: machineId, 'aria-label': '电脑',
        onChange: event => { setMachineId(event.target.value); setFrame(null) },
      }, machines.length === 0
        ? h('option', { value: '' }, '还没有配对的电脑')
        : machines.map(item => h('option', { key: item.machineId, value: item.machineId }, item.label ?? item.machineId)))),

    h('div', { className: 'bt-desktop-modes', role: 'group', 'aria-label': '桌面模式' },
      h('button', { type: 'button', className: control ? 'bt-tab' : 'bt-tab is-active', 'aria-pressed': !control, onClick: () => setControl(false) }, '仅观看'),
      h('button', { type: 'button', className: control ? 'bt-tab is-active' : 'bt-tab', 'aria-pressed': control, onClick: () => setControl(true) }, '取得控制权'),
      h('span', { className: 'bt-muted bt-desktop-frame-id' }, frame?.screenshotId ? `帧 ${String(frame.screenshotId).slice(-6)}` : '')),
    error ? h('div', { className: 'bt-error' }, error) : null,

    h('button', {
      type: 'button', className: 'bt-desktop-open', title: '放大', disabled: !frame?.base64,
      onClick: () => setExpanded(true),
    }, screen(smallRef, false)),

    h('div', { className: 'bt-desktop-actions' },
      h('button', { type: 'button', className: 'bt-btn', disabled: status === 'capturing' || !machineId, onClick: () => { void capture() } }, status === 'capturing' ? '取画面中…' : '刷新画面'),
      h('label', { className: 'bt-muted bt-desktop-live' },
        h('input', { type: 'checkbox', checked: live, onChange: event => setLive(event.target.checked) }), ' 实时'),
      h('button', { type: 'button', className: 'bt-btn', disabled: !frame?.base64, onClick: () => setExpanded(true) }, '放大')),

    expanded ? h('div', {
      className: 'bt-desktop-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '远程桌面',
      onClick: event => { if (event.target === event.currentTarget) setExpanded(false) },
    },
    h('div', { className: 'bt-desktop-modal-body' },
      h('div', { className: 'bt-desktop-modal-bar' },
        h('strong', null, `${machines.find(item => item.machineId === machineId)?.label ?? machineId}`),
        h('button', { type: 'button', className: control ? 'bt-tab' : 'bt-tab is-active', onClick: () => setControl(false) }, '仅观看'),
        h('button', { type: 'button', className: control ? 'bt-tab is-active' : 'bt-tab', onClick: () => setControl(true) }, '取得控制权'),
        h('button', { type: 'button', className: 'bt-btn', onClick: () => { void capture() } }, '刷新'),
        h('button', { type: 'button', className: 'bt-btn', onClick: () => setExpanded(false) }, '关闭')),
      screen(bigRef, true))) : null,
  )
}
