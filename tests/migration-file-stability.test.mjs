import test from 'node:test'
import assert from 'node:assert/strict'
import { migrationImageMetadataMismatch as mismatch, migrationImageCtimeRetry as retryable } from '../packages/orchestration/src/migration-file-stability.mjs'

const stat = (patch = {}) => ({ dev: 1n, ino: 2n, size: 14n, mtimeNs: 20n, ctimeNs: 10n, nlink: 1n, ...patch })

test('migration file stability: Windows accepts ctime settling before the opened-handle read baseline', () => {
  const named = stat(), opened = stat({ ctimeNs: 11n }), after = stat({ ctimeNs: 11n }), again = stat({ ctimeNs: 11n })
  assert.equal(mismatch(named, opened, after, again, 'win32'), null)
})

test('migration file stability: Windows still rejects ctime drift during the actual read', () => {
  const named = stat(), opened = stat({ ctimeNs: 11n }), after = stat({ ctimeNs: 12n }), again = stat({ ctimeNs: 12n })
  const result = mismatch(named, opened, after, again, 'win32')
  assert.equal(result.field, 'ctimeNs')
  assert.equal(result.observation, 'after-read')
  assert.equal(result.baseline, opened)
})

test('migration file stability: hardlink count drift is rejected on every platform', () => {
  for (const platform of ['win32', 'linux']) {
    const named = stat(), opened = stat({ nlink: 2n }), after = stat({ nlink: 2n }), again = stat({ nlink: 2n })
    const result = mismatch(named, opened, after, again, platform)
    assert.equal(result.field, 'nlink')
    assert.equal(result.observation, 'opened')
  }
})

test('migration file stability: POSIX ctime and content metadata retain the original pre-open baseline', () => {
  const named = stat(), opened = stat({ ctimeNs: 11n }), after = stat({ ctimeNs: 11n }), again = stat({ ctimeNs: 11n })
  assert.equal(mismatch(named, opened, after, again, 'linux').field, 'ctimeNs')
  const changed = stat({ size: 15n })
  assert.equal(mismatch(named, changed, changed, changed, 'linux').field, 'size')
})

test('migration file stability: only Windows read-stable ctime drift qualifies for a bounded complete reread', () => {
  const error = (field = 'ctimeNs', check = 'read-stable') => Object.assign(new Error('MIGRATION_COMMIT_SOURCE_CHANGED'), { code: 'MIGRATION_COMMIT_SOURCE_CHANGED', diagnostic: { check, field } })
  assert.equal(retryable(error(), 'win32'), true)
  for (const [value, platform] of [[error('nlink'), 'win32'], [error('size'), 'win32'], [error('ctimeNs', 'open-identity'), 'win32'], [error(), 'linux']]) {
    assert.equal(retryable(value, platform), false)
  }
  assert.equal(retryable(new Error('other'), 'win32'), false)
})
