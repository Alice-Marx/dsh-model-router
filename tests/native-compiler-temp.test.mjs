import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nativeProcess, privateEnvironment, protectProfile, resolveNativeHelper } from '../packages/cli-runtime/src/native-process.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createCliBootstrap } from '../packages/capability-broker/src/cli-bootstrap.mjs'

const ROOT_ENV = 'DSH_NATIVE_COMPILER_ROOT', SCRATCH_ENV = 'DSH_NATIVE_COMPILER_SCRATCH'
const windows = process.platform === 'win32'
const source = pathToFileURL(resolve('packages/cli-runtime/src/native-process.mjs')).href
const caseRoot = resolve('tmp/integration/native-compiler-temp')
const exists = path => stat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
const timeout = (operation, ms = 45000) => {
  let timer
  return Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('COMPILER_FIXTURE_TIMEOUT')), ms) })]).finally(() => clearTimeout(timer))
}
async function fixture(homeChars = 216) {
  await mkdir(caseRoot, { recursive: true })
  const base = await mkdtemp(join(caseRoot, 'case-'))
  const home = join(base, `h-${'x'.repeat(homeChars - base.length - 3)}`)
  assert.equal(home.length, homeChars)
  for (const name of ['tmp', 'workspace', 'appdata', 'local', 'cache', 'config', 'data']) await mkdir(join(home, name), { recursive: true })
  return { base, home, helper: await resolveNativeHelper() }
}
function collect(proc) {
  const messages = [], controls = [], failures = []
  proc.events.on('message', value => messages.push(value))
  proc.events.on('control', value => controls.push(value))
  proc.events.on('failure', error => failures.push(error.message))
  return { messages, controls, failures }
}
function message(proc, predicate) {
  return timeout(new Promise((resolve, reject) => {
    const clean = () => { proc.events.off('message', receive); proc.events.off('failure', failed); proc.events.off('closed', ended) }
    const receive = value => { if (predicate(value)) { clean(); resolve(value) } }
    const failed = error => { clean(); reject(error) }
    const ended = () => failed(Error('FIXTURE_PROCESS_ENDED'))
    proc.events.on('message', receive); proc.events.once('failure', failed); proc.events.once('closed', ended)
  }))
}
async function scratchNames(home) {
  const root = privateEnvironment(home)[ROOT_ENV]
  return { root, names: root ? (await readdir(root)).filter(name => /^c-/.test(name)) : [] }
}
async function inspectAcls(helper, home, paths) {
  const script = `$ErrorActionPreference='Stop'; $inputValue=[Console]::In.ReadLine()|ConvertFrom-Json; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $values=@(); foreach($path in $inputValue.paths) { $acl=Get-Acl -LiteralPath $path; $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); $values+=@{protected=$acl.AreAccessRulesProtected; ownerMatches=($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -eq $sid); ruleCount=$rules.Count; sidOnly=($rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid -and $rules[0].AccessControlType -eq 'Allow' -and $rules[0].FileSystemRights -eq 'FullControl')} }; [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject $values))`
  const proc = spawn(helper.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: home, env: privateEnvironment(home), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  proc.stdout.on('data', data => { stdout += data }); proc.stderr.on('data', data => { stderr = (stderr + data).slice(-1024) })
  proc.stdin.end(JSON.stringify({ paths }) + '\n')
  const code = await timeout(new Promise(resolve => proc.once('close', resolve)))
  assert.equal(code, 0, stderr)
  return JSON.parse(stdout)
}

test('private environment carries no arbitrary compiler selection or inherited credentials', () => {
  const env = privateEnvironment(resolve('tmp/compiler-env-fixture'), { SystemRoot: process.env.SystemRoot, TEMP: 'untrusted-temp', [ROOT_ENV]: 'model-selected-root', [SCRATCH_ENV]: 'model-selected-scratch', AWS_SECRET_ACCESS_KEY: 'fixture-secret', OPENAI_API_KEY: 'fixture-secret', HTTP_PROXY: 'fixture-secret' })
  assert.notEqual(env[ROOT_ENV], 'model-selected-root')
  assert.equal(env[SCRATCH_ENV], undefined)
  for (const key of ['AWS_SECRET_ACCESS_KEY', 'OPENAI_API_KEY', 'HTTP_PROXY']) assert.equal(env[key], undefined)
  assert.equal(env.TEMP, join(env.HOME, 'tmp'))
})

test('Windows PowerShell compiles/probes at 216/240-character private homes and really protects current-SID ACLs', { skip: !windows, timeout: 90000 }, async () => {
  for (const homeChars of [216, 240]) {
  const { base, home, helper } = await fixture(homeChars)
  const proc = nativeProcess(helper, 'probe', null, { home }), evidence = collect(proc)
  const exit = await timeout(proc.exit)
  assert.equal(exit.code, 0, proc.stderr)
  assert.equal(evidence.messages[0].available, true, JSON.stringify(evidence))
  assert.equal(evidence.messages[0].supervisor, 'windows-job')
  assert.deepEqual(evidence.failures, [])
  await protectProfile(helper, home)
  const root = privateEnvironment(home)[ROOT_ENV]
  assert.ok(root.length <= 140)
  assert.equal(root.startsWith(home), false)
  const acls = await inspectAcls(helper, home, [home, root])
  for (const acl of acls) assert.deepEqual(acl, { protected: true, ownerMatches: true, ruleCount: 1, sidOnly: true })
  await writeFile(join(base, 'probe-acl-evidence.json'), JSON.stringify({ homeChars: home.length, privateTempChars: join(home, 'tmp').length, compilerRootChars: root.length, exit, peer: evidence.messages[0], acls }, null, 2))
  }
})

test('real supervised CLI and SDK MCP grandchildren share a short compiler root while keeping the long private environment and peer checks', { skip: !windows, timeout: 150000 }, async () => {
  const { base, home, helper } = await fixture()
  await protectProfile(helper, home)
  const root = privateEnvironment(home)[ROOT_ENV], before = await scratchNames(home)
  const script = join(base, 'offline-mcp-cli.mjs')
  await writeFile(script, `import { createInterface } from 'node:readline';
import { Client } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/client'))};
import { StdioClientTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/client/stdio'))};
import { privateEnvironment } from ${JSON.stringify(source)};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
emit({kind:'environment',home:process.env.HOME,userprofile:process.env.USERPROFILE,appdata:process.env.APPDATA,temp:process.env.TEMP,tmp:process.env.TMP,cwd:process.cwd(),root:process.env.${ROOT_ENV},hasScratch:Object.hasOwn(process.env,${JSON.stringify(SCRATCH_ENV)}),hasCredential:Object.hasOwn(process.env,'OPENAI_API_KEY')});
const lines=createInterface({input:process.stdin});
lines.once('line',async line=>{const config=JSON.parse(line); const client=new Client({name:'compiler-temp-offline',version:'1.0'}); let transport;
try { transport=new StdioClientTransport({command:config.command,args:config.args,env:privateEnvironment(process.env.HOME),stderr:'pipe'}); transport.stderr?.on('data',()=>{}); await client.connect(transport); const tools=await client.listTools(); const result=await client.callTool({name:'compiler_echo',arguments:{value:23}}); emit({kind:'mcp-result',tools:tools.tools.map(tool=>tool.name),result}); await client.close(); lines.close(); }
catch { emit({kind:'fixture-failure',code:'SDK_MCP_FAILED'}); process.exitCode=2; try {await client.close()}catch{}; lines.close(); }
});
`)
  const authority = createAuthority(), subject = {}
  authority.register(subject, { botId: 'compiler-fixture-bot', tools: ['compiler_echo'], modelRoutes: [] })
  let calls = 0
  const bridge = await createCliBootstrap({ authority, subject, binding: { taskId: 'compiler-task', attemptId: 'attempt-one', machineId: 'local-fixture', workspaceId: 'compiler-workspace', location: 'local' }, tools: ['compiler_echo'], home, ttlMs: 90000, helper,
    handlers: [{ definition: { name: 'compiler_echo', description: 'Offline compiler regression fixture', inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } }, parse: value => value, execute: async value => { calls++; return { echoed: value.value, fixture: true } } }] })
  const proc = nativeProcess(helper, 'supervise', { executable: process.execPath, args: [script], cwd: join(home, 'workspace'), ttlMs: 100000 }, { home, env: { ...privateEnvironment(home), [ROOT_ENV]: 'ignored-model-root', [SCRATCH_ENV]: 'ignored-model-scratch' } })
  const evidence = collect(proc)
  const envWait = message(proc, value => value.kind === 'environment')
  const resultWait = message(proc, value => value.kind === 'mcp-result' || value.kind === 'fixture-failure')
  try {
    const spawned = await proc.waitControl('spawned', 45000)
    const environment = await envWait
    assert.deepEqual(environment, { kind: 'environment', home, userprofile: home, appdata: join(home, 'appdata'), temp: join(home, 'tmp'), tmp: join(home, 'tmp'), cwd: join(home, 'workspace'), root, hasScratch: false, hasCredential: false })
    const allocated = (await scratchNames(home)).names.filter(name => !before.names.includes(name))
    assert.equal(allocated.length, 1)
    const supervisorScratch = join(root, allocated[0])
    assert.equal(await exists(supervisorScratch), true, 'a running helper retains its compiler scratch')
    await bridge.bind({ pid: spawned.pid, start: spawned.start })
    await proc.send({ command: bridge.command, args: bridge.args })
    const result = await resultWait
    assert.equal(result.kind, 'mcp-result', JSON.stringify(result))
    assert.deepEqual(result.tools, ['compiler_echo'])
    assert.deepEqual(JSON.parse(result.result.content[0].text), { echoed: 23, fixture: true })
    assert.equal(calls, 1)
    assert.equal(bridge.evidence.peer.ownerVerified, true)
    assert.equal(bridge.evidence.peer.treeVerified, true)
    assert.equal(bridge.evidence.peer.rootPid, spawned.pid)
    const exit = await timeout(proc.exit)
    assert.equal(exit.code, 0, proc.stderr)
    assert.ok(evidence.controls.some(value => value.control === 'stopped' && value.treeStopped === true && value.containment === 'windows-job'))
    assert.equal(await exists(supervisorScratch), false, 'only confirmed exit plus Job tree-stop permits cleanup')
    assert.deepEqual(evidence.failures, [])
    await writeFile(join(base, 'nested-sdk-mcp-evidence.json'), JSON.stringify({ homeChars: home.length, compilerRootChars: root.length, sameRootInherited: environment.root === root, privateEnvironmentPreserved: true, scratchEnvRemoved: !environment.hasScratch, calls, peer: bridge.evidence.peer, exit, stopped: evidence.controls.find(value => value.control === 'stopped') }, null, 2))
  } finally { proc.end(); await timeout(proc.exit).catch(() => { proc.child.kill() }); await bridge.close() }
})

test('scratch cleanup waits for process exit and preserves unexpected contents and abrupt-exit uncertainty', { skip: !windows, timeout: 120000 }, async () => {
  const { base, home, helper } = await fixture()
  for (const scenario of ['unexpected-directory', 'abrupt-exit']) {
    const before = await scratchNames(home)
    const proc = nativeProcess(helper, 'supervise', { executable: process.execPath, args: ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'], cwd: home, ttlMs: 60000 }, { home })
    const evidence = collect(proc)
    try {
      const spawned = await proc.waitControl('spawned', 45000)
      const current = await scratchNames(home), created = current.names.filter(name => !before.names.includes(name))
      assert.equal(created.length, 1)
      const scratch = join(current.root, created[0])
      assert.equal(await exists(scratch), true)
      if (scenario === 'unexpected-directory') { await mkdir(join(scratch, 'unknown-owned-content')); proc.end() }
      else proc.child.kill()
      const exit = await timeout(proc.exit)
      const deadline = Date.now() + 10000
      let childAlive = true
      while (childAlive && Date.now() < deadline) {
        try { process.kill(spawned.pid, 0); await new Promise(resolve => setTimeout(resolve, 25)) }
        catch (error) { if (error.code !== 'ESRCH') throw error; childAlive = false }
      }
      assert.equal(childAlive, false, 'the actual Job child has exited before the fixture finishes')
      assert.equal(await exists(scratch), true, 'unknown or abrupt helper state is retained, never recursively removed')
      if (scenario === 'unexpected-directory') assert.ok(evidence.controls.some(value => value.control === 'stopped' && value.treeStopped === true))
      else assert.ok(exit.code !== 0 || exit.signal !== null)
      await writeFile(join(base, `${scenario}-evidence.json`), JSON.stringify({ scenario, retained: true, exit, stopped: evidence.controls.find(value => value.control === 'stopped') ?? null }, null, 2))
    } finally { if (!proc.closed) { proc.end(); await timeout(proc.exit).catch(() => { proc.child.kill() }) } }
  }
})

test('invalid compiler hints fail with a bounded code rather than paths or environment text', { skip: !windows, timeout: 45000 }, async () => {
  const { home, helper } = await fixture()
  const secretMarker = 'fixture-private-environment-marker'
  const proc = spawn(helper.executable, [...helper.prefix, '-Mode', 'probe'], { cwd: home, env: { ...privateEnvironment(home), [ROOT_ENV]: `${home}\\${secretMarker}`, [SCRATCH_ENV]: `${home}\\${secretMarker}\\scratch` }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  proc.stdout.on('data', data => { stdout += data }); proc.stderr.on('data', data => { stderr += data })
  const code = await timeout(new Promise(resolve => proc.once('close', resolve)))
  assert.equal(code, 2)
  assert.equal(stdout, '')
  assert.match(stderr.trim(), /^NATIVE_PEER_REFUSED: NATIVE_COMPILER_FAILED$/)
  assert.equal(stderr.includes(secretMarker), false)
  assert.equal(stderr.includes(home), false)
})
