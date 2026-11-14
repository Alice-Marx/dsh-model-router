import {createQwenParser} from './vendor-qwen-adapter.mjs'

/** The CLI's permission ceiling is additional to the mandatory Host sandbox. */
export const codeBuddyTaskArgs=(mode,modelId)=>['--print','--output-format','stream-json','--verbose',
 '--no-session-persistence','--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
 '--permission-mode',mode==='workspace-write'?'bypassPermissions':'dontAsk',
 ...(mode==='read-only'?['--allowedTools','Read,Glob,Grep','--disallowedTools','Write,Edit,MultiEdit,NotebookEdit,Bash,PowerShell,Task,Agent']:[]),
 ...(modelId?['--model',modelId]:[])]
export const createCodeBuddyParser=()=>createQwenParser({label:'CodeBuddy Code',inclusiveInput:false})
export function codeBuddyAccountFile(home,platform=process.platform){
 const root=String(home??'').replace(/[\\/]+$/u,'')
 if(!root)return ''
 return root+(platform==='win32'?'/AppData/Local':platform==='darwin'?'/Library/Application Support':'/.local/share')+'/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info'
}
