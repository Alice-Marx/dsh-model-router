import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cliProxyArtifact, CLI_PROXY_RELEASE, CLI_PROXY_VERSION } from '../packages/orchestration/src/cli-proxy-release.mjs'
import { cliProxyJson, installCliProxyArtifact, createCliProxyRuntime, subscriptionProxyUrl } from '../packages/orchestration/src/cli-proxy-runtime.mjs'
import { stopCliProxyComponent } from '../packages/orchestration/src/cli-proxy-process.mjs'

test('component artifacts have pinned HTTPS release locations and distinct platform checksums', () => {
  assert.equal(Object.keys(CLI_PROXY_RELEASE).length, 6)
  assert.equal(new Set(Object.values(CLI_PROXY_RELEASE).map(value => value[1])).size, 6)
  for (const platform of Object.keys(CLI_PROXY_RELEASE)) { const [os, arch] = platform.split('-'), artifact = cliProxyArtifact(os, arch); assert.match(artifact.sha256, /^[a-f0-9]{64}$/); assert.equal(artifact.url, 'https://github.com/router-for-me/CLIProxyAPI/releases/download/v' + CLI_PROXY_VERSION + '/' + artifact.filename) }
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
test('an opted-in profile prepares a missing pinned version automatically and concurrent requests share an install', async () => {
  const base = resolve('tmp/integration/subscription-runtime-tests')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'managed-update-'))
  await writeFile(join(root, 'settings.json'), JSON.stringify({ enabled: true, proxyUrl: '' }))
  const archive = Promise.withResolvers()
  const started = Promise.withResolvers()
  let downloads = 0
  const runtime = createCliProxyRuntime({ root, async download(artifact) {
    downloads++
    assert.equal(artifact.version, CLI_PROXY_VERSION)
    started.resolve()
    return archive.promise
  } })
  try {
    assert.equal((await runtime.initialize()).phase, 'installing')
    await started.promise
    const first = assert.rejects(runtime.ensureReady(), { code: 'SUBSCRIPTION_COMPONENT_HASH' })
    const second = assert.rejects(runtime.ensureReady(), { code: 'SUBSCRIPTION_COMPONENT_HASH' })
    archive.resolve(Buffer.from('untrusted archive'))
    await Promise.all([first, second])
    assert.equal(downloads, 1)
    assert.equal(runtime.status().phase, 'error')
    assert.equal(runtime.status().installed, false)
  } finally {
    archive.resolve(Buffer.alloc(0))
    await runtime.close()
  }
})
test('a failed release download tries the official asset endpoint and still verifies the archive before installing', async () => {
  const base = resolve('tmp/integration/subscription-runtime-tests')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'retry-'))
  const artifact = cliProxyArtifact(), requests = []
  const runtime = createCliProxyRuntime({ root, bundledDir: root, async fetchRelease(url, options) {
    requests.push([url, options.headers.accept])
    if (url === artifact.url) throw new DOMException('fixture timeout', 'TimeoutError')
    return new Response('mismatched archive', { headers: { 'content-type': 'application/octet-stream' } })
  } })
  try {
    await assert.rejects(runtime.ensureReady({ proxyUrl: 'http://proxy.invalid:8080' }), { code: 'SUBSCRIPTION_COMPONENT_HASH' })
    assert.deepEqual(requests, [[artifact.url, 'application/octet-stream'], [artifact.assetUrl, 'application/octet-stream']])
    assert.deepEqual(await readdir(root), [])
  } finally {
    await runtime.close()
  }
})
test('pausing during a download prevents a new start and discards the unfinished installation', async () => {
  const base = resolve('tmp/integration/subscription-runtime-tests')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'pause-'))
  const archive = Promise.withResolvers(), started = Promise.withResolvers()
  const runtime = createCliProxyRuntime({ root, async download() { started.resolve(); return archive.promise },
    spawnProcess() { assert.fail('a paused download must not start a worker') } })
  try {
    const ready = assert.rejects(runtime.ensureReady(), { code: 'SUBSCRIPTION_PROXY_NOT_READY' })
    await started.promise
    const stop = runtime.stop()
    assert.throws(() => runtime.enable(), { code: 'SUBSCRIPTION_PROXY_STOPPING' })
    archive.resolve(Buffer.from('late archive'))
    await Promise.all([stop, ready])
    assert.equal(runtime.status().phase, 'disabled')
    assert.deepEqual(await readdir(root), ['settings.json'])
  } finally {
    archive.resolve(Buffer.alloc(0))
    await runtime.close()
  }
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
