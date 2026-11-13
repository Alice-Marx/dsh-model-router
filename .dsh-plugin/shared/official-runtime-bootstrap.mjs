// Trusted child of the real Host sandbox. Never accepts model-originated argv.
import {readFile,writeFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises'
import {homedir,tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {spawn} from 'node:child_process'

const {toolId,spec}=JSON.parse(await readFile(process.argv[2],'utf8'))
if(!['gemini','stepcode','dsh-tui','mimo-code'].includes(toolId))throw Error('Unsupported managed runtime')
const source=homedir(),home=await mkdtemp(join(tmpdir(),'official-cli-'))
const env={...process.env,...spec.env,HOME:home,USERPROFILE:home,APPDATA:join(home,'appdata'),LOCALAPPDATA:join(home,'local'),
 XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_CACHE_HOME:join(home,'.cache')}
for(const dir of [env.APPDATA,env.LOCALAPPDATA,env.XDG_CONFIG_HOME,env.XDG_DATA_HOME,env.XDG_CACHE_HOME])await mkdir(dir,{recursive:true})
const copy=async(from,to)=>{try{await mkdir(dirname(to),{recursive:true});await copyFile(from,to)}catch(error){if(error.code!=='ENOENT')throw error}}
if(toolId==='gemini'){
 const original=join(process.env.GEMINI_CLI_HOME||source,'.gemini'),target=join(home,'.gemini');await mkdir(target,{recursive:true})
 for(const file of ['oauth_creds.json','google_accounts.json'])await copy(join(original,file),join(target,file))
 let settings={};try{settings=JSON.parse(await readFile(join(original,'settings.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 // The outer Host sandbox is the boundary; no interactive trust prompt or
 // extension can turn a headless task into a waiting terminal session.
 settings={...settings,security:{...settings.security,folderTrust:{enabled:false},auth:{...settings.security?.auth,...(env.GEMINI_API_KEY||env.GOOGLE_API_KEY?{selectedType:'gemini-api-key'}:{})}},telemetry:{enabled:false}}
 await writeFile(join(target,'settings.json'),JSON.stringify(settings),{mode:0o600});env.GEMINI_CLI_HOME=home;env.GEMINI_CLI_NO_RELAUNCH='1'
}else if(toolId==='stepcode'){
 const original=process.env.STEP_CODING_AGENT_DIR||join(source,'.stepcode/agent'),target=join(home,'.stepcode/agent');await mkdir(target,{recursive:true})
 for(const file of ['settings.json','models.json'])await copy(join(original,file),join(target,file))
 await copy(process.env.STEPCODE_AUTH_PATH||join(source,'.stepcode/auth.json'),join(home,'.stepcode/auth.json'))
 env.STEP_CODING_AGENT_DIR=target;env.STEPCODE_AUTH_PATH=join(home,'.stepcode/auth.json');env.STEP_AUTO_RESUME='0'
}else if(toolId==='mimo-code'){
 // MiMo's optional Git integration cannot spawn Git under the current
 // Windows WRITE_RESTRICTED runner. The Host owns worktree/diff/checkpointing.
 env.MIMOCODE_DISABLE_GIT='1'
 await copy(join(process.env.XDG_DATA_HOME||join(source,'.local/share'),'mimocode/auth.json'),join(env.XDG_DATA_HOME,'mimocode/auth.json'))
 for(const file of ['mimocode.json','mimocode.jsonc'])await copy(join(process.env.XDG_CONFIG_HOME||join(source,'.config'),'mimocode',file),join(env.XDG_CONFIG_HOME,'mimocode',file))
}else{
 const root=join(home,'.dsh');await mkdir(root,{recursive:true});env.DSH_HOME=root;env.DSH_STATE_HOME=root;env.DSH_TELEMETRY_DISABLED='1'
 const config={maxTokens:1024,retryPolicy:{mode:'normal',maxRetries:0},...(env.DEEPSEEK_BASE_URL?{baseURL:env.DEEPSEEK_BASE_URL}:{})}
 await writeFile(join(root,'cordis.patch.yml'),JSON.stringify(['llm-deepseek-account','llm-retry','session-title-llm','session-telemetry-otel','plugin-package-inventory-deepseek'].map(id=>({id,disabled:true})).concat([{id:'llm-deepseek',config}])))
}
const child=spawn(spec.file,spec.args,{env,cwd:process.cwd(),windowsHide:true,shell:false,stdio:'inherit'})
child.once('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1})
child.once('close',code=>{process.exitCode=code??1})
