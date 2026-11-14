import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {getOfficialTool,installCommandLine} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {officialToolExecutionCapabilities,executionEnvironment} from '../.dsh-plugin/shared/official-tool-executor.mjs'
import {executeAssignedTask} from '../.dsh-plugin/shared/task-executors.mjs'
import {codeBuddyTaskArgs,createCodeBuddyParser,codeBuddyAccountFile} from '../.dsh-plugin/shared/vendor-codebuddy-adapter.mjs'
import {checkLogin,credentialFileFor} from '../.dsh-plugin/shared/tool-health.mjs'
import {createCliToolSetup} from '../packages/orchestration/src/cli-tool-setup.mjs'

test('CodeBuddy installs the fixed official npm package and requires managed execution',()=>{
 const tool=getOfficialTool('codebuddy-code');assert.equal(tool.package,'@tencent-ai/codebuddy-code');assert.deepEqual(tool.probeExecutables,['codebuddy'])
 assert.deepEqual(tool.installMethods.map(m=>m.id),['npm','pnpm']);assert.ok(installCommandLine(tool).includes('@tencent-ai/codebuddy-code@latest'))
 assert.deepEqual(officialToolExecutionCapabilities().find(t=>t.id===tool.id).modes,['read-only','workspace-write'])
 assert.equal(officialToolExecutionCapabilities({executionEnvironment:'cli-native'}).find(t=>t.id===tool.id).supported,false)
 const read=codeBuddyTaskArgs('read-only');assert.ok(read.includes('dontAsk'));assert.ok(read.includes('Write,Edit,MultiEdit,NotebookEdit,Bash,PowerShell,Task,Agent'))
 const write=codeBuddyTaskArgs('workspace-write','vendor/model');assert.ok(write.includes('bypassPermissions'));assert.ok(write.includes('--no-session-persistence'));assert.ok(write.includes('--strict-mcp-config'));assert.ok(write.includes('{"mcpServers":{}}'));assert.equal(write[write.indexOf('--setting-sources')+1],'user')
})
test('CodeBuddy detects only its official account path and reports API billing without leaking credentials',async()=>{
 const path=codeBuddyAccountFile('C:/Users/test','win32');assert.match(path,/CodeBuddyExtension\/Data\/Public\/auth\/Tencent-Cloud\.coding-copilot\.info$/)
 assert.equal(credentialFileFor('codebuddy-code',{home:'C:/Users/test',env:{}}),codeBuddyAccountFile('C:/Users/test'))
 assert.match(codeBuddyAccountFile('/home/test','linux'),/\.local\/share\/CodeBuddyExtension/)
 const login=await checkLogin('codebuddy-code',{home:'C:/Users/test',env:{},exists:async p=>p===codeBuddyAccountFile('C:/Users/test')});assert.equal(login.state,'logged-in');assert.equal(login.billing,'unknown')
 const api=await checkLogin('codebuddy-code',{env:{CODEBUDDY_API_KEY:'synthetic-offline-value'},exists:async()=>false});assert.equal(api.billing,'api-key');assert.doesNotMatch(JSON.stringify(api),/synthetic-offline-value/)
 const env=executionEnvironment('codebuddy-code',{env:{CODEBUDDY_API_KEY:'synthetic',CODEBUDDY_BASE_URL:'http://127.0.0.1',ANTHROPIC_API_KEY:'other'}});assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.CODEBUDDY_BASE_URL,'http://127.0.0.1')
 assert.equal(executionEnvironment('codebuddy-code',{sessionOnly:true,env:{CODEBUDDY_API_KEY:'synthetic'}}).CODEBUDDY_API_KEY,undefined)
})
test('CodeBuddy setup is owner-only, supplies a login action and does not invent a native chat driver',async()=>{
 const setup=createCliToolSetup({probe:async()=>({installed:false}),readiness:async()=>({ready:false}),findEntries:async()=>[]})
 await assert.rejects(setup.inspect({toolId:'codebuddy-code'},{kind:'bot'}),{code:'REMOTE_OWNER_REQUIRED'})
 const value=await setup.inspect({toolId:'codebuddy-code'},{kind:'owner'});assert.equal(value.driver,'execution-only');assert.equal(value.loginCommand,'codebuddy');assert.equal(value.entry,null)
})
const push=(parser,event)=>parser.push({session_id:'session',parent_tool_use_id:null,...event})
test('CodeBuddy treats cached input as disjoint and preserves actual model and completion evidence',()=>{
 const parser=createCodeBuddyParser();push(parser,{type:'system',subtype:'init',model:'vendor/model'});push(parser,{type:'result',subtype:'success',is_error:false,result:'done',usage:{input_tokens:10,output_tokens:3,cache_read_input_tokens:2,cache_creation_input_tokens:1}})
 const value=parser.finish(0);assert.equal(value.status,'succeeded');assert.equal(value.reportedModel,'vendor/model');assert.deepEqual(value.usage,{inputTokens:10,outputTokens:3,cacheReadTokens:2,cacheWriteTokens:1});assert.equal(Object.hasOwn(value,'reportedCostUsd'),false)
 const missing=createCodeBuddyParser();push(missing,{type:'result',subtype:'success',is_error:false,result:'done'});assert.equal(Object.hasOwn(missing.finish(0),'usage'),false)
})
test('CodeBuddy rejects mixed sessions, tool failures, denied execution, incomplete and post-terminal streams',()=>{
 for(const bad of [{type:'assistant',session_id:'other'},{type:'user',message:{content:[{type:'tool_result',is_error:true}]}},{type:'result',subtype:'success',is_error:false,result:'done',permission_denials:[{}]}]){
  const parser=createCodeBuddyParser();push(parser,{type:'system'});push(parser,bad);push(parser,{type:'result',subtype:'success',is_error:false,result:'claims done'});assert.equal(parser.finish(0).status,'failed')
 }
 const incomplete=createCodeBuddyParser();push(incomplete,{type:'assistant'});assert.equal(incomplete.finish(0).status,'failed')
 const complete=createCodeBuddyParser();push(complete,{type:'result',subtype:'success',is_error:false,result:'done'});assert.equal(complete.finish(1).status,'failed')
})
test('a committed CodeBuddy Bot route uses the Host runner and cannot retry through portable or API execution',async()=>{
 const workspace=resolve('tmp/integration/codebuddy-unit');await mkdir(workspace,{recursive:true});let calls=0
 const result=await executeAssignedTask({route:{provider:'codebuddy',model:'chat'},task:'Read fixture',workspace,authorizeOfficial:()=>({cliModel:'vendor-default',botScoped:true}),runVerified:async request=>{calls++;assert.equal(request.toolId,'codebuddy-code');return{status:'succeeded',finalText:'done',exitCode:0}},resolvePortableLaunch:()=>{throw Error('no portable')},apiFallback:()=>{throw Error('no API')}})
 assert.equal(calls,1);assert.equal(result.ok,true)
})
