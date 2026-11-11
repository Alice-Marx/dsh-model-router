import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createProductDataAccess } from '../packages/orchestration/src/data-product-access.mjs'
import { registerDataTools } from '../packages/orchestration/src/bot-data-tools.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

function fixture() {
  const calls = [], authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const live = new Set(['bot-a', 'bot-b']), agent = { id: 'runtime-agent', session: { id: 'session-a' } }
  directory.register('bot-a', { tools: [], modelRoutes: [] }); directory.bind('bot-a', agent)
  directory.register('bot-b', { tools: [], modelRoutes: [] })
  const engine = { forBot: botId => ({ catalog: () => { calls.push(botId); return { tables: [] } },
    sql: input => { calls.push({ botId, input }); return { rows: [[1]] } } }) }
  const access = createProductDataAccess({ engine, authority, directory, lifecycle: { committedBot: id => live.has(id) ? { id } : null } })
  return { calls, authority, directory, agent, engine, access, live }
}

test('data model tools require a committed grant and actual bound Agent; arguments cannot select another Bot', async () => {
  const f = fixture(), tools = new Map()
  const release = registerDataTools({ tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } }, { engine: f.engine, botIdFor: f.access.botIdFor })
  const sql = tools.get('data_sql').execute
  assert.ok((await sql({ sql: 'SELECT 1', botId: 'bot-b' }, { agent: f.agent })).error)
  assert.equal(f.calls.length, 0)
  f.directory.replaceGrant('bot-a', { tools: ['tool/data'], modelRoutes: [] })
  await sql({ sql: 'SELECT 1', botId: 'bot-b' }, { agent: f.agent })
  assert.equal(f.calls[0].botId, 'bot-a')
  assert.equal(Object.hasOwn(f.calls[0].input, 'botId'), false)
  assert.ok((await sql({ sql: 'SELECT 1' }, { agent: { ...f.agent } })).error, 'matching strings do not bind an Agent object')
  f.directory.replaceGrant('bot-a', { tools: [], modelRoutes: [] })
  assert.ok((await sql({ sql: 'SELECT 1' }, { agent: f.agent })).error)
  assert.equal(f.calls.length, 1, 'revoked calls never reach the engine')
  release(); assert.equal(tools.size, 0)
})

test('owner data selection crosses the real product boundary and refuses deleted or unknown Bots before opening a database', async () => {
  const f = fixture(), action = { action: 'data.catalog', payload: { botId: 'bot-b' } }
  const model = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: { 'data.catalog': payload => f.access.ownerAction('data.catalog', payload) } })
  await assert.rejects(model.dispatch(action, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  assert.equal(f.calls.length, 0)
  await model.dispatch(action, { kind: 'owner' }); assert.deepEqual(f.calls, ['bot-b'])
  f.live.delete('bot-b')
  await assert.rejects(model.dispatch(action, { kind: 'owner' }), { code: 'INVALID_DATA_OWNER' })
  await assert.rejects(model.dispatch({ ...action, payload: { botId: '../../outside' } }, { kind: 'owner' }), { code: 'INVALID_DATA_OWNER' })
  assert.deepEqual(f.calls, ['bot-b'])
})
