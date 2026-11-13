import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CliChatProviders } from '../../apps/integration-client/cli-chat-providers.jsx'
import baseCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import aiCss from '../../apps/integration-client/ai-providers.css'

const style = document.createElement('style')
style.textContent = baseCss + workspaceCss + aiCss + '\nbody{margin:0;background:var(--bp-bg);font-family:system-ui}#fixture-controls{display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px;background:var(--bp-subtle);font-size:12px;color:var(--bp-muted)}main{padding:24px;max-width:1050px;margin:auto}main .bp-cli-chat{margin-top:0}h2{margin-top:0}.fixture-note{font-size:13px;color:var(--bp-muted)}'
document.head.append(style); document.body.setAttribute('data-bot-product-ui', '1')
const calls = [], state = { hungInspection: false, aborted: 0, toolsOpened: false, bindingsOpened: false }
const drivers = [
  { id: 'codex', name: 'Codex', implemented: true, hostTools: false, transport: 'app-server', credentialHint: '在官方工具面板登录后，保存时可选择导入此账号。', credentialTemplate: { files: { '.codex/auth.json': { placeholder: '按此驱动的格式填写账号资料' } } } },
  { id: 'cursorAgent', name: 'Cursor', implemented: true, hostTools: false, transport: 'acp' },
  { id: 'pi', name: 'Pi', implemented: true, hostTools: false, transport: 'rpc' },
  { id: 'deepseekAgent', name: 'DeepSeek Harness', implemented: true, available: false, hostTools: false, reason: '此驱动没有可用的订阅聊天路线。' },
]
const profiles = [[{ id: 'fixture-codex', revision: 7, driver: 'codex', name: 'Codex · 合成账号', provider: 'bot-cli-fixture', model: 'gpt-fixture', enabled: true,
  entry: { executable: 'C:\\Tools\\codex.exe', version: '1.2.3' }, credentialConfigured: true, usedBy: [{ id: 'chief', name: 'Chief · 合成 Bot' }], state: 'configured' }], []]
const apis = [0, 1].map(host => ({ dispatch: async (action, payload, signal) => {
  calls.push({ host, action, payload: structuredClone(payload) })
  signal?.addEventListener('abort', () => { state.aborted++ }, { once: true })
  if (action === 'cliProviders.list') return { schemaVersion: 1, drivers, profiles: structuredClone(profiles[host]) }
  if (action === 'cliProviders.inspect') {
    if (state.hungInspection) return new Promise(() => {})
    return { versionVerified: true, entry: payload.entry }
  }
  if (action === 'cliProviders.save') {
    const item = { ...payload, id: payload.id ?? 'fixture-new', revision: payload.expectedRevision + 1, credentialConfigured: true, state: 'configured', usedBy: [] }
    delete item.credentialJson; delete item.importLocalAccount; delete item.clearCredential
    profiles[host] = [item]; return { id: item.id, revision: item.revision }
  }
  if (action === 'cliProviders.remove') { profiles[host] = []; return { removed: true } }
  throw new Error('Unknown fixture action')
} }))
function Fixture() {
  const [host, setHost] = useState(0)
  globalThis.__cliChatFixture = { calls, state, switchHost: () => setHost(previous => 1 - previous) }
  return <><div id="fixture-controls"><span>本地界面验收 · 合成账号 · 不访问实际 CLI 或厂商</span><button type="button" onClick={() => setHost(previous => 1 - previous)}>切换验收连接</button></div>
    <main><div className="bp-ai"><h2>AI 提供方</h2><p className="fixture-note">CLI 聊天连接界面预览。这里的登录、模型与安装数据均为合成数据。</p>
      <CliChatProviders productApi={apis[host]} onOpenTools={() => { state.toolsOpened = true }} onOpenBindings={() => { state.bindingsOpened = true }}/></div></main></>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
