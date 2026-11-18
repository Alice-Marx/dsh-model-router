import assert from 'node:assert/strict'
import test from 'node:test'
import { compareRoutingRuns } from '../scripts/compare-routing-runs.mjs'

test('routing comparisons report matched cost and duration coverage', () => {
  const report = compareRoutingRuns([
    { taskId: 'review', baseline: { passed: true, durationMs: 400, actualApiUsd: 0.25 },
      routed: { passed: true, durationMs: 300, actualApiUsd: 0 } },
    { taskId: 'summarize', baseline: { passed: false, durationMs: 600, actualApiUsd: null },
      routed: { passed: true, durationMs: 500, actualApiUsd: 20 } },
  ])
  assert.deepEqual(report.passRate, { baseline: 0.5, routed: 1 })
  assert.deepEqual(report.medianDurationMs, { pairs: 2, baseline: 500, routed: 400 })
  assert.deepEqual(report.totalActualApiUsd, { pairs: 1, baseline: 0.25, routed: 0 })
})
