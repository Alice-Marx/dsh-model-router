import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { codexAuthorizationUrl, createCodexSubscriptionBackend } from '../packages/bot-engines/src/codex-subscription.mjs'
import { nativeRpcFixtureEntry } from './helpers/native-rpc-fixture-launcher.mjs'

test('the official authorization link is HTTPS and limited to the vendor sign-in hosts', () => {
  for (const url of ['javascript:alert(1)', 'http://auth.openai.com/login', 'https://auth.openai.com.example.invalid/login',
    'https://user:secret@auth.openai.com/login', 'https://auth.openai.com:444/login']) {
    assert.throws(() => codexAuthorizationUrl(url), { code: 'SUBSCRIPTION_AUTH_URL' })
  }
  assert.equal(codexAuthorizationUrl('https://auth.openai.com/authorize?state=fixture'), 'https://auth.openai.com/authorize?state=fixture')
})

test('the Codex account wire validates, paginates and narrows the official replies in a protected profile',
  { skip: process.platform !== 'win32' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sub-test-')), id = randomUUID().replaceAll('-', '')
    const entry = await nativeRpcFixtureEntry(resolve('tests/fixtures/native-chat-protocol-fixture.mjs'))
    const backend = createCodexSubscriptionBackend({ root, resolveEntry: async () => entry })
    const outcomes = []
    const session = await backend.open(id, { create: true, onLogin: (...args) => outcomes.push(args) })
    try {
      await assert.rejects(backend.credentialHome(id), { code: 'SUBSCRIPTION_AUTH_REQUIRED' })
      await assert.rejects(session.snapshot(), { code: 'SUBSCRIPTION_AUTH_REQUIRED' })
      const authorization = await session.login()
      assert.ok(new URL(authorization.url).searchParams.has('code_challenge'))
      assert.deepEqual(await session.cancel(authorization.peerId), { status: 'canceled' })
      await writeFile(join(root, id, 'auth.json'), '{"fixture":"private-oauth-token"}')
      assert.equal(await backend.credentialHome(id), join(root, id))
      const reading = { id: 'primary', remainingPercent: 65, durationMinutes: 300, resetAt: 1900000000000 }
      assert.deepEqual(await session.snapshot(), {
        email: 'fixture@example.invalid', plan: 'plus',
        models: [{ id: 'gpt-fixture', name: 'Fixture Codex' }, { id: 'gpt-second', name: 'Second model' }], windows: [reading],
      })
      assert.deepEqual(await session.snapshot(undefined, { quotaOnly: true }), { windows: [reading] })
      assert.deepEqual(outcomes, [['fixture-login', false]])
    } finally {
      await session.close()
      await backend.forget(id)
    }
    await assert.rejects(access(join(root, id, 'auth.json')), { code: 'ENOENT' })
    await writeFile(join(root, id, 'config.toml'), 'sandbox_mode = "danger-full-access"\n')
    await assert.rejects(backend.credentialHome(id), { code: 'SUBSCRIPTION_STORAGE_INVALID' })
  })
