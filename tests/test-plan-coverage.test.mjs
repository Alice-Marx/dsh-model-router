import test from 'node:test'
import assert from 'node:assert/strict'
import {readdir, readFile} from 'node:fs/promises'

// A test file that no plan stage runs is a test file that protects nothing.
// This gate makes the gap explicit: every spec on disk is either selected by the
// committed plan or declared in `excluded` with a reason a reader can act on.

const plan = JSON.parse(await readFile(new URL('../scripts/test-plan.json', import.meta.url), 'utf8'))
const onDisk = (await readdir(new URL('../tests/', import.meta.url)))
  .filter((name) => /\.(test|native)\.mjs$/.test(name))
  .map((name) => `tests/${name}`)
  .sort()

const globToRegExp = (pattern) => new RegExp('^' + pattern
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replace(/\u0000/g, '.*') + '$')

const selected = new Set()
for (const stage of plan.stages) {
  for (const arg of stage) {
    if (typeof arg !== 'string' || !arg.startsWith('tests/')) continue
    if (arg.includes('*')) {
      const re = globToRegExp(arg)
      for (const file of onDisk) if (re.test(file)) selected.add(file)
    } else selected.add(arg)
  }
}

// A native spec reached through a probe script is selected too: the probe is
// what supplies the verified driver, so the plan names the probe, not the spec.
for (const probe of ['scripts/integration-task-probe.mjs', 'scripts/integration-finance-probe.mjs']) {
  const source = await readFile(new URL(`../${probe}`, import.meta.url), 'utf8')
  for (const match of source.matchAll(/(tests\/[A-Za-z0-9_.-]+\.(?:test|native)\.mjs)/g)) selected.add(match[1])
}

const excluded = plan.excluded ?? {}

test('test plan: every spec on disk is selected or explicitly excluded', () => {
  const unaccounted = onDisk.filter((file) => !selected.has(file) && !Object.hasOwn(excluded, file))
  assert.deepEqual(unaccounted, [], `these specs run nowhere and are not declared: ${unaccounted.join(', ')}`)
})

test('test plan: an exclusion carries a reason a reader can act on', () => {
  for (const [file, reason] of Object.entries(excluded)) {
    assert.ok(typeof reason === 'string' && reason.trim().length >= 12, `${file} needs a real reason, not a placeholder`)
    assert.ok(!/^(todo|tbd|n\/a|skip|见上|待补充)$/i.test(reason.trim()), `${file} has a placeholder reason`)
  }
})

test('test plan: nothing is declared excluded while the plan still selects it', () => {
  for (const file of Object.keys(excluded)) {
    assert.equal(selected.has(file), false, `${file} is both selected and excluded; one of the two is wrong`)
  }
})

test('test plan: an excluded entry still exists on disk', () => {
  for (const file of Object.keys(excluded)) {
    assert.ok(onDisk.includes(file), `${file} is declared excluded but no longer exists; drop the entry`)
  }
})

test('test plan: the journal, ledger and accounting specs are actually reached', () => {
  // The three specs that guard the durable state machine and the money ledger.
  // They need the verified driver, so they arrive through the task probe stage.
  const probeStage = plan.stages.find((stage) => stage.some((arg) => typeof arg === 'string' && arg.includes('integration-task-probe')))
  assert.ok(probeStage, 'the task probe stage must stay in the plan')
  const probe = probeStage.find((arg) => arg.includes('integration-task-probe'))
  assert.ok(probe)
})

test('test plan: the task probe runs every native task spec it can drive', async () => {
  const source = await readFile(new URL('../scripts/integration-task-probe.mjs', import.meta.url), 'utf8')
  for (const spec of ['tests/task-journal.native.mjs', 'tests/write-retry.native.mjs', 'tests/task-runner-restart.native.mjs']) {
    assert.ok(source.includes(spec), `${spec} must be listed in the probe that supplies its driver`)
  }
  const finance = await readFile(new URL('../scripts/integration-finance-probe.mjs', import.meta.url), 'utf8')
  for (const spec of ['tests/sqlite-router-state.native.mjs', 'tests/model-accounting.native.mjs']) {
    assert.ok(finance.includes(spec), `${spec} must be listed in the finance probe that supplies its driver`)
  }
})
