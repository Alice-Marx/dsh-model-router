/**
 * What each execution channel can read and write. Shown in settings and the
 * workbench so users can see the boundary before allowing a run. Pure data.
 */
import { toolForProvider } from './official-tool-registry.mjs'

const READ_ONLY_SCOPE = Object.freeze({
  'claude-code': '当前会话工作区（仅 Read/Glob/Grep 工具，dontAsk 模式拒绝未授权的工作区外读取）',
  codex: '当前用户可读的全部文件（Codex read-only 沙箱只禁止写入和联网命令）',
  gemini: '当前会话工作区（Gemini CLI 默认工作区限制）',
})

/** `sandboxed` is true when the Harness process sandbox wraps the launch (verified runner). */
export function toolBoundary(toolId, { sandboxed = false, platform = 'unknown' } = {}) {
  const directOnly = toolId === 'gemini'
  const harnessSandbox = sandboxed && !directOnly
  return {
    toolId,
    readOnly: {
      readable: READ_ONLY_SCOPE[toolId] ?? '当前会话工作区',
      writable: '无（只读运行，不应用任何改动）',
      sandbox: harnessSandbox
        ? platform === 'win32' ? 'Harness 进程沙箱（Windows ACL 后端为部分强制）' : 'Harness 进程沙箱'
        : '无 Harness 沙箱：直接启动 CLI，只读仅由 CLI 自身参数保证',
      direct: !harnessSandbox,
    },
    write: toolId === 'gemini'
      ? null
      : {
        readable: '独立 Git 工作树（当前仓库的干净副本）',
        writable: '独立 Git 工作树；CLI 成功且原工作区未变动时，才把源代码补丁应用回当前工作区',
        sandbox: 'Harness 进程沙箱，缺少沙箱时拒绝启动',
        requiresApproval: true,
      },
  }
}

/** Boundary rows for configured routes: CLI routes show their tool, others are API-only. */
export function routeBoundaries(routes, { sandboxedToolIds = [], platform = 'unknown' } = {}) {
  return (Array.isArray(routes) ? routes : []).map(route => {
    const tool = toolForProvider(route.provider)
    if (!tool || route.execution === 'api') {
      return {
        provider: route.provider, model: route.model, toolId: null, toolLabel: null,
        readOnly: { readable: '无本机文件访问（只把任务文本发给模型目录 API）', writable: '无', sandbox: '不启动本地进程', direct: false },
        write: null,
      }
    }
    return {
      provider: route.provider, model: route.model, toolLabel: tool.label,
      ...toolBoundary(tool.id, { sandboxed: sandboxedToolIds.includes(tool.id), platform }),
    }
  })
}
