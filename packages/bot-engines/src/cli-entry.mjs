import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { pinAcpEntry } from '../../bot-acp/src/native-launch.mjs'
import { inspectAntigravityEntry } from './antigravity-runtime.mjs'
const digest = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }

/** Owner-selected executable, verified without loading an account or sending a prompt. */
export async function inspectCliEntry(input, _driver, signal, root) {
  if (_driver === 'antigravityAgent') return inspectAntigravityEntry(input, { signal, root })
  if (_driver === 'deepseekAgent' && (!input.script || input.version !== '0.2.2-rc.2')) throw Object.assign(new Error('DeepSeek ACP 需要 dsh 0.2.2-rc.2 的 Node 和入口脚本。'), { code: 'DEEPSEEK_NODE_ENTRY_REQUIRED' })
  const invalid = () => { throw Object.assign(new Error('请使用实际可执行文件的绝对路径；Node/Python CLI 可填写解释器和脚本，不能填写 shell 命令。'), { code: 'CLI_CHAT_ENTRY_INVALID' }) }
  if (!isAbsolute(input.executable ?? '') || /\.(?:cmd|bat|ps1)$/i.test(input.executable) || input.script && !isAbsolute(input.script)) invalid()
  signal?.throwIfAborted()
  const executable = await realpath(input.executable), script = input.script ? await realpath(input.script) : null
  for (const file of [executable, script].filter(Boolean)) { const info = await stat(file); if (!info.isFile() || info.size > 1_500_000_000) invalid() }
  const sha256 = await digest(executable)
  const entry = { executable, sha256, version: input.version, ...(script ? { script, scriptSha256: await digest(script) } : {}) }
  const home = join(root, 'entry-check-' + randomUUID()); await mkdir(home, { recursive: true, mode: 0o700 })
  await pinAcpEntry(entry, home)
  signal?.throwIfAborted()
  return entry
}
