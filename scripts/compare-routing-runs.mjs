import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const numberOrNull = value => value === null || (Number.isFinite(value) && value >= 0)

function metrics(pairs, field, summarize) {
  // Compare the same tasks on both sides, even if one receipt lacks a measurement.
  const measured = pairs.filter(pair => pair.baseline[field] !== null && pair.routed[field] !== null)
  if (!measured.length) return { pairs: 0, baseline: null, routed: null }
  return { pairs: measured.length, baseline: summarize(measured.map(pair => pair.baseline[field])),
    routed: summarize(measured.map(pair => pair.routed[field])) }
}

const total = values => values.reduce((sum, value) => sum + value, 0)
function median(values) {
  const ordered = values.toSorted((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

/** Compare matched tasks graded against the same acceptance criteria. Quota stays in its own unit. */
export function compareRoutingRuns(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new TypeError('Provide at least one paired task')
  const ids = new Set()
  for (const pair of pairs) {
    const id = pair?.taskId
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new TypeError('Paired tasks need distinct taskId values')
    ids.add(id)
    for (const run of [pair.baseline, pair.routed]) {
      if (typeof run?.passed !== 'boolean' || !numberOrNull(run.durationMs) || !numberOrNull(run.actualApiUsd)) {
        throw new TypeError('Each run needs passed, durationMs and actualApiUsd. Use null for missing measurements.')
      }
    }
  }
  const accepted = side => pairs.filter(pair => pair[side].passed).length
  return {
    tasks: pairs.length,
    passed: { baseline: accepted('baseline'), routed: accepted('routed') },
    passRate: { baseline: accepted('baseline') / pairs.length, routed: accepted('routed') / pairs.length },
    medianDurationMs: metrics(pairs, 'durationMs', median),
    totalActualApiUsd: metrics(pairs, 'actualApiUsd', total),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2]
  if (!input) throw new Error('Usage: node scripts/compare-routing-runs.mjs <paired-results.json>')
  const pairs = JSON.parse(await readFile(resolve(input), 'utf8'))
  console.log(JSON.stringify(compareRoutingRuns(pairs), null, 2))
}
