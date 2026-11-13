import {spawn} from 'node:child_process'
import {readFile,realpath,stat} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname,isAbsolute,join,relative,sep} from 'node:path'
import {attestVendorRelease} from './vendor-release-attestation.mjs'

const inside=(root,file)=>{const part=relative(root,file);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)}
const versionOf=file=>new Promise((resolve,reject)=>{
 const child=spawn(file,['--version'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let out=''
 const timer=setTimeout(()=>{child.kill();reject(Error('CLI 版本检测超时'))},8000)
 child.stdout.on('data',b=>out=(out+b).slice(-2048));child.stderr.on('data',()=>{})
 child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);const version=/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/.exec(out)?.[1];if(code===0&&version)resolve(version);else reject(Error('未取得 CLI 的准确版本'))})
})
export function stepTaskArgs(mode,modelId){return ['--print','--mode','json','--no-session','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-approve',
 '--approval-mode',mode==='workspace-write'?'auto':'confirm','--non-interactive-approval',mode==='workspace-write'?'allow':'deny','--non-interactive-denial','terminate',
 '--provider','step',...(mode==='read-only'?['--tools','read,grep,find,ls']:[]),...(modelId?['--model',modelId.replace(/^step\//,'')]:[])]}
export const geminiTaskArgs=(mode,modelId)=>['--prompt','Carry out the task from stdin in the current workspace.','--output-format','json','--sandbox=false','--approval-mode',mode==='workspace-write'?'yolo':'plan',...(modelId?['--model',modelId]:[])]

export async function resolveStepTask(workspace,mode,modelId,selection,{attest=attestVendorRelease,versionProbe=versionOf}={}){
 if(process.platform!=='win32')return {unsupported:'Step Code 的托管程序当前仅在 Windows 完成核验。'}
 const directories=selection.directories??[]
 for(const directory of directories){
  try{
   const root=await realpath(directory),file=await realpath(join(root,'step.exe'))
   if(!inside(root,file)||inside(workspace,file)||!(await stat(file)).isFile())continue
   const version=await versionProbe(file),checked=await attest({vendor:'stepcode',version,executable:file})
   if(!checked.ok)return {unsupported:'Step 官方程序摘要核验失败：'+checked.reason}
   return {file,args:stepTaskArgs(mode,modelId),format:'step-jsonl',source:checked.source}
  }catch{}
 }
 return {unsupported:'未在所选 Step 安装目录中找到已核验的 step.exe，请展开诊断并修复该安装。'}
}

/** Use the same official DSH backend as dsh-TUI, with the actual rc.2 JSON protocol. */
export async function resolveDshTask(workspace,mode,modelId,selection,{findEntries,findNode}={}){
 if(modelId)return {unsupported:'DeepSeek 托管工具当前使用 CLI 已保存的默认模型，请选择“厂商默认模型”。'}
 const entries=await findEntries('@deepseek-ai/dsh','dsh','lib/bin.js',workspace,{moduleRoots:selection.plan?.packageModuleRoots,directories:selection.preferred?selection.directories:undefined})
 let entry=entries.find(row=>row.version==='0.2.2-rc.2'),electron=false
 if(!entry){
  // The installed official Host may already carry dsh. Resolve its package
  // from trusted process entry points, never from a model-supplied location.
  for(const origin of [process.argv[1],import.meta.url]){
   try{
    if(!origin)continue
    const require=createRequire(origin),manifest=require.resolve('@deepseek-ai/dsh/package.json'),pkg=JSON.parse(await readFile(manifest,'utf8'))
    if(pkg.name!=='@deepseek-ai/dsh'||pkg.version!=='0.2.2-rc.2')continue
    const root=dirname(manifest),script=await realpath(join(root,'lib/bin.js'))
    if(!inside(root,script)||inside(workspace,script))continue
    entry={entry:script,version:pkg.version,source:'official-host-dsh-runtime'};electron=Boolean(process.versions.electron&&script.includes('app.asar'));break
   }catch{}
  }
 }
 if(!entry)return {unsupported:'缺少官方 dsh 0.2.2-rc.2 Node 运行时；请在 dsh-TUI 的“安装/修复 CLI”补齐依赖。'}
 const node=electron?process.execPath:await findNode(workspace)
 if(!node)return {unsupported:'缺少可直接启动的 Node 运行时。'}
 return {file:node,args:[...(electron?['--expose-internals']:[]),entry.entry,'--profile','headless','--json','--permission-mode',mode,'--approval-policy','never','-'],
  ...(electron?{env:{ELECTRON_RUN_AS_NODE:'1'}}:{}),format:'dsh-headless-jsonl',source:entry.source??'official-dsh-node-entry'}
}

/** Strict completion/accounting for one actual CLI execution, not terminal rendering. */
export function createHeadlessParser(format){
 let session=null,final=null,failed=false,protocol=null,model=null,usage=null,usageIncomplete=false,stepCount=0
 const count=n=>Number.isSafeInteger(n)&&n>=0
 const add=value=>{if(!value){usageIncomplete=true;return}if(!count(value.inputTokens)||!count(value.outputTokens)){usageIncomplete=true;return}
  const next={inputTokens:value.inputTokens,outputTokens:value.outputTokens,cacheReadTokens:count(value.cacheReadTokens)?value.cacheReadTokens:0,cacheWriteTokens:count(value.cacheWriteTokens)?value.cacheWriteTokens:0}
  usage=Object.fromEntries(Object.entries(next).map(([key,value])=>[key,(usage?.[key]??0)+value]))
 }
 return {
  push(event){
   if(!event||typeof event!=='object'||typeof event.type!=='string'){protocol='CLI 事件格式无效';return}
   if(format==='step-jsonl'){
    if(final&&!final.pending){protocol='Step 在结束事件后仍返回数据';return}
    if(event.type==='session'){if(session){protocol='Step 返回重复会话';return}session=event.id??event.sessionId}
    if(event.type==='message_end'&&event.message?.role==='assistant'){
     const m=event.message;if(m.provider&&m.model)model=m.provider+'/'+m.model
     if(m.errorMessage||['error','aborted'].includes(m.stopReason))failed=true
     if(m.usage){const u=m.usage;add(count(u.input)&&count(u.output)?{inputTokens:u.input,outputTokens:u.output,cacheReadTokens:u.cacheRead,cacheWriteTokens:u.cacheWrite}:null)}else usageIncomplete=true
     final={pending:true,text:(m.content??[]).filter(row=>row.type==='text').map(row=>row.text??'').join(''),stopReason:m.stopReason}
    }
    if(event.type==='agent_settled'){if(event.failure)failed=true;if(!final||!['stop','end_turn','completed'].includes(final.stopReason))failed=true;final={...final,pending:false}}
    if(event.type==='tool_execution_end'&&event.isError===true||event.type==='message_end'&&event.message?.role==='toolResult'&&event.message.isError===true)failed=true
   }else{
    if(final){protocol='DSH 在结束事件后仍返回数据';return}
    if(event.type==='session'){if(session){protocol='DSH 返回重复会话';return}session=event.sessionId}
    if(event.type==='status'&&event.phase==='step_end'){stepCount++;add(event.usage)}
    if(event.type==='tool_result'&&(event.status==='error'||event.error))failed=true
    if(event.type==='error')failed=true
    if(event.type==='final'){
     if(!session||event.sessionId!==session){protocol='DSH 结束事件不属于当前会话';return}
     final={text:event.text,pending:false};if(event.reason?.kind!=='completed')failed=true
    }
   }
  },
  finish(exitCode){const ok=exitCode===0&&!failed&&!protocol&&final&&!final.pending&&typeof final.text==='string'&&final.text.trim()
   return {status:ok?'succeeded':'failed',exitCode,terminalEvent:ok?'completed':'failed',finalText:typeof final?.text==='string'?final.text:'',
    ...(ok?{}:{error:protocol??'CLI 未返回当前任务的成功终态和完整答复。'}),...(model?{reportedModel:model}:{}),
    ...(usage?{usage,...(usageIncomplete?{usageIncomplete:true}:{})}:{}),...(session?{sessionId:session}:{})}
  }
 }
}
