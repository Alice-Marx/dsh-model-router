import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLiveBenchSnapshot, liveBenchRow, normalizeLiveBenchPayload } from '../.dsh-plugin/shared/livebench.mjs'
import { parseModelProfilesJson, applyModelProfiles } from '../.dsh-plugin/shared/model-profiles.mjs'
import { profileDraft, updateProfileJson } from '../.dsh-plugin/client/model-profile-editor-state.mjs'
import { buildPlan } from '../.dsh-plugin/shared/router.mjs'

const fetchJson = payload => async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(payload) })
const fromMirror = payload => fetchLiveBenchSnapshot({ endpoint: 'https://bench.example.com/data.json', fetchImpl: fetchJson(payload), strict: true })

test('dynamic mirror requires an explicit score scale; percent one is not perfect quality', async () => {
  const low = await fromMirror({ scoreScale: 100, models: [{ model: 'Exact-v1', overall: 1, scores: { code: 1 } }] })
  assert.equal(low.models.exactv1.overall, 0.01)
  assert.equal(low.models.exactv1.scores.code, 0.01)
  const high = await fromMirror({ scoreScale: 1, models: [{ model: 'Exact-v1', overall: 1 }] })
  assert.equal(high.models.exactv1.overall, 1)
  await assert.rejects(fromMirror({ models: [{ model: 'Exact-v1', overall: 90 }] }), /scoreScale/u)
})

test('invalid raw scores reject a whole dynamic mirror instead of clamping it to perfect quality', async () => {
  for (const score of [-1, 101, '90', null]) {
    await assert.rejects(fromMirror({ scoreScale: 100, models: [{ model: 'Exact-v1', overall: score }] }))
  }
  await assert.rejects(fromMirror({ scoreScale: 100, models: [
    { model: 'Good', overall: 90 }, { model: 'Bad', overall: 9999 },
  ] }))
  await assert.rejects(fromMirror({ scoreScale: 1, models: [{ model: 'Exact-v1', overall: 0.9, scores: { code: 2 } }] }))
})

test('normalization collisions fail closed; strict snapshots require the exact raw benchmark name', () => {
  assert.throws(() => normalizeLiveBenchPayload({ models: [{ model: 'a-b', overall: 0.8 }, { model: 'ab', overall: 0.9 }] }), /collide/u)
  const snapshot = { ...normalizeLiveBenchPayload({ models: [{ model: 'Model-v1-Max', overall: 0.9 }] }), exactModelMatch: true }
  assert.equal(liveBenchRow(snapshot, 'modelv1max'), null)
  assert.equal(liveBenchRow(snapshot, 'Model-v1-Max').overall, 0.9)
})

test('official percent scores are fixed-scale and agentic coding does not overwrite ordinary coding', async () => {
  const responses = new Map([
    ['https://livebench.ai', '<script src="/app.js"></script>'],
    ['https://livebench.ai/app.js', 'const versions=["2026-06-25"];'],
    ['https://livebench.ai/table_2026_06_25.csv', 'model,coding,agentic\nModel-v1,1,99\n'],
    ['https://livebench.ai/categories_2026_06_25.json', JSON.stringify({ Coding: ['coding'], 'Agentic Coding': ['agentic'] })],
  ])
  const fetchImpl = async url => ({ ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => {
    assert.ok(responses.has(url), url); return responses.get(url)
  } })
  const snapshot = await fetchLiveBenchSnapshot({ fetchImpl, strict: true })
  assert.equal(snapshot.models.modelv1.scores.code, 0.01)
  assert.equal(snapshot.models.modelv1.overallSource, 'derived')
})

test('exact benchmark mapping survives the editor and never changes the executable route identity', () => {
  const route = { provider: 'p', model: 'api-id' }
  const json = JSON.stringify([{ ...route, benchmarkModel: 'Display-v1-Max', quality: 85 }])
  const original = parseModelProfilesJson(json)[0]
  const edited = updateProfileJson(json, route, { ...profileDraft(original), quality: '86' })
  const [profile] = parseModelProfilesJson(edited)
  assert.equal(profile.benchmarkModel, 'Display-v1-Max')
  const [applied] = applyModelProfiles([route], [profile])
  assert.equal(applied.model, 'api-id')
  assert.equal(applied.benchmarkModel, 'Display-v1-Max')
  assert.throws(() => parseModelProfilesJson(JSON.stringify([{ ...route, benchmarkModel: '\u0000x' }])))
})

test('dynamic benchmark verification timestamp and version appear in the actual plan audit', () => {
  const snapshot = { ...normalizeLiveBenchPayload({ models: [{ model: 'Exact-v1', overall: 0.9 }] }),
    verifiedAt: 1791086400000, publishedAt: 1782345600000, version: '2026-06-25', exactModelMatch: true }
  delete snapshot.fetchedAt
  const plan = buildPlan({ text: '请写一行代码', available: [{ provider: 'p', model: 'Exact-v1' }], liveBench: snapshot })
  assert.equal(plan.candidates[0].qualitySource, 'livebench')
  assert.equal(plan.optimization.liveBench.source, 'livebench')
  assert.equal(plan.optimization.liveBench.models, 1)
  assert.equal(plan.optimization.liveBench.verifiedAt, snapshot.verifiedAt)
  assert.equal(plan.optimization.liveBench.version, snapshot.version)
})
