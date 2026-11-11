/* Offline preview of the identity and personality panel. Nothing here talks to a
 * model, a Host or the network: it renders the real product component against a
 * synthetic owner service that keeps a committed store, a revision and the same
 * conflict fence the wiring service applies. The controls along the top are
 * preview-only: they switch the Bot, edit it behind the panel's back and slow a
 * save down, which are the three situations the panel has to survive. */
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BotProfileIdentity } from '../../apps/integration-client/bot-profile-identity.jsx'
import { installWorkspaceAppearance } from '../../apps/integration-client/workspace-ui.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import { botProfileFixture } from './bot-profile-data.mjs'

const api = botProfileFixture()
window.__botProfileFixture = api
const initial = api.list()[0]

document.body.setAttribute('data-bot-product-ui', '1')
installWorkspaceAppearance(window)
const style = document.createElement('style')
style.textContent = `${productCss}\n${workspaceCss}\n`
// Preview-only chrome: the settings window this panel sits in. The product and
// workspace styles above are the ones under test.
+ `html,body,#root{height:100%;margin:0}
body{font-family:var(--bp-font);background:var(--bp-bg);color:var(--bp-ink)}
.fixture-note{height:27px;display:flex;align-items:center;justify-content:center;background:#24332a;color:#e5eee6;font-size:10px;letter-spacing:.02em}
.fixture-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;height:auto;min-height:38px;padding:6px 14px;background:var(--bp-sidebar);border-bottom:1px solid var(--bp-border);color:var(--bp-muted);font-size:11px}
.fixture-bar button{height:24px;padding:0 10px;border:1px solid var(--bp-border);border-radius:6px;background:var(--bp-surface);color:var(--bp-ink);font:inherit;font-size:11px;cursor:pointer}
.fixture-bar button[aria-pressed=true]{border-color:var(--bp-solid);color:var(--bp-solid)}
.fixture-state{margin-left:auto;color:var(--bp-muted)}
.fixture-window{display:flex;flex-direction:column;width:min(620px,100vw);height:calc(100% - 65px);margin-left:auto;background:var(--bp-bg);border-left:1px solid var(--bp-border);box-shadow:-12px 0 45px #0002}
.fixture-window header{display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--bp-border);background:var(--bp-surface)}
.fixture-window header h2{margin:0;font-size:16px;font-weight:600}
.fixture-window header p{margin:3px 0 0;font-size:12px;color:var(--bp-muted)}
.fixture-body{flex:1;min-height:0;overflow:auto;padding:18px 22px}
@media (max-width:520px){.fixture-window{width:100vw;border-left:0}.fixture-body{padding:14px}.fixture-window header{padding:13px 15px}}
`
document.head.append(style)

function Fixture() {
  const [botId, setBotId] = useState(initial.id)
  const [slow, setSlow] = useState(false)
  const [elsewhere, setElsewhere] = useState(0)
  const [, tick] = useState(0)
  // Preview-only: the counters below are read at render time, so the fixture
  // re-renders itself to keep them honest while a save is in flight.
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 300); return () => clearInterval(timer) }, [])
  const bot = api.list().find(item => item.id === botId) ?? initial
  return <>
    <div className="fixture-note">本地验证 · 离线预览 · 真实身份组件 + 合成拥有者响应 · 未发布改动 · 未触达宿主、模型或网络</div>
    <div className="fixture-bar">
      <span>预览开关（不属于产品）：</span>
      {api.list().map(item => <button key={item.id} type="button" data-bot-id={item.id} aria-pressed={item.id === botId} onClick={() => setBotId(item.id)}>{item.name}</button>)}
      <button type="button" onClick={() => { api.editElsewhere(botId, { instructions: `别处改过的指令 · ${Date.now() % 1000}` }); setElsewhere(value => value + 1) }}>他处修改这个 Bot 的指令</button>
      <button type="button" aria-pressed={slow} onClick={() => { const next = !slow; setSlow(next); api.setDelay(next ? 700 : 0) }}>{slow ? '慢速保存（700ms）' : '慢速保存'}</button>
      <span className="fixture-state" role="status">已记录 {api.calls.length} 次操作 · 他处修改 {elsewhere} 次 · 宿主修订号 {api.store.revision}</span>
    </div>
    <section className="fixture-window" aria-label="Bot 设置侧窗">
      <header><span aria-hidden="true">🤖</span><div><h2>{bot.name} 的设置</h2><p>模型与官方工具 · 身份与个性</p></div></header>
      <div className="fixture-body">
        <BotProfileIdentity productApi={api} botId={botId}/>
      </div>
    </section>
  </>
}

createRoot(document.getElementById('root')).render(<Fixture/>)
