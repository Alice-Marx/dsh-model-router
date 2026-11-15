// This worker holds the component's process handle. Losing the Host IPC pipe
// stops the component as well, including when the Host is terminated abruptly.
import { spawn } from 'node:child_process'
import { dirname, isAbsolute } from 'node:path'
const [binary, config] = process.argv.slice(2)
if (!process.send || !isAbsolute(binary ?? '') || !isAbsolute(config ?? '')) process.exit(2)
let component, stopping = false, finished = false, timer
const finish = code => { if (finished) return; finished = true; clearTimeout(timer); process.exitCode = code ?? 1; if (process.connected) process.disconnect() }
const stop = () => {
  if (stopping || finished) return
  stopping = true
  if (!component || component.exitCode !== null) { finish(0); return }
  component.kill('SIGTERM')
  timer = setTimeout(() => { if (component.exitCode === null) component.kill('SIGKILL') }, 2000)
}
process.on('disconnect', stop)
process.on('message', message => { if (message?.action === 'stop') stop() })
process.on('SIGTERM', stop); process.on('SIGINT', stop)
component = spawn(binary, ['--config', config], { cwd: dirname(config), env: process.env, windowsHide: true, stdio: 'ignore' })
component.once('error', () => finish(1))
component.once('exit', code => finish(stopping ? 0 : code ?? 1))
component.once('spawn', () => { if (process.connected) process.send({ componentPid: component.pid }, () => {}); else stop() })
if (!process.connected) stop()
