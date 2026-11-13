import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pinAcpEntry } from '../../bot-acp/src/native-launch.mjs'

/** Owner-selected executable, verified without loading an account or sending a prompt. */
export async function inspectCliEntry(input, _driver, signal, root) {
  const invalid = () => { throw Object.assign(new Error('请使用实际可执行文件的绝对路径；Node/Python CLI 可填写解释器和脚本，不能填写 shell 命令。'), { code: 'CLI_CHAT_ENTRY_INVALID' }) }
  if (!isAbsolute(input.executable ?? '') || /\.(?:cmd|bat|ps1)$/i.test(input.executable) || input.script && !isAbsolute(input.script)) invalid()
  signal?.throwIfAborted()
  const executable = await realpath(input.executable), script = input.script ? await realpath(input.script) : null
  for (const file of [executable, script].filter(Boolean)) { const info = await stat(file); if (!info.isFile() || info.size > 256_000_000) invalid() }
  const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
  const entry = { executable, sha256, version: input.version, ...(script ? { script, scriptSha256: createHash('sha256').update(await readFile(script)).digest('hex') } : {}) }
  const home = join(root, 'entry-check-' + randomUUID()); await mkdir(home, { recursive: true, mode: 0o700 })
  await pinAcpEntry(entry, home)
  signal?.throwIfAborted()
  return entry
}
