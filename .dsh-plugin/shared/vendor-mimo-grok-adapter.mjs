/**
 * Fixed Windows launch adapters for official MiMo Code and Grok Build (any
 * installed version; developed against MiMo 0.1.15 and Grok 1.0.41).
 *
 * MiMo source: https://github.com/XiaomiMiMo/MiMo-Code/blob/v0.1.15/packages/opencode/src/cli/cmd/run.ts
 * Grok source: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md
 * Grok npm bootstrap: https://unpkg.com/@xai-official/grok@1.0.41/bin/grok-bootstrap.js
 *
 * We bypass npm's mutable .cmd/JS launcher. Package names and platform
 * binaries are fixed here; only model IDs and task text are supplied by the
 * caller. Neither vendor signs its Windows binary, so the native program must
 * equal the file in the official npm tarball of the installed version, as
 * attested at runtime by registry.npmjs.org (see npm-attestation.mjs). The Host
 * must still approve write mode and confine the process to its isolated workspace.
 */
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { npmAttestor } from './npm-attestation.mjs'
import { isReleaseVersion } from './latest-versions.mjs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createBrotliDecompress } from 'node:zlib'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureNpmPrefixOnPath } from './official-tools-runtime.mjs'
import { usageFromEvents } from './task-executors.mjs'

const TOOL_IDS = Object.freeze(['mimo-code', 'grok-build'])
const PLATFORMS = Object.freeze({
  'mimo-code': Object.freeze({
    x64: Object.freeze({ package: '@mimo-ai/mimocode-windows-x64', file: 'bin/mimo.exe' }),
    arm64: Object.freeze({ package: '@mimo-ai/mimocode-windows-arm64', file: 'bin/mimo.exe' }),
  }),
  'grok-build': Object.freeze({
    x64: Object.freeze({ package: '@xai-official/grok-win32-x64', file: 'bin/grok.exe.br' }),
    arm64: Object.freeze({ package: '@xai-official/grok-win32-arm64', file: 'bin/grok.exe.br' }),
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

async function manifestAt(directory, name, version = null) {
  try {
    const root = await realpath(directory)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (manifest.name !== name || !isReleaseVersion(manifest.version)) return null
    if (version !== null && manifest.version !== version) return null
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

async function optionalPackage(wrapper, platform, modules, workspace) {
  // The wrapper pins its platform package to its own version.
  const version = wrapper.manifest.optionalDependencies?.[platform.package]
  if (version !== wrapper.manifest.version) return null
  const candidates = [
    packagePath(join(wrapper.root, 'node_modules'), platform.package),
    packagePath(modules, platform.package),
  ]
  for (const candidate of candidates) {
    const optional = await manifestAt(candidate, platform.package, version)
    if (!optional || optional.root === workspace || inside(workspace, optional.root)) continue
    return optional
  }
  return null
}

async function findMiMoExecutable(workspace, platform, attestor, problems) {
  const wrapperInfo = WRAPPERS['mimo-code']
  for (const modules of moduleRoots()) {
    const wrapper = await manifestAt(packagePath(modules, wrapperInfo.name), wrapperInfo.name)
    if (!wrapper || String(wrapper.manifest.bin?.[wrapperInfo.command]).replace(/^\.\//, '') !== wrapperInfo.bin) continue
    const optional = await optionalPackage(wrapper, platform, modules, workspace)
    if (!optional) continue
    const file = await realFileWithin(optional.root, join(optional.root, ...platform.file.split('/')), workspace)
    if (!file) continue
    const attested = await attestor.matches(file, platform.package, optional.manifest.version, platform.file)
    if (!attested.ok) { problems.push(attested.reason); continue }
    return { file, version: optional.manifest.version, source: 'official-npm-registry-attested' }
  }
  return null
}

async function grokHome() {
  const configured = process.env.GROK_HOME
  if (configured) return isAbsolute(configured) ? resolve(configured) : null
  try { return join(await realpath(homedir()), '.grok') }
  catch { return join(homedir(), '.grok') }
}

async function findGrokExecutable(workspace, platform, attestor, problems) {
  const wrapperInfo = WRAPPERS['grok-build']
  for (const modules of moduleRoots()) {
    const wrapper = await manifestAt(packagePath(modules, wrapperInfo.name), wrapperInfo.name)
    if (!wrapper || String(wrapper.manifest.bin?.[wrapperInfo.command]).replace(/^\.\//, '') !== wrapperInfo.bin) continue
    const optional = await optionalPackage(wrapper, platform, modules, workspace)
    if (!optional) continue
    const version = optional.manifest.version
    const compressed = await realFileWithin(optional.root, join(optional.root, ...platform.file.split('/')), workspace)
    if (!compressed) continue
    const attested = await attestor.matches(compressed, platform.package, version, platform.file)
    if (!attested.ok) { problems.push(attested.reason); continue }
    // The attested .br decompresses to the exact program the bootstrap expands.
    const uncompressedIntegrity = await hashFile(compressed, true)
    const home = await grokHome()
    const candidates = [
      ...(home ? [join(home, 'bin', `grok-${version}.exe`), join(home, 'bin', 'grok.exe')] : []),
      join(optional.root, 'bin', 'grok.exe'),
    ]
    for (const candidate of candidates) {
      try {
        const file = await realpath(candidate)
        if (file === workspace || inside(workspace, file) || !(await stat(file)).isFile()) continue
        if (await hashFile(file) === uncompressedIntegrity) {
          return { file, version, source: 'official-npm-registry-attested' }
        }
      } catch { /* try next installed binary */ }
    }
    problems.push(`尚未找到由已核验 grok.exe.br 解压出的 grok.exe；请先在终端运行一次 grok 完成解压。`)
  }
  return null
}

/**
 * Return a fixed executable and arguments for the Host's existing sandboxed
 * process runner, or an unsupported reason. The Host retains its own task,
 * workspace, model, approval, timeout, and cancellation validation.
 */
export async function resolveMiMoGrokLaunch({ toolId, workspace, mode, modelId, task, attestor = npmAttestor }) {
  if (!TOOL_IDS.includes(toolId)) return { unsupported: '未知的 MiMo/Grok 官方工具 ID。' }
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
  const problems = []
  const found = toolId === 'mimo-code'
    ? await findMiMoExecutable(directory, platform, attestor, problems)
    : await findGrokExecutable(directory, platform, attestor, problems)
  if (!found) {
    return { unsupported: problems.length
      ? `官方原生程序未通过 npm registry 摘要核验：${problems[0]}`
      : `未找到官方 npm 包 ${WRAPPERS[toolId].name} 及其 Windows 原生程序。` }
  }

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
  if (!TOOL_IDS.includes(toolId)) throw new TypeError('unsupported vendor parser')
  let protocolError = null
  let vendorError = null
  let finalText = ''
  let terminal = null
  let sessionId = null
  let requestId = null
  let toolErrors = 0
  let events = 0
  const mimoSteps = []
  let grokSpend = null

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
            if (event.part.tokens && typeof event.part.tokens === 'object') mimoSteps.push({ tokens: event.part.tokens, cost: event.part.cost })
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
            if (event.usage && typeof event.usage === 'object') grokSpend = event
          }
        }
      }
    },
    finish(exitCode) {
      function spend() {
        const reported = toolId === 'mimo-code' ? usageFromEvents('mimo-steps', mimoSteps) : usageFromEvents('grok-end', grokSpend)
        return reported ? { usage: reported.usage, ...(reported.reportedCostUsd ? { reportedCostUsd: reported.reportedCostUsd } : {}) } : {}
      }
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
        ...spend(),
        ...(!good ? { error: protocolError ?? vendorError ?? `${toolId} 未返回完整的成功终态和回答。` } : {}),
      }
    },
  }
}
