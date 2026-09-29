/**
 * Fixed Windows launch adapters for official MiMo Code 0.1.15 and Grok 1.0.41.
 *
 * MiMo source: https://github.com/XiaomiMiMo/MiMo-Code/blob/v0.1.15/packages/opencode/src/cli/cmd/run.ts
 * Grok source: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md
 * Grok npm bootstrap: https://unpkg.com/@xai-official/grok@1.0.41/bin/grok-bootstrap.js
 *
 * We bypass npm's mutable .cmd/JS launcher. Package names, versions, platform
 * binaries, and file digests are fixed here; only model IDs and task text are
 * supplied by the caller. The Host must still approve write mode and confine
 * the process to its isolated workspace.
 */
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createBrotliDecompress } from 'node:zlib'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureNpmPrefixOnPath } from './official-tools-runtime.mjs'

const VERSIONS = Object.freeze({ 'mimo-code': '0.1.15', 'grok-build': '1.0.41' })
const PLATFORMS = Object.freeze({
  'mimo-code': Object.freeze({
    x64: Object.freeze({ package: '@mimo-ai/mimocode-windows-x64', integrity: 'sha256-6nBnONfwCs5+Y+pLp+Vcc4cwuWDDMP0hLBdlQTHpmkw=', size: 135419392 }),
    arm64: Object.freeze({ package: '@mimo-ai/mimocode-windows-arm64', integrity: 'sha256-5w/7e0cy90Smv2sBaIlrdLliel4i2VjEKcWm1I2J6eo=', size: 131460608 }),
  }),
  'grok-build': Object.freeze({
    x64: Object.freeze({ package: '@xai-official/grok-win32-x64', integrity: 'sha256-ZK5odjiiROsE+OE72BdLTcbZgxKRoSnVFUUyDufuaS8=', size: 46488279 }),
    arm64: Object.freeze({ package: '@xai-official/grok-win32-arm64', integrity: 'sha256-oJkk4XYpNvNQBk5jbFReagr8WnbCTWRpXPir0Oa7YWg=', size: 41589854 }),
  }),
})

const WRAPPERS = Object.freeze({
  'mimo-code': Object.freeze({ name: '@mimo-ai/cli', command: 'mimo', bin: 'bin/mimo' }),
  'grok-build': Object.freeze({ name: '@xai-official/grok', command: 'grok', bin: 'bin/grok' }),
})
const FINAL_TEXT_LIMIT = 32_000
const WINDOWS_PROMPT_LIMIT = 12_000

function inside(parent, child) {
  const part = relative(parent, child)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

function packagePath(modules, name) { return join(modules, ...name.split('/')) }

function moduleRoots() {
  const path = process.env.PATH ?? process.env.Path ?? ''
  const roots = new Set()
  for (const raw of path.split(delimiter)) {
    const directory = raw.trim().replace(/^"|"$/g, '')
    if (!directory) continue
    roots.add(join(directory, 'node_modules'))
    if (basename(directory).toLowerCase() === '.bin') roots.add(resolve(directory, '..'))
  }
  return [...roots]
}

async function manifestAt(directory, name, version) {
  try {
    const root = await realpath(directory)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (manifest.name !== name || manifest.version !== version) return null
    return { root, manifest }
  } catch { return null }
}

async function hashFile(filename, decompress = false) {
  const hash = createHash('sha256')
  const stream = decompress
    ? createReadStream(filename).pipe(createBrotliDecompress())
    : createReadStream(filename)
  for await (const chunk of stream) hash.update(chunk)
  return `sha256-${hash.digest('base64')}`
}

async function realFileWithin(root, candidate, workspace) {
  try {
    const file = await realpath(candidate)
    if (!inside(root, file) || file === workspace || inside(workspace, file)) return null
    if (!(await stat(file)).isFile()) return null
    return file
  } catch { return null }
}

async function optionalPackage(wrapper, toolId, platform, modules, workspace) {
  if (wrapper.manifest.optionalDependencies?.[platform.package] !== VERSIONS[toolId]) return null
  const candidates = [
    packagePath(modules, platform.package),
    packagePath(join(wrapper.root, 'node_modules'), platform.package),
  ]
  for (const candidate of candidates) {
    const optional = await manifestAt(candidate, platform.package, VERSIONS[toolId])
    if (!optional || optional.root === workspace || inside(workspace, optional.root)) continue
    return optional
  }
  return null
}

async function findMiMoExecutable(workspace, platform) {
  const wrapperInfo = WRAPPERS['mimo-code']
  for (const modules of moduleRoots()) {
    const wrapper = await manifestAt(packagePath(modules, wrapperInfo.name), wrapperInfo.name, VERSIONS['mimo-code'])
    if (!wrapper || String(wrapper.manifest.bin?.[wrapperInfo.command]).replace(/^\.\//, '') !== wrapperInfo.bin) continue
    const optional = await optionalPackage(wrapper, 'mimo-code', platform, modules, workspace)
    if (!optional) continue
    const file = await realFileWithin(optional.root, join(optional.root, 'bin', 'mimo.exe'), workspace)
    if (!file || (await stat(file)).size !== platform.size) continue
    if (await hashFile(file) !== platform.integrity) continue
    return { file, source: 'official-npm-native-sha256' }
  }
  return null
}

async function grokHome() {
  const configured = process.env.GROK_HOME
  if (configured) return isAbsolute(configured) ? resolve(configured) : null
  try { return join(await realpath(homedir()), '.grok') }
  catch { return join(homedir(), '.grok') }
}

async function findGrokExecutable(workspace, platform) {
  const wrapperInfo = WRAPPERS['grok-build']
  for (const modules of moduleRoots()) {
    const wrapper = await manifestAt(packagePath(modules, wrapperInfo.name), wrapperInfo.name, VERSIONS['grok-build'])
    if (!wrapper || String(wrapper.manifest.bin?.[wrapperInfo.command]).replace(/^\.\//, '') !== wrapperInfo.bin) continue
    const optional = await optionalPackage(wrapper, 'grok-build', platform, modules, workspace)
    if (!optional) continue
    const compressed = await realFileWithin(optional.root, join(optional.root, 'bin', 'grok.exe.br'), workspace)
    if (!compressed || (await stat(compressed)).size !== platform.size) continue
    if (await hashFile(compressed) !== platform.integrity) continue
    const uncompressedIntegrity = await hashFile(compressed, true)
    const home = await grokHome()
    const candidates = [
      ...(home ? [join(home, 'bin', `grok-${VERSIONS['grok-build']}.exe`), join(home, 'bin', 'grok.exe')] : []),
      join(optional.root, 'bin', 'grok.exe'),
    ]
    for (const candidate of candidates) {
      try {
        const file = await realpath(candidate)
        if (file === workspace || inside(workspace, file) || !(await stat(file)).isFile()) continue
        if (await hashFile(file) === uncompressedIntegrity) {
          return { file, source: 'official-npm-native-sha256' }
        }
      } catch { /* try next installed binary */ }
    }
  }
  return null
}

/**
 * Return a fixed executable and arguments for the Host's existing sandboxed
 * process runner, or an unsupported reason. The Host retains its own task,
 * workspace, model, approval, timeout, and cancellation validation.
 */
export async function resolveMiMoGrokLaunch({ toolId, workspace, mode, modelId, task }) {
  if (!(toolId in VERSIONS)) return { unsupported: '未知的 MiMo/Grok 官方工具 ID。' }
  if (process.platform !== 'win32') return { unsupported: 'MiMo/Grok 原生入口目前仅完成 Windows 适配。' }
  if (!isAbsolute(workspace) || !['read-only', 'workspace-write'].includes(mode)) {
    return { unsupported: '缺少有效的绝对工作区或执行模式。' }
  }
  if (modelId != null && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(modelId)) {
    return { unsupported: '模型 ID 格式无效。' }
  }
  if (toolId === 'mimo-code' && modelId && !modelId.includes('/')) {
    return { unsupported: 'MiMo CLI 的模型参数需要 provider/model；请使用 MiMo 中已配置的模型名称，或省略 modelId 使用默认模型。' }
  }
  const platform = PLATFORMS[toolId][process.arch]
  if (!platform) return { unsupported: '当前 Windows CPU 架构没有核验的官方原生程序。' }
  await ensureNpmPrefixOnPath()
  const directory = await realpath(workspace)
  const found = toolId === 'mimo-code'
    ? await findMiMoExecutable(directory, platform)
    : await findGrokExecutable(directory, platform)
  if (!found) return { unsupported: `未找到与官方 npm ${VERSIONS[toolId]} 发行文件哈希一致的 Windows 原生程序。` }

  if (toolId === 'mimo-code') {
    // MiMo's v0.1.15 run command reads all piped stdin and emits JSONL. Its
    // default headless permission requests are auto-rejected; isolated write
    // mode can auto-approve only after the Host has approved/constrained it.
    return {
      ...found,
      args: [
        'run', '--format', 'json', '--dir', directory,
        ...(modelId ? ['--model', modelId] : []),
        ...(mode === 'workspace-write' ? ['--dangerously-skip-permissions'] : []),
      ],
      format: 'mimo-jsonl',
      stdinTask: true,
    }
  }

  // xAI's headless contract takes the prompt in -p. Piped stdin is not the
  // documented task channel, so do not launch with a fixed stub prompt.
  if (typeof task !== 'string' || !task.trim() || task.length > WINDOWS_PROMPT_LIMIT) {
    return { unsupported: `Grok 任务必须是非空文本且不超过 ${WINDOWS_PROMPT_LIMIT} 个 UTF-16 字符，以适应 Windows 命令行长度。` }
  }
  return {
    ...found,
    args: [
      '--no-auto-update', '-p', task, '--cwd', directory,
      '--output-format', 'streaming-json',
      ...(modelId ? ['--model', modelId] : []),
      ...(mode === 'read-only'
        ? ['--tools', 'read_file,grep,list_dir,web_search,web_fetch']
        : ['--always-approve']),
    ],
    format: 'grok-jsonl',
    stdinTask: false,
  }
}

/** Parse vendor JSONL without treating a clean process exit as proof of work. */
export function createMiMoGrokParser(toolId) {
  if (!(toolId in VERSIONS)) throw new TypeError('unsupported vendor parser')
  let protocolError = null
  let vendorError = null
  let finalText = ''
  let terminal = null
  let sessionId = null
  let requestId = null
  let toolErrors = 0
  let events = 0

  return {
    push(line) {
      if (!String(line).trim()) return
      let event
      try { event = JSON.parse(line) }
      catch { protocolError = '官方 CLI 输出了无效 JSONL。'; return }
      if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
        protocolError = '官方 CLI 输出了无效事件。'
        return
      }
      events += 1
      if (toolId === 'mimo-code') {
        if (typeof event.sessionID !== 'string' || !event.sessionID) {
          protocolError = 'MiMo 事件缺少会话 ID。'
          return
        }
        if (sessionId && sessionId !== event.sessionID) {
          protocolError = 'MiMo 混入了其他会话的事件。'
          return
        }
        sessionId = event.sessionID
        if (event.type === 'error') {
          vendorError = 'MiMo 返回了会话错误。'
          terminal = 'failed'
        } else if (event.type === 'step_start') {
          // A previous completed step is not the terminal state of a new step.
          terminal = null
        } else if (event.type === 'step_finish') {
          if (event.part?.type !== 'step-finish' || typeof event.part.reason !== 'string') {
            protocolError = 'MiMo 步骤终态格式无效。'
          } else {
            terminal = event.part.reason === 'stop' ? 'completed' : 'failed'
          }
        } else if (event.type === 'text' && event.part?.type === 'text'
          && typeof event.part.text === 'string' && event.part.time?.end) {
          finalText = event.part.text.slice(-FINAL_TEXT_LIMIT)
        } else if (event.type === 'tool_use' && event.part?.state?.status === 'error') {
          toolErrors += 1
        }
      } else {
        if (event.type === 'error') {
          vendorError = 'Grok 返回了错误事件。'
          terminal = 'failed'
        } else if (event.type === 'text') {
          if (typeof event.data !== 'string') protocolError = 'Grok 文本事件格式无效。'
          else finalText = (finalText + event.data).slice(-FINAL_TEXT_LIMIT)
        } else if (event.type === 'end') {
          if (terminal !== null) protocolError = 'Grok 返回了重复终态。'
          else {
            const reason = String(event.stopReason ?? '').toLowerCase().replaceAll('_', '')
            terminal = reason === 'endturn' ? 'completed' : 'failed'
            if (typeof event.sessionId === 'string') sessionId = event.sessionId
            if (typeof event.requestId === 'string') requestId = event.requestId
          }
        }
      }
    },
    finish(exitCode) {
      const good = exitCode === 0 && !protocolError && !vendorError
        && terminal === 'completed' && finalText.trim().length > 0
        && (toolId !== 'grok-build' || Boolean(sessionId))
      return {
        status: good ? 'succeeded' : 'failed',
        terminalEvent: terminal,
        finalText,
        sessionId,
        requestId,
        toolErrors,
        events,
        ...(!good ? { error: protocolError ?? vendorError ?? `${toolId} 未返回完整的成功终态和回答。` } : {}),
      }
    },
  }
}
