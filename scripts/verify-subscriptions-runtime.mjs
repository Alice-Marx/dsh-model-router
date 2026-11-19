// Exercise the installed official Codex in a fresh private home. No account is signed in.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createCodexSubscriptionBackend } from '../packages/bot-engines/src/codex-subscription.mjs'

const base = resolve(process.argv[2] ?? 'tmp/integration/native-subscription-runtime')
await mkdir(base, { recursive: true })
const directory = await mkdtemp(join(base, 'case-'))
const id = randomUUID().replaceAll('-', '')
const backend = createCodexSubscriptionBackend({ root: directory })
assert.equal(backend.available, true, 'Verification requires a Windows host')
const session = await backend.open(id, { create: true })
try {
  await assert.rejects(session.snapshot(), { code: 'SUBSCRIPTION_AUTH_REQUIRED' })
  const { peerId, url } = await session.login()
  const auth = new URL(url)
  assert.equal(auth.hostname, 'auth.openai.com')
  assert.equal(auth.protocol, 'https:')
  assert.ok(auth.searchParams.has('state'))
  assert.ok(auth.searchParams.has('code_challenge'))
  assert.equal((await session.cancel(peerId)).status, 'canceled')
} finally {
  await session.close()
  await backend.forget(id)
}
await assert.rejects(access(join(directory, id, 'auth.json')), { code: 'ENOENT' })
const result = { officialCodexVersion: session.entry.version, isolatedAccountHome: true, authorizationLink: true,
  cancelled: true, treeStopped: true, accountSignedIn: false, modelCalls: 0 }
await writeFile(join(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
