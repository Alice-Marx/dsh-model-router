import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'

const labels = { disabled: '未开启', starting: '正在开启', running: '远程访问已开启', stopping: '正在关闭', failed: '需要处理', 'needs-attention': '需要处理' }
const messages = {
  LOCAL_COMPUTER_CONFLICT: '设置或配对已在其他窗口修改，请重新载入后操作。',
  LOCAL_COMPUTER_PRIVATE_DIRECTORY: '请选用专门的共享文件夹，不能共享插件或 Host 的私有数据目录。',
  LOCAL_COMPUTER_PORT_BUSY: '此端口已被占用，请更换端口。',
  LOCAL_DESKTOP_WINDOWS_REQUIRED: '桌面控制需要 Windows；此电脑仍可共享文件。',
  LOCAL_DESKTOP_UNAVAILABLE: '桌面助手未能启动。请保持 Windows 用户已登录，并检查是否已有独立桌面助手正在运行。',
  LOCAL_COMPUTER_LOCKED: '本机接入正由另一个 Harness 实例管理，请关闭重复实例后刷新。',
  LOCAL_COMPUTER_STOP_UNCONFIRMED: '尚未确认全部服务已停止。请完全退出并重新启动 Harness 后核对状态。',
}
const explanation = error => messages[error?.code] || error?.message || '操作未完成，请刷新状态后核对。'

let nextScope = 0
export function LocalComputerHost(props) {
  const scope = useMemo(() => ++nextScope, [props.transport ?? props.dispatch])
  return <LocalComputerHostView key={scope} {...props}/>
}
function LocalComputerHostView({ snapshot, dispatch, transport = dispatch, busy }) {
  const available = (snapshot.availableActions ?? []).includes('machine.host.status')
  const [view, setView] = useState(null), [draft, setDraft] = useState(null), [devices, setDevices] = useState([])
  const [pending, setPending] = useState(''), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [invitation, setInvitation] = useState(null), [time, setTime] = useState(Date.now())
  const live = useRef(false), mutation = useRef(false), dirty = useRef(false), generation = useRef(0), refreshBusy = useRef(false)
  const call = async (action, payload, timeout = 15_000) => {
    let timer
    try {
      const value = await Promise.race([transport === dispatch ? dispatch(action, payload, { errorResult: true }) : transport(action, payload), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待结果超时，请刷新本机状态核对；不会自动重复此操作。')), timeout) })])
      if (!value || value.ok === false) throw Object.assign(new Error(value?.error?.message || '宿主未确认操作。'), { code: value?.error?.code })
      return value
    } finally { clearTimeout(timer) }
  }
  const apply = value => {
    setView(value)
    const automatic = `http://${value.config?.listenAddress}:${value.config?.port}`
    if (!dirty.current) setDraft({ ...value.defaults, ...value.config, endpoint: value.config?.endpoint === automatic ? '' : value.config?.endpoint ?? '', expectedRevision: value.revision })
    setInvitation(previous => value.state !== 'running' || previous?.revision !== value.revision ? null : previous)
  }
  const load = async (reset = false) => {
    if (!available || refreshBusy.current) return
    refreshBusy.current = true; const epoch = generation.current
    try {
      const value = await call('machine.host.status', {})
      if (!live.current || epoch !== generation.current) return
      if (reset) dirty.current = false
      apply(value)
      if (value.revision > 0) {
        const result = await call('machine.host.devices', {})
        if (live.current && epoch === generation.current) setDevices(result.items ?? [])
      }
    } catch (error) { if (live.current && epoch === generation.current) setFailure(explanation(error)) }
    finally { refreshBusy.current = false }
  }
  useEffect(() => {
    live.current = true; dirty.current = false; generation.current++
    setView(null); setDraft(null); setInvitation(null); setDevices([]); setFailure('')
    void load()
    const timer = setInterval(() => { setTime(Date.now()); if (!mutation.current) void load() }, 5000)
    return () => { live.current = false; generation.current++; clearInterval(timer) }
  }, [available, transport])
  useEffect(() => { if (invitation && time >= invitation.invite.expiresAt) setInvitation(null) }, [time, invitation])
  const change = (name, value) => { dirty.current = true; setDraft(old => ({ ...old, [name]: value })); setNotice('') }
  const run = async (kind, action, payload) => {
    if (mutation.current || busy) return
    mutation.current = true; setPending(kind); setFailure(''); setNotice(''); const epoch = generation.current
    try {
      const result = await call(action, payload, 100_000)
      if (!live.current || epoch !== generation.current) return
      if (kind === 'invite') { setInvitation({ ...result, revision: view.revision }); setTime(Date.now()); return }
      setInvitation(null)
      if (['save', 'start', 'stop'].includes(kind)) { dirty.current = false; apply(result) }
      setNotice(kind === 'revoke' ? '配对已撤销，对方的连接与操作权限已失效。' : kind === 'stop' ? '本机远程访问已关闭。' : '设置已保存。')
      await load()
    } catch (error) { if (live.current && epoch === generation.current) setFailure(explanation(error)) }
    finally { mutation.current = false; if (live.current && epoch === generation.current) setPending('') }
  }
  const save = enabled => void run('save', 'machine.host.configure', { ...draft, enabled })
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(invitation.invite)); if (live.current) setNotice('邀请已复制。请在另一台电脑导入，再输入本机显示的六位确认码。') }
    catch { if (live.current) setFailure('无法访问剪贴板，请手动复制邀请内容。') }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(invitation.invite, null, 2)], { type: 'application/json' })), a = document.createElement('a')
    a.href = url; a.download = 'dsh-pairing-invite.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  if (!available) return null
  const locked = Boolean(pending || busy), connected = view?.listening === true
  return <section className="bp-card bp-local-computer" aria-label="本机远程访问">
    <header className="bp-connection-heading"><span className="bp-connection-icon"><UiIcon name="computer" size={23}/></span><div><h3>{view?.config?.name ?? '这台电脑'}</h3><p className="bp-connection-state" data-online={connected} role="status"><i/>{labels[view?.state] ?? '正在读取…'}</p></div>
      {connected && <button type="button" disabled={locked} onClick={() => void run('stop', 'machine.host.stop', { expectedRevision: view.revision })}>{pending === 'stop' ? '正在关闭…' : '关闭远程访问'}</button>}</header>
    <p className="bp-muted">共享文件与桌面，邀请另一台电脑连接。</p>
    {failure && <p className="bp-error" role="alert">{failure}</p>}
    {view?.errorCode && <p className="bp-error">{messages[view.errorCode] || `本机服务未就绪：${view.errorCode}`}</p>}
    {draft && <details className="bp-local-settings" open={!view.config || undefined}><summary><UiIcon name="settings" size={15}/>{view.config ? '共享设置' : '选择共享内容'}<UiIcon name="chevron" size={14}/></summary><div className="bp-form">
      <label>这台电脑名称<input aria-label="本机名称" value={draft.name} maxLength={60} disabled={locked} onChange={e => change('name', e.target.value)}/></label>
      <label>共享文件夹<input aria-label="本机共享文件夹" value={draft.sharedDirectory} disabled={locked} onChange={e => change('sharedDirectory', e.target.value)}/></label>
      <div className="bp-sharing-options"><label><span><UiIcon name="folder" size={17}/>文件修改</span><input type="checkbox" role="switch" aria-label="允许修改共享文件夹" checked={draft.allowWrite} disabled={locked} onChange={e => change('allowWrite', e.target.checked)}/></label>
      <label><span><UiIcon name="computer" size={17}/>桌面控制</span><input type="checkbox" role="switch" aria-label="允许查看与控制 Windows 桌面" checked={draft.allowDesktop} disabled={locked || !view.desktopSupported} onChange={e => change('allowDesktop', e.target.checked)}/></label></div>
      <details className="bp-connection-advanced"><summary>网络与高级设置</summary>
        <label>连接网卡<select aria-label="本机连接网卡" value={draft.listenAddress} disabled={locked} onChange={e => change('listenAddress', e.target.value)}>{view.addresses.map(address => <option key={address}>{address}</option>)}</select></label>
        <label>端口<input aria-label="本机接入端口" type="number" min={1} max={65535} value={draft.port} disabled={locked} onChange={e => change('port', Number(e.target.value))}/></label>
        <label>连接地址（可选）<input aria-label="本机连接地址" value={draft.endpoint} disabled={locked} placeholder={`http://${draft.listenAddress}:${draft.port}`} onChange={e => change('endpoint', e.target.value)}/></label>
        <p className="bp-muted">跨网需已有 VPN 或可达地址；必要时放行所选 TCP 端口。配对不提供公网穿透。</p>
        <p className="bp-muted">对方可在所选范围内管理其团队 Bot。</p>
        <button type="button" disabled={locked} onClick={() => { setFailure(''); void load(true) }}>重新载入设置</button>
      </details>
      {view.revision > 0 && dirty.current && <p className="bp-sharing-warning" role="note">保存更改将撤销现有配对，需要重新邀请。</p>}
      <div className="bp-actions"><button type="button" className="bp-button-primary" disabled={locked} onClick={() => save(true)}>{pending === 'save' ? '正在开启…' : '保存并开启远程访问'}</button><button type="button" disabled={locked} onClick={() => save(false)}>仅保存，不开启</button>
      </div>
    </div></details>}
    {view?.config && !connected && !dirty.current && <button type="button" className="bp-button-primary" disabled={locked} onClick={() => void run('start', 'machine.host.start', { expectedRevision: view.revision })}>重新开启</button>}
    {view?.state === 'running' && <div className="bp-actions"><button type="button" className="bp-button-primary" disabled={locked || dirty.current} onClick={() => void run('invite', 'machine.host.invite', { expectedRevision: view.revision })}><UiIcon name="plus" size={16}/>{pending === 'invite' ? '正在生成…' : '生成两分钟配对邀请'}</button></div>}
    {invitation && <section className="bp-invitation-card" aria-label="本机配对邀请"><img alt="本机配对二维码" src={invitation.qrDataUrl} width={240} height={240}/><p className="bp-muted">在另一台电脑扫描，输入确认码</p><p className="bp-invitation-code" aria-label="六位确认码">{invitation.code}</p>
      <details className="bp-connection-advanced"><summary>设备指纹</summary><code>{invitation.invite.transport.fingerprint}</code></details><p className="bp-muted" role="timer">{Math.max(0, Math.ceil((invitation.invite.expiresAt - time) / 1000))} 秒后失效</p>
      <div className="bp-actions"><button type="button" onClick={() => void copy()}>复制邀请</button><button type="button" onClick={download}>下载邀请文件</button><button type="button" onClick={() => setInvitation(null)}>收起邀请</button></div>
      <details><summary>手动复制邀请内容</summary><textarea aria-label="本机邀请内容" readOnly rows={4} value={JSON.stringify(invitation.invite)}/></details></section>}
    {devices.some(item => !item.revoked) && <section aria-label="已配对控制端"><h4>已配对控制端</h4>{devices.filter(item => !item.revoked).map(item => <div className="bp-actions" key={item.id}><code>{item.id}</code><span>{item.tools.length} 项能力</span><button type="button" disabled={locked} onClick={() => void run('revoke', 'machine.host.revoke', { id: item.id, revision: item.revision })}>撤销配对</button></div>)}</section>}
    {notice && <p role="status">{notice}</p>}
    {!view && <button type="button" onClick={() => void load()}>重新读取本机状态</button>}
  </section>
}
