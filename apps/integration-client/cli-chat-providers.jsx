import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import css from './cli-chat-providers.css'

const stateLabels = { ready: '就绪 · 已验证对话', configured: '已配置 · 待验证对话', 'needs-credentials': '需要登录资料', disabled: '已停用', 'needs-attention': '需要处理' }
const emptyEntry = () => ({ executable: '', version: '', script: '', harness: '' })
const entryView = entry => ({ executable: entry?.executable ?? '', version: entry?.version ?? '', script: entry?.script ?? '', harness: entry?.harness ?? '' })
const entryPayload = entry => ({ executable: entry.executable.trim(), version: entry.version.trim(), ...(entry.script.trim() ? { script: entry.script.trim() } : {}), ...(entry.harness.trim() ? { harness: entry.harness.trim() } : {}) })
const freshDraft = driver => ({ driver: driver.id, name: driver.name, model: '', enabled: true, entry: emptyEntry(), credentialJson: '', clearCredential: false, importLocalAccount: false })
const errorText = error => error?.message || '操作未完成，请重试。'

let nextScope = 0
export function CliChatProviders(props) {
  const key = useMemo(() => ++nextScope, [props.productApi])
  return <CliChatConnections key={key} {...props}/>
}

function CliChatConnections({ productApi, onOpenTools, onOpenBindings, initialSetup, onSaved }) {
  const [view, setView] = useState(null), [draft, setDraft] = useState(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('')
  const scope = useRef({ live: false, requests: new Set(), loadEpoch: 0, operation: null, busy: false }), draftVersion = useRef(0)
  const setupOpened=useRef(false)
  const mutationPending = busy === 'save' || busy === 'remove'
  const drivers = (view?.drivers ?? []).filter(item=>!initialSetup||item.id===initialSetup.driver), driver = drivers.find(item => item.id === draft?.driver)
  const visibleProfiles=(view?.profiles??[]).filter(item=>!initialSetup||item.driver===initialSetup.driver)
  const call = async (action, payload, operation = false) => {
    const current = scope.current, controller = new AbortController()
    current.requests.add(controller)
    if (operation) current.operation = controller
    let abort
    const cancelled = new Promise((_resolve, reject) => {
      abort = () => reject(new Error('请求已取消或超时，请重试。'))
      controller.signal.addEventListener('abort', abort, { once: true })
    })
    const timer = setTimeout(() => controller.abort(), payload?.driver === 'antigravityAgent' && ['cliProviders.inspect', 'cliProviders.save'].includes(action) ? 90_000 : 20_000)
    try {
      return await Promise.race([Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return productApi.dispatch(action, payload, controller.signal)
      }), cancelled])
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', abort); current.requests.delete(controller)
      if (current.operation === controller) current.operation = null
    }
  }
  const load = async () => {
    const current = scope.current, epoch = ++current.loadEpoch
    try {
      const result = await call('cliProviders.list', {})
      if (!current.live || epoch !== current.loadEpoch) return
      if (result?.schemaVersion !== 1 || !Array.isArray(result.drivers) || !Array.isArray(result.profiles)) throw new Error('此插件连接尚不支持 CLI 聊天配置，请更新完整插件。')
      setView(result); setError('')
      if(initialSetup&&!setupOpened.current){setupOpened.current=true
        const selected=result.drivers.find(item=>item.id===initialSetup.driver&&item.implemented&&item.available!==false)
        if(selected&&!result.profiles.some(item=>item.driver===selected.id))setDraft({...freshDraft(selected),entry:entryView(initialSetup.entry)})
      }
    } catch (failure) { if (current.live && epoch === current.loadEpoch) setError(errorText(failure)) }
  }
  useEffect(() => {
    const current = scope.current; current.live = true
    const style = document.createElement('style'); style.dataset.cliChatProviders = '1'; style.textContent = css; document.head.append(style)
    void load()
    return () => {
      current.live = false; current.loadEpoch++; draftVersion.current++
      for (const controller of current.requests) controller.abort()
      style.remove()
    }
  }, [productApi])
  const run = async (kind, operation) => {
    const current = scope.current
    if (current.busy) return
    const version = draftVersion.current
    current.busy = true; setBusy(kind); setError(''); setNotice('')
    try { await operation() } catch (failure) { if (current.live && (kind !== 'inspect' || version === draftVersion.current)) setError(errorText(failure)) }
    finally { current.busy = false; if (current.live) setBusy('') }
  }
  const change = patch => { draftVersion.current++; setNotice(''); setDraft(previous => ({ ...previous, ...patch })) }
  const closeEditor = () => {
    if (mutationPending) return
    draftVersion.current++; scope.current.operation?.abort(); setDraft(null); setError(''); setNotice('')
  }
  const edit = profile => {
    draftVersion.current++; setError(''); setNotice('')
    setDraft({ ...profile, entry: entryView(profile.entry), credentialJson: '', clearCredential: false, importLocalAccount: false })
  }
  const add = () => {
    const first = drivers.find(item => item.implemented && item.available !== false && (!initialSetup||item.id===initialSetup.driver))
    if (!first) return
    draftVersion.current++; setError(''); setNotice(''); setDraft({...freshDraft(first),...(initialSetup?{entry:entryView(initialSetup.entry)}:{})})
  }
  const inspect = () => run('inspect', async () => {
    const version = draftVersion.current
    const result = await call('cliProviders.inspect', { entry: entryPayload(draft.entry), driver: draft.driver }, true)
    if (!scope.current.live || version !== draftVersion.current) return
    if (result?.versionVerified !== true || !result.entry) throw new Error('未取得安装入口的版本核验结果，请检查路径与版本。')
    setNotice('安装入口与版本已核验。保存后请实际发起对话，验证账号与模型是否可用。')
  })
  const save = () => run('save', async () => {
    if (!driver?.implemented || driver.available === false) throw new Error(driver?.reason || '请选择当前可用的聊天驱动。')
    const credential = draft.driver === 'deepseekAgent' && draft.credentialJson && !draft.credentialJson.trim().startsWith('{')
      ? JSON.stringify({ schemaVersion: 1, billing: 'api', files: {}, env: { DEEPSEEK_API_KEY: draft.credentialJson.trim() } }) : draft.credentialJson
    const payload = { ...(draft.id ? { id: draft.id } : {}), expectedRevision: draft.revision ?? 0,
      driver: draft.driver, name: draft.name.trim(), model: draft.model.trim(), enabled: draft.enabled, entry: entryPayload(draft.entry),
      ...(draft.importLocalAccount ? { importLocalAccount: true } : credential ? { credentialJson: credential } : draft.clearCredential ? { clearCredential: true } : {}) }
    const result = await call('cliProviders.save', payload, true)
    if (!scope.current.live) return
    if (!result || typeof result.id !== 'string' || !Number.isSafeInteger(result.revision)) throw new Error('未取得保存回执，请刷新配置确认结果。')
    draftVersion.current++; setDraft(null); setNotice(`CLI 聊天连接已保存。请在 Bot 模型设置中选择该路线，并使用${draft.driver === 'deepseekAgent' ? '按量 API' : '订阅'}资金配置。`); await load();onSaved?.(result)
  })
  const remove = () => run('remove', async () => {
    const result = await call('cliProviders.remove', { id: draft.id, expectedRevision: draft.revision }, true)
    if (!scope.current.live) return
    if (result?.removed !== true) throw new Error('未取得删除回执，请刷新配置确认结果。')
    draftVersion.current++; setDraft(null); setNotice('此 CLI 聊天连接已删除。'); await load()
  })
  return <section className="bp-cli-chat" aria-label="CLI 聊天连接设置">
    <div className="bp-ai-section-head bp-cli-chat-title"><div><h3>CLI 聊天连接</h3><p className="bp-ai-hint">使用原生 CLI 的持续会话与 Bot 对话。聊天路线和下面的官方执行工具分别配置。</p></div>
      {!draft && <div className="bp-cli-chat-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void load()}>刷新连接</button><button type="button" disabled={Boolean(busy) || !drivers.some(item => item.implemented && item.available !== false)} onClick={add}><UiIcon name="plus" size={14}/>添加 CLI 聊天</button></div>}</div>
    {error && <div className="bp-ai-alert" role="alert">{error}<button type="button" disabled={mutationPending} onClick={() => void load()}>刷新 CLI 配置</button></div>}
    {notice && <p className="bp-ai-notice" role="status">{notice}</p>}
    {!view && !error && <p className="bp-ai-hint" role="status">正在读取 CLI 聊天配置…</p>}
    {draft ? <div className="bp-cli-chat-editor">
      <div className="bp-ai-editor-head"><button type="button" disabled={mutationPending} onClick={closeEditor}><UiIcon name="chevron" size={15}/>返回 CLI 连接</button><h4>{draft.id ? '管理 CLI 聊天' : '添加 CLI 聊天'}</h4></div>
      <p className="bp-cli-chat-kind">{driver?.hostTools ? '原生聊天 · 可使用已授权工具' : '原生文本聊天'}</p>
      {driver?.reason && <p className="bp-ai-hint">{driver.reason}</p>}
      <p className="bp-ai-hint">{draft.driver === 'deepseekAgent' ? '按量 API 计费，使用此连接独立保存的 DeepSeek Key。每轮最多一次模型请求、输出最多 4096 token；请在 Bot 资金配置中设置 API 价格与预算。' : '保留多轮对话，使用此连接独立保存的账号资料。'}保存和入口核验不会启动付费对话。</p>
      <div className="bp-ai-fields">
        <label>聊天驱动<select aria-label="CLI 聊天驱动" value={draft.driver} disabled={mutationPending || Boolean(draft.id)} onChange={event => {
          const selected = drivers.find(item => item.id === event.target.value)
          if (selected) change(freshDraft(selected))
        }}>{drivers.filter(item=>!initialSetup||item.id===initialSetup.driver).map(item => <option value={item.id} key={item.id} disabled={!item.implemented || item.available === false}>{item.name}{!item.implemented ? ' · 尚未适配' : item.available === false ? ' · 当前不可用' : ''}</option>)}</select></label>
        <label>连接名称<input aria-label="CLI 连接名称" value={draft.name} maxLength={100} disabled={mutationPending} onChange={event => change({ name: event.target.value })}/></label>
        <label className="bp-ai-wide">模型 ID<input aria-label="CLI 模型 ID" value={draft.model} maxLength={240} disabled={mutationPending} placeholder={initialSetup?.modelHint??'填写此 CLI 账号中可用的模型 ID'} onChange={event => change({ model: event.target.value })}/></label>
        <label className="bp-ai-wide">可执行文件路径<input aria-label="CLI 可执行文件路径" value={draft.entry.executable} maxLength={4096} disabled={mutationPending} placeholder="完整路径，例如 C:\\Tools\\agent.exe" onChange={event => change({ entry: { ...draft.entry, executable: event.target.value } })}/></label>
        <label>CLI 版本<input aria-label="CLI 版本" value={draft.entry.version} maxLength={64} disabled={mutationPending} placeholder="填写 --version 显示的版本号" onChange={event => change({ entry: { ...draft.entry, version: event.target.value } })}/></label>
        <label>入口脚本（可选）<input aria-label="CLI 入口脚本" value={draft.entry.script} maxLength={4096} disabled={mutationPending} placeholder="Node / Python 入口脚本的完整路径" onChange={event => change({ entry: { ...draft.entry, script: event.target.value } })}/></label>
        {draft.driver === 'antigravityAgent' && <label className="bp-ai-wide">Antigravity harness 文件<input aria-label="Antigravity harness 文件" value={draft.entry.harness} maxLength={4096} disabled={mutationPending} placeholder="同版本发行包中 harness 文件的完整路径" onChange={event => change({ entry: { ...draft.entry, harness: event.target.value } })}/></label>}
      </div>
      <div className="bp-cli-chat-entry-actions">{initialSetup?.entry&&<button type="button" disabled={Boolean(busy)} onClick={()=>change({entry:entryView(initialSetup.entry)})}>使用检测到的入口</button>}<button type="button" disabled={Boolean(busy) || !draft.entry.executable.trim() || !draft.entry.version.trim()} onClick={inspect}>{busy === 'inspect' ? '正在核验版本…' : '核验安装入口'}</button>{onOpenTools && <button type="button" onClick={onOpenTools}>安装与登录<UiIcon name="arrow" size={14}/></button>}</div>
      <p className="bp-ai-hint">脚本方式需要同时指定 Node 或 Python 的可执行文件及脚本路径。更改安装后，请重新核验并保存连接。</p>
      <h4 className="bp-cli-chat-auth-title">此连接的登录资料</h4>
      {driver?.credentialHint && <p className="bp-ai-hint">{driver.credentialHint}</p>}
      {draft.driver !== 'deepseekAgent' && <label className="bp-ai-check"><input type="checkbox" aria-label="使用本机已登录账号" checked={draft.importLocalAccount} disabled={mutationPending} onChange={event => change({ importLocalAccount: event.target.checked, credentialJson: '', clearCredential: false })}/>使用本机已登录账号</label>}
      <p className="bp-ai-hint">勾选后，保存时只导入此驱动支持的认证资料，独立保存在当前连接；账号后续变化时需要重新导入。原有配置不被修改。</p>
      <label className="bp-cli-chat-secret">{draft.driver === 'deepseekAgent' ? 'DeepSeek API Key（也可填写认证 JSON）' : '手动登录资料（JSON）'}<input type="password" aria-label="CLI 登录资料 JSON" autoComplete="new-password" spellCheck={false} maxLength={131072} value={draft.credentialJson} disabled={mutationPending || draft.importLocalAccount} placeholder={draft.credentialConfigured ? '留空保留已保存资料；页面不会回显' : draft.driver === 'deepseekAgent' ? '粘贴此连接使用的 DeepSeek API Key' : '可选择导入本机账号，或粘贴此驱动要求的认证 JSON'} onChange={event => change({ credentialJson: event.target.value, clearCredential: false })}/></label>
      {driver?.credentialTemplate && <details className="bp-cli-chat-template"><summary>查看登录资料格式</summary><p className="bp-ai-hint">这里展示填写格式，不包含已保存的登录资料。</p><pre>{JSON.stringify(driver.credentialTemplate, null, 2)}</pre></details>}
      {draft.credentialConfigured && <label className="bp-ai-check"><input type="checkbox" aria-label="清除此 CLI 连接的登录资料" checked={draft.clearCredential} disabled={mutationPending || draft.importLocalAccount} onChange={event => change({ clearCredential: event.target.checked, credentialJson: '' })}/>清除此连接已保存的登录资料</label>}
      <label className="bp-ai-check"><input type="checkbox" aria-label="启用 CLI 聊天连接" checked={draft.enabled} disabled={mutationPending} onChange={event => change({ enabled: event.target.checked })}/>启用此聊天连接</label>
      {draft.usedBy?.length > 0 && <p className="bp-ai-hint">正在使用：{draft.usedBy.map(bot => bot.name).join('、')}。删除前请先为这些 Bot 切换模型。</p>}
      <footer className="bp-ai-save">{draft.id && <button type="button" className="bp-ai-danger" disabled={Boolean(busy) || draft.usedBy?.length > 0} onClick={remove}>删除 CLI 连接</button>}<button type="button" className="bp-ai-primary" disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '正在保存…' : '保存 CLI 聊天连接'}</button></footer>
    </div> : view && <>
      <div className="bp-ai-provider-list">{visibleProfiles.map(profile => <article className="bp-ai-provider" data-cli-profile={profile.id} key={profile.id}>
        <div className="bp-ai-mark" aria-hidden="true"><UiIcon name="bot" size={20}/></div><div className="bp-ai-copy"><h4>{profile.name}</h4>
          <p className="bp-ai-state" data-state={profile.state}><span/>{stateLabels[profile.state] ?? '状态未确认'}</p>
          <small>{drivers.find(item => item.id === profile.driver)?.name ?? profile.driver} · {profile.model}</small>
          <small>{profile.hostTools || drivers.find(item => item.id === profile.driver)?.hostTools ? '原生聊天 · 可使用已授权工具' : '原生文本聊天'}</small>
          {profile.reason && <small>{profile.reason}</small>}</div>
        <button type="button" onClick={() => edit(profile)}>管理 CLI 聊天</button>
      </article>)}{visibleProfiles.length === 0 && <div className="bp-cli-chat-empty"><p>还没有 CLI 聊天连接</p><small>添加已适配的驱动、安装入口和独立账号，再为 Bot 选择这条聊天路线。</small></div>}</div>
      {!initialSetup&&drivers.length > 0 && <p className="bp-ai-hint bp-cli-chat-availability">已适配 {drivers.filter(item => item.implemented).length} 种聊天驱动。驱动已适配仍需要本机安装、登录，并完成实际对话验证。</p>}
      {view.profiles.length > 0 && onOpenBindings && <button type="button" className="bp-ai-bot-link" onClick={onOpenBindings}>为 Bot 选择 CLI 模型<UiIcon name="chevron" size={15}/></button>}
    </>}
  </section>
}
