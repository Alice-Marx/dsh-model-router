import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {getOfficialTool,installCommandLine} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {officialToolExecutionCapabilities,executionEnvironment} from '../.dsh-plugin/shared/official-tool-executor.mjs'
import {resolvePortableToolLaunch,executeAssignedTask} from '../.dsh-plugin/shared/task-executors.mjs'
import {qwenTaskArgs,createQwenParser} from '../.dsh-plugin/shared/vendor-qwen-adapter.mjs'
import {checkLogin,credentialFileFor} from '../.dsh-plugin/shared/tool-health.mjs'
import {createCliToolSetup} from '../packages/orchestration/src/cli-tool-setup.mjs'

test('Qwen is a fixed official npm/pnpm tool with managed modes and no unconfined fallback',()=>{
 const tool=getOfficialTool('qwen-code');assert.equal(tool.package,'@qwen-code/qwen-code');assert.deepEqual(tool.probeExecutables,['qwen'])
 assert.deepEqual(tool.installMethods.map(m=>m.id),['npm','pnpm']);assert.ok(installCommandLine(tool).includes('@qwen-code/qwen-code@latest'))
 assert.deepEqual(officialToolExecutionCapabilities().find(t=>t.id===tool.id).modes,['read-only','workspace-write'])
 assert.equal(officialToolExecutionCapabilities({executionEnvironment:'cli-native'}).find(t=>t.id===tool.id).supported,false)
 const args=qwenTaskArgs('read-only','qwen/model');assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('plan'));assert.ok(qwenTaskArgs('workspace-write').includes('yolo'))
})
test('Qwen account detection uses the selected home, exposes no credential and separates API billing',async()=>{
 assert.equal(credentialFileFor('qwen-code',{home:'C:/Users/test',env:{QWEN_HOME:'D:/qwen-account'}}),'D:/qwen-account/oauth_creds.json')
 const login=await checkLogin('qwen-code',{home:'C:/Users/test',env:{},exists:async p=>p.endsWith('/.qwen/oauth_creds.json')})
 assert.equal(login.state,'logged-in');assert.equal(login.billing,'unknown')
 const api=await checkLogin('qwen-code',{env:{OPENAI_API_KEY:'synthetic-offline-value'},exists:async()=>false});assert.equal(api.billing,'api-key');assert.doesNotMatch(JSON.stringify(api),/synthetic-offline-value/)
 assert.equal(executionEnvironment('qwen-code',{env:{OPENAI_API_KEY:'synthetic',ANTHROPIC_API_KEY:'other'}}).ANTHROPIC_API_KEY,undefined)
 assert.equal(executionEnvironment('qwen-code',{sessionOnly:true,env:{OPENAI_API_KEY:'synthetic'}}).OPENAI_API_KEY,undefined)
})
test('Qwen setup is owner-only and offers the existing independent Qwen chat driver without granting execution',async()=>{
 const setup=createCliToolSetup({probe:async()=>({installed:false}),readiness:async()=>({ready:false}),findEntries:async()=>[]})
 await assert.rejects(setup.inspect({toolId:'qwen-code'},{kind:'bot'}),{code:'REMOTE_OWNER_REQUIRED'})
 const value=await setup.inspect({toolId:'qwen-code'},{kind:'owner'});assert.equal(value.driver,'qwenAgent');assert.equal(value.loginCommand,'qwen');assert.equal(value.entry,null)
})
test('Qwen package discovery attests code and manifest, confines the package root and requires Node 22+',async()=>{
 const base=resolve('tmp/integration/qwen-unit');await mkdir(base,{recursive:true});const prefix=await mkdtemp(join(base,'case-')),root=join(prefix,'node_modules/@qwen-code/qwen-code'),workspace=join(prefix,'workspace');await mkdir(root,{recursive:true});await mkdir(workspace);const entry=join(root,'cli-entry.js');await writeFile(entry,'// offline');await writeFile(join(root,'cli.js'),'// offline runtime')
 const seen=[],input={selection:{plan:{installDir:prefix,packageModuleRoots:[join(prefix,'node_modules')]},directories:[prefix]},findEntries:async(name,cmd,script)=>{assert.equal(name,'@qwen-code/qwen-code');assert.equal(cmd,'qwen');assert.equal(script,'cli-entry.js');return[{entry,packageRoot:root,version:'0.27.3'}]},findNode:async(_ws,min)=>{assert.deepEqual(min,[22,0,0]);return process.execPath},attestor:{matchesPackage:async(_root,name,_v,include)=>{seen.push(name);assert.ok(include.test('package.json'));assert.ok(include.test('chunks/code.js'));return{ok:true}},matches:async()=>({ok:true})}}
 assert.equal((await resolvePortableToolLaunch({id:'qwen-code'},workspace,input)).file,process.execPath);assert.deepEqual(seen,['@qwen-code/qwen-code'])
 assert.match((await resolvePortableToolLaunch({id:'qwen-code'},workspace,{...input,attestor:{matchesPackage:async()=>({ok:false,reason:'changed'})}})).reason,/摘要核验/)
})
const push=(parser,event)=>parser.push({session_id:'session',parent_tool_use_id:null,...event})
test('Qwen accepts only the current complete success and normalizes inclusive cache tokens once',()=>{
 const parser=createQwenParser();push(parser,{type:'system',subtype:'init',model:'qwen/model'});push(parser,{type:'assistant',message:{model:'qwen/model'}});assert.equal(parser.finish(0).status,'failed')
 push(parser,{type:'result',subtype:'success',is_error:false,result:'done',usage:{input_tokens:12,output_tokens:3,cache_read_input_tokens:2}})
 const result=parser.finish(0);assert.equal(result.status,'succeeded');assert.equal(result.reportedModel,'qwen/model');assert.deepEqual(result.usage,{inputTokens:10,outputTokens:3,cacheReadTokens:2,cacheWriteTokens:0});assert.equal(Object.hasOwn(result,'reportedCostUsd'),false)
 assert.equal(parser.finish(1).status,'failed')
})
test('Qwen never promotes tool failure, permission denial, another session or nested subagent completion to success',()=>{
 for(const event of [{type:'user',message:{content:[{type:'tool_result',is_error:true}]}},{type:'assistant',session_id:'other'},{type:'invalid',session_id:''}]){
  const parser=createQwenParser();push(parser,{type:'system'});push(parser,event);push(parser,{type:'result',subtype:'success',is_error:false,result:'claims done'});assert.equal(parser.finish(0).status,'failed')
 }
 const nested=createQwenParser();push(nested,{type:'result',parent_tool_use_id:'child',subtype:'success',is_error:false,result:'child only'});assert.equal(nested.finish(0).status,'failed')
 const denied=createQwenParser();push(denied,{type:'result',subtype:'success',is_error:false,result:'done',permission_denials:[{}]});assert.equal(denied.finish(0).status,'failed')
})
test('an authorized Qwen Bot model route uses the managed Host runner with no portable/API retry',async()=>{
 const workspace=resolve('tmp/integration/qwen-unit');await mkdir(workspace,{recursive:true});let calls=0
 const result=await executeAssignedTask({route:{provider:'qwen',model:'chat'},task:'Read fixture',workspace,authorizeOfficial:()=>({cliModel:'vendor-default',botScoped:true}),runVerified:async request=>{calls++;assert.equal(request.toolId,'qwen-code');return{status:'succeeded',finalText:'done',exitCode:0}},resolvePortableLaunch:()=>{throw Error('no portable')},apiFallback:()=>{throw Error('no API')}})
 assert.equal(calls,1);assert.equal(result.ok,true)
})
