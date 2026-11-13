import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'
import { createPrivateProfileHome, capabilityProbe, protectProfile } from '../../cli-runtime/src/native-process.mjs'
import { launchAcpProcess } from '../../bot-acp/src/native-launch.mjs'

const execute = promisify(execFile)
const error = code => Object.assign(new Error(code), { code })
const sourceRoot = fileURLToPath(new URL('../../../native/windows-desktop/', import.meta.url))

/** Only bundled native sources and the Host's fixed Windows compiler are used. */
export async function startEmbeddedDesktop(dataRoot) {
  if (process.platform !== 'win32') throw error('LOCAL_DESKTOP_WINDOWS_REQUIRED')
  const home = await createPrivateProfileHome(dataRoot, 'desktop-' + randomBytes(8).toString('hex'), { recursive: true })
  for (const name of ['tmp', 'cache', 'config', 'data', 'appdata', 'local']) await mkdir(join(home, name), { recursive: true, mode: 0o700 })
  const probe = await capabilityProbe({ home })
  if (!probe.available) throw error('LOCAL_DESKTOP_SUPERVISOR_UNAVAILABLE')
  await protectProfile(probe.helper, home)
  const sources = ['Program.cs', 'DesktopLease.cs', 'DesktopStream.cs', 'FullDesktop.cs']
  for (const name of sources) await copyFile(join(sourceRoot, name), join(home, name))
  const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const executable = join(home, 'dsh-desktop-helper.exe')
  try {
    await execute(compiler, ['/nologo', '/optimize+', '/target:winexe', '/platform:anycpu', '/out:' + executable,
      '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
      ...sources.map(name => join(home, name))], { cwd: home, windowsHide: true, timeout: 45_000, maxBuffer: 64_000 })
  } catch { throw error('LOCAL_DESKTOP_BUILD_FAILED') }
  const secretFile = join(home, 'native.secret'), pipeName = 'dsh-desktop-' + randomBytes(12).toString('hex')
  await writeFile(secretFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 })
  const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
  const { supervisor } = await launchAcpProcess({ entry: { path: executable, sha256 },
    args: ['--desktop-mode', 'full', '--pipe', pipeName, '--secret-file', secretFile], cwd: home, home, ttlMs: 2_000_000_000, probe })
  let closed = false, proof = null, stopping = null
  supervisor.events.on('control', value => { if (value.control === 'stopped') proof = value })
  supervisor.events.once('closed', () => { closed = true })
  const stop = () => stopping ??= (async () => {
    supervisor.end(); await supervisor.exit
    return { treeStopped: proof?.treeStopped === true, status: proof?.treeStopped === true ? 'confirmed' : 'unknown' }
  })()
  try {
    const deadline = Date.now() + 20_000
    while (true) {
      if (closed) throw error('LOCAL_DESKTOP_UNAVAILABLE')
      const connected = await new Promise(resolve => {
        const socket = net.createConnection('\\\\.\\pipe\\' + pipeName)
        let done = false
        const finish = value => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value) }
        const timer = setTimeout(() => finish(false), 500)
        socket.once('connect', () => finish(true)); socket.once('error', () => finish(false))
      })
      if (connected) break
      if (Date.now() >= deadline) throw error('LOCAL_DESKTOP_UNAVAILABLE')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  } catch (failure) { if ((await stop()).treeStopped !== true) throw error('LOCAL_COMPUTER_STOP_UNCONFIRMED'); throw failure }
  return { config: { pipeName, secretFile }, get alive() { return !closed }, stop }
}

/** Protect the persisted device keys before Agent/Store creates any secrets. */
export async function protectEmbeddedComputerRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') return
  const home = await createPrivateProfileHome(root, 'acl-' + randomBytes(8).toString('hex'), { recursive: true })
  const probe = await capabilityProbe({ home })
  if (!probe.available) throw error('LOCAL_COMPUTER_PROTECTION_UNAVAILABLE')
  await protectProfile(probe.helper, root)
}
