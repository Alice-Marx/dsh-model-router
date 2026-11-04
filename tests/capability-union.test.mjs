import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { CAPABILITY_UNION } from '../.dsh-plugin/shared/capability-union.mjs'

const REQUIRED = ['cli-task', 'groups', 'memory', 'capabilities', 'voice', 'side', 'schedules', 'views', 'tools', 'terminal', 'routing']

test('capability union: every promised capability still has its evidence on disk', async () => {
  const missing = []
  for (const row of CAPABILITY_UNION) {
    try { await access(row.evidence) } catch { missing.push(`${row.id} → ${row.evidence}`) }
  }
  assert.deepEqual(missing, [], `功能并集缺少证据：${missing.join('；')}`)
})

test('capability union: the list covers every capability the product promises', () => {
  const ids = new Set(CAPABILITY_UNION.map(row => row.id))
  for (const id of REQUIRED) assert.equal(ids.has(id), true, `缺少能力条目 ${id}`)
  assert.equal(CAPABILITY_UNION.length >= REQUIRED.length, true)
  // Every row is closed: no accidental extra fields that would let a row claim more than it shows.
  for (const row of CAPABILITY_UNION) {
    assert.deepEqual(Object.keys(row).filter(key => !['id', 'label', 'evidence', 'note'].includes(key)), [])
    assert.match(row.evidence, /^[A-Za-z0-9._/-]+$/, `证据路径必须相对且无空格：${row.evidence}`)
  }
})

test('capability union: the twelve official tools plus dsh-TUI are still registered', async () => {
  const source = await readFile('.dsh-plugin/shared/official-tool-registry.mjs', 'utf8')
  const ids = [...source.matchAll(/^    id: '([a-z0-9-]+)',$/gmu)].map(match => match[1])
  assert.equal(ids.length, 13, `注册表应有 13 个工具，实际 ${ids.length}：${ids.join(',')}`)
  assert.equal(ids.includes('dsh-tui'), true)
  for (const id of ['kimi-code', 'claude-code', 'codex', 'minimax-code', 'mimo-code', 'grok-build', 'gemini', 'opencode', 'stepcode', 'pi', 'hermes', 'zcode']) {
    assert.equal(ids.includes(id), true, `缺少既有工具 ${id}`)
  }
})
