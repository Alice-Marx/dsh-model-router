import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {officialToolExecutionCapabilities,parseGeminiProcessOutput,runOfficialTool} from '../.dsh-plugin/shared/official-tool-executor.mjs'
import {createHeadlessParser,stepTaskArgs,geminiTaskArgs,resolveStepTask,resolveDshTask} from '../.dsh-plugin/shared/official-headless-adapters.mjs'
import {createBotOfficialToolsCatalog,buildBotOfficialToolsCatalog} from '../packages/orchestration/src/bot-official-tools.mjs'
import {createHash} from 'node:crypto'
import {zipMemberDigest,attestVendorRelease} from '../.dsh-plugin/shared/vendor-release-attestation.mjs'
import {createMiMoGrokParser} from '../.dsh-plugin/shared/vendor-mimo-grok-adapter.mjs'
import {prepareOfficialRuntime} from '../.dsh-plugin/shared/official-runtime-state.mjs'

test('Gemini, Step and DSH are actual managed capabilities and cannot silently become unconfined native execution',()=>{
 for(const id of ['gemini','stepcode','dsh-tui']){
  const cap=officialToolExecutionCapabilities().find(row=>row.id===id)
  assert.equal(cap.supported,id==='stepcode'?process.platform==='win32':true)
  if(cap.supported)assert.deepEqual(cap.modes,['read-only','workspace-write'])
  const native=officialToolExecutionCapabilities({executionEnvironment:'cli-native'}).find(row=>row.id===id)
  assert.equal(native.supported,false);assert.deepEqual(native.modes,[])
 }
})
test('new managed tools refuse a missing actual Host sandbox before any executable discovery or task launch',async()=>{
 const base=resolve('tmp/integration/official-execution-tests');await mkdir(base,{recursive:true});const workspace=await mkdtemp(join(base,'case-'))
 for(const toolId of ['gemini','stepcode','dsh-tui']){const result=await runOfficialTool({toolId,task:'offline read',workspace});assert.equal(result.status,'unsupported');assert.match(result.reason,/沙箱|Windows/)}
})
test('Step and Gemini launch fixed argv and the requested file-effect modes',()=>{
 const read=stepTaskArgs('read-only','step/model'),write=stepTaskArgs('workspace-write','step/model')
 assert.ok(read.includes('read,grep,find,ls'));assert.ok(read.includes('deny'));assert.ok(write.includes('allow'));assert.ok(write.includes('auto'))
 for(const args of [read,write])for(const flag of ['--print','--mode','json','--no-session','--no-extensions','--no-approve'])assert.ok(args.includes(flag))
 assert.ok(geminiTaskArgs('read-only').includes('plan'));assert.ok(geminiTaskArgs('workspace-write').includes('yolo'));assert.ok(geminiTaskArgs('workspace-write').includes('--sandbox=false'))
})
test('Gemini requires real JSON completion, preserves real usage and does not report API fallback success',()=>{
 const result=parseGeminiProcessOutput(JSON.stringify({response:'read proof',stats:{models:{'gemini-model':{tokens:{prompt:11,candidates:3,cached:2}}}}}),0)
 assert.equal(result.status,'succeeded');assert.equal(result.finalText,'read proof');assert.equal(result.usage.outputTokens,3)
 for(const [body,code]of [['not-json',0],[JSON.stringify({response:'preview'}),1],[JSON.stringify({response:'preview',error:{message:'denied'}}),0],[JSON.stringify({}),0]])assert.equal(parseGeminiProcessOutput(body,code).status,'failed')
 assert.equal(Object.hasOwn(parseGeminiProcessOutput('{"response":"ok"}',0),'usage'),false)
 assert.equal(parseGeminiProcessOutput(JSON.stringify({response:'looks done',stats:{tools:{totalFail:1}}}),0).status,'failed')
})

test('MiMo tool errors remain failed even when a later assistant claims success',()=>{
 const p=createMiMoGrokParser('mimo-code')
 for(const e of [{type:'tool_use',part:{state:{status:'error'}}},{type:'text',part:{type:'text',text:'done',time:{end:1}}},{type:'step_finish',part:{type:'step-finish',reason:'stop'}}])p.push(JSON.stringify({...e,sessionID:'s'}))
 assert.equal(p.finish(0).status,'failed')
})

const zip=(names,body=Buffer.from('official fixture'))=>{
 let offset=0;const local=[],central=[]
 for(const name of names){const bytes=Buffer.from(name),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt32LE(body.length,18);header.writeUInt32LE(body.length,22);header.writeUInt16LE(bytes.length,26)
 const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt32LE(body.length,20);entry.writeUInt32LE(body.length,24);entry.writeUInt16LE(bytes.length,28);entry.writeUInt32LE(offset,42)
 local.push(header,bytes,body);central.push(entry,bytes);offset+=header.length+bytes.length+body.length}
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...local,directory,end])
}
test('release attestation hashes the exact official member and rejects ambiguous or escaping ZIP entries',()=>{
 assert.equal(zipMemberDigest(zip(['release/step.exe']),'step.exe').sha256,createHash('sha256').update('official fixture').digest('hex'))
 for(const data of [zip(['../step.exe']),zip(['step.exe','other/step.exe']),zip(['other.exe']),Buffer.from('not zip')])assert.throws(()=>zipMemberDigest(data,'step.exe'))
})
test('release attestation refuses a changed native binary without launching it or accepting a caller URL',async()=>{
 const base=resolve('tmp/integration/official-attestation-test');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'case-')),file=join(dir,'step.exe'),cache=join(dir,'digests.json'),body=Buffer.from('official fixture'),archive=zip(['step.exe'],body),digest=createHash('sha256').update(archive).digest('hex');let calls=0
 const fetcher=async url=>{calls++;return url.endsWith('/manifest.json')?Response.json({version:'9.8.7',packages:{'windows-x64':'https://static-openapi.stepfun.com/stepcode/9.8.7/step-9.8.7-windows-x64.zip'},checksums:{'windows-x64':digest}}):new Response(archive)}
 await writeFile(file,body);const input={vendor:'stepcode',version:'9.8.7',executable:file,arch:'x64',fetcher,cacheFile:cache}
 assert.equal((await attestVendorRelease(input)).ok,true);const downloads=calls
 await writeFile(file,'tampered');assert.equal((await attestVendorRelease(input)).ok,false);assert.equal(calls,downloads)
 assert.equal((await attestVendorRelease({...input,version:'../bad'})).ok,false)
})
test('read-only managed runtime keeps the project outside its writable state root and disposes its launch manifest',async()=>{
 const dir=resolve('tmp/integration/official-runtime-state');await mkdir(dir,{recursive:true})
 const runtime=await prepareOfficialRuntime({file:process.execPath,args:['--version'],format:'step-jsonl'},'stepcode',dir,'read-only')
 assert.equal(runtime.policy.mode,'workspace-write');assert.notEqual(runtime.policy.workspaceRoot,dir);assert.ok(runtime.spec.args.includes(runtime.policy.workspaceRoot+requireSeparator()+'launch.json'));await runtime.dispose()
})
function requireSeparator(){return process.platform==='win32'?'\\':'/'}
test('Step print protocol waits for agent_settled and preserves disjoint cache usage without inventing cost',()=>{
 const p=createHeadlessParser('step-jsonl');p.push({type:'session',id:'s'});p.push({type:'message_end',message:{role:'assistant',provider:'step',model:'m',content:[{type:'text',text:'done'}],stopReason:'stop',usage:{input:10,output:2,cacheRead:3,cacheWrite:1}}})
 assert.equal(p.finish(0).status,'failed');p.push({type:'agent_end'});assert.equal(p.finish(0).status,'failed');p.push({type:'agent_settled'})
 const value=p.finish(0);assert.equal(value.status,'succeeded');assert.deepEqual(value.usage,{inputTokens:10,outputTokens:2,cacheReadTokens:3,cacheWriteTokens:1});assert.equal(Object.hasOwn(value,'reportedCostUsd'),false)
})
test('Step settled failure or tool failure cannot become success despite a clean exit or assistant text',()=>{
 for(const fail of [{type:'agent_settled',failure:{kind:'incomplete_turn'}},{type:'tool_execution_end',isError:true}]){
  const p=createHeadlessParser('step-jsonl');p.push({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'preview'}],stopReason:'stop'}});p.push(fail);if(fail.type!=='agent_settled')p.push({type:'agent_settled'});assert.equal(p.finish(0).status,'failed')
 }
})
test('DSH accepts only a completed final for the current session and keeps missing usage unknown',()=>{
 const p=createHeadlessParser('dsh-headless-jsonl');p.push({type:'session',sessionId:'s'});p.push({type:'text',text:'preview'});assert.equal(p.finish(0).status,'failed')
 p.push({type:'status',phase:'step_end',usage:{inputTokens:9,outputTokens:2}});p.push({type:'final',sessionId:'s',reason:{kind:'completed'},text:'done'})
 assert.equal(p.finish(0).status,'succeeded');assert.equal(p.finish(0).usage.outputTokens,2)
 for(const event of [{type:'final',sessionId:'other',reason:{kind:'completed'},text:'fake'},{type:'final',sessionId:'s',reason:{kind:'error'},text:'failed'}]){const bad=createHeadlessParser('dsh-headless-jsonl');bad.push({type:'session',sessionId:'s'});bad.push(event);assert.equal(bad.finish(0).status,'failed')}
 const unknown=createHeadlessParser('dsh-headless-jsonl');unknown.push({type:'session',sessionId:'s'});unknown.push({type:'status',phase:'step_end'});unknown.push({type:'final',sessionId:'s',reason:{kind:'completed'},text:'done'});assert.equal(Object.hasOwn(unknown.finish(0),'usage'),false)
})
test('a slow tool digest cannot close another ready tool and does not grant the pending entry',async()=>{
 const service=createBotOfficialToolsCatalog({timeoutMs:350,probeHealth:async()=>({tools:['codex','stepcode'].map(id=>({id,installed:true,login:{state:'logged-in'}}))}),
  probeCapabilities:async()=>['codex','stepcode'].map(id=>({id,supported:true,modes:['read-only']})),probeReadiness:id=>id==='stepcode'?new Promise(()=>{}):Promise.resolve({ready:true,readyModes:['read-only']})})
 const rows=await service.refresh();assert.equal(rows.find(row=>row.toolId==='codex').status,'ready');const pending=rows.find(row=>row.toolId==='stepcode');assert.equal(pending.status,'unavailable');assert.deepEqual(pending.grantTools,[]);assert.match(pending.reason,/摘要/)
})
