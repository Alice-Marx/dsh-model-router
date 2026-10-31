import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import Database from 'better-sqlite3'
await import('../remote-computer-agent/build.mjs')
const { Agent, WorkspacePin } = await import('../remote-computer-agent/dist/index.mjs')

const linux = process.platform === 'linux', only = { skip: !linux }
const parent = resolve('tmp/integration/workspace-root-lock'); await mkdir(parent, { recursive: true })
const tools = ['fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel']
const outcome = promise => promise.then(value => ({ status: value?.status ?? 'succeeded', code: value?.error?.code }), error => ({ status: 'failed', code: error?.code }))
const exited = child => new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))

async function fixture(t, roots) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const agent = new Agent({ dataDir: join(dir, 'agent-data'), roots }, Database)
  const rootIds = Object.keys(roots)
  const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: rootIds, tools })
  const context = agent.store.grant(agent.store.issue(agent.store.client(pair.token), { botId: 'bot-a', taskId: 't', attemptId: 'a', roots: rootIds, tools }).grantToken)
  t.after(() => agent.close())
  return { dir, agent, context, write: (id, rootId, relativePath) => agent.call('fs_write', { rootId, relativePath, content: 'x', expectedHash: null }, context, id) }
}
/** Start a separate process holding a claim on the root; resolves when its ready file appears. */
function holder(t, root) {
  return new Promise((resolveHolder, reject) => {
    const ready = join(root, '..', 'holder-ready.json')
    const child = spawn(process.execPath, [resolve('tests/fixtures/workspace-root-lock-holder.mjs'), root, ready], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', data => { stderr += data })
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
    const timer = setTimeout(() => reject(new Error(`holder did not start: ${stderr}`)), 20_000)
    const poll = async () => {
      try { const value = JSON.parse(await readFile(ready, 'utf8')); clearTimeout(timer); resolveHolder({ child, key: value.key }) }
      catch { setTimeout(poll, 50) }
    }
    void poll()
  })
}

test('root lock/native: a second Agent process with a different dataDir is excluded by the kernel claim', only, async t => {
  const holderDir = await mkdtemp(join(parent, 'held-')), root = join(holderDir, 'root'); await mkdir(root)
  const held = await holder(t, root)
  const f = await fixture(t, { project: root })
  const busy = await outcome(f.write('op-cross', 'project', 'cross.txt'))
  assert.equal(busy.status, 'failed'); assert.equal(busy.code, 'WORKSPACE_BUSY')
  assert.equal(f.agent.workspaces.list().length, 0, 'the refusal came from the claim, not from a journal row')
  held.child.kill('SIGKILL'); await exited(held.child)
  const after = await outcome(f.write('op-after-steal', 'project', 'after.txt'))
  assert.equal(after.status, 'succeeded', 'a verifiably dead holder claim is reclaimed')
  assert.equal(f.agent.workspaces.list().length, 0)
})

test('root lock/native: an alias of the held root is the same physical claim', only, async t => {
  const holderDir = await mkdtemp(join(parent, 'alias-')), root = join(holderDir, 'root'); await mkdir(root)
  await symlink(root, join(holderDir, 'alias'), 'dir')
  const held = await holder(t, join(holderDir, 'alias'))
  const f = await fixture(t, { project: root })
  const busy = await outcome(f.write('op-alias', 'project', 'via-real.txt'))
  assert.equal(busy.code, 'WORKSPACE_BUSY')
  held.child.kill('SIGKILL'); await exited(held.child)
})

test('root lock/native: nested captures in one process share the claim and never self-deadlock', only, async t => {
  const dir = await mkdtemp(join(parent, 'nested-')), root = join(dir, 'root'); await mkdir(root)
  const outer = await WorkspacePin.capture(root)
  const inner = await WorkspacePin.capture(root)
  await inner.close()
  const fresh = await WorkspacePin.capture(root)  // still nested under the outer claim
  await fresh.close()
  await outer.close()
  const reopened = await WorkspacePin.capture(root)  // fully released; a new claim must be possible
  await reopened.close()
  assert.ok(true)
})

test('root lock/native: a released claim lets an independent process pin the root again', only, async t => {
  const dir = await mkdtemp(join(parent, 'serial-')), root = join(dir, 'root'); await mkdir(root)
  const first = await WorkspacePin.capture(root); await first.close()
  const held = await holder(t, root)  // would time out into WORKSPACE_BUSY if the release leaked
  held.child.kill('SIGKILL'); await exited(held.child)
  const f = await fixture(t, { project: root })
  assert.equal((await outcome(f.write('op-serial', 'project', 'serial.txt'))).status, 'succeeded')
})
