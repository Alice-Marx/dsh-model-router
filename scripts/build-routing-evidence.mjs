#!/usr/bin/env node
/** Offline evidence import. Provenance is caller attestation, not authentication. */
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRoutingEvidence, parseRoutingEvidenceJson } from '../.dsh-plugin/shared/routing-evidence.mjs'

const HELP = `Usage: node scripts/build-routing-evidence.mjs --input data.json --output evidence.json
  --min-samples N      Minimum matching observations (default: 8)
  --now TIMESTAMP     Explicit evaluation time in Unix milliseconds
  --allow-synthetic   Test fixtures only; production imports reject synthetic data
  --help              Show this help

Offline only: no model calls, network requests, or automatic history collection.
Input: {runs?: [...], observations?: [...], matrix?: {...}}.
Observations require id, groupId, text, type, provider, model, reasoningEffort
(empty string means unknown), channel, quality in [0,1], split:"train", timestamp,
and provenance:{kind:"objective",source:"unit-tests",reference:"audit/run-1"}.
Only explicit objective training observations are accepted. Held-out test,
validation, and calibration splits must never be supplied as training data.

Matrix format: {split:"train",tasks:[{id,groupId,text,type,timestamp,results:[
  {id?,action:{provider,model,reasoningEffort,channel},quality,provenance,synthetic?}
]}]}. Each result describes one measured, fixed action; uncalled actions remain
unknown. Task/result split, if present, must also be "train".

Output contains route aggregates and hashed lexical features, no task/answer
plaintext. Feature hashing is not an anonymity guarantee. Schema validation
does not authenticate declared provenance. Estimates are empirical and require
independent held-out evaluation before claiming quality or cost improvements.
`

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)

export function normalizeInput(input) {
  if (!object(input)) throw new Error('input must be an object')
  for (const key of ['runs', 'observations']) {
    if (own(input, key) && !Array.isArray(input[key])) throw new Error(`${key} must be an array`)
  }
  const observations = [...(input.observations ?? [])]
  if (own(input, 'matrix')) {
    const matrix = input.matrix
    if (!object(matrix) || matrix.split !== 'train' || !Array.isArray(matrix.tasks)) {
      throw new Error('matrix requires split:"train" and a tasks array')
    }
    for (const task of matrix.tasks) {
      if (!object(task) || typeof task.id !== 'string' || !task.id ||
          !Array.isArray(task.results) || (own(task, 'split') && task.split !== 'train')) {
        throw new Error('matrix task requires id, results, and a training split')
      }
      for (const [index, result] of task.results.entries()) {
        if (!object(result) || !object(result.action) ||
            (own(result, 'split') && result.split !== 'train')) {
          throw new Error('matrix result requires an explicit action and training split')
        }
        const action = result.action
        observations.push({
          id: result.id ?? `${task.id}:result-${index + 1}`,
          groupId: task.groupId, text: task.text, type: task.type,
          provider: action.provider, model: action.model,
          reasoningEffort: action.reasoningEffort, channel: action.channel,
          quality: result.quality, timestamp: task.timestamp, split: 'train',
          provenance: result.provenance,
          ...(own(result, 'synthetic') ? { synthetic: result.synthetic } : {}),
        })
      }
    }
  }
  if (observations.length > 10_000 || (input.runs?.length ?? 0) > 10_000) {
    throw new Error('input exceeds the 10000-record limit')
  }
  return { runs: input.runs ?? [], observations }
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { process.stdout.write(HELP); return }
  const options = { minSamples: 8, now: Date.now(), allowSynthetic: false }
  const names = new Map([['--input', 'input'], ['--output', 'output'], ['--min-samples', 'minSamples'], ['--now', 'now']])
  const seen = new Set()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (seen.has(arg)) throw new Error('duplicate command option')
    seen.add(arg)
    if (arg === '--allow-synthetic') { options.allowSynthetic = true; continue }
    const key = names.get(arg)
    if (!key || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error('unknown option or missing option value; use --help')
    }
    const value = argv[++index]
    options[key] = key === 'minSamples' || key === 'now' ? Number(value) : value
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required')
  const inputPath = resolve(options.input)
  const outputPath = resolve(options.output)
  const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value
  if (canonical(inputPath) === canonical(outputPath)) throw new Error('input and output paths must differ')
  const source = await readFile(inputPath, 'utf8')
  if (Buffer.byteLength(source, 'utf8') > 10_000_000) throw new Error('input exceeds the 10MB limit')
  let input
  try { input = JSON.parse(source) } catch { throw new Error('input must be valid JSON') }
  const normalized = normalizeInput(input)
  const evidence = buildRoutingEvidence({ ...normalized, ...options })
  if (evidence.qualitySamples.length !== normalized.observations.length) {
    throw new Error('one or more objective training observations were invalid, duplicated, held out, or synthetic without opt-in')
  }
  const artifact = JSON.stringify(evidence, null, 2) + '\n'
  parseRoutingEvidenceJson(artifact, { now: options.now, allowSynthetic: options.allowSynthetic })
  await mkdir(dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, artifact, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, outputPath)
  } finally {
    await rm(temporary, { force: true })
  }
  process.stdout.write(JSON.stringify({ output: outputPath, schemaVersion: evidence.schemaVersion,
    revision: evidence.revision, resourceGroups: evidence.resourceGroups.length,
    qualitySamples: evidence.qualitySamples.length }) + '\n')
  return evidence
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().catch(error => { process.stderr.write(`routing-evidence: ${error.message}\n`); process.exitCode = 1 })
}
