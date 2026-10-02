import test from 'node:test'
import assert from 'node:assert/strict'
import { parseModelProfilesJson } from '../.dsh-plugin/shared/model-profiles.mjs'
import { profileDraft, updateProfileJson } from '../.dsh-plugin/client/model-profile-editor-state.mjs'

const cheap = { provider: 'provider-a', model: 'cheap' }
const strong = { provider: 'provider-b', model: 'strong' }

test('per-model editor saves a 0-100 quality score and exact route price', () => {
  const json = updateProfileJson('[]', cheap, {
    quality: '82', input: '0.2', output: '0.8', cacheRead: '', cacheWrite: '',
    specialties: 'summarization, code', cliModel: 'cheap-v2',
  })
  const [profile] = parseModelProfilesJson(json)
  assert.equal(profile.quality, 0.82)
  assert.equal(profile.pricing.input, 0.2)
  assert.equal(profile.cliModel, 'cheap-v2')
  assert.deepEqual(profile.specialties, ['summarization', 'code'])
  assert.equal(profileDraft(profile).quality, '82')
})

test('editing one route keeps another profile quality and price unchanged', () => {
  const original = JSON.stringify([
    { ...cheap, quality: 75, pricing: { input: 0.1, output: 0.4 } },
    { ...strong, quality: 96, pricing: { input: 4, output: 18 } },
  ])
  const updated = updateProfileJson(original, cheap, {
    quality: '78', input: '0.11', output: '0.42', specialties: '', cliModel: '',
  })
  const profiles = parseModelProfilesJson(updated)
  assert.equal(profiles.find(item => item.model === 'cheap').quality, 0.78)
  assert.equal(profiles.find(item => item.model === 'strong').quality, 0.96)
  assert.equal(profiles.find(item => item.model === 'strong').pricing.output, 18)
})

test('editor can save an official-tool or API execution preference', () => {
  const json = updateProfileJson('[]', cheap, {
    quality: '', input: '', output: '', cacheRead: '', cacheWrite: '',
    specialties: '', cliModel: '', execution: 'api',
  })
  const [profile] = parseModelProfilesJson(json)
  assert.equal(profile.execution, 'api')
  assert.equal(profileDraft(profile).execution, 'api')
})

test('editor rejects partial prices and removes only the selected route', () => {
  assert.throws(() => updateProfileJson('[]', cheap,
    { quality: '', input: '0.1', output: '', specialties: '', cliModel: '' }), /同时填写/)
  const original = JSON.stringify([{ ...cheap, quality: 75 }, { ...strong, quality: 96 }])
  const updated = parseModelProfilesJson(updateProfileJson(original, cheap, null))
  assert.deepEqual(updated.map(item => item.model), ['strong'])
  assert.equal(updated[0].quality, 0.96)
})
