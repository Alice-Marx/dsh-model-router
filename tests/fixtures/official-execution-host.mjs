// An explicit test-only plugin loaded into a new isolated official Harness.
// It exposes no free-form command/task/path input and accepts only the owner.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {officialToolReadiness,runOfficialTool,officialToolEntrySelection,findNodeExecutable,resolveOfficialToolLaunch} from '../../.dsh-plugin/shared/official-tool-executor.mjs'
import {setInstallPreferences} from '../../.dsh-plugin/shared/official-tools-runtime.mjs'
import {resolvePortableToolLaunch} from '../../.dsh-plugin/shared/task-executors.mjs'
import {prepareOfficialRuntime} from '../../.dsh-plugin/shared/official-runtime-state.mjs'
export const inject=['sandbox','connection']
export const name='official-execution-verification'
export function apply(ctx){
 setInstallPreferences({installDir:'D:/AI/tools',registry:'https://registry.npmjs.org/',methods:{},scriptUrls:{},allowScriptInstall:true})
 ctx.connection.fetch.register({path:'/api/official-execution-verification',methods:['POST'],requestBody:'buffered',fetch:async request=>{
  const admission=ctx.connection.admit(request)
  if(!admission||'rejection'in admission||admission.peer?.principal?.kind!=='owner')return Response.json({error:'OWNER_REQUIRED'},{status:403})
  const input=await request.json()
  if(!input||Object.keys(input).some(key=>!['toolId','operation'].includes(key))||!['gemini','stepcode','dsh-tui','mimo-code'].includes(input.toolId)||!['readiness','sandbox','diagnostics','prepare','prepare-read-only'].includes(input.operation))return Response.json({error:'INVALID_FIXED_CHECK'},{status:400})
  try{
   setInstallPreferences({installDir:'D:/AI/tools',registry:'https://registry.npmjs.org/',methods:{},scriptUrls:{},allowScriptInstall:true})
   if(input.operation==='diagnostics'){
    const node='D:/Program Files/node-v24.20.0-win-x64/node.exe'
    const probe=await new Promise(resolve=>{const child=spawn(node,['--version'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('close',code=>resolve({code,stdout,stderr}));child.once('error',e=>resolve({error:e.message}))})
    const trace=[],portable=await resolvePortableToolLaunch({id:'gemini'},process.cwd(),{selection:officialToolEntrySelection('gemini'),findNode:async(...args)=>{const value=await findNodeExecutable(...args);trace.push({args,value});return value}})
    return Response.json({selection:officialToolEntrySelection('stepcode'),node:await findNodeExecutable(process.cwd()),portable,trace,probe,path:process.env.PATH??process.env.Path,systemRoot:process.env.SystemRoot})
   }
   if(input.operation==='readiness')return Response.json(await officialToolReadiness(input.toolId))
   const base=join(process.env.DSH_STATE_HOME,'execution-checks');await mkdir(base,{recursive:true});const workspace=await mkdtemp(join(base,'workspace-'))
   if(input.operation==='prepare'||input.operation==='prepare-read-only'){
    const mode=input.operation==='prepare-read-only'?'read-only':'workspace-write'
    const spec=await resolveOfficialToolLaunch(input.toolId,workspace,mode,null)
    if(spec.unsupported)return Response.json(spec)
    const managed=await prepareOfficialRuntime(spec,input.toolId,workspace,mode)
    const confined=await ctx.sandbox.confine([managed.spec.file,...managed.spec.args],managed.policy)
    return Response.json({spec:{...managed.spec,file:confined.argv[0],args:confined.argv.slice(1)},workspace,enforcement:confined.enforcement,exactArgvConfined:true})
   }
   const result=await ctx.sandbox.confine([process.execPath,'--version'],{mode:'workspace-write',workspaceRoot:workspace})
   return Response.json({hasRealSandbox:true,enforcement:result.enforcement,argv:result.argv,workspace})
  }catch(error){return Response.json({error:String(error?.message??error).replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]')},{status:400})}
 }})
}
