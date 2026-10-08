import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'

const gate = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'router-maturity-state-'))
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'state.json')
  return { directory, file, store: createRouterState({ file }) }
}

test('a rejected update cannot expose an uncommitted feedback or budget mutation', async t => {
  const { file, store } = await fixture(t)
  await store.appendRun({ id: 'kept', packages: [{ id: 'p', rating: null }] })
  await assert.rejects(store.update(state => {
    state.runs[0].packages[0].rating = 1
    state.runs.push({ id: 'uncommitted', packages: [] })
    throw new Error('Synthetic callback failure')
  }), /Synthetic callback failure/)
  const local = await store.read()
  assert.equal(local.runs.length, 1)
  assert.equal(local.runs[0].packages[0].rating, null)
  assert.deepEqual(local, await createRouterState({ file }).read())
  await store.appendRun({ id: 'after-failure', packages: [] })
  assert.equal((await store.read()).runs.length, 2)
})

test('returned state and caller-owned records cannot mutate committed reader cache', async t => {
  const { store } = await fixture(t)
  const run = { id: 'one', packages: [{ id: 'p', rating: null }] }
  const saved = await store.appendRun(run)
  saved.packages[0].rating = -1
  run.packages[0].rating = 1
  const observed = await store.read()
  assert.equal(observed.runs[0].packages[0].rating, null)
  observed.runs.push({ id: 'reader-edit', packages: [] })
  assert.equal((await store.read()).runs.length, 1)
})

test('a failed serialization rolls back state, releases the lock and leaves no temporary file', async t => {
  const { file, directory, store } = await fixture(t)
  await store.appendRun({ id: 'one', packages: [] })
  await assert.rejects(store.update(state => { state.runs[0].invalid = 1n }), /BigInt/)
  assert.equal((await store.read()).runs[0].invalid, undefined)
  assert.deepEqual((await readdir(directory)).sort(), ['state.json'])
  assert.equal(JSON.parse(await readFile(file, 'utf8')).runs[0].invalid, undefined)
})

test('waiting writer times out without deleting a live holder or losing its update', async t => {
  const { file, store } = await fixture(t)
  await store.appendRun({ id: 'before', packages: [] })
  const entered = gate()
  const release = gate()
  const holding = store.update(async state => {
    entered.resolve()
    await release.promise
    state.runs.push({ id: 'holder', packages: [] })
  })
  await entered.promise
  const owner = await readFile(`${file}.lock`, 'utf8')
  const waiting = createRouterState({ file, lockTimeoutMs: 25, lockStaleMs: 1,
    now: () => Date.now() + 100_000 })
  try {
    await assert.rejects(waiting.appendRun({ id: 'waiter', packages: [] }), { code: 'ROUTER_STATE_LOCK_TIMEOUT' })
    assert.equal(await readFile(`${file}.lock`, 'utf8'), owner)
  } finally { release.resolve(); await holding }
  await waiting.appendRun({ id: 'waiter-retried', packages: [] })
  assert.deepEqual((await store.read()).runs.map(run => run.id), ['before', 'holder', 'waiter-retried'])
})

test('a stale lock from an exited owner can be recovered, including the legacy format', async t => {
  const { file, store } = await fixture(t)
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  assert.equal(child.status, 0)
  const deadPid = Number(child.stdout)
  assert.ok(Number.isSafeInteger(deadPid) && deadPid > 0)
  for (const owner of [JSON.stringify({ pid: deadPid, token: 'exited-fixture' }), `${deadPid} 1\n`]) {
    await writeFile(`${file}.lock`, owner)
    const past = new Date(Date.now() - 100_000)
    await utimes(`${file}.lock`, past, past)
    await store.appendRun({ id: `recovered-${owner.length}`, packages: [] })
  }
  assert.equal((await store.read()).runs.length, 2)
})

test('unknown lock ownership fails closed and fixed wall-clock still has a bounded wait', async t => {
  const { file } = await fixture(t)
  await writeFile(`${file}.lock`, 'unknown-owner')
  const past = new Date(Date.now() - 100_000)
  await utimes(`${file}.lock`, past, past)
  const store = createRouterState({ file, lockTimeoutMs: 25, lockStaleMs: 1, now: () => 1 })
  await assert.rejects(store.appendRun({ id: 'blocked', packages: [] }), { code: 'ROUTER_STATE_LOCK_TIMEOUT' })
  assert.equal(await readFile(`${file}.lock`, 'utf8'), 'unknown-owner')
  assert.ok(!(await readdir(dirname(file))).includes('state.json'))
})

test('a releasing writer cannot remove a replacement ownership token', async t => {
  const { file, store } = await fixture(t)
  const replacement = JSON.stringify({ pid: process.pid, token: 'replacement-fixture' })
  await store.update(async state => {
    await writeFile(`${file}.lock`, replacement)
    state.runs.push({ id: 'committed', packages: [] })
  })
  assert.equal(await readFile(`${file}.lock`, 'utf8'), replacement)
  assert.equal((await store.read()).runs[0].id, 'committed')
})

test('corrupt recovery rereads under the lock and preserves a concurrently restored valid file', async t => {
  const { file, directory, store } = await fixture(t)
  const entered = gate()
  const release = gate()
  const restoring = store.update(async state => {
    await writeFile(file, '{broken synthetic state')
    entered.resolve()
    await release.promise
    state.runs.push({ id: 'restored', packages: [] })
  })
  await entered.promise
  const reader = createRouterState({ file })
  const reading = reader.read()
  // Wait until a reader outside the writer lock has had time to inspect the
  // corrupt file. It must leave those bytes untouched while waiting.
  await new Promise(accept => setTimeout(accept, 30))
  try { assert.equal(await readFile(file, 'utf8'), '{broken synthetic state') }
  finally { release.resolve(); await restoring }
  const recovered = await reading
  assert.equal(recovered.runs[0].id, 'restored')
  assert.equal(recovered.notices.length, 0)
  assert.deepEqual((await readdir(directory)).sort(), ['state.json'])
})

test('unknown or malformed valid JSON schema is preserved exactly and never downgraded by updates', async t => {
  const { file, directory } = await fixture(t)
  for (const payload of [{ version: 2, runs: [{ id: 'future-spend' }] }, { version: 1, runs: 'malformed' }, []]) {
    const original = JSON.stringify(payload)
    await writeFile(file, original)
    const store = createRouterState({ file })
    await assert.rejects(store.read(), { code: 'ROUTER_STATE_UNSUPPORTED' })
    await assert.rejects(store.appendRun({ id: 'not-written', packages: [] }), { code: 'ROUTER_STATE_UNSUPPORTED' })
    assert.equal(await readFile(file, 'utf8'), original)
    assert.deepEqual((await readdir(directory)).sort(), ['state.json'])
  }
})

test('same-clock corrupt recoveries keep unique backups and the incomplete marker survives notice dismissal', async t => {
  const { file, directory } = await fixture(t)
  const store = createRouterState({ file, now: () => 1000 })
  for (const raw of ['{first broken', '{second broken']) {
    await writeFile(file, raw)
    assert.equal((await store.read()).historyIncomplete, true)
  }
  const backups = (await readdir(directory)).filter(name => name.startsWith('state.json.corrupt-'))
  assert.equal(backups.length, 2)
  assert.deepEqual((await Promise.all(backups.map(name => readFile(join(directory, name), 'utf8')))).sort(), ['{first broken', '{second broken'])
  await store.dismissNotice(1000)
  const state = await createRouterState({ file }).read()
  assert.equal(state.notices.length, 0)
  assert.equal(state.historyIncomplete, true)
})

test('updateRun awaits an asynchronous change and rolls back its asynchronous rejection', async t => {
  const { store } = await fixture(t)
  await store.appendRun({ id: 'one', packages: [] })
  await store.updateRun('one', async run => { await Promise.resolve(); run.rating = 1 })
  assert.equal((await store.read()).runs[0].rating, 1)
  await assert.rejects(store.updateRun('one', async run => {
    await Promise.resolve(); run.rating = -1; throw new Error('Synthetic asynchronous failure')
  }), /Synthetic asynchronous failure/)
  assert.equal((await store.read()).runs[0].rating, 1)
})

test('nested corrupted charge records cannot be sanitized into certified zero history', async t => {
  const { file } = await fixture(t)
  const at = Date.UTC(2026, 9, 8)
  for (const data of [
    { runs: [{ id: 'synthetic', createdAt: at, packages: 'corrupted paid packages', reviews: [] }] },
    { runs: [{ id: 'synthetic', createdAt: at, packages: [], reviews: {} }] },
    { runs: [], archivedSpending: { days: { '2026-10-08': { costUsd: 'corrupted total', unknown: 0 } } } },
    { runs: [{ id: 'synthetic', packages: [], priorAttemptSpending: { months: { '2026-10': { costUsd: -1 } } } }] },
    { runs: [{ id: 'synthetic', packages: [{ ran: true, costUsd: 1, finishedAt: 'bad time' }] }] },
  ]) {
    await writeFile(file, JSON.stringify({ version: 1, ...data }))
    const store = createRouterState({ file })
    assert.equal((await store.read()).historyIncomplete, true)
    await store.update(() => {})
    assert.equal((await createRouterState({ file }).read()).historyIncomplete, true)
  }
})
