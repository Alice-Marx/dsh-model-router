import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductPage } from '../../apps/integration-client/panels.jsx'
import { ContactAttentionNavigation } from '../../apps/integration-client/contact-attention.jsx'
import { PRODUCT_PANELS, workspaceNavigation } from '../../apps/integration-client/workspace-navigation.mjs'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import chatCss from '../../apps/integration-client/chat.css'
import notificationsCss from '../../apps/integration-client/notifications.css'

const bot = { id: 'research', name: '研究伙伴', sessionId: 'session-research', main: true, role: '整理证据与核对结果' }
const task = { botId: bot.id, taskId: 'original-task', attemptId: 'new-attempt', attemptNumber: 2, state: 'running', title: '整理项目研究记录', attempts: 2 }
const items = [
  { seq: 9, category: 'reconcile', tone: 'urgent', botId: bot.id, taskId: task.taskId, attemptId: 'old-attempt', text: '研究伙伴 的执行需要核对收据：结果未知，不会自动重试', at: Date.now() - 5 * 60_000, read: false, isNew: true },
  { seq: 8, category: 'succeeded', tone: 'ok', botId: bot.id, taskId: task.taskId, attemptId: 'old-attempt', text: '研究伙伴 的任务已完成', at: Date.now() - 80 * 60_000, read: false, isNew: true },
  { seq: 6, category: 'blocked', tone: 'wait', botId: bot.id, taskId: task.taskId, attemptId: 'old-attempt', text: '研究伙伴 的任务受阻，等待处理', at: Date.now() - 25 * 3_600_000, read: true, isNew: false },
]
let cursorSeq = 0
const summary = () => ({ schemaVersion: 1, status: 'available', unreadCount: items.filter(item => !item.read).length, cursorSeq, maxSeq: 9, truncated: false })
const snapshot = { schemaVersion: 1, readOnly: null, observedAt: new Date().toISOString(), bots: [bot], mainBotId: bot.id,
  tasks: { status: 'available', items: [], total: 0, truncated: false, plans: [] },
  bindings: { status: 'available', items: [] }, botBindings: { status: 'available', items: [] },
  machines: { status: 'available', items: [] }, usage: { status: 'available', items: [] }, fundingAccounts: { status: 'available', items: [] },
  availableActions: ['notifications.list', 'notifications.readModel', 'notifications.read', 'notifications.markAll', 'task.inspect', 'task.cancel', 'task.retry', 'task.reconcile'] }
const calls = []
const api = { snapshot: async () => structuredClone(snapshot), attention: async () => ({ ...snapshot, notifications: summary() }), dispatch: async (action, payload) => {
  calls.push({ action, payload })
  if (action === 'notifications.list') return { ...summary(), items: structuredClone(items), nextBefore: null }
  if (action === 'notifications.read') { items.find(item => item.seq === payload.seq).read = true; return summary() }
  if (action === 'notifications.markAll') { cursorSeq = 9; for (const item of items) item.read = true; return summary() }
  if (action === 'task.inspect') return { task, attempts: [
    { attemptId: 'old-attempt', number: 1, state: 'failed', operationId: 'old-operation' },
    { attemptId: 'new-attempt', number: 2, state: 'running', operationId: 'new-operation' },
  ], timeline: { items: [{ seq: 9, kind: 'settled', at: Date.now(), attemptId: 'old-attempt', attemptNumber: 1, operationId: 'old-operation', outcome: 'unknown' }], total: 1, truncated: false } }
  throw new Error('离线夹具不执行任务操作')
} }
window.__notificationFixture = { calls }
document.body.setAttribute('data-bot-product-ui', '1')
document.body.setAttribute('data-bp-appearance', 'light')
const style = document.createElement('style')
style.textContent = `${productCss}\n${workspaceCss}\n${chatCss}\n${notificationsCss}\nhtml,body,#root{height:100%;margin:0}.fixture-note{box-sizing:border-box;height:32px;padding:8px 16px;background:#edf2f8;color:#33465c;font:12px system-ui}.fixture-shell{display:grid;grid-template-columns:244px minmax(0,1fr);height:calc(100% - 32px)}.fixture-contacts{display:flex;flex-direction:column;padding:18px 10px;background:var(--bp-sidebar);color:var(--bp-ink);border-right:1px solid var(--bp-border)}.fixture-contacts>strong{padding:0 12px}.fixture-person{padding:20px 12px;font:13px system-ui}.fixture-contacts>.bp-contact-nav{margin-top:auto}.fixture-main{min-width:0;min-height:0}@media(max-width:700px){.fixture-shell{grid-template-columns:1fr}.fixture-contacts{display:none}}`
style.textContent += '\n.fixture-contacts>.fixture-person{flex:1}'
document.head.append(style)
function Fixture() {
  const [section, setSection] = useState('notifications')
  const openPanel = id => setSection(Object.keys(PRODUCT_PANELS).find(key => PRODUCT_PANELS[key] === id) ?? 'notifications')
  const navigate = value => { workspaceNavigation(api).navigate(value); openPanel(PRODUCT_PANELS[value.section]) }
  return <><div className="fixture-note">离线界面验证 · 合成任务通知 · 无模型调用</div><div className="fixture-shell"><aside className="fixture-contacts"><strong>Bot 伙伴</strong><div className="fixture-person">研究伙伴<br/><small>整理证据与核对结果</small></div><ContactAttentionNavigation productApi={api} onNavigate={navigate}/></aside><div className="fixture-main"><ProductPage section={section} productApi={api} openPanel={openPanel} openSession={() => {}}/></div></div></>
}
createRoot(document.getElementById('root')).render(<Fixture />)
