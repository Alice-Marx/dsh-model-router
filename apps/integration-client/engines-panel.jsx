import React, { useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import { Pill } from './models-panel.jsx'

const STATE = {
  ready: { label: '就绪', tone: 'success' },
  login: { label: '需要登录', tone: 'warning' },
  missing: { label: '未安装', tone: 'muted' },
  checking: { label: '检测中', tone: 'muted' },
  unknown: { label: '状态未知', tone: 'muted' },
}
const shortName = name => String(name ?? '').replace(/（官方工具）$/, '')

function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false)
  return <span className="bp-command"><code>{command}</code>
    <button type="button" className="bp-icon-button" aria-label={`复制 ${command}`} title="复制命令" onClick={async () => {
      try { await navigator.clipboard?.writeText(command); setCopied(true) } catch { setCopied(false) }
    }}><UiIcon name={copied ? 'check' : 'copy'} size={14} /></button></span>
}

/**
 * Official tools as Bot engines: the CLIs the person already signed in to. They run headless,
 * read-only, in a Host-owned empty folder and are billed by their own subscription.
 */
export function Engines({ snapshot, dispatch, busy, openPanel, workbenchPanel = 'model-router-galgame', bindingsPanel }) {
  const section = snapshot.engines
  if (section?.status !== 'available') {
    return <aside className="bp-blocked" role="status"><strong>暂不可用</strong><p>{section?.reason ?? '尚未取得官方工具引擎状态。'}</p>{section?.nextAction && <p className="bp-muted">下一步：{section.nextAction}</p>}</aside>
  }
  const bots = snapshot.bots ?? []
  const usedBy = provider => bots.filter(bot => String(bot.model ?? '').startsWith(`${provider}/`))
  const apiRoutes = (snapshot.quickBinding?.routes ?? []).filter(route => !route.engine)
  const providers = [...new Set(apiRoutes.map(route => route.provider))].map(provider => {
    const rows = apiRoutes.filter(route => route.provider === provider)
    const prices = snapshot.quickBinding?.settings?.prices ?? []
    const priced = rows.filter(route => route.profilePrice || prices.some(row => row.provider === route.provider && row.model === route.model)).length
    return { provider, count: rows.length, priced }
  })
  return <>
    <section className="bp-card bp-hero">
      <div className="bp-hero-copy"><h2>用你已经登录的官方工具当 Bot 的大脑</h2>
        <p className="bp-muted">在私聊的模型菜单里选「官方工具」分组即可。每次回复都交给官方 CLI 在宿主专用的空文件夹里只读运行，使用你自己的订阅登录，不读取 API Key，也不会修改你的文件。</p></div>
      <div className="bp-actions"><button type="button" disabled={busy || !snapshot.availableActions?.includes('engines.refresh')} onClick={() => dispatch('engines.refresh', {})}>
        <UiIcon name="refresh" size={15} className={section.checking ? 'bp-spinning' : ''} />重新检测</button>
        <button type="button" onClick={() => openPanel?.(workbenchPanel)}>安装与登录…</button></div>
      <p className="bp-muted bp-hero-meta">{section.checking ? '正在检测…' : section.checkedAt ? `上次检测 ${new Date(section.checkedAt).toLocaleString('zh-CN')}` : '尚未检测'}</p>
    </section>
    <div className="bp-engine-grid">{section.items.map(engine => {
      const state = STATE[engine.state] ?? STATE.unknown, users = usedBy(engine.provider)
      return <article key={engine.provider} className="bp-card bp-engine" data-state={engine.state}>
        <div className="bp-card-title"><div className="bp-person-heading"><span className="bp-engine-mark" data-tool={engine.toolId}>{shortName(engine.name).slice(0, 1)}</span>
          <div><h2>{shortName(engine.name)}</h2><p className="bp-muted">{engine.vendor} · 官方工具</p></div></div><Pill tone={state.tone}>{state.label}</Pill></div>
        <dl className="bp-facts bp-facts-compact">
          <div className="bp-value"><dt>版本</dt><dd>{engine.version ?? (engine.installed === false ? '未安装' : '未知')}{engine.updateAvailable && engine.latestVersion ? <Pill tone="accent">可更新到 {engine.latestVersion}</Pill> : null}</dd></div>
          <div className="bp-value"><dt>使用中的 Bot</dt><dd>{users.length ? users.map(bot => bot.name).join('、') : '暂无'}</dd></div>
        </dl>
        {engine.state === 'login' && <p className="bp-engine-hint">在终端运行 <CopyCommand command={engine.login.command} /> 登录后点「重新检测」。</p>}
        {engine.state === 'missing' && <p className="bp-engine-hint">还没有安装。打开「安装与登录…」，在官方工具页一键安装。</p>}
        {engine.login.detail && engine.state !== 'missing' && <p className="bp-muted bp-engine-detail">{engine.login.detail}</p>}
        {!engine.registered && <p className="bp-muted">此宿主未注册该引擎；请确认插件设置中的「官方工具引擎」已开启。</p>}
        <div className="bp-chip-row">{engine.models.map(model => <span key={model.id} className="bp-chip">{model.name}</span>)}</div>
      </article>
    })}</div>
    <section className="bp-card">
      <div className="bp-card-title"><div><h2>API 模型</h2><p className="bp-muted">按调用计费的模型。快速模式需要知道价格；没有价格的模型会被拒绝，而不是按猜测计费。</p></div>
        {bindingsPanel && <button type="button" onClick={() => openPanel?.(bindingsPanel)}>设置价格</button>}</div>
      {providers.length === 0 ? <p className="bp-muted">宿主目录里还没有 API 模型。在 DSH 设置中添加模型供应商后会出现在这里。</p>
        : <ul className="bp-provider-list">{providers.map(row => <li key={row.provider}><span className="bp-model-glyph"><UiIcon name="chip" size={15} /></span>
          <strong>{row.provider}</strong><span className="bp-muted">{row.count} 个模型</span>
          <Pill tone={row.priced === row.count ? 'success' : row.priced ? 'accent' : 'warning'}>{row.priced === row.count ? '价格齐全' : `${row.priced}/${row.count} 已定价`}</Pill></li>)}</ul>}
    </section>
  </>
}
