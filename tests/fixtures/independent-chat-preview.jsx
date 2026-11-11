import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IndependentChatPage, IndependentChatEntry, BotConversationLink } from '../../apps/integration-client/independent-chat-page.jsx'
import { independentChatNavigation } from '../../apps/integration-client/independent-chat-navigation.mjs'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import chatCss from '../../apps/integration-client/chat.css'
import css from '../../apps/integration-client/independent-chat.css'
import { createProductApi } from '../../apps/integration-client/api.mjs'
import { chatSettingsFixture } from './chat-settings-data.mjs'

document.body.dataset.botProductUi = '1'; document.body.dataset.bpAppearance = 'light'
const style = document.createElement('style'); style.textContent = `${productCss}\n${workspaceCss}\n${chatCss}\n${css}\nhtml,body,#root{height:100%;margin:0}body{overflow:hidden}.fixture-controls{position:fixed;top:0;right:0;z-index:10}`; document.head.append(style)
const fixture = { calls: [], mode: 'success', host: 'a', nativeSessions: [], panels: [], delay: null, release: null }
const hostIds = { a: 'host-aaaaaaaaaaaaaaaa', b: 'host-bbbbbbbbbbbbbbbb' }
const journals = new Map(), transcripts = new Map()
const bots = host => [{ id: 'a', name: host === 'a' ? '研究伙伴' : '另一宿主伙伴', role: '把问题理清楚', model: 'fixture/research-model', sessionId: `${host}-real-session-a` }, { id: 'b', name: '写作伙伴', role: '一起完成下一步', model: 'fixture/writing-model', sessionId: `${host}-real-session-b` }]
const settingsFixtures = new Map()
const richShowcase = (host, botId) => {
  const at = Date.now(), id = name => `${host}-${botId}-rich-${name}`, lines = (...parts) => parts.join('\n'), src = { provider: 'fixture', model: 'offline' }
  return [
    { messageId: id('basics'), role: 'assistant', at, modelSource: src, content: lines('## 已整理的步骤', '', '1. 先核对来源', '2. 再整理为清单', '3. 最后给出结论', '', '> 依据会保留在每一步。', '', '可用 `npm test` 验证，**重要**步骤需 *重复* 检查。参考 [官方文档](https://example.invalid/docs)。') },
    { messageId: id('table'), role: 'assistant', at, modelSource: src, content: lines('宽表格在窄屏内横向滚动，不撑破页面：', '', '| 名称 | 类型 | 说明 | 状态 | 负责人 |', '| --- | --- | --- | --- | --- |', '| 核对 | 步骤 | 确认来源 | 完成 | 甲 |', '| 整理 | 步骤 | 生成清单 | 进行中 | 乙 |', '| 结论 | 输出 | 汇总结果 | 待开始 | 丙 |') },
    { messageId: id('code'), role: 'assistant', at, modelSource: src, content: lines('代码围栏与原文复制：', '', '```ts', 'const greeting = "你好，世界"', 'export function hello(name) {', '  return greeting + "，" + name', '}', '```', '', '```js', 'const raw = "<b>这不是HTML</b>"', 'console.log(raw)', '```') },
    { messageId: id('longcode'), role: 'assistant', at, modelSource: src, content: lines('超长单行代码在窄屏内横向滚动：', '', '```json', '{"averylongkey":"0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz"}', '```') },
    { messageId: id('math'), role: 'assistant', at, modelSource: src, content: lines('数学公式（KaTeX）：行内 $E = mc^2$，展示公式如下', '', String.raw`$$\int_0^1 x^2\,dx = \frac{1}{3}$$`, '', String.raw`以及 $\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$。`) },
    { messageId: id('links'), role: 'assistant', at, modelSource: src, content: lines('链接与媒体安全：', '', '- 安全外链：[示例](https://example.invalid/page)', '- 危险脚本：[点击](javascript:alert(1))', '- 数据协议：[数据](data:text/plain,hello)', '- 本地文件：[本地文件](file:///C:/secret.txt)', '- 本地图片：![机密图片](C:/Users/secret.png)') },
    { messageId: id('rawhtml'), role: 'assistant', at, modelSource: src, content: lines('原始 HTML 不应执行：', '', '<script>window.__richRawHtml=1</script>', '', '<img src="file:///etc/passwd" onerror="window.__richImgOnerror=1">', '', '<b>这段若被加粗说明漏洞</b>', '', '<div onclick="window.__richDivOnclick=1">点击不应触发</div>') },
    { messageId: id('toolcall'), role: 'assistant', at, modelSource: src, content: '', toolCalls: [{ id: 'call-rich-read', name: 'read_file', args: { path: 'C:/notes/secret.md', encoding: 'utf-8' } }, { id: 'call-rich-run', name: 'run_command', args: { command: '<script>alert(1)</script>' } }] },
    { messageId: id('toolresult-read'), role: 'tool', at, toolCallId: 'call-rich-read', name: 'read_file', content: lines('# 机密笔记', '第一行：读取成功。', '第二行：这是文件内容。') },
    { messageId: id('toolresult-run'), role: 'tool', at, toolCallId: 'call-rich-run', name: 'run_command', content: '命令被拒绝：当前策略不允许执行。', isError: true },
    { messageId: id('toolsummary'), role: 'assistant', at, modelSource: src, content: '已尝试读取笔记并运行命令；命令被拒绝，结果记录如上（记录不代表任务完成或已停止）。' },
  ]
}
const rows = (host, botId) => {
  const key = `${host}:${botId}`
  if (!transcripts.has(key)) transcripts.set(key, [...Array.from({ length: 54 }, (_, index) => ({ messageId: `${host}-${botId}-history-${index}`, role: index % 2 ? 'assistant' : 'user', content: index % 2 ? `我会先核对来源，再整理为清晰的步骤。这里是第 ${index} 条上下文。` : `请帮我整理这项工作，保留每一步的依据。第 ${index} 条。`, at: Date.now() - (54 - index) * 60000, ...(index % 2 ? { modelSource: { provider: 'fixture', model: 'offline' } } : {}) })), ...richShowcase(host, botId)])
  return transcripts.get(key)
}
const saved = () => { try { return JSON.parse(sessionStorage.getItem('independent-chat-fixture-journal') ?? '{}') } catch { return {} } }
for (const [key, value] of Object.entries(saved())) journals.set(key, value)
const save = () => sessionStorage.setItem('independent-chat-fixture-journal', JSON.stringify(Object.fromEntries(journals)))
const status = (botId, requestKey, patch = {}) => ({ schemaVersion: 1, botId, requestKey, state: 'running', pending: true, finished: false, stopConfirmed: false, durableInput: true, cancelRequested: false, ...patch })
const finish = (host, botId, requestKey) => {
  const held = journals.get(`${host}:${botId}:${requestKey}`)
  if (!held) return
  held.state = 'succeeded'; held.pending = false; held.finished = true; delete held.recoveryInput; save()
  delete held.progress; save()
  rows(host, botId).push({ messageId: `${host}-${requestKey}-answer`, role: 'assistant', content: '已经核对完了。我们可以从最重要的一步开始，逐项整理。', at: Date.now(), modelSource: { provider: 'fixture', model: 'offline' } })
}
const mockApi = host => ({
  snapshot: async () => ({ schemaVersion: 1, bots: bots(host), mainBotId: 'a', availableActions: ['independentChat.view'] }),
  dispatch: async (action, payload = {}) => {
    fixture.calls.push({ host, action, payload: structuredClone(payload) })
    if (action === 'ui.namespace') return { schemaVersion: 1, hostId: hostIds[host] }
    if (action.startsWith('binding.') || action.startsWith('botProfile.')) {
      const key = `${host}:${payload.botId}`
      if (!settingsFixtures.has(key)) settingsFixtures.set(key, chatSettingsFixture(bots(host).find(bot => bot.id === payload.botId)))
      return settingsFixtures.get(key).dispatch(action, payload)
    }
    const botId = payload.botId, journalKey = `${host}:${botId}:${payload.requestKey}`
    if (action === 'independentChat.view') {
      if (fixture.delay === host && (!fixture.delayBot || fixture.delayBot === botId)) await new Promise(resolve => { fixture.release = resolve })
      const requests = [...journals.entries()].filter(([key]) => key.startsWith(`${host}:${botId}:`)).map(([, value]) => value)
      return { schemaVersion: 1, botId, mode: fixture.integration ? 'integration' : 'independent', available: !fixture.integration, pendingRequest: requests.find(row => row.pending) ?? null, latestRequest: requests.at(-1) ?? null }
    }
    if (action === 'independentChat.messages') {
      const messages = rows(host, botId), end = payload.cursor ? messages.findIndex(row => row.messageId === payload.cursor) : messages.length
      const start = Math.max(0, end - (payload.limit ?? 40))
      return { schemaVersion: 1, botId, items: messages.slice(start, end), nextCursor: start ? messages[start].messageId : null }
    }
    if (action === 'independentChat.send') {
      const held = status(botId, payload.requestKey, fixture.mode === 'unknown' ? { state: 'unknown', finished: true, pending: false, recoveryInput: payload.input }
        : fixture.mode === 'hold' ? { progress: { step: 1, sequence: 2, text: '正在核对来源。\n这是一段尚未完成的回复。', truncated: false } } : {})
      journals.set(journalKey, held); save()
      rows(host, botId).push({ messageId: `${host}-${payload.requestKey}-user`, role: 'user', content: payload.input, at: Date.now() })
      if (fixture.mode === 'success') setTimeout(() => finish(host, botId, payload.requestKey), 180)
      if (fixture.mode === 'unknown') throw new Error('连接中断，原请求等待核对。')
      return { ...held }
    }
    if (action === 'independentChat.inspect') {
      const held = journals.get(journalKey)
      if (!held) throw Object.assign(new Error('宿主没有此请求'), { code: 'INDEPENDENT_CHAT_REQUEST_NOT_FOUND' })
      return { ...held }
    }
    if (action === 'independentChat.cancel') {
      const held = journals.get(journalKey); held.cancelRequested = true; save(); return { ...held }
    }
    throw Object.assign(new Error('离线预览不提供这个操作'), { code: 'PRODUCT_ACTION_UNAVAILABLE' })
  },
})
const apis = window.__independentChatNative ? { a: createProductApi() } : { a: mockApi('a'), b: mockApi('b') }
function Preview() {
  const [host, setHost] = useState('a'), [surface, setSurface] = useState('chat')
  fixture.setHost = setHost; fixture.setSurface = setSurface
  fixture.selectBot = botId => independentChatNavigation(apis[host]).select(botId)
  fixture.complete = () => { for (const [key, value] of journals) if (value.pending) { const [owner, botId, requestKey] = key.split(':'); finish(owner, botId, requestKey) } }
  const api = apis[host]
  const open = id => { fixture.panels.push(id); setSurface('chat') }
  const native = id => fixture.nativeSessions.push(id)
  return surface === 'native' ? <div className="bp-conversation-tools"><IndependentChatEntry productApi={api} botId="a" openPanel={open}/><BotConversationLink productApi={api} bot={bots(host)[0]} openSession={native} onOpenIndependent={() => open('bot-product-independentChat')} available/></div>
    : <IndependentChatPage productApi={api} openPanel={open} openSession={native}/>
}
window.__independentChatFixture = fixture
createRoot(document.getElementById('root')).render(<Preview/> )
