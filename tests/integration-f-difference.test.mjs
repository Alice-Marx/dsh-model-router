import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  buildDifference, checkDifference, validateDocument, writeDifference,
} from '../scripts/integration-f-difference.mjs'

const execute = promisify(execFile)
const ROOT = resolve(import.meta.dirname, '..')
const GENERATED_AT = '2026-11-02T00:00:00.000Z'
const INPUTS = [
  'docs/integration/scope.json',
  'docs/integration/feature-inventory.json',
  'docs/integration/behavior-audit.json',
  'docs/integration/tasks.json',
  'docs/integration/baseline.json',
  'docs/integration/included-increments.json',
]

async function copy(root, path) {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(ROOT, path), target, { recursive: true })
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'integration-f-difference-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'docs/releases'), { recursive: true })
  for (const path of [
    ...INPUTS,
    'docs/integration/evidence',
    'modules/bot-runtime/SOURCE.json',
    'modules/bot-runtime/vendor',
    'scripts/integration-f-difference.mjs',
    'packages/orchestration/src',
    'packages/cli-runtime/src',
    'packages/capability-broker/src',
    'remote-computer-agent/src',
    'native/windows-desktop',
    'deploy/remote-agent',
  ]) await copy(root, path)
  const tasks = JSON.parse(await readFile(join(root, INPUTS[3]), 'utf8'))
  const evidencePaths = new Set(tasks.acceptanceResults.flatMap(result => result.evidence))
  for (const path of evidencePaths) await copy(root, path)
  const inventory = JSON.parse(await readFile(join(root, INPUTS[1]), 'utf8'))
  for (const feature of inventory.features) {
    for (const source of feature.sources) {
      if (feature.repository === 'MR') await copy(root, source.path)
    }
  }
  const git = async (directory, args, { binary = false } = {}) => {
    if (args[0] === 'show') {
      return (await execute('git', ['-C', ROOT, ...args], {
        encoding: binary ? 'buffer' : 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      })).stdout
    }
    if (args[0] === 'hash-object') {
      const bytes = await readFile(join(directory, args.at(-1)))
      return `${createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}\n`
    }
    if (args[0] === 'diff') {
      return (await execute('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true })).stdout
    }
    throw new Error(`Unexpected git command ${args[0]}`)
  }
  return { root, git }
}

async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

async function writeJson(root, path, value) {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`)
}

test('F difference: complete and deterministic, with current T authority and separate historical snapshot', async () => {
  const options = { root: ROOT, generatedAt: GENERATED_AT }
  const first = await buildDifference(options)
  const second = await buildDifference(options)
  assert.deepEqual(first, second)
  assert.equal(first.markdown, second.markdown)
  assert.deepEqual(first.document.features.map(feature => feature.id),
    Array.from({ length: 40 }, (_value, index) => `F${String(index + 1).padStart(2, '0')}`))
  assert.ok(first.document.features.every(feature => feature.behaviorVerified === false))
  const tasks = await readJson(ROOT, INPUTS[3])
  const results = new Map(tasks.acceptanceResults.map(result => [result.id, result]))
  for (const feature of first.document.features) {
    for (const acceptance of feature.acceptance) {
      const current = results.get(acceptance.id)
      assert.equal(acceptance.status, current.status)
      assert.equal(acceptance.level, current.level ?? null)
      assert.equal(acceptance.verifiedOn, current.verifiedOn ?? null)
      assert.deepEqual(acceptance.evidence, current.evidence)
    }
    assert.ok(feature.historicalBehavior.every(entry => entry.historicalOnly && entry.snapshotOn === '2026-10-31'))
  }
  assert.equal(first.document.snapshots.behaviorAuditUpdatedOn, '2026-10-31')
  assert.equal(first.document.snapshots.tasksUpdatedOn, tasks.updatedOn)
  assert.equal(first.document.features.find(feature => feature.id === 'F40').frozenCommit, null)
  assert.deepEqual(first.document.includedIncrements.increments, [])
  assert.match(first.markdown, /当前台账为空；仅登记 MR\/DS genesis 完整 SHA/)
})

test('F difference: missing, duplicate, unknown mappings and bad schemas fail closed', async t => {
  const { root, git } = await fixture(t)
  const options = { root, git, generatedAt: GENERATED_AT }
  const scope = await readJson(root, INPUTS[0])
  scope.features[1] = scope.features[0]
  await writeJson(root, INPUTS[0], scope)
  await assert.rejects(buildDifference(options), /duplicate id F01/)

  scope.features[1] = { ...scope.features[0], id: 'F02' }
  scope.features.pop()
  await writeJson(root, INPUTS[0], scope)
  await assert.rejects(buildDifference(options), /exactly F01-F40/)

  const originalScope = await readJson(ROOT, INPUTS[0])
  originalScope.features[0].acceptanceIds = ['T99']
  await writeJson(root, INPUTS[0], originalScope)
  await assert.rejects(buildDifference(options), /acceptance mapping differs|unknown acceptance T99/)

  await writeJson(root, INPUTS[0], await readJson(ROOT, INPUTS[0]))
  const tasks = await readJson(root, INPUTS[3])
  tasks.acceptanceResults[0].status = 'mystery'
  await writeJson(root, INPUTS[3], tasks)
  await assert.rejects(buildDifference(options), /unknown status mystery/)

  const behavior = await readJson(root, INPUTS[2])
  behavior.schemaVersion = 2
  await writeJson(root, INPUTS[2], behavior)
  await assert.rejects(buildDifference(options), /unsupported schemaVersion/)
})

test('F difference: saved-time check detects source, input, generator and output schema changes', async t => {
  const { root, git } = await fixture(t)
  await writeDifference({ root, git, generatedAt: GENERATED_AT })
  await checkDifference({ root, git })
  const inventory = await readJson(root, INPUTS[1])
  const mrPath = inventory.features.find(feature => feature.repository === 'MR').sources[0].path
  const originalSource = await readFile(join(root, mrPath))
  await writeFile(join(root, mrPath), `${originalSource}\n// source drift\n`)
  await assert.rejects(checkDifference({ root, git }), /stale or malformed/)
  await writeFile(join(root, mrPath), originalSource)
  await checkDifference({ root, git })

  const tasksPath = join(root, INPUTS[3])
  const originalTasks = await readFile(tasksPath)
  const tasks = JSON.parse(originalTasks.toString('utf8'))
  tasks.acceptanceResults[0].notes = 'input drift'
  await writeJson(root, INPUTS[3], tasks)
  await assert.rejects(checkDifference({ root, git }), /stale or malformed/)
  await writeFile(tasksPath, originalTasks)

  const generatorPath = join(root, 'scripts/integration-f-difference.mjs')
  const generator = await readFile(generatorPath)
  await writeFile(generatorPath, `${generator}\n// generator drift\n`)
  await assert.rejects(checkDifference({ root, git }), /stale or malformed/)
  await writeFile(generatorPath, generator)
  await checkDifference({ root, git })

  const outputPath = join(root, 'docs/releases/0.26.0-preview.1-f-difference.json')
  const output = await readJson(root, 'docs/releases/0.26.0-preview.1-f-difference.json')
  output.schemaVersion = 2
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
  await assert.rejects(checkDifference({ root, git }), /unsupported schemaVersion/)

  const valid = await buildDifference({ root, git, generatedAt: GENERATED_AT })
  const duplicated = structuredClone(valid.document)
  duplicated.features[1] = duplicated.features[0]
  assert.throws(() => validateDocument(duplicated), /duplicate id F01/)
  const unknown = structuredClone(valid.document)
  unknown.features[0].acceptance[0].status = 'unknown'
  assert.throws(() => validateDocument(unknown), /unknown acceptance status/)
})
