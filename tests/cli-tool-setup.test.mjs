import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve,join} from 'node:path'
import {createCliToolSetup as createActualSetup} from '../packages/orchestration/src/cli-tool-setup.mjs'
const createCliToolSetup=options=>createActualSetup({readiness:async()=>({ready:false,reason:'offline entry fixture'}),...options})
import {getOfficialTool,installCommandLine} from '../.dsh-plugin/shared/official-tool-registry.mjs'
const owner={kind:'owner'},node=process.execPath,script=resolve('tmp/integration/synthetic-cli/gemini.js')
test('CLI setup is owner-only, accepts fixed registry ids and never starts repair or imports an account on read',async()=>{
 const calls=[],service=createCliToolSetup({probe:async id=>{calls.push(id);return {installed:true,version:'1.2.3',packageEntry:script}},findNode:async()=>node,repair:()=>{throw Error('unexpected install')}})
 await assert.rejects(service.inspect({toolId:'gemini'},{kind:'bot'}),{code:'REMOTE_OWNER_REQUIRED'})
 await assert.rejects(service.inspect({toolId:'gemini',executable:'malicious'},owner),{code:'CLI_SETUP_INVALID'})
 await assert.rejects(service.inspect({toolId:'unknown'},owner),{code:'CLI_SETUP_INVALID'})
 const value=await service.inspect({toolId:'gemini'},owner)
 assert.deepEqual(calls,['gemini']);assert.deepEqual(value.entry,{executable:node,script,version:'1.2.3'})
 assert.equal(value.driver,'geminiAgent');assert.equal(value.billing,'subscription');assert.equal(value.loginCommand,'gemini')
 assert.equal(Object.hasOwn(value,'credentialJson'),false);assert.equal(Object.hasOwn(value,'ready'),false)
})
test('DeepSeek setup selects the matching Node ACP prerequisite in the chosen TUI package prefix and declares API billing',async()=>{
 const packageRoot=resolve('tmp/integration/tools/node_modules/@deepseek-harness-tui/dsh-tui'),dsh=resolve('tmp/integration/tools/node_modules/@deepseek-ai/dsh/lib/bin.js')
 let options
 const service=createCliToolSetup({probe:async()=>({installed:true,version:'0.19.0',packageRoot,packageEntry:script}),findNode:async()=>node,
  findEntries:async(pkg,bin,expected,workspace,input)=>{assert.equal(pkg,'@deepseek-ai/dsh');options=input;return[{version:'0.2.1-rc.5',entry:'old'},{version:'0.2.2-rc.2',entry:dsh}]}})
 const value=await service.inspect({toolId:'dsh-tui'},owner)
 assert.deepEqual(options.moduleRoots,[resolve('tmp/integration/tools/node_modules')]);assert.equal(value.driver,'deepseekAgent');assert.equal(value.billing,'api')
 assert.deepEqual(value.entry,{executable:node,script:dsh,version:'0.2.2-rc.2'});assert.equal(value.loginCommand,null)
})
test('missing or shim-only entries remain editable without reporting execution readiness',async()=>{
 const service=createCliToolSetup({probe:async()=>({installed:true,version:'1.0.0',executablePath:resolve('tools/step.cmd')})})
 const value=await service.inspect({toolId:'stepcode'},owner)
 assert.equal(value.entry,null);assert.match(value.entryNotice,/安装\/修复/);assert.equal(value.driver,'stepAgent')
 const dsh=createCliToolSetup({probe:async()=>({installed:true,version:'0.19.0'}),findEntries:async()=>[]})
 assert.match((await dsh.inspect({toolId:'dsh-tui'},owner)).entryNotice,/0.2.2-rc.2/)
})
test('repair only starts on the explicit owner operation and status/cancel reconcile the same registry tool',()=>{
 const calls=[],job={status:'running',tool:'stepcode'},service=createCliToolSetup({repair:id=>{calls.push(['start',id]);return job},status:id=>{calls.push(['status',id]);return job},cancel:id=>{calls.push(['cancel',id]);return {...job,cancelRequested:true}}})
 assert.throws(()=>service.repair({toolId:'stepcode',operation:'start'},{kind:'bot'}),{code:'REMOTE_OWNER_REQUIRED'})
 for(const operation of ['start','status','cancel'])assert.equal(service.repair({toolId:'stepcode',operation},owner).toolId,'stepcode')
 assert.deepEqual(calls,[['start','stepcode'],['status','stepcode'],['cancel','stepcode']])
 assert.throws(()=>service.repair({toolId:'stepcode',operation:'start',args:['--unsafe']},owner),{code:'CLI_SETUP_INVALID'})
})
test('TUI install and repair include the pinned official dsh prerequisite for npm and pnpm',()=>{
 const tool=getOfficialTool('dsh-tui')
 for(const method of tool.installMethods){assert.ok(method.installArgs.includes('@deepseek-ai/dsh@0.2.2-rc.2'));assert.equal(method.uninstallArgs.includes('@deepseek-ai/dsh'),false)}
})
