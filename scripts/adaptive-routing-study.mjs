#!/usr/bin/env node
/**
 * A deterministic, controlled synthetic check of the actual shared planner.
 * No network, paid model calls, real user data, or real provider prices enter
 * this study. Designed selection changes test mechanics, not real benefits.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlan } from '../.dsh-plugin/shared/router.mjs'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'
import { buildFeedbackProfile, applyFeedbackProfile } from '../.dsh-plugin/shared/adaptive-feedback.mjs'
import { normalizeLiveBenchPayload } from '../.dsh-plugin/shared/livebench.mjs'
import { buildRunRecord, spending } from '../.dsh-plugin/shared/run-ledger.mjs'

const DAY = 86_400_000
const FIXED_AT = Date.parse('2026-10-04T04:00:00.000Z')
const TASK = '请写一行代码返回数字 1。'
const A = 'synthetic-a-v1'
const B = 'synthetic-b-v1'
const PROVIDER = 'synthetic-study'
const POLICY = 'subjective-utility-v1'
const DEFAULT_OUTPUT = fileURLToPath(new URL('../docs/experiments/20261004-adaptive-routing/adaptive-study.json', import.meta.url))

function routes() {
  return [A, B].map(model => ({
    provider: PROVIDER, model, quality: 0.9, qualitySource: 'user', latency: 0.6, risk: 0.1,
    specialties: ['code'], pricing: { input: 1, output: 1 }, pricingSource: 'user',
    reasoningKnown: true, reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium',
    inputModalities: ['text'], execution: 'api',
  }))
}

const routeKey = model => `${PROVIDER}\0${model}`
const versionRecord = (pricing = 'synthetic-equal-price-v1', benchmark = null, modelProfile = 'synthetic-explicit-profile-v1') => ({
  pricing: { revision: pricing, source: 'controlled-synthetic-price-fixture', currency: 'USD', unit: 'million-tokens', checkedAt: FIXED_AT },
  liveBench: benchmark === null ? null : { revision: benchmark, source: 'controlled-synthetic-score-fixture', fetchedAt: FIXED_AT },
  modelProfile: { revision: modelProfile, source: 'controlled-explicit-model-quality-fixture' },
})

function snapshot(aQuality, bQuality, revision) {
  // A downloaded JSON snapshot has no undefined fields. Normalize to that
  // serialization boundary so import and CLI reports are byte-equivalent.
  return JSON.parse(JSON.stringify({ ...normalizeLiveBenchPayload([
    { model: A, overall: aQuality, scores: { code: aQuality } },
    { model: B, overall: bQuality, scores: { code: bQuality } },
  ], FIXED_AT, `synthetic-livebench-mock:${revision}`), exactModelMatch: true, revision }))
}

function planRecord(available, profile, { liveBench = null, dataVersions = versionRecord() } = {}) {
  const adjusted = applyFeedbackProfile(available, profile)
  const settings = { mode: 'single', liveBench, learning: profile, dataVersions }
  const projected = createPlanFromRoutes(TASK, adjusted, settings)
  const direct = buildPlan({ text: TASK, available: adjusted, ...settings })
  // Exercises both public boundaries, not a reimplemented selection formula.
  assert.deepEqual(projected.selected, direct.selected)
  assert.deepEqual(projected.costBreakdown, direct.costBreakdown)
  assert.equal(projected.subtasks.length, 1, 'Controlled task must remain one code node')
  assert.equal(projected.subtasks[0].type, 'code')
  const model = projected.selected?.model ?? null
  const selectedStage = projected.costBreakdown.find(row => row.model === model)
  return {
    plan: projected,
    observation: {
      selected: projected.selected,
      publicQuality: selectedStage?.quality ?? null,
      qualitySource: selectedStage?.qualitySource ?? null,
      qualityFloor: projected.subtasks[0].qualityFloor,
      estimatedCostUsd: projected.estimatedCost,
      subjectiveUtilityAdjustment: profile.adjustments[routeKey(model)]?.code ?? 0,
      adjustments: profile.adjustments,
      feedbackCount: profile.feedbackCount,
      effectiveWeight: profile.effectiveWeight,
      dataVersions: projected.optimization.dataVersions,
      personalization: projected.optimization.personalization,
    },
  }
}

/** Real run-ledger shape, with invented usage/result explicitly marked synthetic. */
function recordedSyntheticRun(id, at, model, rating, available, plan = null) {
  const actualPlan = plan ?? createPlanFromRoutes(TASK, available.filter(route => route.model === model), { mode: 'single' })
  assert.equal(actualPlan.selected.model, model)
  const usage = { inputTokens: 120, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const run = buildRunRecord({
    id, createdAt: at, finishedAt: at, task: TASK, plan: actualPlan,
    execution: { status: 'completed', packages: [{
      id: 'execution', ok: true, provider: PROVIDER, model,
      channel: 'harness-llm', answer: 'Controlled synthetic result; no model was called.', usage,
    }] },
    pricingFor: item => available.find(route => route.provider === item.provider && route.model === item.model)?.pricing ?? null,
  })
  run.provenance = 'controlled-synthetic-execution-and-usage'
  run.packages[0].rating = rating
  run.packages[0].ratedAt = at
  return run
}

export function runStudy() {
  const available = routes()
  const empty = buildFeedbackProfile([], { now: FIXED_AT })
  const start = planRecord(available, empty)
  assert.equal(start.observation.selected.model, A)
  const stream = []
  const steps = []
  // A deterministic invented user's labels: A is not useful, B is useful.
  // Only the model the real planner selected receives a recorded observation.
  for (let index = 0; index < 36; index += 1) {
    const at = FIXED_AT + index * 60_000
    const profile = buildFeedbackProfile(stream, { now: at })
    const planned = planRecord(available, profile)
    const model = planned.observation.selected.model
    const rating = model === A ? -1 : 1
    steps.push({ index: index + 1, at, beforeFeedback: planned.observation,
      observed: { provider: PROVIDER, model, rating, provenance: 'controlled-synthetic-human-label' },
      unselectedModelOutcomes: null })
    stream.push(recordedSyntheticRun(`stream-${String(index + 1).padStart(2, '0')}`, at, model, rating, available, planned.plan))
  }
  const finalAt = FIXED_AT + 36 * 60_000
  const finalProfile = buildFeedbackProfile(stream, { now: finalAt })
  const final = planRecord(available, finalProfile)
  assert.equal(finalProfile.feedbackCount, 36)
  assert.equal(steps[0].beforeFeedback.selected.model, A)
  assert.equal(steps[1].beforeFeedback.selected.model, B)
  assert.equal(final.observation.selected.model, B)
  assert.equal(start.observation.publicQuality, final.observation.publicQuality)

  const oldPositive = Array.from({ length: 40 }, (_, index) => recordedSyntheticRun(
    `drift-old-${index}`, finalAt - 180 * DAY + index * 1000, A, 1, available))
  const recentNegative = Array.from({ length: 4 }, (_, index) => recordedSyntheticRun(
    `drift-recent-${index}`, finalAt - 3_600_000 + index * 1000, A, -1, available))
  const driftHistory = [...oldPositive, ...recentNegative]
  const decayedProfile = buildFeedbackProfile(driftHistory, { now: finalAt, halfLifeDays: 30 })
  const slowDecayProfile = buildFeedbackProfile(driftHistory, { now: finalAt, halfLifeDays: 3650 })
  const decayed = planRecord(available, decayedProfile)
  const slowDecay = planRecord(available, slowDecayProfile)
  assert.ok(decayedProfile.adjustments[routeKey(A)].code < 0)
  assert.ok(slowDecayProfile.adjustments[routeKey(A)].code > 0)
  assert.equal(decayed.observation.selected.model, B)
  assert.equal(slowDecay.observation.selected.model, A)

  const pricesBefore = available.map(route => ({ ...route, pricing: route.model === A ? { input: 0.1, output: 0.1 } : { input: 2, output: 2 } }))
  const pricesAfter = available.map(route => ({ ...route, pricing: route.model === A ? { input: 5, output: 5 } : { input: 2, output: 2 } }))
  const priceBefore = planRecord(pricesBefore, empty, { dataVersions: versionRecord('synthetic-changing-price-v1') })
  const priceAfter = planRecord(pricesAfter, empty, { dataVersions: versionRecord('synthetic-changing-price-v2') })
  assert.equal(priceBefore.observation.selected.model, A)
  assert.equal(priceAfter.observation.selected.model, B)

  const scoresBefore = snapshot(0.96, 0.85, 'synthetic-score-v1')
  const scoresAfter = snapshot(0.85, 0.96, 'synthetic-score-v2')
  const benchmarkBefore = planRecord(available, empty, { liveBench: scoresBefore, dataVersions: versionRecord('synthetic-equal-price-v1', scoresBefore.revision) })
  const benchmarkAfter = planRecord(available, empty, { liveBench: scoresAfter, dataVersions: versionRecord('synthetic-equal-price-v1', scoresAfter.revision) })
  assert.equal(benchmarkBefore.observation.selected.model, A)
  assert.equal(benchmarkAfter.observation.selected.model, B)
  assert.equal(benchmarkBefore.observation.qualitySource, 'livebench')
  assert.equal(benchmarkAfter.observation.qualitySource, 'livebench')

  const floorRoutes = available.map(route => ({ ...route, quality: route.model === A ? 0.65 : 0.9 }))
  const positiveForLowQuality = Array.from({ length: 200 }, (_, index) => recordedSyntheticRun(
    `floor-${index}`, finalAt - 200_000 + index * 1000, A, 1, floorRoutes))
  const highPreference = buildFeedbackProfile(positiveForLowQuality, { now: finalAt, priorWeight: 1, maxAdjustment: 0.1 })
  const floorProtected = planRecord(floorRoutes, highPreference, { dataVersions: versionRecord('synthetic-equal-price-v1', null, 'synthetic-floor-profile-v1') })
  assert.ok(highPreference.adjustments[routeKey(A)].code > 0.099)
  assert.equal(floorProtected.observation.selected.model, B)
  assert.equal(floorProtected.plan.candidates.find(candidate => candidate.model === A).quality, 0.65)
  assert.ok(floorProtected.observation.publicQuality >= floorProtected.observation.qualityFloor)
  assert.equal(floorProtected.plan.optimization.constraintRelaxed, false)

  const clearedRuns = structuredClone(stream)
  for (const run of clearedRuns) for (const item of run.packages) { item.rating = null; item.ratedAt = finalAt }
  const clearedProfile = buildFeedbackProfile(clearedRuns, { now: finalAt })
  const resetProfile = buildFeedbackProfile(stream, { now: finalAt, resetAt: finalAt })
  const clearPlan = planRecord(available, clearedProfile)
  const resetPlan = planRecord(available, resetProfile)
  const spendBefore = spending(stream, finalAt)
  const spendCleared = spending(clearedRuns, finalAt)
  const spendReset = spending(stream, finalAt)
  assert.equal(clearedProfile.feedbackCount, 0)
  assert.equal(resetProfile.feedbackCount, 0)
  assert.equal(clearPlan.observation.selected.model, A)
  assert.equal(resetPlan.observation.selected.model, A)
  assert.deepEqual(spendBefore, spendCleared)
  assert.deepEqual(spendBefore, spendReset)
  assert.ok(spendBefore.month > 0)

  return {
    schemaVersion: 1,
    experimentId: 'controlled-adaptive-routing-v1',
    generatedAt: new Date(FIXED_AT).toISOString(),
    evidenceLevel: 'controlled-synthetic-mechanics-not-real-quality-cost-validation',
    provenance: { synthetic: true, realUserData: false, networkCalls: 0, paidModelCalls: 0,
      resultAndUsage: 'invented-but-valid-run-ledger-shape', prices: 'hypothetical-USD-per-million-not-official-pricing',
      benchmark: 'invented-LiveBench-shaped-scores-not-published-LiveBench-observations' },
    clocks: { startAt: FIXED_AT, finalAt, stepMs: 60_000 },
    actualInterfaces: ['buildPlan', 'createPlanFromRoutes', 'buildRunRecord', 'buildFeedbackProfile', 'applyFeedbackProfile', 'spending'],
    task: TASK,
    baseRoutes: available,
    policy: { version: POLICY, formula: 'B * sum(w_i*r_i) / (kappa + sum(w_i)); w_i=2^(-(now-completedAt_i)/halfLifeMs)',
      halfLifeDays: 30, priorWeight: 3, maxAdjustment: 0.04, domain: 'code',
      semantics: 'independent-subjective-utility-not-objective-quality-or-success-probability' },
    experiments: {
      normalUseFeedbackStream: { labelRule: 'synthetic-a-v1: -1; synthetic-b-v1: +1, only when selected',
        labelledCalls: 36, start: start.observation, steps, final: final.observation,
        selectedCounts: Object.fromEntries([A, B].map(model => [model, steps.filter(step => step.observed.model === model).length])),
        unselectedModelOutcomes: 'unknown; no counterfactual scores are imputed' },
      recencyReversal: { oldPositiveCount: 40, oldAgeDays: 180, recentNegativeCount: 4, recentAgeHours: 1,
        observedModel: A, defaultHalfLifeDays: 30, slowDecayControlDays: 3650,
        decayed: decayed.observation, slowDecayControl: slowDecay.observation,
        scope: 'controlled-history-drift-probe-not-an-unbiased-live-user-study' },
      priceChange: { beforePrices: pricesBefore.map(route => ({ model: route.model, pricing: route.pricing })),
        afterPrices: pricesAfter.map(route => ({ model: route.model, pricing: route.pricing })),
        before: priceBefore.observation, after: priceAfter.observation,
        scope: 'hypothetical-prices-and-predicted-token-costs-not-recorded-bills' },
      benchmarkChange: { beforeScores: scoresBefore, afterScores: scoresAfter,
        before: benchmarkBefore.observation, after: benchmarkAfter.observation,
        scope: 'exact-name-LiveBench-shaped-mock-not-real-published-score-changes' },
      objectiveFloorProtection: { labelledLowQualityResults: 200, highPreferenceProfile: highPreference,
        candidatePublicQualities: floorProtected.plan.candidates.map(candidate => ({ model: candidate.model, quality: candidate.quality, qualitySource: candidate.qualitySource })),
        protectedPlan: floorProtected.observation },
      clearAndReset: { before: final.observation, clear: clearPlan.observation, reset: resetPlan.observation,
        scope: 'pure-feedback-profile-and-ledger-spending-check-not-persistent-host-store-test',
        costBasis: 'synthetic-usage-times-hypothetical-price', spendBefore, spendAfterClear: spendCleared, spendAfterReset: spendReset },
    },
    checks: {
      feedbackChangesNextSelection: true, objectiveQualityNotRewritten: true, recencyCanReversePreference: true,
      priceChangeReplans: true, benchmarkChangeReplans: true, qualityFloorProtected: true,
      clearAndResetRestoreUnpersonalizedSelection: true, clearAndResetPreserveSpending: true,
      hostAndSharedPlannerProjectionAgree: true,
    },
    limitations: [
      'Selection transitions were deliberately induced by synthetic labels, prices and scores; they are not measured real-user benefits.',
      'Only chosen models receive feedback. Unselected outcomes remain unknown; no global optimum, unbiased risk, convergence or calibration is established.',
      'Preferences are isolated by exact provider/model/task type in one local DSH home, not by authenticated multi-user accounts.',
      'The latest-200-runs window and completion-time decay are bounded memory, not a permanent personalized model.',
      'A quality floor applies to uncalibrated objective score proxies, not a guaranteed real-answer quality floor.',
      'No provider-specific pricing refresh service, paid exploration, benchmark download or network failure behavior is tested here.',
    ],
  }
}

export async function runCli(args = process.argv.slice(2)) {
  let output = DEFAULT_OUTPUT
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new Error('Usage: node scripts/adaptive-routing-study.mjs [--out output.json]')
    output = path.resolve(args[1])
  }
  const report = runStudy()
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { output, experimentId: report.experimentId, labelledStreamCalls: 36, checks: report.checks,
    evidenceLevel: report.evidenceLevel, networkCalls: 0, paidModelCalls: 0 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1 })
}
