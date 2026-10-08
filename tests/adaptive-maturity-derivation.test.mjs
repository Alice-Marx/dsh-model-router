import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFeedbackProfile } from '../.dsh-plugin/shared/adaptive-feedback.mjs'

const at = Date.UTC(2026, 9, 8, 8, 5)
const day = 86_400_000
const runs = Array.from({ length: 9 }, (_, index) => ({ id: `synthetic-${index}`, packages: [{
  id: 'result', provider: 'synthetic', model: 'v1', type: 'code', ran: true, ok: true,
  rating: index % 3 === 0 ? -1 : 1, finishedAt: at - 1000 - index * day,
}] }))

test('fixed-evidence hourly bias drift satisfies the independently derived derivative bound', () => {
  for (const halfLifeDays of [1, 30, 3650]) for (const priorWeight of [1, 3, 1_000_000]) {
    for (const maxAdjustment of [0, 0.04, 0.1]) {
      const parameters = { halfLifeDays, priorWeight, maxAdjustment }
      const initial = buildFeedbackProfile(runs, { ...parameters, now: at })
      const bias = initial.adjustments['synthetic\0v1'].code
      for (const delta of [1, 60_000, 1_800_000, 3_599_000]) {
        const current = buildFeedbackProfile(runs, { ...parameters, now: at + delta })
        const bound = maxAdjustment * Math.log(2) * delta / (4 * halfLifeDays * day)
        assert.ok(Math.abs(current.adjustments['synthetic\0v1'].code - bias) <= bound + 1e-14)
        assert.equal(current.evidenceRevision, initial.evidenceRevision)
      }
    }
  }
})

test('common aging preserves concentration before underflow; finite diagnostics stay bounded', () => {
  const first = buildFeedbackProfile(runs, { now: at })
  const aged = buildFeedbackProfile(runs, { now: at + 30 * day })
  const before = first.cellStats['synthetic\0v1'].code
  const after = aged.cellStats['synthetic\0v1'].code
  assert.ok(Math.abs(after.effectiveSampleSize - before.effectiveSampleSize) < 1e-12)
  assert.ok(Math.abs(after.effectiveWeight - before.effectiveWeight / 2) < 1e-12)
  assert.ok(after.shrinkage < before.shrinkage)
  assert.ok(Math.abs(after.adjustment) < Math.abs(before.adjustment))

  const pair = (ageDays, spacingMs) => [0, 1].map(index => ({ id: `pair-${index}`, packages: [{
    id: 'result', provider: 'synthetic', model: 'v1', type: 'code', ran: true, ok: true, rating: 1,
    finishedAt: at - ageDays * day - index * spacingMs,
  }] }))
  const almostEqual = buildFeedbackProfile(pair(0, 2), { now: at }).cellStats['synthetic\0v1'].code
  assert.ok(almostEqual.effectiveSampleSize >= 0 && almostEqual.effectiveSampleSize <= 2)
  const ancient = pair(1073, day)
  const initialTiny = buildFeedbackProfile(ancient, { now: at, halfLifeDays: 1 }).cellStats['synthetic\0v1'].code
  const oneUnderflow = buildFeedbackProfile(ancient, { now: at + day, halfLifeDays: 1 }).cellStats['synthetic\0v1'].code
  const allUnderflow = buildFeedbackProfile(ancient, { now: at + 2 * day, halfLifeDays: 1 }).cellStats['synthetic\0v1'].code
  assert.ok(Math.abs(initialTiny.effectiveSampleSize - 1.8) < 1e-12)
  assert.equal(oneUnderflow.effectiveSampleSize, 1)
  assert.equal(allUnderflow.effectiveSampleSize, 0)
  assert.equal(allUnderflow.effectiveWeight, 0)
  assert.equal(allUnderflow.adjustment, 0)
})
