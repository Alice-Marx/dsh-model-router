import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceTools, resolveInside } from '../modules/independent-runtime/workspace-tools.mjs'

const workspace = t => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-tools-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('workspace tools: every path stays inside the root', (t) => {
  const root = workspace(t)
  assert.equal(resolveInside(root, 'a/b.txt').startsWith(root), true)
  for (const bad of ['/etc/passwd', '..\\..\\Windows\\win.ini', '../outside.txt', '', 'a\0b']) {
    assert.throws(() => resolveInside(root, bad), /INVALID_PATH|PATH_ABSOLUTE|PATH_OUTSIDE_ROOT/)
  }
})

test('workspace tools: a symlink pointing out of the root is refused', (t) => {
  const root = workspace(t)
  const outside = workspace(t)
  writeFileSync(join(outside, 'secret.txt'), 'nope')
  try { symlinkSync(outside, join(root, 'link'), 'junction') } catch { t.skip('symlink not permitted here') }
  const tools = createWorkspaceTools({ root })
  assert.rejects(tools.call('fs_read', { path: 'link/secret.txt' }), /PATH_OUTSIDE_ROOT/)
})

test('workspace tools: write then read round-trips, and createOnly refuses an existing file', async (t) => {
  const root = workspace(t)
  const tools = createWorkspaceTools({ root })
  const written = await tools.call('fs_write', { path: 'notes/a.txt', content: 'hello' })
  assert.equal(written.bytes, 5)
  const read = await tools.call('fs_read', { path: 'notes/a.txt' })
  assert.equal(read.content, 'hello')
  await assert.rejects(tools.call('fs_write', { path: 'notes/a.txt', content: 'x', createOnly: true }), /FILE_EXISTS/)
})

test('workspace tools: listing is deterministic and bounded', async (t) => {
  const root = workspace(t)
  mkdirSync(join(root, 'dir'))
  writeFileSync(join(root, 'dir', 'b.txt'), 'b')
  writeFileSync(join(root, 'dir', 'a.txt'), 'a')
  const tools = createWorkspaceTools({ root })
  const listed = await tools.call('fs_list', { path: 'dir' })
  assert.deepEqual(listed.entries, ['a.txt', 'b.txt'])
  assert.equal((await tools.call('fs_list', { path: '.', limit: 1 })).entries.length, 1)
})

test('workspace tools: sizes are bounded and unknown tools fail', async (t) => {
  const root = workspace(t)
  const tools = createWorkspaceTools({ root })
  await assert.rejects(tools.call('fs_write', { path: 'big.txt', content: 'x'.repeat(1_000_001) }), /CONTENT_TOO_LARGE/)
  await assert.rejects(tools.call('shell_exec', { argv: ['whoami'] }), /TOOL_NOT_FOUND/)
  const info = await tools.call('workspace_info', {})
  assert.equal(info.root, root)
  assert.deepEqual(info.tools, ['fs_list', 'fs_read', 'fs_write'])
})
