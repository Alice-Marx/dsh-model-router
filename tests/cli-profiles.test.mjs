import test from 'node:test'
import assert from 'node:assert/strict'
import { CLI_PROFILES, cliProfile, cliScopeTable } from '../.dsh-plugin/shared/cli-profiles.mjs'
import { codexExecArgs } from '../.dsh-plugin/shared/official-tool-executor.mjs'

test('cli profiles: every profile states its read scope, write ability and confinement need', () => {
  for (const [toolId, modes] of Object.entries(CLI_PROFILES)) {
    for (const [mode, profile] of Object.entries(modes)) {
      assert.ok(['workspace', 'user', 'confined'].includes(profile.readScope), `${toolId}/${mode} readScope`)
      assert.equal(typeof profile.writes, 'boolean', `${toolId}/${mode} writes`)
      assert.equal(typeof profile.requiresConfinement, 'boolean', `${toolId}/${mode} requiresConfinement`)
      assert.ok(Array.isArray(profile.args), `${toolId}/${mode} args`)
    }
  }
})

test('cli profiles: Claude read-only keeps its normal tools and proves it wrote nothing', () => {
  const read = cliProfile('claude-code', 'read-only')
  assert.equal(read.writes, false)
  // C: the tool list is no longer the guarantee; plan mode + workspace + the no-write proof are.
  assert.equal(read.args.includes('--restricted'), false)
  assert.equal(read.args.includes('Read,Glob,Grep'), false)
  assert.equal(read.args[read.args.indexOf('--permission-mode') + 1], 'plan')
  assert.equal(read.args.includes('<workspace>'), true)
  assert.equal(read.verifyNoWrites, true)
  assert.equal(read.requiresConfinement, true)
  const write = cliProfile('claude-code', 'workspace-write')
  assert.equal(write.writes, true)
  assert.ok(write.args.includes('bypassPermissions'))
  assert.equal(write.args.includes('--restricted'), false)
})

test('cli profiles: Codex keeps its sandbox flag and says its reads are not limited by itself', () => {
  const read = cliProfile('codex', 'read-only')
  assert.deepEqual([...read.args], ['--sandbox', 'read-only'])
  assert.equal(read.readScope, 'user', 'Codex read-only still reads what the user can read')
  assert.equal(read.requiresConfinement, true)
  const write = cliProfile('codex', 'workspace-write')
  assert.deepEqual([...write.args], ['--sandbox', 'workspace-write'])
})

test('cli profiles: Gemini gets a declared write mode instead of "not supported"', () => {
  const write = cliProfile('gemini', 'workspace-write')
  assert.equal(write.writes, true)
  assert.ok(write.args.includes('yolo'))
  assert.ok(write.args.includes('<workspace>'), 'the workspace directory must be a parameter, not a guess')
  assert.equal(write.requiresConfinement, true)
  assert.equal(write.reachable, false, 'declared but not reachable until the runner launches Gemini')
  const read = cliProfile('gemini', 'read-only')
  assert.ok(read.args.includes('plan'))
  assert.equal(read.writes, false)
})

test('cli profiles: an unknown tool has no profile instead of a default', () => {
  assert.equal(cliProfile('opencode', 'read-only'), null)
  assert.equal(cliProfile('nope', 'workspace-write'), null)
})

test('cli profiles: the scope table exposes one row per tool and mode', () => {
  const rows = cliScopeTable()
  assert.equal(rows.length, 6)
  assert.deepEqual(rows.map(row => `${row.toolId}/${row.mode}`).sort(), [
    'claude-code/read-only', 'claude-code/workspace-write',
    'codex/read-only', 'codex/workspace-write',
    'gemini/read-only', 'gemini/workspace-write',
  ])
  assert.equal(rows.find(row => row.toolId === 'codex' && row.mode === 'read-only').readScope, 'user')
  assert.equal(rows.filter(row => row.reachable === false).length, 1)
})

test('cli profiles: the Codex argv can pin the run workspace as its working root', () => {
  assert.deepEqual(codexExecArgs('read-only'), ['--ask-for-approval', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '-'])
  const pinned = codexExecArgs('workspace-write', null, { cwd: 'D:/work/demo' })
  assert.equal(pinned.includes('-C'), true)
  assert.equal(pinned[pinned.indexOf('-C') + 1], 'D:/work/demo')
  assert.equal(pinned.includes('--sandbox'), true)
})
