import test from 'node:test'
import assert from 'node:assert/strict'
import { extendIndependentToolHost } from '../packages/orchestration/src/independent-tool-families.mjs'

const baseOf = calls => ({ forBot: botId => ({ botId, schemas: () => [{ name: 'base_read' }],
  isReadonly: () => true, call: async name => { calls.push(name); throw Object.assign(new Error('not granted'), {code:'TOOL_NOT_GRANTED'}) } }), close() {} })
const context = () => ({ botId:'a', turnId:'turn-host', callId:'call-host', signal:new AbortController().signal })
const family = execute => ({ readonly:false, handler: { definition:{name:'family_write', description:'fixture', inputSchema:{type:'object'}},
  parse: args => { if (Object.keys(args).some(key => key !== 'text')) throw new Error('bad args'); return args }, execute } })

test('catalog and call re-read current Host family grants; no execution follows revocation', async () => {
  const calls = []; let granted = true, runs = 0
  const host = extendIndependentToolHost({ base:baseOf(calls), familiesFor:botId => granted && botId === 'a' ? [family(async () => { runs++; return {saved:true} })] : [] })
  const view=host.forBot('a')
  assert.equal(view.schemas().some(row=>row.name==='family_write'),true)
  assert.equal(view.isReadonly('family_write'),false)
  granted=false
  assert.equal(view.schemas().some(row=>row.name==='family_write'),false)
  await assert.rejects(view.call('family_write',{text:'held'},context()),{code:'TOOL_NOT_GRANTED'})
  assert.equal(runs,0)
  host.close()
})

test('family execution uses Host turn and call, rejects argument identity and foreign metadata', async () => {
  const seen=[]
  const host=extendIndependentToolHost({base:baseOf([]),familiesFor:()=>[family(async(args,exec)=>{seen.push({args,exec});return 7})]})
  const view=host.forBot('a')
  await assert.rejects(view.call('family_write',{text:'x',botId:'b'},context()),/bad args/)
  await assert.rejects(view.call('family_write',{text:'x'},{...context(),botId:'b'}),{code:'SUBJECT_MISMATCH'})
  await assert.rejects(view.call('family_write',{text:'x'},{}),{code:'INDEPENDENT_TOOL_TURN_REQUIRED'})
  assert.equal(await view.call('family_write',{text:'x'},context()),7)
  assert.deepEqual(seen[0].exec.context,{turnId:'turn-host',callId:'call-host'})
  assert.equal(seen.length,1)
  host.close()
})

test('closing the Host aborts a pending family and withholds its late result without a retry', async () => {
  let release, entered; const started=new Promise(resolve=>{entered=resolve}); let runs=0
  const host=extendIndependentToolHost({base:baseOf([]),familiesFor:()=>[family(async()=>{runs++;entered();await new Promise(resolve=>{release=resolve});return 'late'})]})
  const pending=host.forBot('a').call('family_write',{text:'x'},context())
  await started; host.close(); release()
  await assert.rejects(pending,{code:'TOOL_HOST_CLOSED'})
  assert.equal(runs,1)
})

test('native routes keep their own typed private MCP door without family schema duplication', () => {
  let queried=0
  const host=extendIndependentToolHost({base:baseOf([]),familiesFor:()=>{queried++;return [family(async()=>1)]}})
  assert.deepEqual(host.forBot('a',{nativeRoute:{provider:'native'}}).schemas(),[{name:'base_read'}])
  assert.equal(queried,0)
  host.close()
})

test('the execution gate covers ordinary and family tools without hiding discovery', async () => {
  let consult = true, runs = 0
  const base = { forBot: () => ({ schemas: () => [{name:'base_read'}], isReadonly: () => true,
    call: async () => { runs++; return 'base' } }) }
  const host = extendIndependentToolHost({ base, familiesFor: () => [family(async () => { runs++; return 'family' })],
    validateCall: (botId, ctx) => {
      assert.equal(botId, 'a'); assert.equal(ctx.conversationId, 'original-context')
      if (consult) throw Object.assign(new Error('consult'), {code:'TEAM_CONSULT_READ_ONLY'})
    } })
  const view = host.forBot('a'), ctx = {...context(), conversationId:'original-context'}
  assert.equal(view.schemas().length, 2)
  await assert.rejects(view.call('base_read', {}, ctx), {code:'TEAM_CONSULT_READ_ONLY'})
  await assert.rejects(view.call('family_write', {text:'x'}, ctx), {code:'TEAM_CONSULT_READ_ONLY'})
  assert.equal(runs, 0)
  consult = false
  assert.equal(await view.call('base_read', {}, ctx), 'base')
  assert.equal(await view.call('family_write', {text:'x'}, ctx), 'family')
  assert.equal(runs, 2)
  host.close()
})
