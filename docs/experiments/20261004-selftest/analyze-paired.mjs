#!/usr/bin/env node
// Offline statistics only. Provenance, pairing, and prior freezing are declared.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pairedRoutingComparison } from '../../../scripts/routing-paired-statistics.mjs'

export const EXPERIMENT_SCOPE = 'first-stage-fixed-generation-model-choice-projection'
function fail(path, message) { throw new TypeError(`${path}: ${message}`) }
function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'must be a plain object')
}
function fields(value, allowed, required, path) {
  record(value, path)
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${path}.${name}`, 'unexpected field')
  for (const name of required) if (!Object.hasOwn(value, name)) fail(`${path}.${name}`, 'required field is missing')
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(path, 'must be a non-empty string without surrounding whitespace')
}
function number(value, path, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(path, `must be a finite number between ${minimum} and ${maximum}`)
}

export function analyzePaired(input, protocol) {
  const inputFields = ['schemaVersion', 'protocolId', 'stage', 'provenance', 'costBasis', 'choicesSha256', 'rows']
  fields(input, inputFields, inputFields.filter(name => name !== 'choicesSha256'), 'input')
  const protocolFields = ['schemaVersion', 'protocolId', 'status', 'experimentScope', 'comparisons', 'statistics']
  const protocolMetadataFields = ['dataset', 'maximumCollectionBudgetUsd', 'stopRules', 'actions',
    'generationAndFailurePolicy', 'gradingPolicy', 'costAccounting', 'split', 'oldCommit',
    'currentSourceManifest', 'baselineSelectionPolicy', 'pilotPlannedQuestions', 'formalPlannedQuestions', 'sampleSizeRationale',
    'missingDataPolicy', 'protocolFrozenAt', 'testOutcomeAccessBeforeFreeze']
  fields(protocol, [...protocolFields, ...protocolMetadataFields], protocolFields, 'protocol')
  if (input.schemaVersion !== 1 || protocol.schemaVersion !== 1) fail('schemaVersion', 'input and protocol must equal 1')
  text(input.protocolId, 'input.protocolId')
  text(protocol.protocolId, 'protocol.protocolId')
  if (input.protocolId !== protocol.protocolId) fail('input.protocolId', 'must match protocol.protocolId')
  if (!['pilot', 'test'].includes(input.stage)) fail('input.stage', 'must be pilot or test')
  if (!['recorded', 'synthetic'].includes(input.provenance)) fail('input.provenance', 'must be recorded or synthetic')
  if (!['invoiced', 'usage-priced', 'synthetic'].includes(input.costBasis)) fail('input.costBasis', 'must be invoiced, usage-priced, or synthetic')
  if ((input.provenance === 'synthetic') !== (input.costBasis === 'synthetic')) fail('input.costBasis', 'synthetic provenance requires synthetic costs; recorded provenance requires invoiced or usage-priced costs')
  if (!['draft', 'frozen'].includes(protocol.status)) fail('protocol.status', 'must be draft or frozen')
  if (protocol.experimentScope !== EXPERIMENT_SCOPE) fail('protocol.experimentScope', `must equal ${EXPERIMENT_SCOPE}`)
  const hash = input.choicesSha256
  if (hash !== undefined && hash !== null && (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash))) fail('input.choicesSha256', 'must be a 64-hex SHA-256 string when supplied')
  if (input.stage === 'test') {
    if (protocol.status !== 'frozen') fail('protocol.status', 'test analysis requires a frozen protocol')
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) fail('input.choicesSha256', 'test analysis requires a 64-hex choices SHA-256')
  }
  if (!Array.isArray(protocol.comparisons) || protocol.comparisons.length === 0) fail('protocol.comparisons', 'must be a non-empty complete comparison family')
  const comparisons = new Set()
  for (const [index, comparison] of protocol.comparisons.entries()) {
    const path = `protocol.comparisons[${index}]`
    fields(comparison, ['strategy', 'reference'], ['strategy', 'reference'], path)
    text(comparison.strategy, `${path}.strategy`)
    text(comparison.reference, `${path}.reference`)
    if (comparison.strategy === comparison.reference) fail(path, 'strategy and reference must differ')
    const key = JSON.stringify([comparison.strategy, comparison.reference])
    if (comparisons.has(key)) fail(path, 'duplicate comparison pairs are prohibited')
    comparisons.add(key)
  }
  const stats = protocol.statistics
  const statsFields = ['seed', 'resamples', 'alpha', 'nonInferiorityMargin']
  fields(stats, statsFields, statsFields, 'protocol.statistics')
  if (!Number.isSafeInteger(stats.seed) || stats.seed < 0 || stats.seed > 0xffffffff) fail('protocol.statistics.seed', 'must be an unsigned 32-bit integer')
  if (!Number.isSafeInteger(stats.resamples) || stats.resamples < 1 || stats.resamples > 1_000_000) fail('protocol.statistics.resamples', 'must be an integer between 1 and 1000000')
  number(stats.alpha, 'protocol.statistics.alpha', 0, 1)
  if (stats.alpha === 0 || stats.alpha === 1) fail('protocol.statistics.alpha', 'must be strictly between 0 and 1')
  number(stats.nonInferiorityMargin, 'protocol.statistics.nonInferiorityMargin', 0, 1)
  if (!Array.isArray(input.rows) || input.rows.length === 0) fail('input.rows', 'must be a non-empty array of paired question outcomes')
  for (const [index, row] of input.rows.entries()) {
    const path = `input.rows[${index}]`
    fields(row, ['id', 'groupId', 'domain', 'outcomes'], ['id', 'groupId', 'domain', 'outcomes'], path)
    for (const name of ['id', 'groupId', 'domain']) text(row[name], `${path}.${name}`)
    record(row.outcomes, `${path}.outcomes`)
    for (const [name, outcome] of Object.entries(row.outcomes)) {
      text(name, `${path}.outcomes key`)
      const outcomePath = `${path}.outcomes[${JSON.stringify(name)}]`
      fields(outcome, ['quality', 'correct', 'costUsd'], ['costUsd'], outcomePath)
      if (!Object.hasOwn(outcome, 'quality') && !Object.hasOwn(outcome, 'correct')) fail(outcomePath, 'must provide quality or correct')
      if (Object.hasOwn(outcome, 'quality')) number(outcome.quality, `${outcomePath}.quality`, 0, 1)
      if (Object.hasOwn(outcome, 'correct') && typeof outcome.correct !== 'boolean') fail(`${outcomePath}.correct`, 'must be boolean')
      if (Object.hasOwn(outcome, 'quality') && Object.hasOwn(outcome, 'correct') && outcome.quality !== Number(outcome.correct)) fail(outcomePath, 'conflicting quality and correct values')
      number(outcome.costUsd, `${outcomePath}.costUsd`, 0, Number.MAX_VALUE)
    }
  }
  const formalAnalysisPrerequisitesPresent = input.stage === 'test' && input.provenance === 'recorded' && protocol.status === 'frozen'
  const results = protocol.comparisons.map(comparison => {
    const result = pairedRoutingComparison(input.rows, { ...stats, ...comparison, claims: protocol.comparisons.length })
    return { ...result, formalAnalysisPrerequisitesPresent }
  })
  return { schemaVersion: 1, protocolId: input.protocolId, experimentScope: EXPERIMENT_SCOPE,
    stage: input.stage, protocolStatus: protocol.status, provenance: input.provenance,
    costBasis: input.costBasis, choicesSha256: hash ?? null, claims: protocol.comparisons.length,
    formalAnalysisPrerequisitesPresent, protocol: structuredClone(protocol), comparisons: results,
    costNotice: input.costBasis === 'usage-priced'
      ? 'Usage-priced costs are estimates from supplied usage and prices, not invoices; these statistics do not establish actual billed savings.'
      : input.costBasis === 'synthetic' ? 'Synthetic costs and outcomes test the tools only; no formal empirical benefit claim is permitted.'
        : 'Invoiced provenance is caller-supplied; this tool does not authenticate invoices or complete overhead accounting.',
    limitations: [
      'Caller-supplied provenance, protocol status, pairing, independent groups, blinded scoring, actual calls, and prior strategy freezing are not authenticated. formalAnalysisPrerequisitesPresent checks fields only, not evidence that raw data or preregistration is genuine.',
      'Additional protocol metadata is preserved but not certified or checked for completeness; a draft pilot may contain placeholders. Users must genuinely complete and freeze the full protocol before a formal test.',
      'choicesSha256 is checked for format only; this tool does not read a choices artifact, verify its bytes, or certify that strategies were chosen before test outcomes were examined.',
      'Pilot or synthetic analyses are diagnostic only, even when the numerical quality/cost rule passes. Usage-priced results support only the declared estimated-cost basis, not invoiced savings.',
      'All supplied outcomes require explicit finite non-negative costUsd; missing or unknown fees must be resolved before analysis, not replaced with zero. Follow the predeclared deployment-cost accounting, including applicable retries, failures, and routing overhead. Evaluation-only judging and matrix-collection spend belong in the separate research budget, not automatically in every strategy deployment cost.',
      'This scope compares fixed-generation first-work-package model choices on original-question records, not effort changes, output caps, multi-stage DAG execution, or final production answers.',
      'Bootstrap bounds are approximate; few groups, nonrepresentative domains, or dependent groups can invalidate an interpretation. Domain means are not paired question records.',
    ] }
}

const HELP = `Usage: node docs/experiments/20261004-selftest/analyze-paired.mjs <paired-input.json> <protocol.json>

Offline paired statistics; JSON output goes only to stdout. No model calls,
network requests, credential reads, or output-file writes are implemented.
Input: {schemaVersion:1,protocolId,stage:'pilot'|'test',
 provenance:'recorded'|'synthetic',costBasis:'invoiced'|'usage-priced'|'synthetic',
 choicesSha256,rows:[{id,groupId,domain,outcomes:{strategy:{quality,costUsd}}}]}.
quality is continuous [0,1]; boolean correct is the legacy alternative.
All outcomes need known finite non-negative costUsd; there is no zero default.
Protocol: {schemaVersion:1,protocolId,status:'draft'|'frozen',
 experimentScope:'${EXPERIMENT_SCOPE}',
 comparisons:[{strategy,reference}],statistics:{seed,resamples,alpha,nonInferiorityMargin}}.
Claims equal the full number of unique comparison pairs. seed is uint32,
resamples is 1..1000000, 0<alpha<1, and the quality margin is [0,1].
Test requires frozen status and a 64-hex choicesSha256. Pilot may omit the hash.
Synthetic provenance requires synthetic costs and is never formal evidence.
formalAnalysisPrerequisitesPresent checks declared fields only, not raw records.
The full protocol.template.json metadata is allowed and preserved; its content
and genuine prior freezing still require human review.
`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--help') process.stdout.write(HELP)
    else {
      if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) throw new TypeError('Required <paired-input.json> <protocol.json>; use --help')
      const values = await Promise.all(args.map(async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))))
      process.stdout.write(`${JSON.stringify(analyzePaired(...values), null, 2)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
