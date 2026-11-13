import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Machines } from '../../apps/integration-client/panels.jsx'
import { AiProvidersPage } from '../../apps/integration-client/ai-providers.jsx'
import { BotSettingsDialog } from '../../apps/integration-client/bot-settings-dialog.jsx'
import { UiIcon } from '../../apps/integration-client/ui-icons.jsx'
import { chatSettingsFixture } from './chat-settings-data.mjs'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import chatCss from '../../apps/integration-client/chat.css'
import desktopCss from '../../apps/integration-client/desktop.css'
import refinementCss from '../../apps/integration-client/product-refinement.css'

document.body.dataset.botProductUi='1'
const style=document.createElement('style');style.textContent=`${productCss}\n${workspaceCss}\n${chatCss}\n${desktopCss}\n${refinementCss}\n
body{margin:0;background:var(--bp-bg);font-family:system-ui;color:var(--bp-ink)}*{box-sizing:border-box}.preview-shell{display:flex;min-height:100vh}.preview-sidebar{width:218px;flex:none;padding:26px 16px;background:var(--bp-sidebar);border-right:1px solid var(--bp-border)}.preview-sidebar h1{font-size:17px;display:flex;align-items:center;gap:10px;margin:0 12px 28px}.preview-sidebar button{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:0;background:transparent;border-radius:10px;color:inherit;font:inherit;text-align:left;cursor:pointer}.preview-sidebar button[aria-pressed=true]{background:var(--bp-surface)}.preview-main{flex:1;min-width:0}.preview-top{height:70px;display:flex;align-items:center;gap:14px;padding:0 35px;border-bottom:1px solid var(--bp-border)}.preview-top strong{font-size:15px;flex:1}.preview-top button{border:0;background:var(--bp-subtle);color:inherit;border-radius:20px;padding:8px 13px;cursor:pointer}.preview-content{height:auto;max-width:1050px;margin:auto;padding:28px}.preview-note{font-size:11px;color:var(--bp-muted);text-align:center;margin:20px}.preview-contact{margin-top:28px;padding:12px;border-top:1px solid var(--bp-border);display:flex;align-items:center;gap:10px;font-size:13px}.preview-bot-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--bp-accent-soft);color:var(--bp-focus)}@media(max-width:700px){.preview-sidebar{display:none}.preview-content{padding:16px}.preview-top{padding:0 18px}}
`;document.head.append(style)
const bot={id:'research',name:'研究伙伴',role:'整理研究证据',main:false}
const binding=chatSettingsFixture(bot)
const calls=[];window.__refinement={calls}
let local={schemaVersion:1,state:'disabled',revision:0,config:null,desktopSupported:true,addresses:['192.168.1.8','127.0.0.1'],defaults:{name:'我的工作电脑',listenAddress:'192.168.1.8',port:9781,sharedDirectory:'C:/Users/You/DSH-Share',allowWrite:false,allowDesktop:true}}
const api={dispatch:async(action,payload)=>{
 calls.push({action,payload})
 if(action==='machine.host.status')return structuredClone(local)
 if(action==='machine.host.devices')return {items:[]}
 if(action==='machine.host.configure'){local={...local,state:payload.enabled?'running':'disabled',listening:payload.enabled,revision:local.revision+1,config:{...payload,endpoint:payload.endpoint||`http://${payload.listenAddress}:${payload.port}`}};return structuredClone(local)}
 if(action==='machine.host.invite')throw Error('本地界面预览不生成真实配对邀请。')
 if(action==='aiProviders.list')return {schemaVersion:1,protocols:['openai-completions','anthropic-messages'],presets:[{id:'openai',name:'OpenAI',mark:'O',baseUrl:'https://api.openai.com/v1',protocol:'openai-completions'},{id:'moonshot',name:'Kimi',mark:'K',baseUrl:'https://api.moonshot.cn/v1',protocol:'openai-completions'},{id:'custom',name:'自定义',mark:'+',baseUrl:'',protocol:'openai-completions'}],providers:[{id:'kimi-fixture',name:'Kimi',preset:'moonshot',state:'configured',enabled:true,keyConfigured:true,models:[{id:'kimi-k3'}],baseUrl:'https://api.moonshot.cn/v1',auth:'key'}]}
 if(action==='cliProviders.list')return {schemaVersion:1,drivers:[],profiles:[{id:'codex-preview',name:'Codex',driver:'codex',model:'默认模型',state:'configured'}]}
 if(action==='aiProviders.cliStatus')return {tools:[{toolId:'codex',label:'Codex CLI',status:'ready'},{toolId:'claude-code',label:'Claude Code',status:'logged-out',reason:'登录后可用'}]}
 if(action==='binding.inspect'){
  const result=await binding.dispatch(action,payload)
  result.record.catalog.tools=[{toolId:'codex',label:'Codex CLI',installed:true,loginState:'logged-in',status:'ready',modes:['read-only'],grantTools:['cli/codex'],identities:[{model:'vendor-default',label:'默认模型'}]},{toolId:'claude-code',label:'Claude Code',status:'not-installed',identities:[],modes:[],reason:'安装并登录后可添加。'},{toolId:'gemini',label:'Gemini CLI',status:'logged-out',identities:[],modes:[],reason:'登录后可添加。'}]
  return result
 }
 return binding.dispatch(action,payload)
}}
const snapshot={schemaVersion:1,mainBotId:'research',bots:[bot],machines:{status:'available',items:[]},availableActions:['machine.host.status','machine.host.devices','machine.host.configure','machine.host.start','machine.host.stop','machine.host.invite','machine.host.revoke','machine.pair.invite']}
function Fixture(){
 const [page,setPage]=useState('computer'),[settings,setSettings]=useState(false),[dark,setDark]=useState(false)
 const changeTheme=()=>{document.body.dataset.bpAppearance=dark?'light':'dark';setDark(!dark)}
 return <div className="preview-shell"><aside className="preview-sidebar"><h1><span className="preview-bot-icon"><UiIcon name="bot"/></span>DS Bot</h1>{[['computer','电脑','computer'],['ai','AI 连接','spark']].map(([id,label,icon])=><button key={id} aria-pressed={page===id} onClick={()=>setPage(id)}><UiIcon name={icon}/>{label}</button>)}<div className="preview-contact"><span className="preview-bot-icon"><UiIcon name="bot"/></span>研究伙伴</div><button onClick={()=>setSettings(true)}><UiIcon name="settings"/>Bot 设置</button></aside>
 <main className="preview-main"><header className="preview-top"><strong>{page==='computer'?'电脑':'AI 连接'}</strong><button onClick={()=>setPage(page==='computer'?'ai':'computer')}>{page==='computer'?'AI 连接':'电脑'}</button><button onClick={()=>setSettings(true)}>Bot 设置</button><button aria-label="切换深色" onClick={changeTheme}><UiIcon name={dark?'sun':'moon'} size={17}/></button></header>
 <div className="bp-page preview-content">{page==='computer'?<Machines snapshot={snapshot} dispatch={api.dispatch} transport={api.dispatch}/>:<AiProvidersPage productApi={api}/>}</div><p className="preview-note">本地界面预览 · 合成状态，不连接真实电脑或厂商</p></main>
 {settings&&<BotSettingsDialog productApi={api} botId={bot.id} onClose={()=>setSettings(false)} onOpenTools={()=>{setSettings(false);setPage('ai')}} onOpenAi={()=>{setSettings(false);setPage('ai')}}/>}</div>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
