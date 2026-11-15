import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function spawnCliProxyComponent(binary, args, options) {
  const worker = fork(fileURLToPath(new URL('./cli-proxy-worker.mjs', import.meta.url)), [binary, args[1]], {
    cwd: options.cwd, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' }, execPath: process.execPath, execArgv: ['--expose-internals'],
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  return worker
}
export async function stopCliProxyComponent(worker) {
  if (!worker || worker.exitCode !== null) return
  await new Promise((done, reject) => {
    const timer = setTimeout(() => { worker.off('exit', exited); reject(Object.assign(new Error('订阅服务尚未确认停止，请重试停止。'), { code: 'SUBSCRIPTION_STOP_UNCONFIRMED' })) }, 6000)
    const exited = () => { clearTimeout(timer); done() }
    worker.once('exit', exited)
    if (worker.connected && typeof worker.send === 'function') worker.send({ action: 'stop' }, error => { if (error && worker.exitCode !== null) exited() })
    else worker.kill('SIGTERM')
  })
}
