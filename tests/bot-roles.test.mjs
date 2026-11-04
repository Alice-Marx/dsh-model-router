import test from 'node:test'
import assert from 'node:assert/strict'
import { BOT_ROLE_CATALOG, findRole, instantiateRole, listRoles } from '../packages/orchestration/src/bot-roles.mjs'

const code = expected => error => { assert.equal(error.code, expected, error.message); return true }
const ALL = ['managed-tasks', 'model-inference', 'mr-routing']

test('roles: the catalog is the eight reference jobs, each with a brief', () => {
  assert.equal(BOT_ROLE_CATALOG.length, 8)
  for (const role of listRoles()) {
    assert.match(role.id, /^[a-z][a-z0-9-]+$/)
    assert.ok(role.brief.length > 8, `${role.id} needs a real brief`)
  }
  assert.deepEqual(listRoles().map(role => role.id).sort(), [
    'account-health', 'bug-reproduction', 'chief-of-staff', 'expense-manager',
    'paid-media', 'product-performance', 'sales-outbound', 'talent-scout',
  ])
})

test('roles: an unknown or malformed id names what does exist', () => {
  assert.throws(() => findRole('ceo'), error => error.code === 'ROLE_NOT_FOUND' && /chief-of-staff/.test(error.message))
  assert.throws(() => findRole('Chief'), code('ROLE_ID_INVALID'))
})

test('roles: instantiating produces a Bot description, never a permission grab', () => {
  const created = instantiateRole({ roleId: 'bug-reproduction', allowedTools: ALL })
  assert.equal(created.roleId, 'bug-reproduction')
  assert.equal(created.name, 'Bug Reproduction')
  assert.ok(created.description.length > 8)
  assert.deepEqual(created.capabilities, ['managed-tasks', 'model-inference', 'mr-routing'])
  assert.deepEqual(created.officialTools, [])
})

test('roles: a role needing a capability the Host does not offer is refused, not trimmed', () => {
  assert.throws(() => instantiateRole({ roleId: 'chief-of-staff', allowedTools: ['model-inference'] }),
    error => error.code === 'ROLE_TOOL_UNAVAILABLE' && /managed-tasks/.test(error.message))
})

test('roles: a custom name is accepted, and a blank or control-character name is not', () => {
  assert.equal(instantiateRole({ roleId: 'talent-scout', botName: '猎头小王', allowedTools: ALL }).name, '猎头小王')
  assert.throws(() => instantiateRole({ roleId: 'talent-scout', botName: '  ', allowedTools: ALL }), code('ROLE_BOT_NAME_INVALID'))
  assert.throws(() => instantiateRole({ roleId: 'talent-scout', botName: 'a\u0001b', allowedTools: ALL }), code('ROLE_BOT_NAME_INVALID'))
})
