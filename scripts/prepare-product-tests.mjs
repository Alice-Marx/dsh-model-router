import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
execFileSync(process.execPath, [resolve(root, 'remote-computer-agent/build.mjs')], {
  cwd: root, stdio: 'inherit', windowsHide: true,
})
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    resolve(root, 'native/windows-desktop/build.ps1')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  })
}
