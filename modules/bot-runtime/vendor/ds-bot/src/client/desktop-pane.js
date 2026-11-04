// The Bot's remote desktop, inside the details drawer.
//
// This pane owns no authority: the product client registers a small bridge on `globalThis`
// (`__dshDesktop`) whose calls already run as the owner through the plugin's remote channel. When
// the bridge is absent — an older Host, or a window that never rendered the workbench — the pane
// says so instead of showing an empty frame.
//
// A frame is single use: every click/type/key carries the id of the picture the person saw, so a
// stale screen can never be clicked.

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'

const bridge = () => {
  const value = globalThis.__dshDesktop
  return value && typeof value.view === 'function' ? value : null
}

export function DesktopPane({ bot }) {
  const [machines, setMachines] = useState([])
  const [machineId, setMachineId] = useState('')
  const [frame, setFrame] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const imageRef = useRef(null)

  const api = bridge()

  useEffect(() => {
    if (!api) return
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

  useEffect(() => {
    if (!live || !api || !machineId) return undefined
    void capture()
    const timer = setInterval(() => { void capture() }, 1500)
    return () => clearInterval(timer)
  }, [live, api, machineId, capture])

  const act = async (action) => {
    if (!api || !frame?.screenshotId) { setError('先取一帧，再操作。'); return }
    try {
      const result = await api.act(bot.id, machineId, frame.screenshotId, action)
      if (result?.status && result.status !== 'succeeded') setError(`操作未成功：${result.status}`)
      if (!live) await capture()
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }

  const click = (event) => {
    if (!frame?.base64 || !frame?.width || !imageRef.current) return
    const rect = imageRef.current.getBoundingClientRect()
    const ratio = Math.min(rect.width / frame.width, rect.height / frame.height)
    const x = Math.floor((event.clientX - rect.left - (rect.width - frame.width * ratio) / 2) / ratio)
    const y = Math.floor((event.clientY - rect.top - (rect.height - frame.height * ratio) / 2) / ratio)
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return
    void act({ tool: 'click', x, y })
  }

  if (!api) {
    return h('div', { className: 'bt-muted' }, '远程桌面需要工作台已加载：打开一次「电脑」页，再回到这里。')
  }

  return h('div', { className: 'bt-desktop-pane' },
    h('div', { className: 'bt-section-title' }, '远程桌面'),
    h('div', { className: 'bt-desktop-row' },
      h('select', {
        className: 'bt-input', value: machineId, 'aria-label': '电脑',
        onChange: event => { setMachineId(event.target.value); setFrame(null) },
      }, machines.length === 0
        ? h('option', { value: '' }, '还没有配对的电脑')
        : machines.map(item => h('option', { key: item.machineId, value: item.machineId }, item.label ?? item.machineId))),
      h('button', { type: 'button', className: 'bt-btn', disabled: status === 'capturing' || !machineId, onClick: () => { void capture() } },
        status === 'capturing' ? '截取中…' : '截取画面'),
      h('label', { className: 'bt-muted bt-desktop-live' },
        h('input', { type: 'checkbox', checked: live, onChange: event => setLive(event.target.checked) }), ' 实时'),
      h('span', { className: 'bt-muted' }, frame?.screenshotId ? `帧 ${String(frame.screenshotId).slice(-6)}` : '')),
    error ? h('div', { className: 'bt-error' }, error) : null,
    frame?.base64
      ? h('img', {
        ref: imageRef, className: 'bt-desktop-frame', alt: '远程桌面画面', src: `data:${frame.mediaType ?? 'image/png'};base64,${frame.base64}`,
        onClick: click, style: { cursor: 'crosshair' },
      })
      : h('div', { className: 'bt-muted bt-desktop-empty' }, machineId ? '点「截取画面」查看桌面，点画面即点击。' : '先配对一台电脑。'),
  )
}
