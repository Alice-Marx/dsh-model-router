import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { guardDsWorkspaceReads } from '../packages/orchestration/src/ds-workspace-privacy.mjs'

async function fixture(t) {
  const root = resolve('tmp/integration/ds-workspace-privacy'); await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'case-')), own = join(dir, 'own'), other = join(dir, 'other')
  await mkdir(own); await mkdir(other); await writeFile(join(own, 'own.md'), 'own'); await writeFile(join(other, 'private.md'), 'private')
  await symlink(other, join(own, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  const listeners = []
  const ctx = { on(name, listener) { assert.equal(name, 'tools/execute'); listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1) } }
  const runtime = { sessionFolder: () => own, real: realpath }
  const release = guardDsWorkspaceReads(ctx, runtime); t.after(release)
  const execute = (name, file_path) => listeners[0]({ name, agent: { session: { id: 'bot-a' } }, arguments: { file_path } }, async () => 'read')
  return { execute, own, other }
}

test('workspace privacy: real paths stay inside the current Session and junction escapes are refused', async t => {
  const f = await fixture(t)
  assert.equal(await f.execute('read', 'own.md'), 'read')
  await assert.rejects(f.execute('read', join(f.other, 'private.md')), { code: 'BOT_WORKSPACE_READ_DENIED' })
  await assert.rejects(f.execute('read', 'escape/private.md'), { code: 'BOT_WORKSPACE_READ_DENIED' })
  await assert.rejects(f.execute('read', '../other/private.md'), { code: 'BOT_WORKSPACE_READ_DENIED' })
  assert.equal(await f.execute('write', join(f.other, 'private.md')), 'read', 'the write sandbox remains the write authority')
  await assert.rejects(f.execute('pwsh', 'Get-Content ../other/private.md'), { code: 'BOT_NATIVE_EXECUTION_DENIED' })
})

test('workspace privacy: unavailable trusted folder identity fails closed', async t => {
  const listeners = []
  const ctx = { on(name, listener) { listeners.push(listener); return () => {} } }
  guardDsWorkspaceReads(ctx, { sessionFolder: () => undefined, real: realpath })
  await assert.rejects(listeners[0]({ name: 'read', agent: { session: {} }, arguments: { file_path: 'x' } }, async () => 'read'), { code: 'BOT_WORKSPACE_READ_DENIED' })
})
