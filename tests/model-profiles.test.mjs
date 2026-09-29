import test from 'node:test'
import assert from 'node:assert/strict'
import { applyModelProfiles, parseModelProfilesJson } from '../.dsh-plugin/shared/model-profiles.mjs'

test('profile values attach only to an exact configured provider/model route', () => {
  const profiles = parseModelProfilesJson(JSON.stringify([
    { provider: 'vendor-a', model: 'cheap', quality: 72, pricing: { input: 0.12, output: 0.4 }, specialties: ['classification'], cliModel: 'cheap-v2' },
    { provider: 'vendor-a', model: 'missing', quality: 100 },
  ]))
  const routes = [
    { provider: 'vendor-a', model: 'cheap', name: 'Cheap' },
    { provider: 'vendor-b', model: 'cheap', name: 'Different provider' },
  ]
  const merged = applyModelProfiles(routes, profiles)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].quality, 0.72)
  assert.deepEqual(merged[0].pricing, { input: 0.12, output: 0.4, currency: 'USD' })
  assert.equal(merged[0].pricingSource, 'user')
  assert.equal(merged[0].qualitySource, 'user')
  assert.equal(merged[0].cliModel, 'cheap-v2')
  assert.equal(merged[1], routes[1])
  assert.equal(routes[0].pricing, undefined)
})

test('empty profile settings leave official routes untouched', () => {
  assert.deepEqual(parseModelProfilesJson(''), [])
  const routes = [{ provider: 'configured', model: 'only' }]
  assert.deepEqual(applyModelProfiles(routes, '[]'), routes)
})

test('profile parser rejects malformed prices, duplicates, currency and missing route IDs', () => {
  const invalid = [
    '{',
    '{}',
    '[{"provider":"a","model":"x","pricing":{"input":-1,"output":1}}]',
    '[{"provider":"a","model":"x","pricing":{"input":1}}]',
    '[{"provider":"a","model":"x","pricing":{"input":1,"output":2,"currency":"CNY"}}]',
    '[{"provider":"a","model":"x","quality":101}]',
    '[{"provider":"a","quality":50}]',
    '[{"provider":"a","model":"x","quality":50},{"provider":"a","model":"x","quality":60}]',
  ]
  for (const source of invalid) assert.throws(() => parseModelProfilesJson(source), { name: 'Error' }, source)
})

test('profile settings do not accept executable or credential fields', () => {
  const source = JSON.stringify([{ provider: 'a', model: 'x', quality: 80, apiKey: 'secret', command: 'bad' }])
  assert.throws(() => parseModelProfilesJson(source), /不支持的字段/)
})
