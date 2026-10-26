import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { readProject, validateProject, validateEvidence, statusText } from '../scripts/integration-progress.mjs'

const project = await readProject()
const fixture = () => structuredClone(project)

test('integration: frozen plan, source inventory, dependency graph and evidence validate', async () => {
  const result = await validateProject(project)
  assert.equal(result.catalogs.requirements.size, 32)
  assert.equal(result.catalogs.features.size, 40)
  assert.equal(result.results.size, 63)
})

for (const [name, mutate, expected] of [
  ['scope removal', value => value.scope.requirements.pop(), /frozen scope/],
  ['duplicate scope id', value => { value.scope.features[1].id = 'F01' }, /duplicate id/],
  ['altered requirement title', value => { value.scope.requirements[0].title = 'Replace user intent' }, /differs from approved scope/],
  ['weakened acceptance', value => { value.scope.acceptance[0].criteria = 'No evidence needed' }, /criteria differ from approved scope/],
  ['removed acceptance mapping', value => { value.scope.requirements[0].acceptanceIds.pop() }, /mapping differs from approved scope/],
  ['unknown acceptance mapping', value => { value.scope.features[0].acceptanceIds = ['T99'] }, /unknown acceptance/],
  ['dependency cycle', value => { value.board.tasks[0].dependsOn = ['W03'] }, /dependency cycle/],
  ['missing dependency', value => { value.board.tasks[0].dependsOn = ['W99'] }, /Unknown task dependency/],
  ['completion without proof', value => { value.board.tasks[0].status = 'completed'; value.board.tasks[0].evidence = [] }, /completion needs evidence/],
  ['passing acceptance without proof', value => { value.board.acceptanceResults[0].status = 'passed' }, /passing needs evidence/],
  ['incomplete acceptance', value => {
    const task = value.board.tasks[0]
    task.status = 'completed'
    task.evidence = ['docs/integration/baseline.json']
    task.steps.forEach(step => { step.status = 'completed'; step.evidence = ['docs/integration/baseline.json'] })
  }, /acceptance incomplete/],
  ['temporary proof', value => { value.board.tasks[0].evidence = ['tmp/local-result.json'] }, /portable tracked path/],
  ['absolute proof', value => { value.board.tasks[0].evidence = ['C:/private/result.json'] }, /portable tracked path/],
  ['traversal proof', value => { value.board.tasks[0].evidence = ['docs/../../private.json'] }, /portable tracked path/],
  ['blocked without explanation', value => { value.board.tasks[0].status = 'blocked' }, /missing blocker/],
]) {
  test(`integration: reject ${name}`, async () => {
    const value = fixture()
    mutate(value)
    await assert.rejects(validateProject(value), expected)
  })
}

test('integration: a sibling junction cannot turn external evidence into project evidence', async t => {
  const parent = join(project.root, 'tmp/integration/progress-fixtures')
  await mkdir(parent, { recursive: true })
  const canonicalParent = await realpath(parent)
  const parentPart = relative(await realpath(project.root), canonicalParent)
  assert.ok(parentPart && parentPart !== '..' && !parentPart.startsWith(`..${sep}`) && !isAbsolute(parentPart))
  const home = await mkdtemp(join(parent, 'scope-'))
  // All recursive cleanup targets are real fixture directories under this known parent.
  t.after(async () => {
    const canonical = await realpath(home)
    const part = relative(canonicalParent, canonical)
    assert.ok(part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
    await rm(home, { recursive: true, force: true })
  })
  const inside = join(home, 'project')
  const outside = join(home, 'outside')
  await mkdir(join(inside, 'evidence'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(outside, 'result.json'), '{}')
  await symlink(outside, join(inside, 'evidence/link'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(validateEvidence(inside, ['evidence/link/result.json'], 'probe'), /escapes project/)
})

test('integration: progress distinguishes work completed from product acceptance', () => {
  const text = statusText(project.board, project.scope)
  assert.match(text, /Work packages completed: \d+\/20; product acceptance passed: \d+\/63/)
  assert.match(text, /do not imply product completion or release readiness/)
  assert.match(text, /M0 gates:/)
})
