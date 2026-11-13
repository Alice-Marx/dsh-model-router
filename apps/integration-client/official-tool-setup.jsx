import React,{useEffect,useMemo,useRef,useState} from 'react'
import {CliChatProviders} from './cli-chat-providers.jsx'
import {UiIcon} from './ui-icons.jsx'
import css from './official-tool-setup.css'
import aiCss from './ai-providers.css'

// Fixed display mapping only; the Host independently validates every id.
export const hasCliSetup=toolId=>['gemini','stepcode','dsh-tui','opencode','pi','hermes','codex','claude-code','kimi-code'].includes(toolId)
let nextScope=0
export function OfficialToolSetup(props){const key=useMemo(()=>++nextScope,[props.productApi,props.toolId]);return <ToolSetup key={key} {...props}/>}
function ToolSetup({productApi,toolId,onClose,onConfigured,onOpenTools}){
 const [setup,setSetup]=useState(null),[error,setError]=useState(''),[job,setJob]=useState(null),[busy,setBusy]=useState('')
 const scope=useRef({live:false,requests:new Set(),busy:false,readEpoch:0})
 const call=async(action,payload)=>{
  const current=scope.current,controller=new AbortController();current.requests.add(controller)
  const timer=setTimeout(()=>controller.abort(),30000)
  let abort
  const cancelled=new Promise((_,reject)=>{abort=()=>reject(new Error('请求超时或已取消；安装状态可重新读取。'));controller.signal.addEventListener('abort',abort,{once:true})})
  try{return await Promise.race([Promise.resolve().then(()=>productApi.dispatch(action,payload,controller.signal)),cancelled])}
  finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);current.requests.delete(controller)}
 }
 const detect=async()=>{const current=scope.current,epoch=++current.readEpoch
  try{const value=await call('cliProviders.setup',{toolId});if(!current.live||current.readEpoch!==epoch)return
   if(value?.schemaVersion!==1||value.toolId!==toolId||typeof value.driver!=='string')throw new Error('未取得此工具的配置资料，请更新插件后重试。')
   setSetup(value);setError('')
  }catch(e){if(current.live&&current.readEpoch===epoch)setError(e.message)}
 }
 const readJob=async()=>{try{const value=await call('cliProviders.repair',{toolId,operation:'status'});if(scope.current.live&&value?.toolId===toolId)setJob(value.job??null)}catch(e){if(scope.current.live)setError(e.message)}}
 useEffect(()=>{const current=scope.current;current.live=true
  const style=document.createElement('style');style.textContent=aiCss+'\n'+css;document.head.append(style)
  void detect();void readJob()
  return()=>{current.live=false;current.readEpoch++;for(const controller of current.requests)controller.abort();style.remove()}
 },[productApi,toolId])
 useEffect(()=>{if(job?.status!=='running')return
  let live=true,pending=false
  const timer=setInterval(async()=>{if(pending)return;pending=true
   try{const value=await call('cliProviders.repair',{toolId,operation:'status'});if(!live||!scope.current.live)return
    if(value?.toolId!==toolId||!value.job)throw new Error('安装结果未确认，请重新读取状态。')
    setJob(value.job)
    if(value.job.status==='succeeded')void detect()
   }catch(e){if(live&&scope.current.live)setError(e.message)}finally{pending=false}
  },1500)
  return()=>{live=false;clearInterval(timer)}
 },[job?.status,productApi,toolId])
 const repair=async operation=>{const current=scope.current;if(current.busy)return;current.busy=true;setBusy(operation);setError('')
  try{const value=await call('cliProviders.repair',{toolId,operation});if(!current.live)return
   if(value?.toolId!==toolId||!value.job)throw new Error('安装结果未确认，请读取安装状态，不要重复提交。')
   setJob(value.job)
  }catch(e){if(current.live)setError(e.message)}finally{current.busy=false;if(current.live)setBusy('')}
 }
 return <section className="bp-cli-setup bp-ai" aria-label={`${setup?.label??toolId} 配置与修复`}>
  <header><h4>配置与修复{setup?.label&&` · ${setup.label}`}</h4>{onClose&&<button type="button" aria-label="关闭工具配置" onClick={onClose}><UiIcon name="close" size={15}/></button>}</header>
  {error&&<p role="alert" className="bp-cli-setup-error">{error}</p>}
  <div className="bp-cli-setup-actions"><button type="button" disabled={Boolean(busy)} onClick={()=>void detect()}>检测入口</button>
   <button type="button" disabled={Boolean(busy)||job?.status==='running'} onClick={()=>void repair('start')}>{busy==='start'?'正在提交…':job?.status==='running'?'安装/修复中…':'安装/修复 CLI'}</button>
   {job?.status==='running'&&<button type="button" disabled={Boolean(busy)||job.cancelRequested} onClick={()=>void repair('cancel')}>{job.cancelRequested?'正在取消…':'取消安装'}</button>}
   <button type="button" disabled={Boolean(busy)} onClick={()=>void readJob()}>读取安装状态</button>
   {onOpenTools&&<button type="button" onClick={onOpenTools}>安装目录与来源<UiIcon name="arrow" size={13}/></button>}
  </div>
  {job&&<p role="status">{({running:'安装正在进行',succeeded:'安装完成，请核对入口和账号',failed:'安装失败',cancelled:'安装已取消'})[job.status]??'安装结果待核对'}{job.error&&`：${job.error}`}</p>}
  {!setup&&!error&&<p role="status">正在检测此工具的安装入口…</p>}
  {setup&&<><p>{setup.reason}</p>{setup.entryNotice&&<p className="bp-cli-setup-warning">{setup.entryNotice}</p>}
   {setup.loginCommand&&<details><summary>账号登录</summary><p>在本机终端运行 <code>{setup.loginCommand}</code> 完成厂商登录，再在下方勾选“使用本机已登录账号”保存。</p></details>}
   <CliChatProviders productApi={productApi} initialSetup={setup} onSaved={onConfigured}/>
  </>}
 </section>
}
