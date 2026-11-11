import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

const usage = { inputTokens:11,outputTokens:7,cacheReadTokens:0,cacheWriteTokens:0 }
const ask = (id,name,args) => [
  {type:'tool-call-delta',index:0,id,name,argumentsDelta:JSON.stringify(args)},
  {type:'usage',usage}, {type:'finish',reason:{kind:'tool-calls'}},
]
const answer = [{type:'text-delta',index:0,text:'数据已核对'}, {type:'usage',usage}, {type:'finish',reason:{kind:'stop'}}]

test('API independent chat reaches the same Bot data engine through actual SDK tools and one receipt per step', async () => {
  await withProductIndependent(async ({ctx,runtime,bind,dispatch,readRows}) => {
    await bind('a','alpha','one')
    await runtime.move('a','independent')
    let calls=0
    ctx.state.beforeRequest=()=>{
      calls++
      ctx.state.chunks=calls===1 ? ask('load-a','data_load',{from:'content',format:'csv',name:'api_sales',content:'region,value\nA,12\nB,15'})
        : calls===2 ? ask('sum-a','data_sql',{sql:'SELECT SUM(value) AS total FROM api_sales'}) : answer
    }
    const result=await runtime.turn({botId:'a',input:'导入并核对合计'})
    assert.equal(result.answer,'数据已核对')
    assert.equal(calls,3)
    const schemas=ctx.upstream[0].tools
    for(const name of ['data_load','data_describe','data_sql','data_show','data_export']) assert.ok(schemas.some(row=>row.name===name),name)
    assert.equal(schemas.find(row=>row.name==='data_show').parameters.properties.chart.type,'object')
    const replies=ctx.upstream.at(-1).messages.filter(row=>row.role==='tool')
    assert.equal(replies.length,2)
    assert.deepEqual(JSON.parse(replies[1].content[0].text).rows,[[27]])
    assert.equal((await dispatch('data.describe',{botId:'a',target:'api_sales'})).rowCount,2)
    assert.deepEqual((await dispatch('data.catalog',{botId:'b'})).tables,[])
    assert.equal(readRows('router_model_calls').length,3)
    assert.ok(readRows('router_model_calls').every(row=>row.state==='settled'&&row.provider==='alpha'&&row.model==='one'))
  })
})
