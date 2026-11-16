import test from 'node:test'
import assert from 'node:assert/strict'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { offlineModelInfo } from './helpers/product-native-llm.mjs'

const usage={inputTokens:11,outputTokens:7,cacheReadTokens:0,cacheWriteTokens:0}
const finish={type:'finish',reason:{kind:'stop'}}

test('API independent model tool calls delegate through the production family and resume the original sender', async()=>{
  await withProductIndependent(async({ctx,runtime,bind,readRows})=>{
    await bind('a','alpha','one'); await bind('b','beta','vendor/two')
    await runtime.move('a','independent'); await runtime.move('b','independent')
    let senderCalls=0,targetCalls=0
    class TeamAdapter extends LlmAdapter {
      async listModels(provider){return[offlineModelInfo(provider,provider==='alpha'?'one':'vendor/two')]}
      async resolveModel(provider,model){return offlineModelInfo(provider,model)}
      async *stream(options){
        ctx.upstream.push(structuredClone({provider:options.provider,model:options.model,messages:options.messages,tools:options.tools}))
        if(options.provider==='beta'){
          targetCalls++
          yield {type:'text-delta',index:0,text:'目标已用自己的模型核对'}
        }else if(++senderCalls===1){
          yield {type:'tool-call-delta',index:0,id:'actual-api-team-call',name:'coordinate_bots',argumentsDelta:JSON.stringify({bot_ids:['b'],message:'独立核对后返回结论',request_key:'api-family-team-request'})}
          yield {type:'usage',usage}
          yield {type:'finish',reason:{kind:'tool-calls'}}
          return
        }else if(senderCalls===3){
          const note=options.messages.filter(message=>message.role==='user').at(-1).content.map(part=>part.text??'').join('\n')
          assert.doesNotMatch(JSON.stringify(options.messages),/目标已用自己的模型核对/)
          const id=note.match(/assign_[a-f0-9-]+/)[0]
          yield {type:'tool-call-delta',index:0,id:'pull-team-inbox',name:'team_inbox',argumentsDelta:JSON.stringify({action:'read',ids:[id]})}
          yield {type:'usage',usage};yield {type:'finish',reason:{kind:'tool-calls'}};return
        }else if(senderCalls===4){
          assert.match(JSON.stringify(options.messages),/目标已用自己的模型核对/)
          const id=ctx.get('botTeamCoordination').store.all()[0].assignmentId
          yield {type:'tool-call-delta',index:0,id:'ack-team-inbox',name:'team_inbox',argumentsDelta:JSON.stringify({action:'acknowledge',ids:[id]})}
          yield {type:'usage',usage};yield {type:'finish',reason:{kind:'tool-calls'}};return
        }else{
          yield {type:'text-delta',index:0,text:senderCalls===2?'已安排，等待结果':'已核对收件箱中的结果'}
        }
        yield {type:'usage',usage}; yield finish
      }
    }
    ctx.replaceOfflineLlmAdapter(new TeamAdapter())
    const origin=runtime.contextOf('a').contextId
    const answer=await runtime.turn({botId:'a',input:'请 Writer 核对并把结论交回此会话'})
    assert.equal(answer.answer,'已安排，等待结果')
    const team=ctx.get('botTeamCoordination')
    await team.drain()
    assert.equal(team.store.all().length,1)
    const row=team.store.all()[0]
    assert.equal(row.state,'settled',JSON.stringify(row))
    assert.equal(row.outcome,'succeeded')
    assert.equal(row.resumeState,'delivered')
    assert.equal(runtime.contextOf('a').contextId,origin)
    assert.equal(senderCalls,5); assert.equal(targetCalls,1)
    assert.equal(row.inboxState,'read')
    for(const name of ['coordinate_bots','assignment_status','list_bots','list_threads','team_inbox']) assert.ok(ctx.upstream[0].tools.some(tool=>tool.name===name),name)
    assert.ok(ctx.upstream.filter(request=>request.provider==='alpha').at(-1).messages.some(message=>message.role==='user'&&message.content.some(part=>part.text?.includes('Team result from b'))))
    assert.equal(runtime.history('b').length,0,'work-thread does not replace the target default conversation')
    const receipts=readRows('router_model_calls')
    assert.equal(receipts.length,6)
    assert.equal(receipts.filter(receipt=>receipt.botId==='a'&&receipt.provider==='alpha'&&receipt.model==='one').length,5)
    assert.equal(receipts.filter(receipt=>receipt.botId==='b'&&receipt.provider==='beta'&&receipt.model==='vendor/two').length,1)
    assert.ok(receipts.every(receipt=>receipt.state==='settled'&&receipt.outcome==='succeeded'))
    const before=receipts.length
    assert.equal(team.assignmentStatus({callerBotId:'a',conversationId:origin,turnId:'later-host-turn',args:{id:row.assignmentId}}).assignment.assignmentId,row.assignmentId)
    assert.equal(readRows('router_model_calls').length,before,'observing the result cannot start another model step')
  })
})
