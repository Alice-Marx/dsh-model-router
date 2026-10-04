#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { evaluateRouting } from './routing-evaluation.mjs'

const HELP = `Usage: node scripts/evaluate-routing.mjs <dataset.json>

Evaluate a complete, fixed-pool outcome matrix offline and print a JSON report.
No models are invoked, no credentials are read, and no router is trained.

Dataset:
  provenance: "synthetic" or "recorded"
  models: unique "provider/model" IDs
  validation: non-empty rows with id, domain, and results
  test: non-empty rows with id, domain, selected, results, and optional routingCostUsd
  results: one { correct: boolean, costUsd: finite non-negative number } per model

IDs must be unique across both splits. Test selections must come from an external
policy. Single-model baselines are chosen on validation only. The oracle uses
test hindsight and cannot be deployed. Synthetic results imply no real-world gains.

Options:
  -h, --help  Show this help
`

async function main(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    process.stdout.write(HELP)
    return
  }
  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new Error('Expected one dataset JSON path. Use --help for the schema.')
  }
  const source = await readFile(args[0], 'utf8')
  const dataset = JSON.parse(source.replace(/^\uFEFF/, ''))
  process.stdout.write(`${JSON.stringify(evaluateRouting(dataset), null, 2)}\n`)
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`Routing evaluation failed: ${error.message}\n`)
  process.exitCode = 1
})
