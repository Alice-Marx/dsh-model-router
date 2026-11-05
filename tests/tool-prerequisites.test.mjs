import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PREREQUISITES_PER_TOOL, normalizePrerequisites, prerequisiteKeysFor, resolvePrerequisites } from '../.dsh-plugin/shared/tool-prerequisites.mjs'
import { executionEnvironment } from '../.dsh-plugin/shared/official-tool-executor.mjs'

const code = expected => error => { assert.equal(error.code, expected, error.message); return true }

test('prerequisites: a declaration names variables, and nothing else', () => {
  const normalized = normalizePrerequisites({ 'dsh-tui': { env: ['DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY', 'DSH_TUI_HOME'] } })
  assert.deepEqual(normalized, { 'dsh-tui': ['DEEPSEEK_API_KEY', 'DSH_TUI_HOME'] })
  assert.deepEqual(prerequisiteKeysFor(normalized, 'dsh-tui'), ['DEEPSEEK_API_KEY', 'DSH_TUI_HOME'])
  assert.deepEqual(prerequisiteKeysFor(normalized, 'codex'), [])
})

test('prerequisites: a malformed name, key or tool id is refused rather than ignored', () => {
  assert.throws(() => normalizePrerequisites({ 'dsh-tui': { env: ['lower_case'] } }), code('INVALID_TOOL_PREREQUISITES'))
  assert.throws(() => normalizePrerequisites({ 'dsh-tui': { args: ['--x'] } }), code('INVALID_TOOL_PREREQUISITES'))
  assert.throws(() => normalizePrerequisites({ 'Bad Tool': { env: ['A_B'] } }), code('INVALID_TOOL_PREREQUISITES'))
  assert.throws(() => normalizePrerequisites({ 'dsh-tui': { env: Array.from({ length: MAX_PREREQUISITES_PER_TOOL + 1 }, (_, i) => `VAR_${i}`) } }), code('INVALID_TOOL_PREREQUISITES'))
  assert.throws(() => normalizePrerequisites([]), code('INVALID_TOOL_PREREQUISITES'))
})

test('prerequisites: an empty declaration is not stored, and an absent one is empty', () => {
  assert.deepEqual(normalizePrerequisites({ 'dsh-tui': { env: [] } }), {})
  assert.deepEqual(normalizePrerequisites(undefined), {})
  assert.deepEqual(normalizePrerequisites(null), {})
})

test('prerequisites: a missing value is reported, and a present one is passed through', () => {
  const declared = normalizePrerequisites({ 'dsh-tui': { env: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'] } })
  const some = resolvePrerequisites(declared, 'dsh-tui', { DEEPSEEK_API_KEY: 'sk-test' })
  assert.deepEqual(some.env, { DEEPSEEK_API_KEY: 'sk-test' })
  assert.deepEqual(some.missing, ['DEEPSEEK_BASE_URL'])
  const none = resolvePrerequisites(declared, 'dsh-tui', {})
  assert.deepEqual(none.missing, ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL'])
})

test('executor: a declared prerequisite joins that tool whitelist only', () => {
  const source = { PATH: '/bin', DEEPSEEK_API_KEY: 'sk-1', DEEPSEEK_BASE_URL: 'https://api.deepseek.com', SECRET_OTHER: 'x' }
  const withKey = executionEnvironment('dsh-tui', { env: source })
  assert.equal(withKey.DEEPSEEK_API_KEY, 'sk-1', 'dsh-tui carries its own key by default')
  assert.equal(withKey.SECRET_OTHER, undefined, 'the rest of the environment stays closed')
  const declared = executionEnvironment('codex', { env: source, extraKeys: ['DEEPSEEK_API_KEY'] })
  assert.equal(declared.DEEPSEEK_API_KEY, 'sk-1')
  const stray = executionEnvironment('codex', { env: source, extraKeys: ['lower_case', 'PATH'] })
  assert.equal(stray.lower_case, undefined, 'a malformed name is dropped, never forwarded')
})
