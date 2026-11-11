import React from 'react'
import {createRoot} from 'react-dom/client'
import {DesktopViewer} from '../../apps/integration-client/desktop-pane.jsx'
import {AppearanceControls,installWorkspaceAppearance} from '../../apps/integration-client/workspace-ui.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import desktopCss from '../../apps/integration-client/desktop.css'
document.body.dataset.botProductUi='1';installWorkspaceAppearance(window)
const style=document.createElement('style');style.textContent=`${productCss}\n${workspaceCss}\n${desktopCss}\nbody{margin:0;background:var(--bp-bg);font:14px var(--bp-font);color:var(--bp-ink)}.fixture-banner{padding:8px;text-align:center;font-size:11px;background:var(--bp-sidebar)}.fixture-desktop{max-width:1200px;margin:auto;padding:20px}.fixture-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.fixture-header h1{font-size:22px}`;document.head.append(style)
const source=document.createElement('canvas');source.width=1440;source.height=900
const context=source.getContext('2d');context.fillStyle='#dce9df';context.fillRect(0,0,1440,900)
context.fillStyle='#eef4ef';context.fillRect(0,0,1440,42);context.fillStyle='#344f3e';context.font='16px system-ui';context.fillText('离线演示电脑',28,27)
context.fillStyle='#ffffff';context.fillRect(120,110,1200,640);context.fillStyle='#f3f7f3';context.fillRect(120,110,1200,52)
context.fillStyle='#2b4937';context.font='21px system-ui';context.fillText('项目资料',150,144);context.fillStyle='#f6f8f6';context.fillRect(120,162,220,588)
context.fillStyle='#7b8e7f';context.font='18px system-ui';['项目文件','研究资料','团队交付','工作记录'].forEach((text,index)=>context.fillText(text,150,220+index*64))
context.fillStyle='#284d37';context.font='30px system-ui';context.fillText('把你的电脑带入聊天',390,248);context.font='18px system-ui';context.fillStyle='#6c7f71';context.fillText('离线夹具画面 · 所有输入仅写入测试记录',390,292)
for(let i=0;i<3;i++){context.fillStyle='#eef4ef';context.fillRect(390+i*270,350,235,190);context.fillStyle='#355b42';context.font='22px system-ui';context.fillText(['资料整理','研究计划','项目进展'][i],414+i*270,402);context.fillStyle='#98ad9c';context.fillRect(414+i*270,434,155,8);context.fillRect(414+i*270,459,115,8)}
context.fillStyle='#e8f1e9';context.fillRect(0,846,1440,54);context.fillStyle='#44644e';context.font='16px system-ui';context.fillText('DSH  ·  Fixture Desktop',40,880)
const encoded=source.toDataURL('image/jpeg',.85).split(',')[1],bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0))
const events=[];window.__desktopFixture={events,frames:0,clipboardReads:0}
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.__desktopFixture.clipboardReads++;return '待确认的本机文字'}}})
class Socket{
  readyState=0;binaryType='arraybuffer'
  constructor(){queueMicrotask(()=>{this.readyState=1;this.onopen?.()})}
  message(value){this.onmessage?.({data:JSON.stringify(value)})}
  send(text){const value=JSON.parse(text);events.push(value);queueMicrotask(()=>{
    if(this.readyState!==1)return
    if(value.type==='auth'){this.message({type:'ready',mode:'watch',width:1440,height:900,displayId:'fixture',displays:[{id:'fixture',name:'测试显示器',width:1440,height:900}],coordinateSpace:'display-physical-pixels'});this.message({type:'frame',width:1440,height:900,frameWidth:1440,frameHeight:900,keyframe:true});this.onmessage?.({data:bytes.buffer});window.__desktopFixture.frames++}
    if(value.type==='control')this.message({type:'control',ok:true,mode:value.action==='acquire'?'control':'watch'})
    if(value.type==='input'||value.type==='release-input')this.message({type:value.type,id:value.id,ok:true})
    if(value.type==='close')this.close()
  })}
  close(){this.readyState=3;this.onclose?.({code:1000,reason:''})}
}
globalThis.WebSocket=Socket
const openSession=async()=>({sessionId:'fixture-desktop',token:'a'.repeat(43),websocketUrl:'ws://offline.fixture/',canControl:true,expiresAt:Date.now()+120000})
createRoot(document.getElementById('root')).render(<><div className="fixture-banner">本地验证 · 离线桌面夹具 · 不控制真实设备 · 0.66.4 未发布改动</div><main className="bp-page fixture-desktop"><header className="fixture-header"><h1>你的电脑，就在聊天里</h1><AppearanceControls/></header><DesktopViewer botId="bot-fixture" machines={[{id:'fixture',label:'演示工作电脑'}]} openSession={openSession} renewSession={openSession} closeSession={async()=>({stopConfirmed:true})}/></main></>)
