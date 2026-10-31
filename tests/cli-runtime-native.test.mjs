import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { capabilityProbe, nativeProcess, privateEnvironment, protectProfile } from '../packages/cli-runtime/src/native-process.mjs'
import { createCliBootstrap } from '../packages/capability-broker/src/cli-bootstrap.mjs'
import { createAuthority, PolicyError } from '../packages/capability-broker/src/authority.mjs'

const binding = { taskId: 't', attemptId: 'a', machineId: 'm', workspaceId: 'w', location: 'local' }
const fixture = resolve('tests/cli-runtime-fixture.mjs')
async function setup(t) {
  const parent = resolve('tmp/integration/cli-native-tests'); await mkdir(parent, { recursive: true })
  const home = await mkdtemp(join(parent, 'p-')); await mkdir(join(home, 'tmp'))
  const probe = await capabilityProbe({ home })
  if (!probe.available) { t.skip(probe.reason); return null }
  await protectProfile(probe.helper, home)
  return { home, helper: probe.helper }
}
function message(proc, type, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.events.off('message', receive); reject(new Error(`MISSING_${type}: ${proc.stderr}`)) }, timeout)
    const receive = value => { if (value.type === type || value.type === 'fixture-error') { clearTimeout(timer); proc.events.off('message', receive); value.type === 'fixture-error' ? reject(new Error(value.error)) : resolve(value) } }
    proc.events.on('message', receive)
  })
}
async function supervised(t, options) {
  const proc = nativeProcess(options.helper, 'supervise', { executable: process.execPath, args: [fixture], cwd: options.home, ttlMs: 60_000 }, { home: options.home })
  t.after(async () => { proc.end(); await proc.exit })
  const root = await proc.waitControl('spawned')
  return { proc, root }
}

test('native CLI cancellation stops a real child tree and confirms its containment', { timeout: 45_000 }, async t => {
  const options = await setup(t); if (!options) return
  const { proc } = await supervised(t, options)
  let forgedStop = false
  proc.events.on('control', value => { if (value.control === 'stopped') forgedStop = true })
  const forged = message(proc, 'forged-control'); await proc.send({ op: 'forge' }); await forged
  assert.equal(forgedStop, false)
  const pending = message(proc, 'child-started'); await proc.send({ op: 'tree' })
  const child = await pending
  assert.doesNotThrow(() => process.kill(child.pid, 0))
  const stopped = proc.waitControl('stopped')
  proc.end()
  assert.equal((await stopped).treeStopped, true)
  await proc.exit
  if (process.platform === 'win32') assert.throws(() => process.kill(child.pid, 0))
  else {
    try { assert.equal((await readFile(`/proc/${child.pid}/stat`, 'utf8')).split(') ')[1].split(' ')[0], 'Z') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
})

test('private CLI bootstrap rejects an unrelated same-user peer and scopes a real grandchild MCP connection', { timeout: 60_000 }, async t => {
  const options = await setup(t); if (!options) return
  const authority = createAuthority(); t.after(() => authority.dispose())
  const subject = {}; authority.register(subject, { botId: 'bot-a', tools: ['own_ping'] })
  let calls = 0
  const bridge = await createCliBootstrap({ authority, subject, binding, tools: ['own_ping'], home: options.home, helper: options.helper, ttlMs: 55_000,
    handlers: [{ definition: { name: 'own_ping', description: 'Offline peer test', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      parse(value) { if (Object.keys(value).length) throw new PolicyError('INVALID_ARGUMENTS'); return value }, execute() { calls++; return { marker: 'owned' } } }] })
  t.after(() => bridge.close())
  const { proc, root } = await supervised(t, options)
  await bridge.bind(root)
  const { payload } = JSON.parse(await readFile(bridge.descriptorPath, 'utf8'))
  const spec = JSON.parse(payload)
  let shortSocketDirectory
  if(process.platform==='linux'){
    assert.ok(Buffer.byteLength(spec.endpoint)<=103)
    if(dirname(spec.endpoint)!==options.home){
      shortSocketDirectory=dirname(spec.endpoint)
      const stat=await lstat(shortSocketDirectory);assert.equal(stat.uid,process.getuid());assert.equal(stat.mode&0o077,0)
    }
  }
  // This helper is a sibling of the managed CLI, so knowing the public descriptor grants nothing.
  const rogue = nativeProcess(options.helper, 'client', { endpoint: spec.endpoint, serverPid: spec.serverPid, serverStart: spec.serverStart, ttlMs: 5000 }, { home: options.home })
  await rogue.send({ type: 'request', id: 1, op: 'list' })
  const rogueExit = await rogue.exit
  assert.equal(rogueExit.code === 0 || rogueExit.code === 2, true)
  assert.equal(bridge.evidence.rejectedPeers, 1)
  assert.equal(bridge.evidence.requests, 0)
  const connected = message(proc, 'connected')
  await proc.send({ op: 'connect', command: bridge.command, args: bridge.args, env: privateEnvironment(options.home) })
  assert.deepEqual((await connected).tools, ['own_ping'])
  const call = async (name, args) => { const pending = message(proc, 'called'); await proc.send({ op: 'call', name, args }); return (await pending).result }
  assert.equal((await call('other_bot_secret', {})).isError, true)
  assert.equal((await call('own_ping', { botId: 'other-bot' })).isError, true)
  assert.equal(calls, 0)
  assert.notEqual((await call('own_ping', {})).isError, true)
  assert.equal(calls, 1)
  authority.revoke(subject)
  assert.equal((await call('own_ping', {})).isError, true)
  assert.equal(calls, 1)
  const before = bridge.evidence
  assert.equal(before.peer.ownerVerified, true); assert.equal(before.peer.treeVerified, true)
  await bridge.close()
  assert.equal(bridge.closed, true)
  if(shortSocketDirectory)await assert.rejects(lstat(shortSocketDirectory),{code:'ENOENT'})
})

test('CLI descriptor public signature rejects replacement before native connection', { timeout: 15_000 }, async t => {
  const options = await setup(t); if (!options) return
  const authority = createAuthority(); t.after(() => authority.dispose())
  const subject = {}; authority.register(subject, { botId: 'bot-a', tools: [] })
  const bridge = await createCliBootstrap({ authority, subject, binding, tools: [], handlers: [], home: options.home, ttlMs: 10_000, helper: options.helper })
  t.after(() => bridge.close())
  await writeFile(bridge.descriptorPath, JSON.stringify({ payload: '{}', signature: Buffer.alloc(64).toString('base64url') }))
  const child = spawn(bridge.command, bridge.args, { cwd: options.home, env: privateEnvironment(options.home), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', error = ''
  child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { error += bytes })
  const code = await new Promise(resolve => child.once('close', resolve))
  assert.equal(code, 2); assert.equal(output, ''); assert.match(error, /BOOTSTRAP_SIGNATURE/)
})
