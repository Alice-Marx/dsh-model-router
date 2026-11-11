import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createBotThreads } from '../packages/orchestration/src/bot-threads.mjs'

test('fresh client modules do not replay an older create after reload; one request still recovers the same thread', async t => {
  const parent=resolve('tmp/integration/thread-request-reload')
  await mkdir(parent,{recursive:true})
  const folder=await mkdtemp(join(parent,'case-'))
  const botId='b'.repeat(128)
  const service=createBotThreads({file:join(folder,'threads.json'),committedBot:id=>id===botId?{id:botId}:null,lifecycleStatus:()=>({healthy:true}),ownsSession:()=>true,botAuthorized:()=>true})
  t.after(()=>service.close())
  const firstPage=await import('../apps/integration-client/thread-request-key.mjs?page=one')
  const nextPage=await import('../apps/integration-client/thread-request-key.mjs?page=two')
  for(const source of ['head','panel']){
    const oldKey=firstPage.threadRequestKey(source)
    const newKey=nextPage.threadRequestKey(source)
    assert.notEqual(newKey,oldKey)
    assert.ok(newKey.length<=128,'The longest Bot ID must not overflow the Host request-key limit')
    const made=service.create({botId,name:'before reload',requestKey:oldKey})
    const replay=service.create({botId,name:'before reload',requestKey:oldKey})
    assert.equal(replay.thread.threadId,made.thread.threadId)
    const after=service.create({botId,name:'after reload',requestKey:newKey})
    assert.notEqual(after.thread.threadId,made.thread.threadId)
    assert.equal(after.thread.name,'after reload')
  }
  assert.equal(service.list(botId).threads.length,4)
})
