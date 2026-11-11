import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductPage, ProductNavigation } from '../../apps/integration-client/panels.jsx'
import { PRODUCT_PANELS } from '../../apps/integration-client/api.mjs'
import { installWorkspaceAppearance } from '../../apps/integration-client/workspace-ui.jsx'
import { UiIcon } from '../../apps/integration-client/ui-icons.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'

const now = Date.now()
const bots = [
  { id: 'main', name: 'Main', role: '拆解目标，协调团队交付', main: true, sessionId: 'session-main', model: { provider: 'fixture', model: 'coordinator' } },
  { id: 'research', name: '研究伙伴', role: '查找证据，梳理问题与方案', sessionId: 'session-research', model: { provider: 'fixture', model: 'research' } },
  { id: 'writer', name: '写作伙伴', role: '整理资料，完成清楚的表达', sessionId: 'session-writer', model: { provider: 'fixture', model: 'writer' } },
  { id: 'developer', name: '开发伙伴', role: '实现功能，验证交付结果', sessionId: 'session-developer', model: { provider: 'fixture', model: 'code' } },
]
const tasks = [
  { taskId: 'research-current', botId: 'research', title: '研究项目交互与可借鉴的设计', state: 'running', updatedAt: now - 3 * 60_000, attempts: 1 },
  { taskId: 'receipt-original', botId: 'developer', title: '核对远程文件写入的原始结果', state: 'needs-reconciliation', updatedAt: now - 8 * 60_000, attempts: 1, operationId: 'fixture-operation-original', result: { remote: { status: 'unknown', stopConfirmed: false, possiblyApplied: true } } },
  { taskId: 'review-approval', botId: 'writer', title: '确认整理好的资料可写入工作目录', state: 'waiting-approval', updatedAt: now - 12 * 60_000, attempts: 0, blockedReason: '已准备好内容，等待你确认这次文件写入。' },
  { taskId: 'workspace-plan', botId: 'main', title: '规划下一轮工作空间改进', state: 'queued', updatedAt: now - 16 * 60_000, attempts: 0 },
  { taskId: 'read-report', botId: 'research', title: '整理源码结构与关键数据流', state: 'succeeded', updatedAt: now - 30 * 60_000, attempts: 1 },
  { taskId: 'design-notes', botId: 'writer', title: '完成本周设计讨论记录', state: 'succeeded', updatedAt: now - 50 * 60_000, attempts: 1 },
]
const snapshot = { schemaVersion: 1, observedAt: new Date(now).toISOString(), readOnly: null, mainBotId: 'main', bots,
  tasks: { status: 'available', items: tasks, plans: [], total: tasks.length, truncated: false },
  machines: { status: 'available', items: [
    { id: 'main-computer', name: '工作电脑', status: 'online', platform: 'windows', roots: ['project'], version: '0.1.1', desktop: { status: 'available' } },
    { id: 'lab-computer', name: '实验电脑', status: 'offline', platform: 'windows', roots: ['project'], desktop: { status: 'unavailable' }, blockedReason: '这台电脑还没有连接。' },
  ] },
  bindings: { status: 'available', items: bots.map(bot => ({ botId: bot.id, revision: 1, model: bot.model, workspace: { root: 'fixture-workspace' }, tools: ['model/fixture', 'task/read'], maxConcurrentTasks: 1,
    settings: { enabled: true, model: bot.model, machineGrants: [], capabilities: [], officialTools: [], maxConcurrentTasks: 1, funding: { mode: 'api' } },
    catalog: { models: bots.map(item => ({ ...item.model, cliModels: [] })), machines: [], capabilities: [] },
  })) }, fundingAccounts: { status: 'available', items: [] },
  availableActions: ['botRoutingInspect', 'roles.list', 'binding.save', 'threads.list', 'webPanels.list'],
  threads: { status: 'available', items: [] },
  webPanels: { status: 'available', items: [
    { id: 'panel-1', name: '本地仪表盘', url: 'http://127.0.0.1:9911/dashboard', host: '127.0.0.1:9911', revision: 1, status: 'ready', createdAt: now - 3600_000 },
    { id: 'panel-2', name: '构建看板', url: 'http://127.0.0.1:9912/board', host: '127.0.0.1:9912', revision: 1, status: 'ready', createdAt: now - 7200_000 },
  ] },
}
const calls = []
const api = Object.freeze({ snapshot: async () => ({ ...snapshot, observedAt: new Date().toISOString() }), dispatch: async (action, payload) => {
  calls.push({ action, payload })
  if (action === 'botRoutingInspect') return { enabled: true, preset: 'balanced', requesterBotId: 'main', settingsRevision: 1, autoGrant: { machineTools: false, cliTools: false }, candidates: bots.map(bot => ({ botId: bot.id, name: bot.name, main: bot.main, model: bot.model, quality: null, pricePerMTokUsd: null, machineId: null })) }
  if (action === 'roles.list') return []
  if (action === 'threads.list') return { status: 'available', reason: '', nextAction: '', threads: [
    { threadId: 't-1', name: '排查线索甲', sessionId: 'session-thread-1', archivedAt: null, createdAt: now - 3600_000, updatedAt: now - 3600_000, active: true, sessionState: 'owned' },
    { threadId: 't-2', name: '排查线索乙', sessionId: 'session-thread-2', archivedAt: null, createdAt: now - 7200_000, updatedAt: now - 7200_000, active: false, sessionState: 'owned' },
  ], activeThreadId: 't-1', sessionBinding: 'host-confirmed', archiveAuthority: 'host' }
  if (action === 'webPanels.list') return { status: 'available', items: snapshot.webPanels.items, revision: 1 }
  throw new Error('离线夹具不执行此宿主操作。')
} })
window.__workspaceFixture = { calls, snapshot, api }
document.body.setAttribute('data-bot-product-ui', '1')
installWorkspaceAppearance(window)
const style = document.createElement('style')
style.textContent = `${productCss}\n${workspaceCss}\nhtml,body,#root{height:100%;margin:0}body{font-family:var(--bp-font);background:var(--bp-bg)}.fixture-note{height:27px;display:flex;align-items:center;justify-content:center;background:#24332a;color:#e5eee6;font-size:10px;letter-spacing:.02em}.fixture-shell{display:grid;grid-template-columns:238px minmax(0,1fr);height:calc(100% - 27px)}.fixture-sidebar{display:flex;flex-direction:column;min-height:0;background:var(--bp-sidebar);border-right:1px solid var(--bp-border);color:var(--bp-ink);padding-top:16px}.fixture-brand{display:flex;align-items:center;gap:10px;padding:8px 22px 17px;font-size:14px;font-weight:650;color:var(--bp-solid)}.fixture-sidebar .bp-nav{max-height:none;margin:0 10px;padding:0 0 17px}.fixture-roster{border-top:1px solid var(--bp-border);margin:0 14px;padding-top:20px;overflow:auto}.fixture-roster>p{margin:0 10px 12px;font-size:10px;color:var(--bp-muted)}.fixture-roster>button{display:flex;width:100%;align-items:center;gap:10px;border:0;border-radius:8px;background:none;text-align:left;padding:10px;color:var(--bp-ink);font:12px var(--bp-font);cursor:pointer}.fixture-roster strong{font-weight:500}.fixture-roster small{display:block;font-size:10px;color:var(--bp-muted);margin-top:4px}.fixture-roster .bp-team-avatar{width:30px;height:30px;border-radius:9px}.fixture-footer{margin-top:auto;padding:17px 24px;color:var(--bp-muted);font-size:10px}.fixture-main{min-width:0;min-height:0;height:100%}.fixture-notice{position:fixed;bottom:10px;left:50%;z-index:10001;background:var(--bp-surface);color:var(--bp-ink);border:1px solid var(--bp-border);padding:12px;border-radius:8px;font-size:12px}@media(max-width:760px){.fixture-shell{grid-template-columns:1fr}.fixture-sidebar{display:none}}`
style.textContent += '\n.fixture-brand{order:0}.fixture-sidebar .bp-nav{order:1}.fixture-roster{order:2}.fixture-footer{order:3}'
document.head.append(style)
if (window.__fixtureInheritedCss) { const inheritedTheme=document.createElement('style');inheritedTheme.textContent=window.__fixtureInheritedCss;document.head.append(inheritedTheme) }

function Fixture() {
  const [section, setSection] = useState('home'), [notice, setNotice] = useState('')
  const openPanel = id => {
    const target = Object.entries(PRODUCT_PANELS).find(([, value]) => value === id)?.[0]
    if (target) setSection(target)
  }
  const openSession = id => { setNotice(`离线夹具：已定位 ${bots.find(bot => bot.sessionId === id)?.name ?? id} 的原始会话`); setTimeout(() => setNotice(''), 4000) }
  return <><div className="fixture-note">本地验证 · 离线夹具数据 · 基于 0.66.4 的未发布改动</div><div className="fixture-shell"><aside className="fixture-sidebar"><div className="fixture-brand"><UiIcon name="spark" size={22} />DSH Workspace</div><ProductNavigation panels={PRODUCT_PANELS} openPanel={openPanel} /><div className="fixture-roster"><p>对话伙伴</p>{bots.map(bot => <button key={bot.id} type="button" onClick={() => openSession(bot.sessionId)}><span className="bp-team-avatar"><UiIcon name={bot.main ? 'spark' : 'bot'} size={18} /></span><span><strong>{bot.name}</strong><small>{bot.role}</small></span></button>)}</div><div className="fixture-footer">工作空间界面验证</div></aside><div className="fixture-main"><ProductPage section={section} productApi={api} openPanel={openPanel} openSession={openSession} /></div></div>{notice && <p className="fixture-notice" role="status">{notice}</p>}</>
}
createRoot(document.getElementById('root')).render(<Fixture />)
