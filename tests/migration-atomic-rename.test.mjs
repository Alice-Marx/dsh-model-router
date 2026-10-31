import test from 'node:test'
import assert from 'node:assert/strict'
import { renameMigrationFile } from '../packages/orchestration/src/migration-atomic-rename.mjs'

const error = code => Object.assign(new Error(code), { code })

test('migration atomic rename: transient Windows sharing errors use bounded retries', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const calls = [], delays = []
    await renameMigrationFile('temp', 'gate', {
      renameOperation: async (...args) => {
        calls.push(args)
        if (calls.length < 3) throw error(code)
      },
      sleep: async ms => { delays.push(ms) },
    })
    assert.deepEqual(calls, [['temp', 'gate'], ['temp', 'gate'], ['temp', 'gate']])
    assert.deepEqual(delays, [50, 50])
  }
})

test('migration atomic rename: success within the five-retry bound preserves the result', async () => {
  let attempts = 0
  await renameMigrationFile('temp', 'gate', {
    renameOperation: async () => {
      attempts++
      if (attempts < 6) throw error('EPERM')
    },
    sleep: async () => {},
  })
  assert.equal(attempts, 6)
})

test('migration atomic rename: exhaustion returns the last error after six attempts', async () => {
  let attempts = 0
  const delays = []
  await assert.rejects(renameMigrationFile('temp', 'gate', {
    renameOperation: async () => { attempts++; throw error('EBUSY') },
    sleep: async ms => { delays.push(ms) },
  }), { code: 'EBUSY' })
  assert.equal(attempts, 6)
  assert.deepEqual(delays, [50, 50, 50, 50, 50])
})

test('migration atomic rename: non-transient errors are never retried', async () => {
  let attempts = 0
  await assert.rejects(renameMigrationFile('temp', 'gate', {
    renameOperation: async () => { attempts++; throw error('ENOENT') },
    sleep: async () => { throw new Error('must not sleep') },
  }), { code: 'ENOENT' })
  assert.equal(attempts, 1)
})
