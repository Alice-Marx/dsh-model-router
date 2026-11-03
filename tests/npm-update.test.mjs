import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  createNpmUpdateHandler,
  findInstalledPackageVersion,
  registerNpmUpdateRoute,
  ROUTER_NPM_REGISTRY,
  ROUTER_PACKAGE_NAME,
  ROUTER_UPDATE_CHANNEL,
  ROUTER_UPDATE_ENDPOINT,
} from '../.dsh-plugin/shared/npm-update.mjs'

async function packageFixture(t, version = '0.4.18') {
  const root = await mkdtemp(join(tmpdir(), 'router-update-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const entry = join(root, '.dsh-plugin', 'index.mjs')
  await mkdir(join(entry, '..'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: ROUTER_PACKAGE_NAME, version }))
  return { root, moduleUrl: pathToFileURL(entry).href }
}

function npmResponse(version = '0.4.19') {
  return new Response(JSON.stringify({ name: ROUTER_PACKAGE_NAME, version }), {
    headers: { 'content-type': 'application/json' },
  })
}

function successfulPnpm(onRun = () => {}) {
  return {
    runPlugin(args, cwd, signal) {
      onRun(args, cwd, signal)
      return {
        stdout: Readable.from(['installed\n']),
        stderr: Readable.from([]),
        done: Promise.resolve({ exitCode: 0, signal: null }),
        cancel() {},
      }
    },
  }
}

function invoke(handler, signal = new AbortController().signal) {
  return handler(ROUTER_UPDATE_ENDPOINT, {}, signal)
}

test('reads the running package version from its own manifest', async t => {
  const fixture = await packageFixture(t)
  assert.equal(await findInstalledPackageVersion(fixture.moduleUrl), '0.4.18')
})

test('does not reinstall or downgrade a current or newer running package', async t => {
  const currentFixture = await packageFixture(t, '0.4.19')
  const newerFixture = await packageFixture(t, '0.4.20')
  let runs = 0
  const options = {
    pnpm: successfulPnpm(() => { runs += 1 }),
    profileDir: 'C:\\Users\\cad\\.dsh\\profiles\\desktop',
    fetchImpl: async () => npmResponse('0.4.19'),
  }
  const current = await invoke(createNpmUpdateHandler({ ...options, moduleUrl: currentFixture.moduleUrl }))
  const newer = await invoke(createNpmUpdateHandler({ ...options, moduleUrl: newerFixture.moduleUrl }))
  assert.equal(current.ok, true)
  assert.equal(current.value.changed, false)
  assert.equal(newer.ok, true)
  assert.match(newer.value.message, /不会降级/)
  assert.equal(runs, 0)
})

test('a preview install follows the preview tag, not the stable latest', async t => {
  const fixture = await packageFixture(t, '0.26.0-preview.6')
  const requested = []
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm: successfulPnpm(),
    profileDir: 'C:\\profile',
    fetchImpl: async url => {
      requested.push(String(url))
      return npmResponse('0.26.0-preview.7')
    },
  })
  const result = await invoke(handler)
  assert.equal(result.ok, true)
  assert.equal(result.value.version, '0.26.0-preview.7')
  assert.equal(result.value.restartRequired, true)
  assert.ok(requested[0].endsWith('/preview'), `requested ${requested[0]}`)
})

test('a stable install keeps following the latest tag', async t => {
  const fixture = await packageFixture(t, '0.25.5')
  const requested = []
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm: successfulPnpm(),
    profileDir: 'C:\\profile',
    fetchImpl: async url => {
      requested.push(String(url))
      return npmResponse('0.25.6')
    },
  })
  const result = await invoke(handler)
  assert.equal(result.value.version, '0.25.6')
  assert.ok(requested[0].endsWith('/latest'), `requested ${requested[0]}`)
})

test('authenticated RPC resolves npm latest and runs one exact command in the active profile', async t => {
  const fixture = await packageFixture(t)
  let invocation
  const profileDir = 'C:\\Users\\cad\\.dsh\\profiles\\desktop'
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm: successfulPnpm((args, cwd, signal) => { invocation = { args, cwd, signal } }),
    profileDir,
    fetchImpl: async () => npmResponse(),
  })
  const result = await invoke(handler)

  assert.equal(result.ok, true)
  assert.equal(result.value.version, '0.4.19')
  assert.equal(result.value.restartRequired, true)
  assert.deepEqual(invocation.args, [
    'add',
    '--save-exact',
    `${ROUTER_PACKAGE_NAME}@0.4.19`,
    `--registry=${ROUTER_NPM_REGISTRY}`,
  ])
  assert.equal(invocation.cwd, profileDir)
  assert.equal(invocation.signal instanceof AbortSignal, true)
})

test('rejects unknown operations and caller-controlled payloads before package execution', async t => {
  const fixture = await packageFixture(t)
  let runs = 0
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm: successfulPnpm(() => { runs += 1 }),
    profileDir: 'C:\\profile',
    fetchImpl: async () => npmResponse(),
  })
  const unknown = await handler('arbitrary-operation', {})
  const callerInput = await handler(ROUTER_UPDATE_ENDPOINT, { package: 'arbitrary-package' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'router/not-found')
  assert.equal(callerInput.ok, false)
  assert.equal(callerInput.error.code, 'router/bad-request')
  assert.equal(runs, 0)
})

test('serializes Router updates while one is active', async t => {
  const fixture = await packageFixture(t)
  let finish
  let started
  const startedPromise = new Promise(resolve => { started = resolve })
  const done = new Promise(resolve => { finish = resolve })
  const pnpm = successfulPnpm()
  pnpm.runPlugin = () => {
    started()
    return {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      done,
      cancel() {},
    }
  }
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm,
    profileDir: 'C:\\profile',
    fetchImpl: async () => npmResponse(),
  })
  const first = invoke(handler)
  await startedPromise
  const second = await invoke(handler)
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'router/busy')
  finish({ exitCode: 0, signal: null })
  assert.equal((await first).ok, true)
})

test('bounds subprocess output and reports a nonzero pnpm exit', async t => {
  const fixture = await packageFixture(t)
  let logged = ''
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm: {
      runPlugin() {
        return {
          stdout: Readable.from(['x'.repeat(100_000)]),
          stderr: Readable.from(['y'.repeat(100_000)]),
          done: Promise.resolve({ exitCode: 1, signal: null }),
          cancel() {},
        }
      },
    },
    profileDir: 'C:\\profile',
    fetchImpl: async () => npmResponse(),
    logger: { warn(value) { logged = value } },
  })
  const result = await invoke(handler)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'router/install-failed')
  assert.match(logged, /earlier output truncated/)
  assert.ok(Buffer.byteLength(logged) < 70 * 1024)
})

test('times out and cancels a stalled package-manager operation', async t => {
  const fixture = await packageFixture(t)
  let cancelled = 0
  const handler = createNpmUpdateHandler({
    moduleUrl: fixture.moduleUrl,
    pnpm: {
      runPlugin() {
        return {
          stdout: Readable.from([]),
          stderr: Readable.from([]),
          done: new Promise(() => {}),
          cancel() { cancelled += 1 },
        }
      },
    },
    profileDir: 'C:\\profile',
    fetchImpl: async () => npmResponse(),
    timeoutMs: 20,
  })
  const result = await invoke(handler)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'router/timeout')
  assert.equal(cancelled, 1)
})

test('registers a dedicated RPC channel with the Desktop profile identity', async t => {
  const fixture = await packageFixture(t)
  let registration
  const profileDir = 'C:\\Users\\cad\\.dsh\\profiles\\desktop'
  const ctx = {
    get(name) {
      if (name === 'connection') return { rpc: { handle(channel, handler) { registration = { channel, handler } } } }
      if (name === 'desktopProfiles') return { current: { name: 'desktop', dir: profileDir } }
      if (name === 'desktopPnpm') return successfulPnpm()
      return undefined
    },
  }
  assert.equal(registerNpmUpdateRoute(ctx, fixture.moduleUrl), true)
  assert.equal(registration.channel, ROUTER_UPDATE_CHANNEL)
  const result = await registration.handler('unknown', {})
  assert.equal(result.error.code, 'router/not-found')
})

test('update RPC registration prefers the caller-bound connection context', () => {
  let channel
  let owner
  const connection = {
    register(registrationOwner, name) {
      owner = registrationOwner
      channel = name
    },
    rpc: { handle: () => { throw new Error('rpc getter must not own the route') } },
  }
  const rawConnection = { rpc: { handle: () => { throw new Error('raw connection must not own the route') } } }
  const ctx = {
    connection,
    desktopProfiles: { current: { dir: 'C:\\profile' } },
    desktopPnpm: { runPlugin: async () => ({ code: 0 }) },
    get: key => key === 'connection' ? rawConnection : undefined,
  }
  assert.equal(registerNpmUpdateRoute(ctx, 'file:///plugin/index.mjs'), true)
  assert.equal(owner, ctx)
  assert.equal(channel, ROUTER_UPDATE_CHANNEL)
})
