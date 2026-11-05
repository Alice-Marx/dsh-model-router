import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createDesktopSessionHost } from '../packages/orchestration/src/desktop-sessions.mjs'

function fixture(t, readOnly = false) {
  const authority = createAuthority(), subject = {}, requests = [], issues = []
  const tools = ['desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll']
  authority.register(subject, { botId: 'bot-a', tools: tools.map(name => `remote/${name}`), modelRoutes: [] })
  t.after(() => authority.dispose())
  const record = { id: 'machine-a', revision: 1, config: { endpoint: 'https://machine.example', secretRef: 'private-ref' } }
  const grant = { revision: 1, scope: { roots: ['project'], tools: readOnly ? ['desktop_screenshot'] : tools, mode: readOnly ? 'read-only' : 'workspace-write' } }
  const host = createDesktopSessionHost({ authority, machine: id => { assert.equal(id, record.id); return record },
    binding: (machine, bot) => { assert.equal(bot, 'bot-a'); return grant },
    issue: async (machine, bot, scope, identity) => { issues.push({ bot, scope, identity }); return 'private-grant-token' },
    request: async (config, path, token, body) => {
      requests.push({ path, token, body })
      if (path.endsWith('/close')) return { stopConfirmed: true }
      return { sessionId: 'session-a', token: 't'.repeat(43), expiresAt: Date.now() + 60000, path: '/desktop/v1/socket' }
    }, event: () => {},
  })
  return { host, subject, grant, requests, issues, authority }
}

test('desktop Host mints a session ticket using committed state, keeps grants private and renews the original task identity', async t => {
  const f = fixture(t)
  const ticket = await f.host.open(f.subject, { machineId: 'machine-a', rootId: 'project', mode: 'watch' }, { clientOrigin: 'https://owner.example' })
  assert.equal(ticket.websocketUrl, 'wss://machine.example/desktop/v1/socket')
  assert.equal(ticket.canControl, true)
  assert.equal(JSON.stringify(ticket).includes('private-grant-token'), false)
  assert.equal(JSON.stringify(ticket).includes('private-ref'), false)
  assert.equal(f.requests[0].body.origin, 'https://owner.example')
  await f.host.renew(f.subject, { sessionId: ticket.sessionId })
  assert.deepEqual(f.issues[1].identity, f.issues[0].identity)
  assert.deepEqual(await f.host.close(f.subject, { sessionId: ticket.sessionId }), { stopConfirmed: true })
})

test('desktop Host refuses caller-supplied endpoints and a revoked or insufficient machine scope', async t => {
  const f = fixture(t, true)
  const input = { machineId: 'machine-a', rootId: 'project', mode: 'watch' }
  await assert.rejects(f.host.open(f.subject, { ...input, endpoint: 'https://attacker.example' }), { code: 'INVALID_DESKTOP_REQUEST' })
  await assert.rejects(f.host.open(f.subject, { ...input, mode: 'control' }), { code: 'MACHINE_BOT_DENIED' })
  assert.equal(f.issues.length, 0)
  const ticket = await f.host.open(f.subject, input)
  assert.equal(ticket.canControl, false)
  f.grant.revision++
  await assert.rejects(f.host.renew(f.subject, { sessionId: ticket.sessionId }), { code: 'MACHINE_GRANT_CHANGED' })
  assert.equal(f.issues.length, 1)
})
