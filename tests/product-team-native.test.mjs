import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

const script = fileURLToPath(new URL('./fixtures/bot-engine-claude-fixture.mjs', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const profileOf = async () => ({ id:'native-team', driver:'claude', provider:'native-team', model:'fixture-model-a', hostTools:true,
  entry:{executable:process.execPath,sha256:sha(await readFile(process.execPath)),version:process.versions.node,
    script,scriptSha256:sha(await readFile(script))}, credentialRef:'ds-secret/NATIVE_TEAM_AUTH', deadlineMs:180000 })
const value = result => JSON.parse(result.content[0].text)
const ok = result => { assert.equal(result.isError ?? false,false,JSON.stringify(result)); return value(result) }
const call = (name,args={}) => ({name,arguments:args})

for (const mode of ['integrated','independent']) test(`native ${mode} team calls reach the target's own API runtime and deduplicate durable requests`, {timeout:240000}, async () => {
  let actual
  await withProductIndependent(async ({ctx,product,runtime,bind,dispatch,home,readRows}) => {
    await product.rt.secretEndpoint('secret-set',{name:'NATIVE_TEAM_AUTH',value:'{"offlineFixture":true}',scope:[]})
    await bind('a','native-team','fixture-model-a')
    await bind('b','beta','vendor/two')
    await runtime.move('b','independent')
    if(mode==='independent') await runtime.move('a','independent')
    const handle=mode==='integrated' ? await actual.context.agents.create({sessionId:'a',agentOptions:{provider:'native-team',model:'fixture-model-a'}}) : null
    const evidence=async()=>JSON.parse(await readFile(join(home,'model-router/conversation-engines/native-team/workspace/fixture-evidence.json'),'utf8'))
    let turns=0
    const send=async calls=>{
      const input=`host-tools:${JSON.stringify({calls})}`
      turns++
      if(handle){
        handle.agent.send(createUserMessage({content:[{type:'text',text:input}],source:{kind:'user'}}),'next-turn',true)
        await handle.agent.whenIdle()
        assert.equal(handle.agent.session.log.filter(row=>row.type==='turn/end').at(-1)?.data.reason.kind,'completed')
      }else{
        const requestKey=`native-team-request-${turns}`
        await dispatch('independentChat.send',{botId:'a',requestKey,input})
        await ctx.get('botIndependentChat').whenIdle()
        assert.equal((await dispatch('independentChat.inspect',{botId:'a',requestKey})).state,'succeeded')
      }
      return (await evidence()).hostToolResults
    }
    const args={bot_ids:['b'],message:'Verify this task using your own configured model.',reply:'none',request_key:'native-host-request'}
    try{
      const first=await send([call('list_bots'),call('coordinate_bots',args),call('assignment_status')])
      if(process.platform==='win32'){
        const launched=await evidence()
        const config=JSON.parse(await readFile(launched.argv.mcpConfig,'utf8'))
        const bridgeEnv=config.mcpServers.dsh_task.env
        assert.equal(typeof bridgeEnv.DSH_NATIVE_COMPILER_ROOT,'string','SDK MCP launch receives the Host compiler root explicitly')
        assert.equal(Object.hasOwn(bridgeEnv,'DSH_NATIVE_COMPILER_SCRATCH'),false,'per-helper compiler scratch stays private')
        assert.equal(bridgeEnv.HOME,dirname(launched.argv.mcpConfig))
        assert.equal(bridgeEnv.USERPROFILE,bridgeEnv.HOME)
        assert.equal(bridgeEnv.TEMP,join(bridgeEnv.HOME,'tmp'))
        assert.equal(bridgeEnv.TMP,bridgeEnv.TEMP)
        assert.notEqual(bridgeEnv.DSH_NATIVE_COMPILER_ROOT,bridgeEnv.TEMP)
      }
      assert.ok(ok(first[0]).bots.some(row=>row.id==='b'))
      const assigned=ok(first[1]).assignments[0]
      assert.ok(assigned.assignmentId)
      assert.equal(first[2].isError,true,'same-turn polling is refused at the actual native door')
      assert.equal(value(first[2]).error.code,'TEAM_STATUS_SAME_TURN')
      const team=ctx.get('botTeamCoordination')
      await team.drain()
      const settled=team.store.get(assigned.assignmentId)
      assert.equal(settled.state,'settled',JSON.stringify(settled))
      assert.equal(settled.outcome,'succeeded',JSON.stringify(settled))
      assert.equal(settled.resumeState,'none')
      assert.equal(settled.targetBot,'b')
      assert.equal(ctx.upstream.length,1)
      assert.equal(ctx.upstream[0].provider,'beta')
      assert.equal(ctx.upstream[0].model,'vendor/two')
      const duplicate=await send([call('coordinate_bots',args),call('list_threads')])
      assert.equal(ok(duplicate[0]).assignments[0].assignmentId,assigned.assignmentId)
      assert.equal(ok(duplicate[0]).assignments[0].replayed,true)
      assert.ok(ok(duplicate[1]).threads.some(row=>row.assignmentId===assigned.assignmentId))
      await team.drain()
      assert.equal(team.store.all().length,1)
      assert.equal(ctx.upstream.length,1,'retry reads the original assignment without another target model call')
      const receipts=readRows('router_model_calls')
      assert.equal(receipts.length,3)
      assert.equal(receipts.filter(row=>row.botId==='a'&&row.provider==='native-team'&&row.funding==='subscription').length,2)
      assert.equal(receipts.filter(row=>row.botId==='b'&&row.provider==='beta'&&row.model==='vendor/two'&&row.funding==='api').length,1)
      assert.ok(receipts.every(row=>row.state==='settled'))
    }finally{await handle?.dispose()}
  },{conversationEngines:[await profileOf()],runtimeConfig:{memoryReview:false},beforeProduct:async({ctx})=>{
    actual=await attachActualAgentLoop(ctx)
    return()=>actual.close()
  }})
})
