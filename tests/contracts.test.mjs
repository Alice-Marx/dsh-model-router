import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile, cp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {assertSchema, validate, ContractError} from '../contracts/validate.mjs'

// The contract package exists so a message shape cannot drift between the side
// that writes it and the side that reads it. These tests pin the validator's
// honesty and the immutability of a published version.

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

test('contracts: a schema keyword this validator does not implement is an error', () => {
  // Silently ignoring an unknown keyword would make a typo a no-op.
  assert.throws(() => assertSchema({type: 'object', if: {}}, '#'), /unsupported schema keyword "if"/)
  assert.throws(() => assertSchema({type: 'object', properties: {a: {type: 'strng'}}}, '#'), /unknown type "strng"/)
})

test('contracts: validation names the exact path that broke', () => {
  const schema = {
    type: 'object', required: ['id'], additionalProperties: false,
    properties: {id: {type: 'string', pattern: '^[a-z]+$'}, list: {type: 'array', items: {type: 'integer'}}},
  }
  assert.doesNotThrow(() => validate(schema, {id: 'abc', list: [1, 2]}))
  assert.throws(() => validate(schema, {id: 'ABC'}), (error) => error instanceof ContractError && error.path === '$.id')
  assert.throws(() => validate(schema, {id: 'abc', list: [1, 'x']}), (error) => error.path === '$.list[1]')
  assert.throws(() => validate(schema, {id: 'abc', extra: 1}), (error) => /\$\$?.*unexpected key/.test(error.message) || /unexpected key "extra"/.test(error.message))
  assert.throws(() => validate(schema, {list: []}), (error) => /missing required key "id"/.test(error.message))
})

test('contracts: every committed fixture passes its own schema', async () => {
  const dirs = ['task-request/v1', 'task-event/v1', 'product-action/v1']
  for (const id of dirs) {
    const base = join(root, 'contracts', ...id.split('/'))
    const schema = JSON.parse(await readFile(join(base, 'schema.json'), 'utf8'))
    const {readdir} = await import('node:fs/promises')
    const fixtures = (await readdir(join(base, 'fixtures'))).sort()
    assert.ok(fixtures.length, `${id} must ship fixtures`)
    for (const name of fixtures) {
      const value = JSON.parse(await readFile(join(base, 'fixtures', name), 'utf8'))
      assert.doesNotThrow(() => validate(schema, value), `${id}/${name} must validate`)
    }
  }
})

test('contracts: check:contracts ships as a release gate beside check:client', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['check:contracts'], 'node scripts/check-contracts.mjs')
  const plan = JSON.parse(await readFile(join(root, 'scripts/test-plan.json'), 'utf8'))
  const runs = plan.stages.some((stage) => stage.includes('scripts/check-contracts.mjs'))
  assert.ok(runs, 'the test plan must run check:contracts, or the gate only exists in a script name')
})

test('contracts: a changed fixture or schema is refused, and the message says which', async () => {
  const work = await mkdtemp(join(tmpdir(), 'contracts-'))
  try {
    await cp(join(root, 'contracts'), join(work, 'contracts'), {recursive: true})
    await cp(join(root, 'scripts', 'check-contracts.mjs'), join(work, 'scripts', 'check-contracts.mjs'))
    await cp(join(root, 'packages', 'orchestration', 'src', 'product-composition.mjs'), join(work, 'packages', 'orchestration', 'src', 'product-composition.mjs'))
    await cp(join(root, 'contracts', 'product-action', 'v1', 'actions.json'), join(work, 'contracts', 'product-action', 'v1', 'actions.json'))

    const run = () => spawnSync(process.execPath, [join(work, 'scripts', 'check-contracts.mjs')], {encoding: 'utf8', cwd: work})
    assert.equal(run().status, 0, 'the untouched copy passes')

    // A fixture that no longer matches its schema fails with its own coordinate.
    const fixture = join(work, 'contracts', 'task-request', 'v1', 'fixtures', 'retry.json')
    // Restore by exact bytes: re-serialising can differ by one space, and then the
    // next step would report two changed files instead of the one it changed.
    const originalBytes = await readFile(fixture)
    const value = JSON.parse(originalBytes.toString('utf8'))
    await writeFile(fixture, JSON.stringify({...value, kind: 'nonsense'}, null, 2) + '\n')
    const broken = run()
    assert.notEqual(broken.status, 0)
    assert.match(broken.stderr, /task-request\/v1.*published and must not change|task-request\/v1\.fixtures\.\d/)
    await writeFile(fixture, originalBytes)

    // A schema byte change is not a fixture problem: it is a version problem.
    const schema = join(work, 'contracts', 'task-request', 'v1', 'schema.json')
    await writeFile(schema, (await readFile(schema, 'utf8')).replace('"kind"', '"kind" '))
    const drifted = run()
    assert.notEqual(drifted.status, 0)
    assert.match(drifted.stderr, /task-request\/v1 is published and must not change \(schema\.json\)\. Add task-request\/v2/)
  } finally {
    await rm(work, {recursive: true, force: true})
  }
})

test('contracts: a version that gains a field is a new version, not an edit', async () => {
  // v2 exists because `initiator` was added; v1 must still be byte-identical to
  // its lock, which is the whole reason a published version is immutable.
  const v1Lock = JSON.parse(await readFile(join(root, 'contracts/task-request/v1/LOCK.json'), 'utf8'))
  const v2Lock = JSON.parse(await readFile(join(root, 'contracts/task-request/v2/LOCK.json'), 'utf8'))
  assert.notEqual(v1Lock.digest, v2Lock.digest)
  const v1 = JSON.parse(await readFile(join(root, 'contracts/task-request/v1/schema.json'), 'utf8'))
  const v2 = JSON.parse(await readFile(join(root, 'contracts/task-request/v2/schema.json'), 'utf8'))
  assert.equal(Object.hasOwn(v1.properties, 'initiator'), false, 'v1 never learns the new field')
  assert.equal(Object.hasOwn(v2.properties, 'initiator'), true)
})

test('contracts: the initiator kinds in the schema are the ones the contract enforces', async () => {
  const {INITIATOR_KINDS} = await import('../packages/orchestration/src/task-contract.mjs')
  const v2 = JSON.parse(await readFile(join(root, 'contracts/task-request/v2/schema.json'), 'utf8'))
  assert.deepEqual([...INITIATOR_KINDS].sort(), [...v2.properties.initiator.properties.kind.enum].sort())
})

test('contracts: every task action the panels dispatch has a declared payload shape', async () => {
  const schema = JSON.parse(await readFile(join(root, 'contracts/task-action-payload/v1/schema.json'), 'utf8'))
  const declared = new Map(schema.oneOf.map((branch) => [branch.properties.action.const, branch]))
  for (const action of ['task.inspect', 'task.cancel', 'task.retry', 'task.reconcile', 'task.plan.cancel']) {
    assert.ok(declared.has(action), `${action} must declare its payload shape`)
  }
  // The shape is closed: an undeclared key is refused, which is what makes the
  // handler-read check in check-contracts mean something.
  const cancel = declared.get('task.cancel')
  assert.throws(() => validate(cancel, {action: 'task.cancel', botId: 'main', taskId: 't', surprise: 1}), /unexpected key "surprise"/)
  assert.doesNotThrow(() => validate(cancel, {action: 'task.cancel', botId: 'main', taskId: 't'}))
})

test('contracts: the shapes match the payloads the panels actually send', async () => {
  const schema = JSON.parse(await readFile(join(root, 'contracts/task-action-payload/v1/schema.json'), 'utf8'))
  const declared = new Map(schema.oneOf.map((branch) => [branch.properties.action.const, branch]))
  // tasks-panel sends {botId, taskId} for cancel and adds requestKey for the two
  // actions that need idempotency; task.plan.cancel sends {botId, planId}.
  assert.doesNotThrow(() => validate(declared.get('task.cancel'), {action: 'task.cancel', botId: 'main', taskId: 't'}))
  assert.doesNotThrow(() => validate(declared.get('task.retry'), {action: 'task.retry', botId: 'main', taskId: 't', requestKey: 'k'}))
  assert.doesNotThrow(() => validate(declared.get('task.plan.cancel'), {action: 'task.plan.cancel', botId: 'main', planId: 'p'}))
})

test('contracts: no producer emits an origin or initiator kind the contract rejects', async () => {
  // The class of bug that made every handoff fail: another module emitting a
  // value the contract's set does not accept. Tests are skipped because a
  // negative fixture deliberately emits an invalid value.
  const {readdir} = await import('node:fs/promises')
  const contract = await readFile(join(root, 'packages/orchestration/src/task-contract.mjs'), 'utf8')
  const setOf = (name) => new Set([...contract.match(new RegExp(`${name} = new Set\\(\\[([^\\]]+)\\]`))?.[1]?.matchAll(/'([a-z-]+)'/g) ?? []].map((m) => m[1]))
  const origins = setOf('ORIGIN_KINDS'), initiators = setOf('INITIATOR_KINDS')
  const offenders = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      if (['node_modules', 'dist', 'build', '.git', 'tmp', 'test-artifacts'].includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { await walk(full); continue }
      if (!/\.(mjs|js|jsx)$/.test(entry.name)) continue
      const rel = full.slice(root.length).replace(/\\/g, '/')
      if (rel.startsWith('tests/')) continue
      const text = await readFile(full, 'utf8')
      for (const match of text.matchAll(/origin\s*:\s*\{\s*kind\s*:\s*'([a-z-]+)'/g)) if (!origins.has(match[1])) offenders.push(`${rel}: origin '${match[1]}'`)
      for (const match of text.matchAll(/initiator\s*:\s*\{\s*kind\s*:\s*'([a-z-]+)'/g)) if (!initiators.has(match[1])) offenders.push(`${rel}: initiator '${match[1]}'`)
    }
  }
  await walk(root)
  assert.deepEqual(offenders, [], `a producer emits a kind the contract rejects: ${offenders.join(', ')}`)
})
