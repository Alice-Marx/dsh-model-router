import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runCli, runStudy } from '../scripts/adaptive-routing-study.mjs'

const A = 'synthetic-a-v1'
const B = 'synthetic-b-v1'

test('deterministic controlled study uses real boundaries and explicitly synthetic evidence', () => {
  const first = runStudy()
  assert.deepEqual(first, runStudy())
  assert.equal(first.evidenceLevel, 'controlled-synthetic-mechanics-not-real-quality-cost-validation')
  assert.equal(first.provenance.synthetic, true)
  assert.equal(first.provenance.realUserData, false)
  assert.equal(first.provenance.networkCalls, 0)
  assert.equal(first.provenance.paidModelCalls, 0)
  assert.ok(first.actualInterfaces.includes('buildPlan'))
  assert.ok(first.actualInterfaces.includes('createPlanFromRoutes'))
  assert.ok(first.actualInterfaces.includes('buildRunRecord'))
  assert.ok(Object.values(first.checks).every(value => value === true))
})

test('normal-use synthetic stream changes the next recommendation without filling unchosen outcomes', () => {
  const stream = runStudy().experiments.normalUseFeedbackStream
  assert.equal(stream.labelledCalls, 36)
  assert.equal(stream.start.selected.model, A)
  assert.equal(stream.steps[0].observed.model, A)
  assert.equal(stream.steps[0].observed.rating, -1)
  assert.equal(stream.steps[1].beforeFeedback.selected.model, B)
  assert.equal(stream.final.selected.model, B)
  assert.deepEqual(stream.selectedCounts, { [A]: 1, [B]: 35 })
  assert.equal(stream.final.feedbackCount, 36)
  assert.ok(stream.final.subjectiveUtilityAdjustment > 0)
  assert.equal(stream.start.publicQuality, stream.final.publicQuality)
  for (const step of stream.steps) {
    assert.equal(step.observed.model, step.beforeFeedback.selected.model)
    assert.equal(step.unselectedModelOutcomes, null)
    assert.equal(step.beforeFeedback.publicQuality, 0.9)
  }
})

test('short half-life lets recent negatives defeat more numerous stale positives', () => {
  const drift = runStudy().experiments.recencyReversal
  assert.equal(drift.oldPositiveCount, 40)
  assert.equal(drift.recentNegativeCount, 4)
  assert.equal(drift.decayed.selected.model, B)
  assert.equal(drift.slowDecayControl.selected.model, A)
  assert.ok(drift.decayed.adjustments['synthetic-study\0synthetic-a-v1'].code < 0)
  assert.ok(drift.slowDecayControl.adjustments['synthetic-study\0synthetic-a-v1'].code > 0)
})

test('price and benchmark versions actually change the shared planner recommendation', () => {
  const { priceChange, benchmarkChange } = runStudy().experiments
  for (const experiment of [priceChange, benchmarkChange]) {
    assert.equal(experiment.before.selected.model, A)
    assert.equal(experiment.after.selected.model, B)
    assert.equal(experiment.before.feedbackCount, 0)
    assert.equal(experiment.after.feedbackCount, 0)
  }
  assert.notEqual(priceChange.before.dataVersions.pricing.revision, priceChange.after.dataVersions.pricing.revision)
  assert.notEqual(benchmarkChange.before.dataVersions.liveBench.revision, benchmarkChange.after.dataVersions.liveBench.revision)
  assert.equal(benchmarkChange.before.qualitySource, 'livebench')
  assert.equal(benchmarkChange.after.qualitySource, 'livebench')
  assert.ok(priceChange.before.estimatedCostUsd > 0)
  assert.ok(priceChange.after.estimatedCostUsd > 0)
})

test('many positive preferences do not bypass the objective proxy quality floor', () => {
  const floor = runStudy().experiments.objectiveFloorProtection
  assert.equal(floor.highPreferenceProfile.feedbackCount, 200)
  assert.ok(floor.highPreferenceProfile.adjustments['synthetic-study\0synthetic-a-v1'].code > 0.099)
  assert.equal(floor.candidatePublicQualities.find(candidate => candidate.model === A).quality, 0.65)
  assert.equal(floor.protectedPlan.selected.model, B)
  assert.ok(floor.protectedPlan.publicQuality >= floor.protectedPlan.qualityFloor)
})

test('clearing and resetting preferences leave synthetic recorded spending intact', () => {
  const check = runStudy().experiments.clearAndReset
  assert.equal(check.before.selected.model, B)
  assert.equal(check.clear.selected.model, A)
  assert.equal(check.reset.selected.model, A)
  assert.equal(check.clear.feedbackCount, 0)
  assert.equal(check.reset.feedbackCount, 0)
  assert.deepEqual(check.spendBefore, check.spendAfterClear)
  assert.deepEqual(check.spendBefore, check.spendAfterReset)
  assert.ok(check.spendBefore.month > 0)
})

test('CLI writes generated JSON to explicit output and rejects unrecognized arguments', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'adaptive-routing-study-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const output = path.join(directory, 'nested', 'study.json')
  const result = await runCli(['--out', output])
  assert.equal(result.output, output)
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), runStudy())
  await assert.rejects(() => runCli(['--unknown', output]), /Usage:/)
  await assert.rejects(() => runCli(['--out']), /Usage:/)
})
