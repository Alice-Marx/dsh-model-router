import React from 'react'
import {createRoot} from 'react-dom/client'
import {SecurePairingSetup} from '../../apps/integration-client/secure-pairing.jsx'
import {AppearanceControls,installWorkspaceAppearance} from '../../apps/integration-client/workspace-ui.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import chatCss from '../../apps/integration-client/chat.css'
document.body.dataset.botProductUi='1';installWorkspaceAppearance(window)
const style=document.createElement('style');style.textContent=`${productCss}\n${workspaceCss}\n${chatCss}\nbody{margin:0;background:var(--bp-bg);color:var(--bp-ink);font-family:var(--bp-font)}.fixture-banner{padding:10px;text-align:center;font-size:12px;background:var(--bp-sidebar)}.fixture-pairing{max-width:760px;padding:20px;margin:auto}.fixture-pairing>header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.fixture-pairing h1{font-size:21px}`;document.head.append(style)
window.__pairingFixture={calls:[]}
const dispatch=async(action,payload)=>{window.__pairingFixture.calls.push({action,payload});throw Object.assign(new Error('离线夹具未进行真实设备配对。'),{code:'FIXTURE_OFFLINE'})}
createRoot(document.getElementById('root')).render(<><div className="fixture-banner">本地验证 · 离线配对夹具 · 0.66.4 未发布改动</div><main className="bp-page fixture-pairing"><header><h1>连接你的电脑</h1><AppearanceControls/></header><SecurePairingSetup snapshot={{mainBotId:'bot-a',bots:[{id:'bot-a'}],machines:{items:[]},availableActions:['machine.pair.invite']}} dispatch={dispatch}/></main></>)
