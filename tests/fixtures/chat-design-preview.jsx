/* Offline preview of the Bot conversation surface. Nothing here talks to a model,
 * a Host or the network: it renders the real product components
 * (ContactNavigation / ContactToolbar / ConversationTools) inside a DOM rebuilt
 * from DS Bot 0.2.7's own markup contract, with the vendor's own stylesheets
 * injected. It exists so the chat design can be looked at and measured in a real
 * browser before it ships — it is not a recording of a live session.
 *
 * The native parts are stand-ins by necessity and are marked as such:
 *   - `.bt-mark` holds a plain disc where BotMark draws the Bot's own shape;
 *   - `_userRow_fixture` / `_bubble_fixture` / `_scroll_fixture` / `_root_fixture`
 *     / `_header_fixture` / `_tools_fixture` / `_trailing_fixture` /
 *     `_primary_fixture` stand in for the shell's hashed class names, which the
 *     vendor's `[class*="…"]` selectors still match;
 *   - the composer's primary control is the shell's send button; this preview
 *     swaps its label between send and stop so both states can be inspected, and
 *     records the click instead of sending anything. What the preview types is
 *     echoed back as a local user bubble and never reaches a model.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ContactNavigation, ContactToolbar, ConversationTools } from '../../apps/integration-client/chat-ui.jsx'
import { contactAttention } from '../../apps/integration-client/contact-attention.jsx'
import { installWorkspaceAppearance } from '../../apps/integration-client/workspace-ui.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import chatCss from '../../apps/integration-client/chat.css'
import botThreadsCss from '../../apps/integration-client/bot-threads.css'
import botThreadHeaderCss from '../../apps/integration-client/bot-thread-header-bridge.css'
import { chatSettingsFixture } from './chat-settings-data.mjs'

const bot = { id: 'research', name: '研究伙伴', model: 'fixture/research-model', appliedModel: 'fixture/research-model' }
const settingsApi = chatSettingsFixture(bot)
window.__chatSettingsFixture = settingsApi
const roster = { models: [{ ref: 'fixture/research-model', name: 'Fixture Research' }], memory: true }
const sessionId = 'bot-research:part-3'
if (location.hash === '#threads') {
  const projectedBot = { ...bot, sessionId }
  roster.byId = { [sessionId]: projectedBot, 'thread-session-research': projectedBot }
  roster.threadsById = { 'thread-session-research': { botId: bot.id, threadId: 'thread-research', sessionId: 'thread-session-research', name: '长文资料与实验记录' } }
}
const threadRows = [{ botId: bot.id, threadId: 'thread-research', name: '长文资料与实验记录', sessionId: 'thread-session-research', state: 'open', sessionState: 'bound', updatedAt: Date.now() }]
const threadApi = { dispatch: async (action, payload) => {
  if (action === 'threads.list') return { botId: bot.id, threads: threadRows }
  if (action === 'threads.open') return { sessionId: threadRows[0].sessionId, thread: threadRows[0] }
  return settingsApi.dispatch(action, payload)
} }
const snapshot = { schemaVersion: 1, tasks: { status: 'available', truncated: true, total: 12, items: [
  { taskId: 'receipt-original', botId: 'developer', title: '核对远程文件写入的原始结果', state: 'needs-reconciliation', updatedAt: Date.now() - 8 * 60_000, attempts: 1, operationId: 'fixture-operation-original' },
  { taskId: 'review-approval', botId: 'writer', title: '确认整理好的资料可写入工作目录', state: 'waiting-approval', updatedAt: Date.now() - 12 * 60_000, attempts: 0 },
] } }
const attention = contactAttention(snapshot)
const calls = []

const noticeNode = () => document.querySelector('.fixture-notice')
const notice = text => {
  const node = noticeNode()
  if (!node) return
  node.textContent = text
  node.hidden = false
  clearTimeout(window.__chatDesignNoticeTimer)
  window.__chatDesignNoticeTimer = setTimeout(() => { node.hidden = true }, 4000)
}
const record = (action, detail) => { calls.push({ action, detail }); notice(`离线预览：${action}${detail ? ` · ${detail}` : ''}`) }
const actions = {
  showDetails: (...args) => record('打开会话详情', args[1]),
  openMemory: id => record('打开记忆', id),
  openVoice: id => record('打开语音聊天', id),
}
window.__chatDesignFixture = { calls, bot, roster, sessionId, snapshot, attention }

document.body.setAttribute('data-bot-product-ui', '1')
installWorkspaceAppearance(window)
const style = document.createElement('style')
style.textContent = `${productCss}\n${workspaceCss}\n${chatCss}\n${botThreadsCss}\n${botThreadHeaderCss}\n${window.__fixtureVendorCss ?? ''}\n${window.__fixtureInheritedCss ?? ''}
/* Preview-only chrome: the window frame this fixture stands in for. The product
   and vendor styles above are the ones under test. */
html,body,#root{height:100%;margin:0}
body{font-family:var(--bp-font);background:var(--bt-main);color:var(--bt-ink)}
.fixture-note{height:27px;display:flex;align-items:center;justify-content:center;background:#24332a;color:#e5eee6;font-size:10px;letter-spacing:.02em}
.fixture-bar{height:34px;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--bt-sidebar);border-bottom:1px solid var(--bt-line);color:var(--bt-ink-2);font-size:11px}
.fixture-bar button{height:24px;padding:0 10px;border:1px solid var(--bt-line-2);border-radius:6px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:11px;cursor:pointer}
.fixture-bar button[aria-pressed=true]{border-color:var(--bt-accent);color:var(--bt-accent)}
.fixture-state{margin-left:auto;color:var(--bt-ink-2)}
.fixture-count{color:var(--bt-ink-2)}
.fixture-shell{display:grid;grid-template-columns:264px minmax(0,1fr);height:calc(100% - 61px)}
.fixture-sidebar{display:flex;flex-direction:column;min-height:0;background:var(--bt-sidebar);border-right:1px solid var(--bt-line);padding-top:14px}
.fixture-sidebar>.bt-side{padding:0 12px 8px 0}
.fixture-account{font-size:11px;color:var(--bt-ink-2)}
.fixture-main{min-width:0;min-height:0;height:100%}
.fixture-conversation{position:relative;display:flex;flex-direction:column;min-width:0;height:100%;background:var(--bt-main)}
/* The Host owns this flex/scroll layout. Vendor CSS only reskins it; without
   this fixture rule long transcripts would stretch the page and falsely make
   an offscreen composer look like a visible native control. */
._scroll_fixture{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
._root_fixture{flex:none}
.fixture-input{flex:1;min-width:0;min-height:24px;padding:2px 0;outline:none;font:inherit;font-size:14px;line-height:22px;color:var(--bt-ink);white-space:pre-wrap;overflow-wrap:anywhere}
.fixture-input:empty::before{content:"给研究伙伴留言";color:var(--bt-ink-3)}
.fixture-notice{position:fixed;bottom:12px;left:50%;translate:-50% 0;z-index:10001;margin:0;padding:10px 14px;border:1px solid var(--bt-line);border-radius:9px;background:var(--bt-card);color:var(--bt-ink);font-size:12px}
@media (max-width:760px){.fixture-shell{grid-template-columns:64px minmax(0,1fr)}}
`
document.head.append(style)
/** The native BotMark stand-in: a disc with the Bot's initial. */
const Mark = ({ label }) => <span className="bt-mark" style={{ width: 36, height: 36, '--bt-size': 36 }} aria-hidden="true">
  <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="var(--bt-hover)" /><text x="18" y="23" textAnchor="middle" fontSize="14" fill="var(--bt-ink-2)">{label}</text></svg>
</span>

const contacts = [
  { kind: 'tile', id: 'main', name: '主 Bot', role: '拆解目标，协调团队交付' },
  { kind: 'row', id: 'research', name: '研究伙伴', preview: '正在整理三份可借鉴的设计资料' },
  { kind: 'row', id: 'writer', name: '写作伙伴', preview: '已写好本周设计讨论记录，等你确认', unread: true },
  { kind: 'row', id: 'developer', name: '开发伙伴', preview: '修复 modules/bot-runtime/vendor/ds-bot/src/client/header.js 的注入顺序' },
  { kind: 'room', id: 'room-design', name: '界面设计小组', preview: '3 位成员正在讨论密度与留白', members: 3 },
]

/** The native sidebar folds its own column; the preview follows the same breakpoint. */
function useNarrow(query = '(max-width: 760px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const change = event => setNarrow(event.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [query])
  return narrow
}

function Fixture() {
  const [viewSessionId, setViewSessionId] = useState(sessionId)
  const narrow = useNarrow()
  const [running, setRunning] = useState(true)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState([])
  const input = useRef(null)
  const send = () => {
    const text = (input.current?.textContent ?? '').trim()
    if (!text) return
    setSent(list => [...list, text])
    record('发送消息', `${text.slice(0, 18)}…`)
    if (input.current) input.current.textContent = ''
    setDraft('')
    input.current?.focus()
  }
  return <>
    <div className="fixture-note">本地验证 · 离线预览 · 重建的 DS Bot 0.2.7 DOM 合同 + 真实产品组件 · 未发布改动</div>
    <div className="fixture-bar">
      <span>预览开关（不属于产品）：</span>
      <button type="button" onClick={() => setRunning(value => !value)} aria-pressed={running}>{running ? '运行中（显示停止）' : '空闲（显示发送）'}</button>
      <span className="fixture-state" role="status">{running ? 'Bot 正在处理这一轮' : 'Bot 空闲，可以发送'}</span>
      <span className="fixture-count">已记录 {calls.length} 次操作，均未触达宿主</span>
    </div>
    <div className="fixture-shell">
      <aside className="fixture-sidebar">
        <div className="bt-side">
          <div className="bt-side-top"><span className="bt-brand"><Mark label="D" />DSH Bot</span></div>
          <ContactToolbar compact={narrow} actions={{ openPalette: query => record('打开聊天搜索', query), openNewChat: mode => record('新建聊天', mode) }} />
          <div className="bt-list" role="region" aria-label="Bot list">
            <div className="bt-tile-wrap"><button type="button" className="bt-tile" aria-current="page" data-bot-id="main"><Mark label="主" /><span className="bt-tile-name">主 Bot</span><span className="bt-chip">拆解目标，协调团队交付</span></button></div>
            {contacts.filter(row => row.kind !== 'tile').map(row => <button type="button" key={row.id} className="bt-row" data-bot-id={row.kind === 'row' ? row.id : undefined} data-room-id={row.kind === 'room' ? row.id : undefined} aria-current={row.id === 'research' ? 'page' : undefined}>
              <Mark label={row.name.slice(0, 1)} />
              <span className="bt-row-body">
                <span className="bt-row-name"><span className="bt-row-title">{row.name}</span>{row.kind === 'room' && <span className="bt-tag">{row.members} 位成员</span>}</span>
                <span className="bt-row-preview">{row.preview}</span>
              </span>
              {row.unread && <span className="bt-unread" aria-hidden="true" />}
            </button>)}
            <div className="bt-read-only">只读名单：这个窗口只能看，不能改。</div>
          </div>
          <ContactNavigation compact={narrow} attentionCount={attention.count} attentionPartial={attention.partial} attentionKnown={attention.known}
            onNavigate={target => record('切换页面', target.section)} onOpenAdvanced={() => record('打开高级工作台')} />
          <div className="bt-leftcol-foot"><span className="fixture-account">本地账户</span></div>
        </div>
      </aside>
      <main className="fixture-main">
        <div className="fixture-conversation">
          <header className="_header_fixture">
            <div className="bt-head">
              <button type="button" className="bt-pill" aria-expanded="false"><Mark label="研" /><span className="bt-pill-name">研究伙伴</span><span className="bt-pill-go" aria-hidden="true">→</span></button>
              <ConversationTools sessionId={viewSessionId} bot={bot} roster={roster} actions={actions} running={running}
                productApi={location.hash === '#threads' ? threadApi : location.hash === '#settings' ? settingsApi : undefined} onOpenTools={() => record('官方工具', '安装与登录')}
                onOpenSession={id => { record('打开线程会话', id); setViewSessionId(id) }}
                onNavigate={target => record('聊天工具', `${target.section}${target.botId ? ` · ${target.botId}` : ''}`)} />
            </div>
          </header>
          <div className="_scroll_fixture">
            <div className="_column_fixture">
              <div className="bt-time-sep" role="separator">今天 09:12</div>
              <div className="bt-group-msg" data-bot-id="research">
                <span className="bt-group-name"><span className="bt-lead"><Mark label="研" /></span>研究伙伴<span className="bt-group-time">09:12</span></span>
                <div className="bt-astack">
                  <div className="bt-msg"><div className="bt-msg-line"><div className="bt-bubble">
                    <p>我看了 OpenMausBot 的对话界面，把它值得借鉴的部分整理成了三条：</p>
                    <ul><li>气泡只占一行宽度的一部分，回复始终留出自己的列；</li><li>工具调用折成一行灰字，不抢正文；</li><li>输入区是一张卡片，不放第二个工具栏。</li></ul>
                    <p>长路径按原样显示：<code>modules/bot-runtime/vendor/ds-bot/src/client/header.js</code></p>
                  </div></div></div>
                  <div className="bt-msg"><div className="bt-msg-line"><div className="bt-bubble">
                    <p>超长代码在气泡里横向滚动，不会把页面撑宽：</p>
                    <pre><code>{'body[data-bot-product-ui] [data-composer-card]:focus-within { border-color: var(--bp-chat-accent) !important; box-shadow: var(--bp-chat-shadow), 0 0 0 3px color-mix(in srgb, var(--bp-chat-accent) 18%, transparent) !important; }'}</code></pre>
                  </div></div></div>
                </div>
              </div>
              <div className="bt-umsg">
                <div className="bt-ustack">
                  <div className="bt-ubody">把联系人列表做为主视角，消息和输入区分层清楚。</div>
                  <div className="bt-utime">09:14</div>
                </div>
                <div className="bt-utools" data-open=""><button type="button" className="bt-tool" aria-label="复制">复制</button></div>
              </div>
              <div className="bt-urow"><div className="bt-ububble">更早的一条回复，走的是另一套渲染器。</div><div className="bt-utime">09:10</div></div>
              <div className="_userRow_fixture"><div className="_bubble_fixture">宿主自己画的用户气泡，几何要与上面两条一致。</div></div>
              <div className="bt-event"><span>调用了</span><button type="button" className="bt-event-whole"><span>读取资料库</span></button><span>· 0.4 秒</span></div>
              <div className="bt-event bt-event-error" role="status" title="fixture/tool-timeout">远程写入没有回执，结果待确认。</div>
              <details className="bt-think"><summary>思考过程 · 1.2 秒</summary><div className="bt-think-text" role="region" tabIndex={0}>先确认选择器的优先级，再决定要不要加 !important；不要让装饰盖住审批和停止按钮。</div></details>
              {running && <div className="bt-typing" aria-hidden="true"><Mark label="研" /><span className="bt-typing-text"><span className="bt-typing-label"><span className="bt-shimmer">正在整理资料</span></span><span className="bt-typing-time">0:12</span></span></div>}
              <div className="bt-q" aria-labelledby="fixture-question">
                <div className="bt-q-head"><div className="bt-q-text"><p className="bt-q-title" id="fixture-question">要我把这份设计写进资料库吗？</p><div className="bt-q-detail">写入会替换《界面设计小组》里的旧版本。</div></div><button type="button" className="bt-q-x" aria-label="忽略问题">×</button></div>
                <div className="bt-q-list" role="group">
                  <button type="button" className="bt-q-opt"><span className="bt-key">1</span><span className="bt-q-body"><span className="bt-q-label">写入并保留旧版本为副本</span><span className="bt-q-desc">资料库里会多一条历史记录</span></span></button>
                  <button type="button" className="bt-q-opt" aria-pressed="true"><span className="bt-key">2</span><span className="bt-q-body"><span className="bt-q-label">先给我看 diff</span></span></button>
                </div>
                <div className="bt-q-foot"><button type="button" className="bt-q-btn">跳过</button><button type="button" className="bt-q-submit">提交</button></div>
              </div>
              <div className="bt-fail">
                <div className="bt-fail-head"><span className="bt-fail-dot" aria-hidden="true" /><span className="bt-fail-text">这一轮没能完成：模型在 30 秒内没有回应。</span></div>
                <div className="bt-fail-actions"><button type="button" className="bt-send bt-fail-go">重试</button><button type="button" className="bt-soft bt-soft-sm">查看详情</button></div>
              </div>
              {sent.map((text, index) => <div className="bt-umsg" key={`sent-${index}`}>
                <div className="bt-ustack"><div className="bt-ubody">{text}</div><div className="bt-utime">刚刚</div></div>
                <div className="bt-utools"><button type="button" className="bt-tool" aria-label="复制">复制</button></div>
              </div>)}
            </div>
          </div>
          <div className="_root_fixture">
            <div data-composer-card>
              <div className="_tools_fixture"><button type="button" className="bt-mic" aria-label="听写">麦</button></div>
              <div data-input-scroll><div ref={input} data-composer-input role="textbox" contentEditable suppressContentEditableWarning className="fixture-input" data-testid="composer-input"
                onInput={event => setDraft(event.currentTarget.textContent ?? '')}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /></div>
              <div className="_trailing_fixture">
                {running
                  ? <button type="button" className="_primary_fixture" data-testid="composer-stop" aria-label="停止这一轮" onClick={() => { record('停止这一轮'); setRunning(false) }}>停</button>
                  : <button type="button" className="_primary_fixture" data-testid="composer-send" aria-label="发送" disabled={!draft.trim()} onClick={send}>发</button>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
    <p className="fixture-notice" role="status" hidden />
  </>
}

createRoot(document.getElementById('root')).render(<Fixture />)
