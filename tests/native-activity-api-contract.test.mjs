import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { createNativeActivityService } from '../packages/orchestration/src/native-activity-service.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'
import { createNativeActivityController } from '../apps/integration-client/native-activity.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const root = new URL('../tmp/integration/native-activity-api/', import.meta.url)
const inspect = (controller, start = false) => new Promise((resolve, reject) => {
  const revision = controller.getSnapshot().revision
  const timer = setTimeout(() => { off(); reject(new Error('activity controller did not publish a completed read')) }, 1500)
  const off = controller.subscribe(() => {
    const state = controller.getSnapshot()
    if (state.revision > revision && !state.loading && (state.loaded || state.error)) { clearTimeout(timer); off(); resolve(state) }
  })
  if (start) controller.start(); else controller.inspect()
})

for (const mode of ['integration', 'independent']) test(`actual SQLite owner action and ${mode} controller preserve unknown and late stop facts`, async () => {
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(new URL('case-', root))
  const conversationId = mode === 'integration' ? `host-${createHash('sha256').update('session-a').digest('hex')}` : 'context-a'
  const selector = { botId:'a',mode,...(mode === 'integration' ? {sessionId:'session-a'} : {contextId:conversationId}) }
  let clock = 100
  const service = createNativeActivityService({ Database, file:join(dir,'activity.sqlite'), namespace:'host-api-contract',
    committedBot:id=>['a','b'].includes(id)?{id}:null, nativeRouteForBot:()=>true, now:()=>++clock })
  const readModel = createProductReadModel({ runtime:{readOnly:()=>undefined}, lifecycle:{},
    actions:{'nativeActivity.list':(payload,context)=>service.list(payload,context)} })
  const api = { dispatch:(action,payload)=>readModel.dispatch({action,payload},{kind:'owner'}) }
  const controller = createNativeActivityController({ api,...selector,pollMs:60000 })
  const identity = { botId:'a',mode,conversationId,contextId:mode==='independent'?conversationId:null,
    processGeneration:'native-api-contract-generation',turnId:'turn-api-contract' }
  const observe = event => { const result = service.observe(event); assert.equal(result.ok, true, JSON.stringify(result)) }
  try {
    observe({kind:'turn-open',identity})
    observe({kind:'tool',identity,tool:{phase:'started',id:'call-id',name:'mcp__dsh_task__data_load'}})
    observe({kind:'turn-close',identity,outcome:'unknown'})
    const first = await inspect(controller, true)
    assert.equal(first.error, '', JSON.stringify(first))
    assert.equal(controller.getSnapshot().items[0].state,'turn-unconfirmed')
    assert.equal(controller.getSnapshot().items[0].stopConfirmed,false)
    observe({kind:'cancel-requested',identity})
    observe({kind:'stop-confirmed',identity})
    observe({kind:'tool',identity,tool:{phase:'completed',id:'call-id',ok:true}})
    await inspect(controller)
    const state=controller.getSnapshot()
    assert.equal(state.error,'',JSON.stringify(state))
    assert.equal(state.items.length,1)
    assert.equal(state.items[0].state,'turn-unconfirmed')
    assert.equal(state.items[0].cancelRequested,true)
    assert.equal(state.items[0].stopConfirmed,true)
    assert.equal(state.items[0].lateCliReturn,true)
    await assert.rejects(readModel.dispatch({action:'nativeActivity.list',payload:selector},{kind:'bot'}),{code:'REMOTE_OWNER_REQUIRED'})
    const foreign=await api.dispatch('nativeActivity.list',{...selector,botId:'b'})
    assert.deepEqual(foreign.items,[])
  } finally { controller.dispose(); service.close() }
})
