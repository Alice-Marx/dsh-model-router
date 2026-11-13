import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AiProvidersPage } from '../../apps/integration-client/ai-providers.jsx'
import { createProductApi } from '../../apps/integration-client/api.mjs'
import { SettingsDialog } from '../../modules/bot-runtime/vendor/ds-bot/src/client/settings.js'
import { SHELL_CSS } from '../../modules/bot-runtime/vendor/ds-bot/src/client/styles.js'
import baseCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import refinementCss from '../../apps/integration-client/product-refinement.css'

const style = document.createElement('style'); style.textContent = SHELL_CSS + baseCss + workspaceCss + '\nbody{margin:0;background:var(--bp-bg);font-family:system-ui}#fixture-controls{display:flex;flex-wrap:wrap;gap:8px;padding:8px 16px;background:var(--bp-subtle);font-size:12px;color:var(--bp-muted)}#fixture-main{padding:38px 24px;max-width:1050px;margin:auto}.bt-settings-shade{background:#0005}'; document.head.append(style)
document.body.setAttribute('data-bot-product-ui', '1')
const refinement = document.createElement('style'); refinement.textContent = refinementCss; document.head.append(refinement)
const apis = [createProductApi(), createProductApi((url, options) => fetch('alternate/' + url, options))]
function Fixture() {
  const [host, setHost] = useState(0), [settings, setSettings] = useState(false)
  globalThis.__aiFixture = { switchHost: () => setHost(previous => 1 - previous), openSettings: () => setSettings(true) }
  globalThis.__dshBotAiProvidersUi = { openSettings: () => setSettings(true), renderSettings: () => <AiProvidersPage productApi={apis[host]}/> }
  return <><div id="fixture-controls"><span>本地验收 · 合成账号 · 不访问实际提供商</span><button type="button" onClick={() => setSettings(true)}>插件设置</button><button type="button" onClick={() => setHost(previous => 1 - previous)}>切换验收连接</button></div>
    <main id="fixture-main"><AiProvidersPage productApi={apis[host]} onOpenTools={() => { globalThis.__aiFixture.toolsOpened = true }} onOpenBindings={() => { globalThis.__aiFixture.bindingsOpened = true }}/></main>
    {settings && <SettingsDialog page="models" roster={{ prefs: {}, bots: [], rooms: [], models: [] }} actions={{ providers() {}, closeSettings: () => setSettings(false), openSettings: () => {} }} useUpdate={() => {}}/>}</>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
