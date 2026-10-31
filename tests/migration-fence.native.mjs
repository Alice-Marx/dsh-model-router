import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { acquireMigrationShared, beginMigrationExclusive, readMigrationFence } from '../packages/orchestration/src/migration-fence.mjs'

const parent = resolve('tmp/integration/migration-fence'); await mkdir(parent, { recursive: true })
const holder = resolve('tests/fixtures/migration-fence-holder.mjs')
const exited = child => child.exitCode !== null || child.signalCode !== null
  ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  : new Promise(done => child.once('exit', (code, signal) => done({ code, signal })))
// writeFile creates the file before its bytes land, so a readable-but-empty file
// is an in-flight write, not the fixture's answer; wait for real content.
const waitFile = async (path, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const text = await readFile(path, 'utf8').catch(() => '')
    if (text.trim().length > 0) return text
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('fence fixture did not reach the expected state')
}

/** Real child process participating in the protocol. */
function startHolder(t, home, mode, name) {
  const ready = join(home, `ready-${name}`), gate = join(home, `gate-${name}`), exit = join(home, `exit-${name}`)
  const child = spawn(process.execPath, [holder, home, mode, ready, gate, exit], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', d => { stderr += d })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  return { child, ready, gate, exit, stderr }
}

test('fence: a shared admission is granted and released; maintenance is not active', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const shared = await acquireMigrationShared(home)
  const state = await readMigrationFence(home)
  assert.equal(state.maintenanceActive, false)
  assert.equal(state.liveShared.length, 1)
  assert.equal(state.stopWriteProvable, false, 'the fence never claims a stop-write proof')
  await shared.release()
  assert.equal((await readMigrationFence(home)).liveShared.length, 0)
})

test('fence: a durable intent refuses new shared admissions and exclusive drains live holders', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const h1 = startHolder(t, home, 'shared', 'a'), h2 = startHolder(t, home, 'shared', 'b')
  await waitFile(h1.ready); await waitFile(h2.ready)
  let observed = 0
  const exclusive = beginMigrationExclusive(home, { operationId: 'op-drain', drainTimeoutMs: 30000, onShared: () => { observed++ } })
  // The intent alone already blocks new participants while holders drain.
  const endIntent = Date.now() + 10000
  while (Date.now() < endIntent && !(await readMigrationFence(home)).maintenanceActive) await new Promise(r => setTimeout(r, 20))
  assert.equal((await readMigrationFence(home)).maintenanceActive, true)
  await new Promise(r => setTimeout(r, 150))
  // Real timing: the coordinator requests the stop, holders observe it and
  // exit, and only then does the exclusive fence resolve.
  await writeFile(h1.exit, 'x'); await writeFile(h2.exit, 'x')
  const fence = await exclusive
  assert.equal(await fence.verify(), true, 'exclusive resolves only after the drain completes')
  assert.ok(observed >= 1, 'live holders were observed during the drain')
  assert.equal((await readMigrationFence(home)).liveShared.length, 0)
  await exited(h1.child); await exited(h2.child)
  const state = await readMigrationFence(home)
  assert.equal(state.exclusive.operationId, 'op-drain'); assert.equal(state.exclusive.holderAlive, true)
})

test('fence: a host arriving after the intent is refused — the gate race closes', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const late = startHolder(t, home, 'late', 'l')
  const exclusive = await beginMigrationExclusive(home, { operationId: 'op-race' })
  await writeFile(late.gate, 'x')
  assert.equal(await waitFile(late.ready), 'MIGRATION_MAINTENANCE_ACTIVE')
  await exited(late.child)
  await exclusive.release()
  const after = await acquireMigrationShared(home)
  assert.ok(after, 'release restores admissions')
  await after.release()
})

test('fence: two concurrent coordinators — one wins, the other is busy', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const first = await beginMigrationExclusive(home, { operationId: 'op-first' })
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'op-second' }), /MIGRATION_FENCE_BUSY/)
  await first.release()
  const second = await beginMigrationExclusive(home, { operationId: 'op-second' })
  await second.release()
})

test('fence: a crashed coordinator keeps blocking writers until a verified takeover', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const moduleUrl = (await import('node:url')).pathToFileURL(resolve('packages/orchestration/src/migration-fence.mjs')).href
  // The crashed coordinator is a real child process: it takes the exclusive
  // fence and is then SIGKILLed, leaving durable state behind.
  const crasher = spawn(process.execPath, ['--input-type=module', '-e', `
    import(${JSON.stringify(moduleUrl)}).then(async ({beginMigrationExclusive}) => {
      const fence = await beginMigrationExclusive(${JSON.stringify(home)}, { operationId: 'op-crash' })
      const fs = await import('node:fs')
      fs.writeFileSync(${JSON.stringify(join(home, 'crash-ready'))}, 'x')
      setInterval(() => {}, 1000)
    })
  `], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; crasher.stderr.on('data', d => { stderr += d })
  t.after(() => { if (crasher.exitCode === null) crasher.kill('SIGKILL') })
  await waitFile(join(home, 'crash-ready'))
  crasher.kill('SIGKILL'); await exited(crasher)
  const blocked = await readMigrationFence(home)
  assert.equal(blocked.maintenanceActive, true, 'the durable intent outlives the coordinator')
  assert.equal(blocked.exclusive.holderAlive, false)
  const late = startHolder(t, home, 'late', 'after-crash')
  await writeFile(late.gate, 'x')
  assert.equal(await waitFile(late.ready), 'MIGRATION_MAINTENANCE_ACTIVE')
  await exited(late.child)
  const takeover = await beginMigrationExclusive(home, { operationId: 'op-takeover' })
  assert.equal((await readMigrationFence(home)).exclusive.operationId, 'op-takeover')
  await takeover.release()
  const shared = await acquireMigrationShared(home)
  await shared.release()
})

test('fence: release is owner-checked and double release fails closed', async t => {
  const home = await mkdtemp(join(parent, 'case-'))
  const exclusive = await beginMigrationExclusive(home, { operationId: 'op-release' })
  await exclusive.release()
  await assert.rejects(exclusive.release(), /MIGRATION_FENCE_NOT_HELD/)
})

test('fence: input shape is bounded', async () => {
  const home = await mkdtemp(join(parent, 'case-'))
  await assert.rejects(beginMigrationExclusive(home, { operationId: '' }), /MIGRATION_FENCE_INPUT_INVALID/)
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'bad id!' }), /MIGRATION_FENCE_INPUT_INVALID/)
  await assert.rejects(beginMigrationExclusive(home, { operationId: 'x'.repeat(129) }), /MIGRATION_FENCE_INPUT_INVALID/)
})
