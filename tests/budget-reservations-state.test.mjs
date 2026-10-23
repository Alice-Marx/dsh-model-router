import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { createBudgetReservations, reservationSpending } from '../.dsh-plugin/shared/budget-reservations.mjs'
import { spending } from '../.dsh-plugin/shared/run-ledger.mjs'
import { beginExecutionLifecycle } from '../.dsh-plugin/shared/execution-lifecycle.mjs'

const AT = new Date(2026, 9, 23, 12).getTime()
const stateModule = new URL('../.dsh-plugin/shared/router-state.mjs', import.meta.url).href
const reservationsModule = new URL('../.dsh-plugin/shared/budget-reservations.mjs', import.meta.url).href
const run = (id, packages = ['a', 'b']) => ({ id, createdAt: AT, status: 'running',
  packages: packages.map(id => ({ id, status: 'pending', ran: false, costUsd: null })), reviews: [] })
const estimates = (a = 0.4, b = 0.4) => [{ id: 'a', estimatedCostUsd: a }, { id: 'b', estimatedCostUsd: b }]
const receipt = (id, costUsd) => ({ id, status: 'succeeded', ran: true, billing: 'api', costUsd, finishedAt: AT })

async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'router-holds-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'state.json')
  const state = createRouterState({ file, now: () => AT, ...extra })
  const reservations = createBudgetReservations({ state, now: () => AT })
  return { directory, file, state, reservations }
}

test('v1 history upgrades to v2 on first write without losing prior spending', async t => {
  const { file } = await fixture(t)
  const previous = { version: 1, runs: [{ ...run('legacy'), packages: [receipt('a', 0.3)] }],
    quota: { codex: { until: AT + 1000 } }, onboarding: { completedAt: AT } }
  await writeFile(file, JSON.stringify(previous))
  const state = createRouterState({ file, now: () => AT })
  assert.equal((await state.read()).version, 2)
  const manager = createBudgetReservations({ state, now: () => AT })
  assert.equal((await manager.beginExecution({ run: run('new'), packageEstimates: estimates(0.2, 0.2), dailyLimitUsd: 1 })).accepted, true)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.version, 2)
  assert.equal(saved.runs[0].id, 'legacy')
  assert.equal(spending(saved.runs, AT, saved.archivedSpending).today, 0.3)
  assert.deepEqual(saved.quota, previous.quota)
  assert.deepEqual(saved.onboarding, previous.onboarding)
  assert.ok(saved.budgetReservations.new)
})

test('an interrupted lifecycle preserves uncertainty when a started call has no receipt', async t => {
  const { state } = await fixture(t)
  const life = await beginExecutionLifecycle({ state, packageEstimates: [{ id: 'a', estimatedCostUsd: 0.4 }],
    buildRun: ({ status, results }) => ({ ...run('started', []), status, packages: results.map(item => ({
      ...item, status: 'failed', ran: !item.notStarted, costUsd: null, billing: 'api',
    })) }) })
  await life.onCheckpointStart({ id: 'a' })
  await life.interrupt(life.current('interrupted'))
  const saved = await state.read()
  assert.equal(saved.runs[0].packages[0].ran, true)
  assert.equal(saved.runs[0].packages[0].status, 'interrupted')
  assert.equal(saved.runs[0].packages[0].costSource, 'interrupted-usage-unknown')
  assert.equal(saved.runs[0].packages[0].costUsd, null)
  assert.equal(reservationSpending(saved).reservedUsd, 0.4)
})

test('begin atomically persists a run and estimates, another Host sees its hold', async t => {
  const { file, state, reservations } = await fixture(t)
  const first = await reservations.beginExecution({ run: run('first'), packageEstimates: estimates(), dailyLimitUsd: 1, ownerToken: 'owner-1' })
  assert.equal(first.accepted, true)
  assert.equal((await state.read()).runs[0].status, 'running')
  const otherState = createRouterState({ file })
  const other = createBudgetReservations({ state: otherState, now: () => AT })
  const refused = await other.beginExecution({ run: run('second'), packageEstimates: estimates(), dailyLimitUsd: 1, ownerToken: 'owner-2' })
  assert.equal(refused.accepted, false)
  assert.equal(refused.reason, 'budget')
  assert.equal(refused.spent.today, 0.8)
  assert.equal((await otherState.read()).runs.length, 1)
})

test('checkpoint replaces estimates with recorded spend without counting both', async t => {
  const { state, reservations } = await fixture(t)
  await reservations.beginExecution({ run: run('first'), packageEstimates: estimates(), ownerToken: 'owner' })
  const partial = run('first')
  partial.packages[0] = receipt('a', 0.3)
  await reservations.checkpointExecution({ reservationId: 'first', ownerToken: 'owner', run: partial, completedIds: ['a'], startedIds: ['b'] })
  let snapshot = await state.read()
  assert.equal(spending(snapshot.runs, AT).today, 0.3)
  assert.equal(reservationSpending(snapshot).reservedUsd, 0.4)
  assert.equal(snapshot.budgetReservations.first.packages[0].started, true)
  // Repeating the same checkpoint remains a replacement, with no archived cost.
  await reservations.checkpointExecution({ reservationId: 'first', ownerToken: 'owner', run: partial, completedIds: ['a'] })
  snapshot = await state.read()
  assert.equal(spending(snapshot.runs, AT, snapshot.archivedSpending).today, 0.3)
  const final = { ...partial, status: 'succeeded', packages: [receipt('a', 0.3), receipt('b', 0.2)] }
  await reservations.finishExecution({ reservationId: 'first', ownerToken: 'owner', run: final })
  snapshot = await state.read()
  assert.equal(snapshot.runs.length, 1)
  assert.equal(spending(snapshot.runs, AT, snapshot.archivedSpending).today, 0.5)
  assert.equal(reservationSpending(snapshot).reservedUsd, 0)
})

test('resize excludes its own previous hold but checks fresh recorded spend and other owners', async t => {
  const { state, reservations } = await fixture(t)
  await reservations.beginExecution({ run: run('first'), packageEstimates: estimates(0.2, 0.2), ownerToken: 'one' })
  await reservations.beginExecution({ run: run('second', ['c']), packageEstimates: [{ id: 'c', estimatedCostUsd: 0.3 }], ownerToken: 'two' })
  const resized = await reservations.resizeExecution({ reservationId: 'first', ownerToken: 'one', packageEstimates: estimates(0.3, 0.3), dailyLimitUsd: 1 })
  assert.equal(resized.accepted, true)
  assert.equal(resized.spent.today, 0.3)
  const before = await readFile(state.file, 'utf8')
  const denied = await reservations.resizeExecution({ reservationId: 'first', ownerToken: 'one', packageEstimates: estimates(0.4, 0.4), dailyLimitUsd: 1 })
  assert.equal(denied.accepted, false)
  assert.equal(await readFile(state.file, 'utf8'), before)
  assert.ok(Math.abs(reservationSpending(await state.read()).reservedUsd - 0.9) < 1e-12)
})

test('wrong owner cannot overwrite receipts or release someone else’s reservation', async t => {
  const { state, reservations } = await fixture(t)
  await reservations.beginExecution({ run: run('first'), packageEstimates: estimates(), ownerToken: 'actual-owner' })
  const before = await readFile(state.file, 'utf8')
  const wrong = { reservationId: 'first', ownerToken: 'old-owner', run: run('first'), completedIds: ['a'] }
  await assert.rejects(reservations.checkpointExecution(wrong), { code: 'ROUTER_RESERVATION_OWNERSHIP' })
  await assert.rejects(reservations.finishExecution(wrong), { code: 'ROUTER_RESERVATION_OWNERSHIP' })
  await assert.rejects(reservations.resizeExecution({ ...wrong, packageEstimates: [] }), { code: 'ROUTER_RESERVATION_OWNERSHIP' })
  assert.equal(await readFile(state.file, 'utf8'), before)
})

test('active holds cross day and month boundaries and do not expire on wall clock jumps', async t => {
  const { state, reservations } = await fixture(t)
  await reservations.beginExecution({ run: run('first'), packageEstimates: estimates(), ownerToken: 'owner' })
  const later = createBudgetReservations({ state, now: () => new Date(2027, 0, 1).getTime(), isProcessAlive: () => true })
  await later.recoverInterruptedExecutions()
  const result = await later.beginExecution({ run: run('next'), packageEstimates: estimates(0.2, 0.2), monthlyLimitUsd: 1, ownerToken: 'new' })
  assert.equal(result.accepted, false)
  assert.equal(result.budget.exceeded, 'monthly')
  assert.equal(result.spent.month, 0.8)
  const backwards = createBudgetReservations({ state, now: () => AT - 3_600_000, isProcessAlive: () => null })
  assert.equal((await backwards.recoverInterruptedExecutions()).recovered.length, 0)
  assert.equal((await state.read()).budgetReservations.first.status, 'active')
})

test('unknown estimates and unknown actual receipts are never converted to a known zero bill', async t => {
  const { state, reservations } = await fixture(t)
  await reservations.beginExecution({ run: run('unknown'), packageEstimates: estimates(null, 0.2), dailyLimitUsd: 1, ownerToken: 'owner', confirmOverBudget: true })
  let saved = await state.read()
  assert.equal(reservationSpending(saved).unknownReservations, 1)
  const partial = run('unknown')
  partial.packages[0] = receipt('a', null)
  await reservations.checkpointExecution({ reservationId: 'unknown', ownerToken: 'owner', run: partial, completedIds: ['a'] })
  saved = await state.read()
  assert.equal(spending(saved.runs, AT).unknownToday, 1)
  assert.equal(reservationSpending(saved).unknownReservations, 0)
  assert.equal(reservationSpending(saved).reservedUsd, 0.2)
})

test('unreconciled interrupted runs stay protected from retention and keep their estimate', async t => {
  const { file, state } = await fixture(t, { maxRuns: 1 })
  const reservations = createBudgetReservations({ state, now: () => AT, pid: 999999, isProcessAlive: () => false })
  await reservations.beginExecution({ run: run('held'), packageEstimates: estimates(), ownerToken: 'dead-owner' })
  const partial = run('held')
  partial.packages[0] = receipt('a', 0.25)
  await reservations.checkpointExecution({ reservationId: 'held', ownerToken: 'dead-owner', run: partial, completedIds: ['a'], startedIds: ['b'] })
  await reservations.recoverInterruptedExecutions()
  await state.appendRun({ ...run('old', []), packages: [receipt('old', 0.1)] })
  const reread = await createRouterState({ file, maxRuns: 1 }).read()
  assert.equal(reread.runs.length, 1)
  assert.equal(reread.runs[0].id, 'held')
  assert.equal(reread.runs[0].status, 'interrupted')
  assert.deepEqual(reread.runs[0].interruption.startedPackageIds, ['b'])
  assert.equal(spending(reread.runs, AT, reread.archivedSpending).today, 0.35)
  assert.equal(reservationSpending(reread).reservedUsd, 0.4)
  assert.equal(reservationSpending(reread).unknownReservations, 1)
  await assert.rejects(reservations.finishExecution({ reservationId: 'held', ownerToken: 'dead-owner', run: partial }), { code: 'ROUTER_RESERVATION_OWNERSHIP' })
})

test('many protected runs may exceed history retention but capacity refuses further work', async t => {
  const { file, state } = await fixture(t, { maxRuns: 1 })
  const reservations = createBudgetReservations({ state, now: () => AT, maxReservations: 2 })
  for (const id of ['first', 'second']) {
    assert.equal((await reservations.beginExecution({ run: run(id), packageEstimates: estimates(), ownerToken: id })).accepted, true)
  }
  assert.equal((await reservations.beginExecution({ run: run('third'), packageEstimates: estimates(), ownerToken: 'third' })).reason, 'reservation-capacity')
  const loaded = await createRouterState({ file, maxRuns: 1 }).read()
  assert.equal(loaded.runs.length, 2)
  assert.equal(Object.keys(loaded.budgetReservations).length, 2)
  assert.equal(loaded.historyIncomplete, false)
})

test('malformed or dangling reservations block approval rather than silently freeing budget', async t => {
  const { file, state, reservations } = await fixture(t)
  await reservations.beginExecution({ run: run('first'), packageEstimates: estimates(), ownerToken: 'owner' })
  const valid = await state.read()
  for (const changed of [
    { ...valid, budgetReservations: null },
    { ...valid, budgetReservations: { first: { ...valid.budgetReservations.first, packages: [{ id: 'a', estimatedCostUsd: -1, started: false }] } } },
    { ...valid, runs: [] },
  ]) {
    await writeFile(file, JSON.stringify(changed))
    const fresh = createRouterState({ file })
    const manager = createBudgetReservations({ state: fresh, now: () => AT })
    assert.equal((await fresh.read()).historyIncomplete, true)
    const result = await manager.beginExecution({ run: run('next'), packageEstimates: estimates(), ownerToken: 'next', confirmOverBudget: true })
    assert.equal(result.accepted, false)
    assert.equal(result.reason, 'history-incomplete')
  }
})

test('resizing cannot drop an in-flight package before its receipt checkpoint', async t => {
  const { state, reservations } = await fixture(t)
  const initial = run('first')
  await reservations.beginExecution({ run: initial, packageEstimates: estimates(), ownerToken: 'owner' })
  await reservations.checkpointExecution({ reservationId: 'first', ownerToken: 'owner', run: initial, startedIds: ['a'] })
  await assert.rejects(reservations.resizeExecution({ reservationId: 'first', ownerToken: 'owner', packageEstimates: [{ id: 'b', estimatedCostUsd: 0.4 }] }), /必须先保存结果/u)
  assert.equal(reservationSpending(await state.read()).reservedUsd, 0.8)
})

test('limited budgets require explicit confirmation for unknown holds and recorded unknown bills', async t => {
  const { state, reservations } = await fixture(t)
  const unknown = await reservations.beginExecution({ run: run('unknown'), packageEstimates: estimates(null, 0.1), dailyLimitUsd: 1, ownerToken: 'unknown' })
  assert.equal(unknown.accepted, false)
  assert.equal(unknown.reason, 'budget-unknown')
  assert.equal((await state.read()).runs.length, 0)
  await reservations.beginExecution({ run: run('unknown'), packageEstimates: estimates(null, 0.1), ownerToken: 'unknown' })
  const next = { run: run('next'), packageEstimates: estimates(0.1, 0.1), dailyLimitUsd: 1, ownerToken: 'next' }
  assert.equal((await reservations.beginExecution(next)).reason, 'budget-unknown')
  assert.equal((await reservations.beginExecution({ ...next, confirmOverBudget: true })).accepted, true)
  const final = { ...run('unknown'), status: 'cancelled', packages: [receipt('a', null)] }
  await reservations.finishExecution({ reservationId: 'unknown', ownerToken: 'unknown', run: final })
  const blocked = await reservations.resizeExecution({ reservationId: 'next', ownerToken: 'next', packageEstimates: estimates(0.1, 0.1), dailyLimitUsd: 1 })
  assert.equal(blocked.reason, 'budget-unknown')
  assert.equal(blocked.spent.unknownToday, 1)
})

test('checkpoint failure interruption saves available receipts and retains unverified hold', async t => {
  const { state, reservations } = await fixture(t)
  const initial = run('first')
  await reservations.beginExecution({ run: initial, packageEstimates: estimates(), ownerToken: 'owner' })
  await reservations.checkpointExecution({ reservationId: 'first', ownerToken: 'owner', run: initial, startedIds: ['a'] })
  const partial = { ...initial, packages: [receipt('a', 0.3), initial.packages[1]] }
  await reservations.interruptExecution({ reservationId: 'first', ownerToken: 'owner', run: partial })
  const saved = await state.read()
  assert.equal(saved.runs[0].packages[0].costUsd, 0.3)
  assert.equal(saved.runs[0].status, 'interrupted')
  assert.equal(saved.budgetReservations.first.status, 'interrupted')
  assert.equal(reservationSpending(saved).reservedUsd, 0.8)
  assert.equal(reservationSpending(saved).unknownReservations, 1)
  await assert.rejects(reservations.finishExecution({ reservationId: 'first', ownerToken: 'owner', run: partial }), { code: 'ROUTER_RESERVATION_OWNERSHIP' })
})

function childWorker(t, file, action) {
  const source = `
    import { createRouterState } from ${JSON.stringify(stateModule)};
    import { createBudgetReservations } from ${JSON.stringify(reservationsModule)};
    const state = createRouterState({file:process.env.TEST_STATE_FILE,now:()=>${AT}});
    const manager = createBudgetReservations({state,now:()=>${AT}});
    process.send({ready:true});
    process.once('message', async () => {
      try { ${action} }
      catch(error) { process.send({error:error.stack}); process.exitCode=1; process.disconnect(); }
    });
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, TEST_STATE_FILE: file }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text })
  child.on('error', () => {})
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  return { child, stderr: () => stderr }
}

test('two real processes cannot both reserve against the same remaining budget', { timeout: 15_000 }, async t => {
  const { file, state } = await fixture(t)
  const action = `
    const id='run-'+process.pid;
    const result=await manager.beginExecution({run:{id,createdAt:${AT},status:'running',packages:[{id:'a',ran:false,costUsd:null}],reviews:[]},packageEstimates:[{id:'a',estimatedCostUsd:0.6}],dailyLimitUsd:1,ownerToken:id});
    process.send({result});process.disconnect();
  `
  const workers = [childWorker(t, file, action), childWorker(t, file, action)]
  await Promise.all(workers.map(async ({ child }) => assert.equal((await once(child, 'message'))[0].ready, true)))
  const results = workers.map(({ child }) => once(child, 'message'))
  const exits = workers.map(({ child }) => once(child, 'exit'))
  for (const { child } of workers) child.send('go')
  const values = (await Promise.all(results)).map(([message]) => {
    assert.equal(message.error, undefined)
    return message.result
  })
  await Promise.all(exits)
  assert.equal(values.filter(value => value.accepted).length, 1)
  assert.equal(values.filter(value => value.reason === 'budget').length, 1)
  const snapshot = await state.read()
  assert.equal(snapshot.runs.length, 1)
  assert.equal(reservationSpending(snapshot).reservedUsd, 0.6)
})

test('a killed real process leaves completed receipts and unverified in-flight hold after recovery', { timeout: 15_000 }, async t => {
  const { file, state } = await fixture(t)
  const action = `
    const run={id:'crashed',createdAt:${AT},status:'running',packages:[{id:'a',ran:false,costUsd:null},{id:'b',ran:false,costUsd:null}],reviews:[]};
    await manager.beginExecution({run,packageEstimates:[{id:'a',estimatedCostUsd:0.4},{id:'b',estimatedCostUsd:0.4}],ownerToken:'crash-owner'});
    run.packages[0]={id:'a',status:'succeeded',ran:true,billing:'api',costUsd:0.2,finishedAt:${AT}};
    await manager.checkpointExecution({reservationId:'crashed',ownerToken:'crash-owner',run,completedIds:['a'],startedIds:['b']});
    process.send({saved:true});setInterval(()=>{},1000);
  `
  const { child } = childWorker(t, file, action)
  assert.equal((await once(child, 'message'))[0].ready, true)
  const saved = once(child, 'message')
  child.send('go')
  assert.equal((await saved)[0].saved, true)
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  const manager = createBudgetReservations({ state, now: () => AT + 1_000 })
  assert.equal((await manager.recoverInterruptedExecutions()).recovered.length, 1)
  const snapshot = await state.read()
  assert.equal(snapshot.runs[0].packages[0].costUsd, 0.2)
  assert.equal(snapshot.runs[0].status, 'interrupted')
  assert.equal(snapshot.runs[0].interruption.unreconciled, true)
  assert.equal(reservationSpending(snapshot).reservedUsd, 0.4)
  assert.equal(reservationSpending(snapshot).unknownReservations, 1)
  const denied = await manager.beginExecution({ run: run('next'), packageEstimates: estimates(0.3, 0.3), dailyLimitUsd: 1, ownerToken: 'next' })
  assert.equal(denied.accepted, false)
  assert.ok(Math.abs(denied.spent.today - 0.6) < 1e-12)
})
