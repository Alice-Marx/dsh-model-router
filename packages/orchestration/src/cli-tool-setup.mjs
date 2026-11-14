import { dirname, extname, isAbsolute } from 'node:path'
import { getOfficialTool } from '../../../.dsh-plugin/shared/official-tool-registry.mjs'
import { probeOfficialTool, startRepair, installStatus, cancelInstall } from '../../../.dsh-plugin/shared/official-tools-runtime.mjs'
import { findGlobalPackageEntries, findNodeExecutable,officialToolReadiness } from '../../../.dsh-plugin/shared/official-tool-executor.mjs'

export const CLI_TOOL_DRIVERS=Object.freeze({'codebuddy-code':'execution-only','qwen-code':'qwenAgent',gemini:'geminiAgent',stepcode:'stepAgent','dsh-tui':'deepseekAgent','mimo-code':'execution-only',opencode:'opencodeGo',pi:'pi',hermes:'hermesAgent',codex:'codex','claude-code':'claude','kimi-code':'kimiAgent'})
const login=Object.freeze({'codebuddy-code':'codebuddy','qwen-code':'qwen',gemini:'gemini',stepcode:'step login','mimo-code':'mimo auth login',opencode:'opencode auth login',pi:'pi',hermes:'hermes login',codex:'codex login','claude-code':'claude auth login','kimi-code':'kimi'})
const fail=()=>{throw Object.assign(new Error('请选择支持配置的官方工具。'),{code:'CLI_SETUP_INVALID'})}
const validate=(payload,context,operations)=>{
 if(context?.kind!=='owner')throw Object.assign(new Error('请使用已认证的拥有者配置 CLI。'),{code:'REMOTE_OWNER_REQUIRED'})
 context.signal?.throwIfAborted()
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['toolId',...(operations?['operation']:[])].includes(key))||!Object.hasOwn(CLI_TOOL_DRIVERS,payload.toolId)||!getOfficialTool(payload.toolId))fail()
 if(operations&&!['start','status','cancel'].includes(payload.operation))fail()
}
/** Only fixed registry addresses are accepted. Discovery is read-only and never imports credentials. */
export function createCliToolSetup({probe=probeOfficialTool,findNode=findNodeExecutable,findEntries=findGlobalPackageEntries,readiness=officialToolReadiness,repair=startRepair,status=installStatus,cancel=cancelInstall,workspace=process.cwd()}={}){
 return Object.freeze({
  async inspect(payload,context){
   validate(payload,context)
   const {toolId}=payload,driver=CLI_TOOL_DRIVERS[toolId],tool=getOfficialTool(toolId)
   const found=await probe(toolId,{fresh:true});context.signal?.throwIfAborted()
   let source=found,entry=null
   if(toolId==='dsh-tui'){
    const moduleRoots=found.packageRoot?[dirname(dirname(found.packageRoot))]:undefined
    const entries=await findEntries('@deepseek-ai/dsh','dsh','lib/bin.js',workspace,moduleRoots?{moduleRoots}:{})
    const dsh=entries.find(item=>item.version==='0.2.2-rc.2')
    source=dsh?{installed:true,version:dsh.version,packageEntry:dsh.entry}:null
   }
   if(source?.installed&&typeof source.version==='string'&&/^[0-9][A-Za-z0-9.+_-]{0,31}$/.test(source.version)){
    const file=source.packageEntry??source.executablePath
    if(isAbsolute(file??'')&&/\.(?:js|mjs|cjs)$/i.test(extname(file))){const node=await findNode(workspace);if(node)entry={executable:node,script:file,version:source.version}}
    else if(isAbsolute(file??'')&&!/\.(?:cmd|bat|ps1)$/i.test(file))entry={executable:file,version:source.version}
   }
   let timer
   const execution=await Promise.race([readiness(toolId,workspace),new Promise(resolve=>{timer=setTimeout(()=>resolve({ready:false,reason:'首次入口摘要仍在核验，请稍后点“检测入口”查看结果。'}),7000)})]).finally(()=>clearTimeout(timer))
   context.signal?.throwIfAborted()
   return {schemaVersion:1,toolId,label:tool.label,driver,entry,execution,billing:driver==='deepseekAgent'?'api':driver==='execution-only'?'unknown':'subscription',loginCommand:login[toolId]??null,
    installed:found.installed===true,version:found.version??null,
    modelHint:driver==='stepAgent'?'step/模型名':driver==='deepseekAgent'?'deepseek-official/deepseek-v4-flash':'填写账号中可用的模型 ID',
    reason:'检查安装与托管执行入口，完成登录后回到工具行选择执行模式并保存授权。',
    ...(!entry?{entryNotice:toolId==='dsh-tui'?'未找到同一安装目录中的 Node 版 dsh 0.2.2-rc.2。点击安装/修复补齐，或填写已有 Node 与 dsh 脚本路径。':'未找到可直接启动的入口。请安装/修复，或填写实际可执行文件路径。'}:{})}
  },
  repair(payload,context){validate(payload,context,true);const toolId=payload.toolId
   if(payload.operation==='start')return {toolId,job:repair(toolId)}
   if(payload.operation==='cancel')return {toolId,job:cancel(toolId)}
   return {toolId,job:status(toolId)}
  },
 })
}
