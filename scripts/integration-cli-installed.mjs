// Installation-attested, non-inference protocol probe for the real Codex CLI 0.163.0.
//
// It drives the genuine createCodexSession / native-peer / real app-server path to prove:
//   - the pinned executable content+version (via the existing pinCodexExecutable),
//   - the effective profile exposes only this task's dsh_task MCP with a fixed read-only policy,
//   - a real MCP tool listing and a task-owned fixture capability call across the native bridge,
//   - out-of-scope / spoofed capability rejection,
//   - graceful close with native process-tree reclamation.
//
// Hard boundaries (never done here): no session.run / turn/start, no model/list-as-availability,
// no inference, no credential provisioning, no reading of any existing profile or model-pool key.
// Both provider base URLs point at a local 403 sink so any request is refused and counted.
// The model string is a fixed configuration identity only; it is never proof of a real model.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, realpath, lstat } from 'node:fs/promises'
import { isAbsolute, join, resolve, relative, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthority, PolicyError } from '../packages/capability-broker/src/authority.mjs'
import { createCodexSession, pinCodexExecutable } from '../packages/cli-runtime/src/codex-runtime.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED_OUT_ROOT = resolve(join(ROOT, 'tmp/integration/step-cli-installed'))
const EXPECTED_VERSION = '0.163.0'
// A fixed synthetic configuration identity. Not a real model and never an availability claim.
const MODEL = 'gpt-installed-probe'
const TOOL = 'read_task_marker'
const MARKER = 'cli-installed-readonly-marker-v1'
const OPERATION_ID = 'cli-installed-probe'
// The exact app-server JSON-RPC surface this probe is permitted to reach. thread/start happens
// only inside createCodexSession' own init; run()/model/list are never referenced by the facade.
const METHOD_ALLOWLIST = ['initialize', 'initialized', 'config/read', 'thread/start', 'mcpServerStatus/list', 'mcpServer/tool/call']

function fail(code) { throw new TypeError(code) }

// --- Strict argument parsing: only the four documented flags, each exactly once. ---
const argv = process.argv.slice(2)
const parsed = {}
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (typeof token !== 'string' || !token.startsWith('--')) fail('UNKNOWN_ARGUMENT')
  const eq = token.indexOf('=')
  const name = eq >= 0 ? token.slice(2, eq) : token.slice(2)
  const value = eq >= 0 ? token.slice(eq + 1) : argv[++i]
  if (value === undefined) fail('MISSING_VALUE:' + name)
  if (parsed[name] !== undefined) fail('DUPLICATE_ARGUMENT:' + name)
  parsed[name] = value
}
for (const name of ['entry', 'sha256', 'version', 'out']) if (parsed[name] === undefined) fail('MISSING_FLAG:' + name)
for (const name of Object.keys(parsed)) if (!['entry', 'sha256', 'version', 'out'].includes(name)) fail('UNKNOWN_FLAG:' + name)

const entryArg = parsed.entry
if (!isAbsolute(entryArg)) fail('ENTRY_MUST_BE_ABSOLUTE')
const sha256 = parsed.sha256
if (!/^[a-f0-9]{64}$/.test(sha256)) fail('INVALID_SHA256')
if (parsed.version !== EXPECTED_VERSION) fail('VERSION_MUST_BE_' + EXPECTED_VERSION)
const out = resolve(parsed.out)
const outRel = relative(ALLOWED_OUT_ROOT, out)
if (outRel === '..' || outRel.startsWith('..' + sep) || isAbsolute(outRel)) fail('OUT_OUTSIDE_ALLOWED_DIR')
if (outRel !== '' && outRel.split(sep).includes('..')) fail('OUT_OUTSIDE_ALLOWED_DIR')

const diagnostics = join(out, 'diagnostics')
await mkdir(out, { recursive: true, mode: 0o700 })
// This developer probe may only write its owned fixture tree. A pre-existing
// junction below it must not redirect diagnostics into a personal profile.
for(let current=out;;current=dirname(current)){
  if((await lstat(current)).isSymbolicLink())fail('OUT_LINK_REFUSED')
  if(current===ROOT)break
  if(dirname(current)===current)fail('OUT_OUTSIDE_PROJECT')
}
if(await realpath(out)!==out)fail('OUT_NOT_CANONICAL')
await mkdir(diagnostics, { recursive: true, mode: 0o700 })
if((await lstat(diagnostics)).isSymbolicLink())fail('OUT_LINK_REFUSED')
const runtimeRoot = await mkdtemp(join(out, 'runtime-'))
const workspace = join(runtimeRoot, 'workspace')
await mkdir(workspace, { recursive: true, mode: 0o700 })
// A genuine, read-only fixture artifact that the owned handler reads through the native bridge.
await writeFile(join(workspace, 'task.marker'), MARKER + '\n', { flag: 'wx', mode: 0o600 })

// --- Local 403 sink: every provider attempt (including /plugins/featured) is refused and counted. ---
const sinkRequests = []
const sink = createServer((req, res) => {
  const observation={method:req.method,path:String(req.url??'').split('?')[0],responseStatus:null,responseFinished:false}
  sinkRequests.push(observation)
  res.once('finish',()=>{observation.responseStatus=res.statusCode;observation.responseFinished=true})
  res.writeHead(403); res.end('protocol-only fixture; all provider requests refused')
})
await new Promise(done => sink.listen(0, '127.0.0.1', done))
const sinkPort = sink.address().port
const openaiBaseUrl = `http://127.0.0.1:${sinkPort}/v1`
const chatgptBaseUrl = `http://127.0.0.1:${sinkPort}`

const authority = createAuthority()
const subject = {}
const binding = { taskId: 'cli-installed', attemptId: 'attempt-1', machineId: 'local', workspaceId: 'probe', location: 'local' }
authority.register(subject, { botId: 'installed-probe-bot', tools: [TOOL], modelRoutes: [{ provider: 'openai', model: MODEL }] })
let capabilityCalls = 0
const empty = value => { if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) throw new PolicyError('INVALID_ARGUMENTS'); return {} }
const handlers = [{
  definition: { name: TOOL, description: 'Read the task-local read-only marker', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  parse: empty,
  execute: async (_args, { binding: callBinding }) => {
    capabilityCalls += 1
    const marker = (await readFile(join(workspace, 'task.marker'), 'utf8')).trim()
    return { marker, taskId: callBinding.taskId, attemptId: callBinding.attemptId }
  },
}]

const checks = []
const failures = []
const progress = []
let session
let stopped = null
let snapshot = null
let entryDigest = null
let fatalError = null

const record = (name, ok, detail) => { const value = { name, ok: !!ok, detail: detail ?? null }; checks.push(value); if (!value.ok) failures.push(name) }

try {
  // (1) Explicit re-verification gate: real content digest + `codex-cli 0.163.0` version.
  const pinned = await pinCodexExecutable({ executable: entryArg, sha256, version: EXPECTED_VERSION }, runtimeRoot)
  entryDigest = pinned.sha256
  record('entryContentAndVersionVerified', true, { version: pinned.version })

  session = await createCodexSession({
    authority, subject, binding, operationId: OPERATION_ID,
    runtimeRoot, workspace, requestedModel: MODEL,
    entry: { executable: entryArg, sha256, version: EXPECTED_VERSION },
    deadlineMs: 90_000,
    providerConfig: { openaiBaseUrl, chatgptBaseUrl },
    tools: [TOOL], handlers,
    onProgress: value => { progress.push(value); if (progress.length > 512) progress.shift() },
  })
  // createCodexSession already ran initialize -> initialized -> config/read (assertEffectiveProfile)
  // -> thread/start internally; a return here means the effective profile matched exactly.
  record('sessionInitializedReadOnlyProfile', true)
  record('effectiveProfileIsolated', true)

  // Facade deliberately omits run()/listModels(); this is the method allowlist enforcement.
  const facade = {
    listCapabilities: (...a) => session.listCapabilities(...a),
    callCapability: (...a) => session.callCapability(...a),
    snapshot: () => session.snapshot(),
    close: (...a) => session.close(...a),
  }
  const rootPid = session.snapshot().process?.pid ?? null

  // (2) Only this task's dsh_task MCP exists, exposing exactly our fixture tool.
  const inventory = await facade.listCapabilities()
  const server = inventory?.data?.[0]
  const onlyDshTask = Array.isArray(inventory?.data) && inventory.data.length === 1 && server?.name === 'dsh_task'
  const listedTools = server?.tools ? Object.keys(server.tools).sort() : []
  record('profileExposesOnlyDshTaskMcp', onlyDshTask)
  record('fixtureCapabilityListed', onlyDshTask && JSON.stringify(listedTools) === JSON.stringify([TOOL]))

  // (3) A real fixture capability call across the native bridge reads the marker.
  const call = await facade.callCapability(TOOL, {})
  let callParsed = null
  try { callParsed = call?.content?.[0]?.text ? JSON.parse(call.content[0].text) : null } catch { callParsed = null }
  record('fixtureCapabilityInvoked', !call?.isError && capabilityCalls === 1 && callParsed?.marker === MARKER, { taskId: callParsed?.taskId ?? null })

  // (4) A capability outside the allow-table is refused by the adapter.
  let outOfScopeRejected = false
  try { await facade.callCapability('other_bot_secret', {}) } catch (error) { outOfScopeRejected = /TOOL_DENIED/.test(error.message) }
  record('outOfScopeCapabilityRejected', outOfScopeRejected && capabilityCalls === 1)

  // (5) Spoofed arguments are refused by the handler parse; no extra execution.
  const spoof = await facade.callCapability(TOOL, { scope: 'other' })
  record('spoofedArgumentsRejected', spoof?.isError === true && capabilityCalls === 1)

  // (6) Grant revocation mid-session stops further capability execution (informational).
  authority.revoke(subject)
  let revocationStops = false
  try { const revoked = await facade.callCapability(TOOL, {}); revocationStops = revoked?.isError === true && capabilityCalls === 1 }
  catch (error) { revocationStops = /CLI_(STOPPING|CLOSED|GRANT_REVOKED|EXITED)/.test(error.message) && capabilityCalls === 1 }

  // (7) Close and confirm native process-tree reclamation.
  stopped = await facade.close()
  record('closeTreeStopped', stopped?.treeStopped === true, { reason: stopped?.reason ?? null, containment: stopped?.containment ?? null })
  let reclaimed = null
  if (rootPid != null) { try { process.kill(rootPid, 0); reclaimed = false } catch (error) { reclaimed = error.code === 'EPERM' ? false : true } }
  record('nativeProcessReclaimed', reclaimed === true, { rootPidPresent: rootPid != null })

  snapshot = session.snapshot()
  record('zeroTurnDispatch', snapshot.cliTurnRequestsDispatched === 0)
  const authPresent=await lstat(join(session.home,'auth.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})
  record('noCredentialsProvisioned', !authPresent, { credentialsProvisioned: false, existingProfileSupplied: false, authFilePresent:authPresent })
  record('allProviderRequestsRefused', sinkRequests.every(r=>r.responseFinished&&r.responseStatus===403), { attempts: sinkRequests.length })
} catch (error) {
  fatalError = error
  stopped = stopped ?? session?.snapshot?.()?.stopEvidence ?? null
  try { if (session) stopped = await session.close() } catch { /* bounded: never mask the original failure */ }
  snapshot = session?.snapshot?.() ?? null
}

// Always close the sink and dispose the in-memory authority.
try { sink.closeAllConnections?.() } catch { /* older runtimes */ }
await new Promise(done => sink.close(done))
authority.dispose()

// --- Private diagnostics (ignored tmp; never printed to the console). ---
const nativeError = fatalError?.nativeError ?? snapshot?.bridge?.nativeError ?? ''
await writeFile(join(diagnostics, 'session-snapshot.json'), JSON.stringify({ snapshot, stopEvidence: stopped, entry: entryDigest ? { sha256: entryDigest } : null, runtimeRoot, capabilityCalls }, null, 2) + '\n')
await writeFile(join(diagnostics, 'native-error.log'), String(nativeError).slice(-8192) + '\n')
await writeFile(join(diagnostics, 'sink-requests.json'), JSON.stringify(sinkRequests, null, 2) + '\n')
await writeFile(join(diagnostics, 'progress.json'), JSON.stringify(progress, null, 2) + '\n')

const status = fatalError ? 'failed' : failures.length ? 'failed' : 'passed'
const passedChecks = checks.filter(c => c.ok).length

// --- Public summary: sha/version/platform/check items/counts only. No install path, profile,
//     raw config, provider URL, token/secret or owner SID. ---
const summary = {
  status,
  kind: 'real-codex-installed-non-inference',
  version: EXPECTED_VERSION,
  platform: process.platform,
  entrySha256: entryDigest ?? sha256,
  checks: Object.fromEntries(checks.map(c => [c.name, c.ok])),
  counts: {
    checksTotal: checks.length,
    checksPassed: passedChecks,
    checksFailed: failures.length,
    capabilityCalls,
    providerRequestAttempts: sinkRequests.length,
    actualModelCalls: 0,
    cliTurnRequestsDispatched: snapshot?.cliTurnRequestsDispatched ?? 0,
  },
  methodAllowlist: METHOD_ALLOWLIST,
  providerRequestsAllRefused: sinkRequests.every(r=>r.responseFinished&&r.responseStatus===403),
  providerRequestPaths: sinkRequests.map(r => ({ method: r.method, path: r.path })),
  nativePeer: snapshot ? { peer: snapshot.capabilityProbe?.peer ?? null, supervisor: snapshot.capabilityProbe?.supervisor ?? null } : null,
  stopEvidence: stopped ? { treeStopped: stopped.treeStopped, reason: stopped.reason ?? null, containment: stopped.containment ?? null } : null,
  credentialsProvisioned: false,
  existingProfileSupplied: false,
  modelIdentityIsConfigOnly: true,
  failure: fatalError ? (/^[A-Z][A-Z0-9_]{1,79}(?=:|$)/.exec(String(fatalError.code??fatalError.message))?.[0]??'CLI_INSTALLED_PROTOCOL_FAILED') : null,
  limitations: [
    'Protocol and capability scope only; no turn/start, no inference, no model/list-as-availability',
    'The configured model string is a fixed identity and is never proof of a real model or quota',
    'An isolated profile and MCP scope do not by themselves provide OS file isolation',
    'No OS-level trace of every file read or network destination is claimed; provider attempts reaching the configured sink are recorded and refused',
  ],
}
await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
if (status !== 'passed') process.exitCode = 1
