import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const WORKER_IMAGE = 'node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d'
const docker = args => {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`Owned container probe failed: ${result.error?.code ?? result.stderr.trim()}`)
  return result.stdout.trim()
}

/** A synthetic Linux container boundary test, not a deployed Bot worker. */
export async function probeLinuxIsolation() {
  assert.equal(process.platform, 'linux', 'Linux isolation probe requires Linux + Docker')
  const parent = join(ROOT, 'tmp/integration/linux-isolation')
  await mkdir(parent, { recursive: true })
  const run = await mkdtemp(join(parent, 'probe-'))
  const workspace = join(run, 'workspace-b')
  const privateRoot = join(run, 'private-a')
  await mkdir(workspace)
  await chmod(workspace, 0o777)
  await mkdir(privateRoot, { mode: 0o700 })
  const secretPath = join(privateRoot, 'synthetic.txt')
  await writeFile(secretPath, 'synthetic-private-a-no-user-data', { mode: 0o600 })
  await writeFile(join(workspace, 'input.txt'), 'synthetic-workspace-b')
  const before = createHash('sha256').update(await readFile(secretPath)).digest('hex')
  const image = JSON.parse(docker(['image', 'inspect', WORKER_IMAGE]))[0]
  assert.equal(image.Architecture, 'amd64')
  const tag = randomUUID()
  const cidFile = join(run, 'container-id')
  const program = `
    const fs = require('node:fs/promises');
    const net = require('node:net');
    (async () => {
      const result = { uid: process.getuid(), pid: process.pid, node: process.version };
      result.workspaceRead = await fs.readFile('/workspace/input.txt', 'utf8') === 'synthetic-workspace-b';
      await fs.writeFile('/workspace/output.txt', 'synthetic-worker-output');
      result.workspaceWrite = true;
      try { await fs.readFile(${JSON.stringify(secretPath)}); result.privateReadDenied = false; }
      catch (error) { result.privateReadDenied = ['ENOENT','EACCES','EPERM'].includes(error.code); }
      try { await fs.writeFile('/outside-write', 'no'); result.rootWriteDenied = false; }
      catch (error) { result.rootWriteDenied = ['EROFS','EACCES','EPERM'].includes(error.code); }
      const status = await fs.readFile('/proc/self/status', 'utf8');
      result.noNewPrivileges = /NoNewPrivs:\\s+1/.test(status);
      result.noCapabilities = /CapEff:\\s+0+/.test(status);
      result.noInheritedCredentials = !Object.keys(process.env).some(key => /API_KEY|TOKEN|PASSWORD|COOKIE|SECRET/i.test(key));
      result.networkDenied = await new Promise(resolve => {
        const socket = net.connect({host:'192.0.2.1',port:443});
        socket.once('error', () => { socket.destroy(); resolve(true); });
        socket.once('connect', () => { socket.destroy(); resolve(false); });
        socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
      });
      console.log(JSON.stringify(result));
    })().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
  `
  let result
  try {
    const output = docker(['run', '--rm', '--pull=never', '--platform', 'linux/amd64', '--cidfile', cidFile,
      '--label', `dsh-integration-run=${tag}`, '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--user', '65532:65532', '--pids-limit=64', '--memory=128m', '--cpus=0.5',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,src=${workspace},dst=/workspace`,
      '--workdir', '/workspace', WORKER_IMAGE, 'node', '--eval', program])
    result = JSON.parse(output)
    assert.equal(result.uid, 65532)
    assert.equal(result.pid, 1)
    for (const key of ['workspaceRead', 'workspaceWrite', 'privateReadDenied', 'rootWriteDenied', 'noNewPrivileges', 'noCapabilities', 'noInheritedCredentials', 'networkDenied']) assert.equal(result[key], true, key)
    assert.equal(await readFile(join(workspace, 'output.txt'), 'utf8'), 'synthetic-worker-output')
    assert.equal(createHash('sha256').update(await readFile(secretPath)).digest('hex'), before)
    const summary = { status: 'passed-for-described-checks', platform: process.platform, hostNode: process.version,
      imageDigest: WORKER_IMAGE, imageId: image.Id, observations: result, actualModelCalls: 0,
      limitations: ['Synthetic container workload, not DSH or a product remote agent', 'Linux only; no Windows isolation evidence',
        'Docker daemon and host remain trusted; no privileged/socket mounts', 'No task cancellation, managed worker restart or file-transfer protocol implemented'] }
    await writeFile(join(run, 'summary.json'), JSON.stringify(summary, null, 2)+'\n')
    return { ...summary, rawEvidence: relative(ROOT, run) }
  } finally {
    // Remove only this invocation's container, after checking its immutable id and owned label.
    let id
    try { id = (await readFile(cidFile, 'utf8')).trim() } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (id) {
      assert.match(id, /^[a-f0-9]{64}$/)
      const inspect = spawnSync('docker', ['container', 'inspect', id], { encoding: 'utf8', timeout: 5000 })
      if (inspect.status === 0) {
        const container = JSON.parse(inspect.stdout)[0]
        assert.equal(container.Config.Labels['dsh-integration-run'], tag, 'Only the owned test container may be removed')
        docker(['rm', '--force', id])
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  probeLinuxIsolation().then(value => process.stdout.write(JSON.stringify(value, null, 2)+'\n'))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
