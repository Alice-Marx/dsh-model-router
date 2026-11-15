import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cliProxyArtifact, CLI_PROXY_RELEASE } from '../packages/orchestration/src/cli-proxy-release.mjs'
import { cliProxyJson, installCliProxyArtifact, createCliProxyRuntime, subscriptionProxyUrl } from '../packages/orchestration/src/cli-proxy-runtime.mjs'
import { stopCliProxyComponent } from '../packages/orchestration/src/cli-proxy-process.mjs'

test('component artifacts have pinned HTTPS release locations and distinct platform checksums', () => {
  assert.equal(Object.keys(CLI_PROXY_RELEASE).length, 6)
  assert.equal(new Set(Object.values(CLI_PROXY_RELEASE).map(value => value[1])).size, 6)
  for (const platform of Object.keys(CLI_PROXY_RELEASE)) { const [os, arch] = platform.split('-'), artifact = cliProxyArtifact(os, arch); assert.match(artifact.sha256, /^[a-f0-9]{64}$/); assert.ok(artifact.url.startsWith('https://github.com/router-for-me/CLIProxyAPI/releases/download/v8.0.72/')) }
  assert.throws(() => cliProxyArtifact('unknown', 'x64'), { code: 'SUBSCRIPTION_PLATFORM_UNSUPPORTED' })
})
test('an unverified download is rejected before an archive-controlled executable or path is touched', async () => {
  const base = resolve('tmp/integration/subscription-runtime-tests'); await mkdir(base, { recursive: true }); const home = await mkdtemp(join(base, 'hash-'))
  await assert.rejects(installCliProxyArtifact(Buffer.from('untrusted executable'), home), { code: 'SUBSCRIPTION_COMPONENT_HASH' })
  assert.deepEqual(await readdir(home), [])
})
test('missing installations stay disabled, and closing an unused runtime creates no credentials or configuration', async () => {
  const base = resolve('tmp/integration/subscription-runtime-tests'); await mkdir(base, { recursive: true }); const home = await mkdtemp(join(base, 'empty-'))
  const runtime = createCliProxyRuntime({ root: home })
  await runtime.initialize(); assert.equal(runtime.status().phase, 'disabled'); assert.equal(runtime.status().installed, false)
  assert.throws(() => runtime.connection(), { code: 'SUBSCRIPTION_PROXY_NOT_READY' })
  await runtime.close(); assert.deepEqual(await readdir(home), [])
})
test('management responses are bounded and authentication errors cannot echo upstream tokens', async () => {
  await assert.rejects(cliProxyJson(new Response('fixture-private-token', { status: 401 })), error => error.code === 'SUBSCRIPTION_PROXY_HTTP' && error.status === 401 && !error.message.includes('fixture-private-token'))
  await assert.rejects(cliProxyJson(new Response('x'.repeat(101)), 100), { code: 'SUBSCRIPTION_PROXY_RESPONSE' })
  await assert.rejects(cliProxyJson(new Response('not-json')), { code: 'SUBSCRIPTION_PROXY_RESPONSE' })
  assert.deepEqual(await cliProxyJson(new Response('{"files":[]}')), { files: [] })
})
test('network proxy choices cannot contain credentials, hidden paths or executable schemes', () => {
  assert.equal(subscriptionProxyUrl('http://127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(subscriptionProxyUrl(''), '')
  for (const input of ['http://user:secret@127.0.0.1:7897', 'file:///tmp/program', 'https://proxy.invalid/path', 'http://proxy.invalid/?token=secret', 'javascript:run()']) assert.throws(() => subscriptionProxyUrl(input), { code: 'SUBSCRIPTION_PROXY_INVALID' })
})

test('a component stop requests IPC shutdown and waits for the owned worker exit before confirming', async () => {
  const worker = new EventEmitter(), sent = []; let completed = false, kills = 0
  Object.assign(worker, { exitCode: null, connected: true, send(message, callback) { sent.push(message); callback() }, kill() { kills++ } })
  const stopped = stopCliProxyComponent(worker).then(() => { completed = true })
  await Promise.resolve(); assert.equal(completed, false); assert.deepEqual(sent, [{ action: 'stop' }]); assert.equal(kills, 0)
  worker.exitCode = 0; worker.emit('exit', 0); await stopped; assert.equal(completed, true)
})
