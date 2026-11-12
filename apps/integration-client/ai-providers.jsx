import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import css from './ai-providers.css'

const labels = { ready: '就绪 · 已验证调用', configured: '已配置', 'needs-key': '需要 API Key', 'needs-models': '需要添加模型', 'needs-attention': '需要处理', disabled: '已停用' }
const cliLabels = { checking: '检测中', 'not-installed': '未安装', 'logged-out': '需要登录', 'login-unknown': '登录状态未确认', 'terminal-only': '仅终端交互', unavailable: '暂不可用', ready: '官方工具可用' }
const newModel = () => ({ id: '', name: '', contextWindow: '', maxTokens: '', reasoning: false })
const modelForm = model => ({ ...model, contextWindow: model.contextWindow == null ? '' : String(model.contextWindow), maxTokens: model.maxTokens == null ? '' : String(model.maxTokens) })
const presetForm = preset => ({ preset: preset.id, name: preset.name, protocol: preset.protocol, baseUrl: preset.baseUrl, models: [], enabled: true, auth: 'key', apiKey: '', clearApiKey: false })
const healthText = provider => provider.health?.kind === 'error'
  ? provider.health.code === 'AUTH' ? `认证被拒绝${provider.health.status ? `（${provider.health.status}）` : ''}，请更新此连接的密钥。`
    : provider.health.code === 'TIMEOUT' ? '检查超时，可以重试。' : `连接检查失败${provider.health.status ? `（HTTP ${provider.health.status}）` : ''}，请检查服务地址和协议。`
  : provider.health?.kind === 'catalog' && !provider.health.verifiedAt ? '模型目录可访问；实际推理尚未验证。' : ''

let nextScope = 0
export function AiProvidersPage(props) { const key = useMemo(() => ++nextScope, [props.productApi]); return <AiProviders key={key} {...props}/> }

function AiProviders({ productApi, onOpenTools, onOpenBindings }) {
  const [view, setView] = useState(null), [cli, setCli] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [checkingCli, setCheckingCli] = useState(false), [cliNotice, setCliNotice] = useState(''), cliEpoch = useRef(0)
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(''), [suggestions, setSuggestions] = useState([]), [search, setSearch] = useState('')
  const editingBusy = busy === 'save' || busy === 'remove'
  const scope = useRef({ live: false, requests: new Set(), epoch: 0 }), draftVersion = useRef(0)
  const call = async (action, payload = {}) => {
    const controller = new AbortController(), current = scope.current
    current.requests.add(controller)
    let rejectAbort
    const deadline = new Promise((_resolve, reject) => { rejectAbort = () => reject(new Error('连接请求已取消或超时，请重试。')); controller.signal.addEventListener('abort', rejectAbort, { once: true }) })
    const timer = setTimeout(() => controller.abort(), action === 'aiProviders.cliStatus' ? 15000 : 12000)
    try { return await Promise.race([Promise.resolve().then(() => productApi.dispatch(action, payload, controller.signal)), deadline]) }
    finally { clearTimeout(timer); current.requests.delete(controller); controller.signal.removeEventListener('abort', rejectAbort) }
  }
  const load = async () => {
    const epoch = ++scope.current.epoch
    try {
      const result = await call('aiProviders.list')
      if (!scope.current.live || epoch !== scope.current.epoch) return
      if (result?.schemaVersion !== 1 || !Array.isArray(result.providers) || !Array.isArray(result.presets)) throw new Error('此连接尚未支持独立 AI 配置，请更新完整插件。')
      setView(result); setError('')
    } catch (failure) { if (scope.current.live && epoch === scope.current.epoch) setError(failure.message) }
  }
  const refreshCli = async () => {
    const epoch = ++cliEpoch.current; setCheckingCli(true); setCliNotice('')
    try { const value = await call('aiProviders.cliStatus', { refresh: true }); if (scope.current.live && epoch === cliEpoch.current) setCli(value) }
    catch { if (scope.current.live && epoch === cliEpoch.current) { setCli(previous => previous ? { ...previous, tools: (previous.tools ?? []).map(tool => ({ ...tool, status: 'unavailable', reason: '本次检测未完成，请重新检查。' })) } : null); setCliNotice('官方 CLI 检查未完成，可重新检查或打开安装与登录。') } }
    finally { if (scope.current.live && epoch === cliEpoch.current) setCheckingCli(false) }
  }
  useEffect(() => {
    const current = scope.current; current.live = true
    const style = document.createElement('style'); style.dataset.aiProviders = '1'; style.textContent = css; document.head.append(style)
    void load()
    void refreshCli()
    return () => { current.live = false; current.epoch++; draftVersion.current++; for (const request of current.requests) request.abort(); style.remove() }
  }, [productApi])
  const run = async (id, operation) => {
    if (scope.current.busy) return
    scope.current.busy = true
    setBusy(id); setError(''); setNotice('')
    try { await operation() } catch (failure) { if (scope.current.live) setError(failure.message || '操作失败，请重试。') }
    finally { scope.current.busy = false; if (scope.current.live) setBusy('') }
  }
  const edit = provider => {
    draftVersion.current++; setSuggestions((provider.health?.models ?? []).map(model => ({ id: model.id, name: model.id, contextWindow: null, maxTokens: null, reasoning: false }))); setError(''); setNotice('')
    setDraft(provider.route ? { ...provider, apiKey: '', clearApiKey: false, models: provider.models.map(modelForm) } : presetForm(provider))
  }
  const change = patch => { draftVersion.current++; setDraft(previous => ({ ...previous, ...patch })) }
  const chooseModels = () => run('suggestions', async () => {
    const version = draftVersion.current, preset = draft.preset
    const value = await call('aiProviders.suggestions', { preset })
    if (scope.current.live && version === draftVersion.current) { setSuggestions(value.models); if (!value.models.length) setNotice('此提供方没有内置目录，请手动添加模型，或检查连接后从返回目录添加。') }
  })
  const save = () => run('save', async () => {
    const payload = { ...(draft.id ? { id: draft.id } : {}), expectedRevision: draft.revision ?? 0, preset: draft.preset,
      name: draft.name, protocol: draft.protocol, baseUrl: draft.baseUrl, auth: draft.auth, enabled: draft.enabled,
      models: draft.models.map(model => ({ ...model, name: model.name || model.id, contextWindow: Number(model.contextWindow), maxTokens: Number(model.maxTokens) })),
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}), ...(draft.clearApiKey ? { clearApiKey: true } : {}) }
    await call('aiProviders.save', payload)
    if (!scope.current.live) return
    draftVersion.current++; setDraft(null); setSuggestions([]); setNotice('连接已保存，可在 Bot 模型设置中选择这些模型。'); await load()
  })
  const check = provider => run(`check-${provider.id}`, async () => {
    await call('aiProviders.check', { id: provider.id }); if (scope.current.live) await load()
  })
  const remove = () => run('remove', async () => {
    await call('aiProviders.remove', { id: draft.id, expectedRevision: draft.revision })
    if (scope.current.live) { setDraft(null); setSuggestions([]); setNotice('已删除此独立连接。'); await load() }
  })
  const allCheck = () => run('check-all', async () => {
    const apiChecks = Promise.allSettled(view.providers.filter(provider => provider.enabled && (provider.auth === 'none' || provider.keyConfigured)).map(provider => call('aiProviders.check', { id: provider.id })))
    const toolCheck = refreshCli()
    await Promise.all([apiChecks, toolCheck]); if (scope.current.live) await load()
  })
  const addSuggested = model => {
    if (draft.models.some(item => item.id === model.id)) return
    change({ models: [...draft.models, modelForm(model)] })
  }
  return <section className="bp-ai" aria-label="AI 提供方设置">
    <header className="bp-ai-heading"><div><h2>AI 提供方</h2><p><UiIcon name="computer" size={15}/>适用于这台电脑 · 插件独立配置</p></div>
      {!draft && <button type="button" disabled={Boolean(busy) || !view} onClick={allCheck}><UiIcon name="refresh" size={15}/>{busy === 'check-all' ? '正在检查…' : '重新检查'}</button>}</header>
    <p className="bp-ai-intro">在这里连接 AI，再为每个 Bot 选择模型。同一提供方可以添加多个账号或服务地址。</p>
    {error && <div className="bp-ai-alert" role="alert">{error}<button type="button" disabled={editingBusy} onClick={() => void load()}>刷新</button></div>}
    {notice && <p className="bp-ai-notice" role="status">{notice}</p>}
    {!view && !error && <p role="status">正在读取独立 AI 配置…</p>}
    {draft ? <div className="bp-ai-editor">
      <div className="bp-ai-editor-head"><button type="button" disabled={editingBusy} onClick={() => { draftVersion.current++; setDraft(null); setSuggestions([]); setError('') }}><UiIcon name="chevron" size={15}/>返回提供方</button><h3>{draft.id ? '管理连接' : '添加连接'}</h3></div>
      <div className="bp-ai-fields">
        <label>连接名称<input aria-label="连接名称" value={draft.name} maxLength={100} disabled={editingBusy} onChange={event => change({ name: event.target.value })}/></label>
        <label>接口协议<select aria-label="接口协议" value={draft.protocol} disabled={editingBusy} onChange={event => change({ protocol: event.target.value })}>{view.protocols.map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}</select></label>
        <label className="bp-ai-wide">服务地址<input type="url" aria-label="AI 服务地址" value={draft.baseUrl} disabled={editingBusy} placeholder="https://api.example.com/v1" onChange={event => change({ baseUrl: event.target.value })}/></label>
        <label>认证方式<select aria-label="认证方式" value={draft.auth} disabled={editingBusy} onChange={event => change({ auth: event.target.value })}><option value="key">API Key</option><option value="none">本机服务 · 无密钥</option></select></label>
        {draft.auth === 'key' && <label>API Key<input type="password" aria-label="此连接的 API Key" autoComplete="new-password" spellCheck={false} value={draft.apiKey} disabled={editingBusy} placeholder={draft.keyConfigured ? '留空保留已保存的密钥' : '请输入此连接的密钥'} onChange={event => change({ apiKey: event.target.value, clearApiKey: false })}/></label>}
      </div>
      {draft.keyConfigured && <label className="bp-ai-check"><input type="checkbox" checked={draft.clearApiKey} disabled={editingBusy} onChange={event => change({ clearApiKey: event.target.checked, apiKey: '' })}/>清除此连接已保存的 API Key</label>}
      <label className="bp-ai-check"><input type="checkbox" checked={draft.enabled} disabled={editingBusy} onChange={event => change({ enabled: event.target.checked })}/>启用此连接</label>
      <div className="bp-ai-model-heading"><h3>可用模型 <span>{draft.models.length}</span></h3><div><button type="button" disabled={Boolean(busy)} onClick={chooseModels}>从内置目录选择</button><button type="button" disabled={editingBusy} onClick={() => change({ models: [...draft.models, newModel()] })}><UiIcon name="plus" size={14}/>添加模型</button></div></div>
      <p className="bp-ai-hint">上下文容量使用模型的实际规格；输出上限必须小于上下文。配置会用于所有选择此模型的 Bot。</p>
      {suggestions.length > 0 && <div className="bp-ai-suggestions"><label>搜索目录模型<input aria-label="搜索目录模型" value={search} onChange={event => setSearch(event.target.value)}/></label><ul>{suggestions.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(search.toLowerCase())).map(model => <li key={model.id}><span>{model.name}<small>{model.id} · {model.contextWindow ? `上下文 ${model.contextWindow.toLocaleString()}` : '添加后请填写准确容量'}</small></span><button type="button" disabled={draft.models.some(item => item.id === model.id)} onClick={() => addSuggested(model)}>{draft.models.some(item => item.id === model.id) ? '已添加' : '添加'}</button></li>)}</ul></div>}
      <div className="bp-ai-models">{draft.models.map((model, index) => <fieldset key={index}><legend>模型 {index + 1}</legend><div className="bp-ai-fields">
        {[['id', '模型 ID'], ['name', '显示名称'], ['contextWindow', '上下文容量'], ['maxTokens', '默认输出上限']].map(([key, label]) => <label key={key}>{label}<input aria-label={`模型 ${index + 1} ${label}`} type={['contextWindow', 'maxTokens'].includes(key) ? 'number' : 'text'} min="1" value={model[key]} disabled={editingBusy} onChange={event => change({ models: draft.models.map((item, at) => at === index ? { ...item, [key]: event.target.value } : item) })}/></label>)}</div>
        <div className="bp-ai-model-footer"><label className="bp-ai-check"><input type="checkbox" checked={model.reasoning} disabled={editingBusy} onChange={event => change({ models: draft.models.map((item, at) => at === index ? { ...item, reasoning: event.target.checked } : item) })}/>支持思考强度设置</label><button type="button" disabled={editingBusy} onClick={() => change({ models: draft.models.filter((_item, at) => at !== index) })}>移除模型</button></div>
      </fieldset>)}</div>
      {draft.usedBy?.length > 0 && <p className="bp-ai-hint">正在使用：{draft.usedBy.map(bot => bot.name).join('、')}。删除前请先切换这些 Bot 的模型。</p>}
      <footer className="bp-ai-save">{draft.id && <button type="button" className="bp-ai-danger" disabled={Boolean(busy) || draft.usedBy?.length > 0} onClick={remove}>删除连接</button>}<button type="button" className="bp-ai-primary" disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '正在保存…' : '保存连接'}</button></footer>
    </div> : view && <>
      <div className="bp-ai-section-head"><h3>API 连接</h3><span>每个连接独立保存模型与密钥</span></div>
      <div className="bp-ai-provider-list">{view.providers.map(provider => <article className="bp-ai-provider" key={provider.id} data-ai-provider={provider.id}>
        <div className="bp-ai-mark" aria-hidden="true">{view.presets.find(preset => preset.id === provider.preset)?.mark ?? 'AI'}</div><div className="bp-ai-copy"><h4>{provider.name}</h4><p className="bp-ai-state" data-state={provider.state}><span/>{labels[provider.state] ?? '状态未知'} · {provider.models.length} 个模型</p>{healthText(provider) && <small>{healthText(provider)}</small>}<small>{new URL(provider.baseUrl).host}</small></div>
        <div className="bp-ai-row-actions"><button type="button" disabled={Boolean(busy) || !provider.enabled || provider.auth === 'key' && !provider.keyConfigured} onClick={() => check(provider)}>{busy === `check-${provider.id}` ? '检查中…' : '检查'}</button><button type="button" disabled={editingBusy} onClick={() => edit(provider)}>管理</button></div>
      </article>)}{!view.providers.length && <div className="bp-ai-empty"><UiIcon name="spark" size={26}/><h4>连接你的第一个 AI</h4><p>选择下面的提供方，填写自己的账号密钥与模型。</p></div>}</div>
      <div className="bp-ai-presets">{view.presets.map(preset => <button type="button" key={preset.id} disabled={editingBusy} onClick={() => edit(preset)}><span className="bp-ai-small-mark" aria-hidden="true">{preset.mark}</span><span>{preset.name}</span><UiIcon name="plus" size={14}/></button>)}</div>
      <div className="bp-ai-section-head"><h3>官方 CLI 与应用</h3>{onOpenTools && <button type="button" onClick={onOpenTools}>安装与登录<UiIcon name="arrow" size={14}/></button>}</div>
      <p className="bp-ai-hint">CLI 使用各自的账号和模型配置，独立于 API 连接。这里显示官方工具的执行状态。</p>
      {checkingCli && <p className="bp-ai-hint" role="status">正在后台检查官方 CLI，API 连接可以继续配置。</p>}
      {cliNotice && <p className="bp-ai-hint" role="status">{cliNotice}</p>}
      <div className="bp-ai-provider-list">{(cli?.tools ?? []).map(tool => <article className="bp-ai-provider" key={tool.toolId ?? tool.id}><div className="bp-ai-mark" aria-hidden="true"><UiIcon name="bot" size={20}/></div><div className="bp-ai-copy"><h4>{tool.label ?? tool.toolId ?? tool.id}</h4><p className="bp-ai-state" data-state={tool.status === 'ready' ? 'ready' : 'configured'}><span/>{cliLabels[tool.status] ?? '尚未检测'}</p>{tool.reason && <small>{tool.reason}</small>}</div>{onOpenTools && <button type="button" onClick={onOpenTools}>管理</button>}</article>)}</div>
      {!(cli?.tools?.length) && <p className="bp-ai-hint">点击“重新检查”读取本机 CLI 状态；安装与登录在官方工具面板完成。</p>}
      {onOpenBindings && <button type="button" className="bp-ai-bot-link" onClick={onOpenBindings}>为 Bot 选择模型<UiIcon name="chevron" size={15}/></button>}
      <p className="bp-ai-footnote">原有 Harness 模型仍可在 Bot 中选用。这里新增、修改和删除的连接只属于本插件。</p>
    </>}
  </section>
}
