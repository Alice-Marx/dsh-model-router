import test from 'node:test'
import assert from 'node:assert/strict'
import * as submissions from '../apps/integration-client/routing-submissions.mjs'

test('submission codes: a saved reference can be restored in a fresh client without claiming acceptance', () => {
  const original = submissions.routingSubmissions({}), ref = { requesterBotId: 'original-main', requestKey: 'request_123' }
  original.start({ ...ref, text: 'private task', credential: 'secret' })
  const code = submissions.submissionCode(original.getSnapshot())
  assert.equal(code, 'dsh-route-v1:original-main:request_123')
  const fresh = submissions.routingSubmissions({})
  assert.equal(fresh.restore(code), true)
  assert.deepEqual(fresh.getSnapshot(), { ...ref, state: 'unknown', planId: null, planState: null })
  assert.equal(fresh.start({ requesterBotId: 'other', requestKey: 'another' }), false)
  assert.equal(fresh.restore('dsh-route-v1:other:another'), false, 'an existing unresolved reference cannot be replaced')
})

test('submission codes: malformed, oversized and unsupported references never enter the store', () => {
  for (const code of [null, {}, '', 'dsh-route-v2:main:key', 'dsh-route-v1:main:', 'dsh-route-v1:main:key:extra',
    'dsh-route-v1:../main:key', 'dsh-route-v1:main:凭据', `dsh-route-v1:main:${'x'.repeat(129)}`, 'dsh-route-v1:main:key\nextra']) {
    const store = submissions.routingSubmissions({})
    assert.throws(() => store.restore(code), { message: 'INVALID_ROUTING_SUBMISSION_CODE' })
    assert.equal(store.getSnapshot(), null)
  }
  const ref = { requesterBotId: 'a'.repeat(128), requestKey: 'b'.repeat(128) }
  const store = submissions.routingSubmissions({})
  assert.equal(store.restore(`  ${submissions.submissionCode(ref)}\n`), true)
  assert.equal(store.getSnapshot().requestKey, ref.requestKey)
})
