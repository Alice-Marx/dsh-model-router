import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { inspectProductBotProfile, saveProductBotProfile } from '../packages/orchestration/src/bot-profile.mjs'
import { attachDsLifecycle } from '../packages/orchestration/src/ds-lifecycle.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

// Exercise the applied overlay as a test artifact, like the composer-slot probe.
// Production imports of the pinned runtime remain confined to its public bridge.
const parent = resolve('tmp/integration/product-profile-commit')
await mkdir(parent, { recursive: true })
const fixture = await mkdtemp(join(parent, 'roster-'))
const sourceDir = resolve('modules/bot-runtime/vendor/ds-bot/src/host')
const compiled = await build({ stdin: { contents: await readFile(join(sourceDir, 'roster.js'), 'utf8'),
  resolveDir: sourceDir, sourcefile: 'roster.js', loader: 'js' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
const entry = join(fixture, 'applied-roster.mjs')
await writeFile(entry, compiled.outputFiles[0].contents)
const { install } = await import(pathToFileURL(entry).href)

function host({ save, rename } = {}) {
  const calls = [], delivered = []
  const state = { version: 1, revision: 7, bots: { a: { id: 'a', sessionId: 'chat-a', name: 'Alpha', role: 'Research', instructions: 'Cite sources.', model: 'fixture/exact', permission: 'read', kickoff: 'held' },
    b: { id: 'b', sessionId: 'chat-b', name: 'Beta' } }, rooms: { room: { id: 'room', name: 'You, Alpha, Beta', members: ['a', 'b'] },
      named: { id: 'named', name: 'Our team', named: true, members: ['a', 'b'] } } }
  let committed = structuredClone(state)
  const rt = { state, defaults: {}, ctx: { sessionTitle: { rename: async (...args) => { calls.push(['title', ...args]); await rename?.(...args) } } },
    botOf: id => state.bots[id], findBot: name => Object.values(state.bots).find(bot => bot.name.toLowerCase() === name.toLowerCase()),
    readOnly: () => undefined, chatOf: id => `chat-${id}`, sessionOfRoom: room => `chat-${room.id}`,
    resolveAgent: async id => ({ session: { id } }),
    load: async () => {}, refresh: async () => {},
    save: async () => { calls.push(['save', structuredClone(state)]); await save?.(); state.revision++; committed = structuredClone(state) },
    warn: (...args) => calls.push(['warn', ...args]), deliver: async input => { delivered.push(input) },
    applyModel: async () => { throw new Error('Unexpected model application') } }
  install(rt)
  return { rt, state, calls, delivered, saved: () => structuredClone(committed) }
}
const base = () => ({ name: 'Alpha', role: 'Research', instructions: 'Cite sources.' })

test('actual roster profile seam commits all identity fields once without sending, granting or releasing a greeting', async () => {
  const { rt, state, calls, delivered } = host()
  const deliver = rt.deliver
  let checks = 0
  await rt.updateBotProfile('a', { name: 'Analyst', role: 'Review', instructions: 'Verify evidence.' }, { base: base(), check(bot) {
    checks++; assert.equal(bot.name, 'Alpha'); assert.equal(calls.length, 0)
  } })
  assert.equal(checks, 1)
  assert.equal(calls.filter(call => call[0] === 'save').length, 1)
  assert.equal(calls[0][1].bots.a.name, 'Analyst')
  assert.equal(calls[0][1].bots.a.role, 'Review')
  assert.equal(calls[0][1].bots.a.instructions, 'Verify evidence.')
  assert.equal(state.bots.a.model, 'fixture/exact'); assert.equal(state.bots.a.permission, 'read'); assert.equal(state.bots.a.kickoff, 'held')
  assert.equal(state.rooms.room.name, 'You, Analyst, Beta'); assert.equal(state.rooms.named.name, 'Our team')
  assert.equal(rt.deliver, deliver); assert.deepEqual(delivered, [])
})

test('a second profile edit with a stale live base fails while the first persistence is pending', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const { rt, calls, state, delivered } = host({ save: () => pending })
  const original = rt.deliver
  const first = rt.updateBotProfile('a', { role: 'First edit' }, { base: base(), check() {} })
  await assert.rejects(rt.updateBotProfile('a', { role: 'Stale edit', instructions: 'Must not leak' }, { base: base(), check() { throw new Error('stale base must reject before check') } }), { code: 'BOT_PROFILE_CONFLICT' })
  assert.equal(state.bots.a.role, 'First edit'); assert.equal(state.bots.a.instructions, 'Cite sources.')
  await rt.deliver({ toId: 'a', role: 'update', text: 'An unrelated update during save' })
  assert.equal(rt.deliver, original); assert.equal(delivered.length, 1)
  release(); await first
  assert.equal(calls.filter(call => call[0] === 'save').length, 1)
})

test('the final synchronous ownership/abort fence runs before any profile field or room changes', async () => {
  const { rt, state, calls } = host(), before = structuredClone(state)
  await assert.rejects(rt.updateBotProfile('a', { name: 'New name', role: 'New role' }, { base: base(), check() {
    throw Object.assign(new Error('Bot moved while request was queued'), { code: 'BOT_PROFILE_CONFLICT' })
  } }), { code: 'BOT_PROFILE_CONFLICT' })
  assert.deepEqual(state, before); assert.deepEqual(calls, [])
  await assert.rejects(rt.updateBotProfile('a', { role: 'Async guard' }, { base: base(), check: async () => {} }), { code: 'BOT_PROFILE_INVALID' })
  assert.deepEqual(state, before)
})

test('profile seam refuses hidden authority fields, invalid names, foreign identities and missing fences', async () => {
  const { rt, state, calls } = host(), before = structuredClone(state)
  for (const patch of [{ model: 'forged/route' }, { permission: 'all' }, { constructor: 'forged' }, { role: 'x'.repeat(25) }, { instructions: 'x'.repeat(4001) }, { name: 'Beta', role: 'leak' }, { name: 'user' }]) {
    await assert.rejects(rt.updateBotProfile('a', patch, { base: base(), check() {} }))
  }
  await assert.rejects(rt.updateBotProfile('chat-a', { role: 'Alias' }, { base: base(), check() {} }), { code: 'BOT_PROFILE_UNKNOWN_BOT' })
  await assert.rejects(rt.updateBotProfile('a', { role: 'No fence' }, { base: base() }), { code: 'BOT_PROFILE_INVALID' })
  assert.deepEqual(state, before); assert.deepEqual(calls, [])
})

test('a failed session title is reported after the persisted profile and never starts another turn', async () => {
  const { rt, calls, delivered } = host({ rename: () => { throw new Error('Fixture title service unavailable') } })
  const bot = await rt.updateBotProfile('a', { name: 'Analyst' }, { base: base(), check() {} })
  assert.equal(bot.name, 'Analyst'); assert.equal(calls[0][0], 'save')
  assert.ok(calls.some(call => call[0] === 'warn')); assert.deepEqual(delivered, [])
})

test('profile product service uses the actual roster seam and committed lifecycle through the real owner channel', async t => {
  const source = host(), { rt } = source
  const lifecycle = attachDsLifecycle({ runtime: rt, directory: createPrincipalDirectory(createAuthority()),
    grantFor: () => ({ tools: [], modelRoutes: [] }), readSaved: async () => source.saved() })
  t.after(() => lifecycle.close())
  await rt.load()
  const model = createProductReadModel({ runtime: rt, lifecycle, actions: {
    'botProfile.inspect': payload => inspectProductBotProfile({ runtime: rt, lifecycle }, payload),
    'botProfile.save': (payload, context) => saveProductBotProfile({ runtime: rt, lifecycle }, payload, context),
  } })
  // Use the allow-list in production, not a test copy of owner admission.
  const request = { action: 'botProfile.save', payload: { botId: 'a', expectedRevision: 7, base: base(), profile: { role: 'Verified reviewer' } } }
  await assert.rejects(model.dispatch(request, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  assert.equal(source.calls.length, 0)
  const result = await model.dispatch(request, { kind: 'owner' })
  assert.equal(result.bot.role, 'Verified reviewer'); assert.equal(result.revision, 8)
  assert.deepEqual(result.saved, ['role'])
  assert.equal(lifecycle.committedBot('a').role, 'Verified reviewer')
  assert.equal(source.calls.filter(call => call[0] === 'save').length, 1)
  assert.deepEqual(source.delivered, [])
  assert.equal(lifecycle.status().healthy, true)
})
