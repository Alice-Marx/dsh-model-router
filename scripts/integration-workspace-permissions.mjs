import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKER_IMAGE } from './integration-linux-isolation.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/integration/workspace-permissions')
const docker = args => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Workspace permission probe failed: ${result.error?.code ?? result.stderr.trim()}`)
  return result.stdout.trim()
}

/**
 * Real-machine boundary probe for the managed-workspace permission contract.
 * The container worker runs as 65532:65532 with no capabilities against a
 * bind-mounted workspace whose REAL permissions are the whole boundary: an
 * operator-granted root works, private-by-owner files fail closed, and the
 * worker cannot chmod/chown its way in. Fixtures prepare only their own tree;
 * no user project is ever chmod/chown-ed by the Agent.
 */
export async function probeWorkspacePermissions() {
  if (process.platform !== 'linux') return { status: 'unavailable', reason: 'requires Linux + Docker', platform: process.platform }
  docker(['image', 'inspect', WORKER_IMAGE])
  await mkdir(OUT, { recursive: true })
  const run = await mkdtemp(join(OUT, 'probe-'))
  const workspace = join(run, 'workspace')
  await mkdir(workspace); await chmod(workspace, 0o777)
  const shared = join(workspace, 'granted.txt'); await writeFile(shared, 'operator-granted'); await chmod(shared, 0o644)
  const secret = join(workspace, 'agent-only.txt'); await writeFile(secret, 'private-by-owner'); await chmod(secret, 0o600)
  const subtree = join(workspace, 'agent-only-dir'); await mkdir(subtree); await chmod(subtree, 0o700); await writeFile(join(subtree, 'nested.txt'), 'nested')
  const program = `
    const fs = require('node:fs/promises');
    (async () => {
      const out = { uid: process.getuid(), gid: process.getgid() };
      out.readGranted = await fs.readFile('/workspace/granted.txt', 'utf8').then(v => v === 'operator-granted').catch(() => false);
      out.writeGranted = await fs.writeFile('/workspace/worker-write.txt', 'written-by-worker').then(() => true).catch(e => e.code);
      out.privateFile = await fs.readFile('/workspace/agent-only.txt', 'utf8').then(() => 'READ_SUCCEEDED').catch(e => e.code);
      out.privateSubtree = await fs.readdir('/workspace/agent-only-dir').then(() => 'LISTED').catch(e => e.code);
      out.chmodOtherOwnersFile = await fs.chmod('/workspace/agent-only.txt', 0o666).then(() => 'CHMOD_SUCCEEDED').catch(e => e.code);
      out.chownOtherOwnersFile = await fs.chown('/workspace/agent-only.txt', 65532, 65532).then(() => 'CHOWN_SUCCEEDED').catch(e => e.code);
      console.log(JSON.stringify(out));
    })().catch(e => { console.error(String(e)); process.exit(3) });
  `
  const raw = docker(['run', '--rm', '--pull=never', '--platform', 'linux/amd64', '--user', '65532:65532', '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m',
    '--mount', `type=bind,src=${workspace},dst=/workspace`, '-w', '/workspace',
    WORKER_IMAGE, 'node', '-e', program])
  const observed = JSON.parse(raw.split('\n').filter(Boolean).pop())
  const workerWrite = await stat(join(workspace, 'worker-write.txt')).catch(() => null)
  const summary = {
    status: 'passed', platform: `${process.platform} ${spawnSync('uname', ['-r'], { encoding: 'utf8' }).stdout.trim()}`,
    image: WORKER_IMAGE, worker: `${observed.uid}:${observed.gid}`, probe: run,
    operatorGrantRead: observed.readGranted === true,
    operatorGrantWrite: observed.writeGranted === true,
    privateFileDenied: observed.privateFile === 'EACCES',
    privateSubtreeDenied: observed.privateSubtree === 'EACCES',
    chmodDenied: observed.chmodOtherOwnersFile === 'EPERM',
    chownDenied: observed.chownOtherOwnersFile === 'EPERM',
    workerFilesOwnedByWorker: workerWrite ? workerWrite.uid === 65532 : false,
    raw: observed,
    limitations: [
      'Synthetic fixture tree only; no real user project was chmod/chown-ed by the Agent',
      'World-access is one operator grant shape; group-based grants need a root-prepared fixture and remain unverified here',
      'This is the worker permission boundary, not an account/AppContainer/network/filesystem isolation claim',
    ],
  }
  assert.equal(summary.worker, '65532:65532')
  assert.equal(summary.operatorGrantRead, true)
  assert.equal(summary.operatorGrantWrite, true)
  assert.equal(summary.privateFileDenied, true, `0600 owner-private file must fail closed, saw ${observed.privateFile}`)
  assert.equal(summary.privateSubtreeDenied, true, `0700 owner-private subtree must fail closed, saw ${observed.privateSubtree}`)
  assert.equal(summary.chmodDenied, true, `worker chmod on another owner's file must fail, saw ${observed.chmodOtherOwnersFile}`)
  assert.equal(summary.chownDenied, true, `worker chown must fail without capabilities, saw ${observed.chownOtherOwnersFile}`)
  assert.equal(summary.workerFilesOwnedByWorker, true, 'worker-created files carry the worker uid')
  return summary
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = await probeWorkspacePermissions()
  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
}
