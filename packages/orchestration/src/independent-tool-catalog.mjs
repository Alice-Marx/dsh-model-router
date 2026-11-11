/**
 * The tool catalog one independent Bot may see.
 *
 * The model is offered exactly what this Bot's committed grants allow, re-decided from committed
 * state on every request: no tool name, machine, root or capability comes from the request, and
 * nothing here hands the model an owner, a subject, an executable path, an endpoint or an
 * operation identity. Those are Host facts; the model only ever supplies business content.
 *
 * Three rules are load-bearing:
 *
 * 1. A capability the Host cannot actually run is **not** offered. `unavailable()` names it and
 *    says why, so a Host with no durable Task backend says "no tracked write" instead of advertising
 *    a schema whose execution would be a guess.
 * 2. Every schema is derived, never cached across a grant change: the caller asks again per step and
 *    per call, and a grant the authority no longer holds removes the tool from the request.
 * 3. The machine and root are Host-chosen from the Bot's own live binding. A model may name one of
 *    its own bound machines or roots; the Host still re-checks both before the call runs.
 */

/** Effects. A read may run beside another read; everything else stays sequential. */
export const READ_EFFECT = 'read'
export const WRITE_EFFECT = 'workspace-write'

/** Machine tools the independent path may reach, with the Host-side business arguments. */
const TARGET_KEYS = {
  machineId: { type: 'string', description: '本 Bot 已绑定的其中一台机器；不填则由宿主选择。' },
  rootId: { type: 'string', description: '该机器上已授权给本 Bot 的其中一个根目录；不填则由宿主选择。' },
}

const pathParameter = description => ({ type: 'string', description })

const objectSchema = (properties, required = []) => Object.freeze({
  type: 'object',
  properties: Object.freeze(properties),
  required: Object.freeze(required),
  additionalProperties: false,
})

/**
 * One offered capability. `machineTool` is the remote agent tool; `backend` names the durable Task
 * backend that must exist before the capability may be offered at all; `grants` are the authority
 * capabilities a call will need, so a grant that was withdrawn takes the tool out of the request.
 */
const CAPABILITIES = Object.freeze([
  Object.freeze({
    name: 'bot_machine_ping', machineTool: 'machine_ping', effect: READ_EFFECT, backend: null,
    grants: ['remote/machine_ping'],
    description: '确认本 Bot 已绑定的远程机器在线，并读取它的能力清单。',
    parameters: objectSchema({ ...TARGET_KEYS }),
  }),
  Object.freeze({
    name: 'bot_fs_list', machineTool: 'fs_list', effect: READ_EFFECT, backend: null,
    grants: ['remote/fs_list'],
    description: '列出已授权根目录下的文件名。路径相对于该根目录，不能越出它。',
    parameters: objectSchema({ ...TARGET_KEYS, relativePath: pathParameter('相对已授权根目录的目录路径，默认当前目录。') }, []),
  }),
  Object.freeze({
    name: 'bot_fs_read', machineTool: 'fs_read', effect: READ_EFFECT, backend: null,
    grants: ['remote/fs_read'],
    description: '读取已授权根目录下的一个文本文件，有长度上限。',
    parameters: objectSchema({ ...TARGET_KEYS, relativePath: pathParameter('相对已授权根目录的文件路径。') }, ['relativePath']),
  }),
  Object.freeze({
    name: 'bot_fs_write', machineTool: 'fs_write', effect: WRITE_EFFECT, backend: 'remote-write',
    grants: ['remote/fs_write', 'task/submit'],
    description: '把文本内容写入已授权根目录下的一个文件。这是一次可跟踪的持久 Task：宿主保留请求键、Task、attempt 与 operation 身份，结果未知时不会重放。',
    parameters: objectSchema({
      ...TARGET_KEYS,
      relativePath: pathParameter('相对已授权根目录的文件路径。'),
      content: { type: 'string', description: '要写入的文本内容。' },
      expectedHash: { type: ['string', 'null'], description: '期望的当前文件 SHA256；新文件填 null。' },
    }, ['relativePath', 'content', 'expectedHash']),
  }),
  Object.freeze({
    name: 'bot_command', machineTool: 'container_command_v1', effect: WRITE_EFFECT, backend: 'remote-command',
    grants: ['remote/container_command_v1', 'task/submit'],
    description: '在已授权的远程容器 profile 中运行一条操作员预先批准的 argv 命令。不接受 shell 字符串、可执行路径或环境变量。',
    parameters: objectSchema({
      ...TARGET_KEYS,
      workspaceRelativePath: pathParameter('命令的工作目录，相对已授权根目录；空字符串表示该根本身。'),
      argv: { type: 'array', items: { type: 'string' }, description: '命令参数数组，第一项必须是已批准的别名。' },
      timeoutMs: { type: 'integer', description: '超时毫秒数，宿主另有上界。', minimum: 1000, maximum: 600000 },
    }, ['workspaceRelativePath', 'argv']),
  }),
  Object.freeze({
    name: 'bot_operation_status', machineTool: 'operation_status', effect: READ_EFFECT, backend: null,
    grants: ['remote/operation_status'],
    description: '读取本 Bot 早前一次操作的当前状态。operationId 必须来自宿主返回的上一次工具结果。',
    parameters: objectSchema({ operationId: { type: 'string', description: '宿主早前返回的 operationId。' } }, ['operationId']),
  }),
  Object.freeze({
    name: 'bot_operation_cancel', machineTool: 'operation_cancel', effect: WRITE_EFFECT, backend: null,
    grants: ['remote/operation_cancel'],
    description: '请求停止本 Bot 早前的一次操作。这只是停止请求，已生效的副作用不会回滚。operationId 必须来自宿主返回的上一次工具结果。',
    parameters: objectSchema({ operationId: { type: 'string', description: '宿主早前返回的 operationId。' } }, ['operationId']),
  }),
  Object.freeze({
    name: 'bot_artifact_stat', machineTool: 'artifact_stat', effect: READ_EFFECT, backend: null,
    grants: ['remote/artifact_stat'],
    description: '读取本 Bot 早前一次操作产出的附件元数据。artifactId 必须来自宿主返回的上一次工具结果。',
    parameters: objectSchema({ artifactId: { type: 'string', description: '宿主早前返回的 artifactId。' } }, ['artifactId']),
  }),
  Object.freeze({
    name: 'bot_artifact_read', machineTool: 'artifact_read', effect: READ_EFFECT, backend: null,
    grants: ['remote/artifact_read'],
    description: '分块读取本 Bot 早前一次操作产出的附件内容。artifactId 必须来自宿主返回的上一次工具结果。',
    parameters: objectSchema({
      artifactId: { type: 'string', description: '宿主早前返回的 artifactId。' },
      offset: { type: 'integer', description: '起始字节偏移。', minimum: 0 },
      length: { type: 'integer', description: '读取字节数，宿主另有上界。', minimum: 1 },
    }, ['artifactId']),
  }),
  Object.freeze({
    name: 'bot_task_status', machineTool: null, effect: READ_EFFECT, backend: 'task-service', taskAction: 'read',
    grants: ['task/read'],
    description: '读取本 Bot 自己提交的一次持久 Task 的状态。taskId 必须来自宿主返回的上一次工具结果。',
    parameters: objectSchema({ taskId: { type: 'string', description: '宿主早前返回的 taskId。' } }, ['taskId']),
  }),
  Object.freeze({
    name: 'bot_task_cancel', machineTool: null, effect: WRITE_EFFECT, backend: 'task-service', taskAction: 'cancel',
    grants: ['task/cancel'],
    description: '请求停止本 Bot 自己提交的一次持久 Task。这只是停止请求，attempt 保持自己的身份与未知结果证据。taskId 必须来自宿主返回的上一次工具结果。',
    parameters: objectSchema({ taskId: { type: 'string', description: '宿主早前返回的 taskId。' } }, ['taskId']),
  }),
])

export const INDEPENDENT_TOOL_NAMES = Object.freeze(CAPABILITIES.map(entry => entry.name))

const byName = new Map(CAPABILITIES.map(entry => [entry.name, entry]))

export const independentToolEntry = name => byName.get(name) ?? null

/**
 * The offered schemas for one Bot, plus what this Host cannot run.
 *
 * @param {{ scopes?: Array<{ machineId: string, roots: string[], tools: string[], mode: string }>,
 *   backends?: string[], granted?: (capability: string) => boolean }} facts read live
 * @returns {{ tools: object[], unavailable: Array<{ name: string, code: string }>, machines: string[] }}
 */
export function catalogFor({ scopes = [], backends = [], granted = () => true } = {}) {
  if (!Array.isArray(scopes)) throw new TypeError('INDEPENDENT_TOOL_SCOPES_REQUIRED')
  const live = scopes.filter(scope => scope && typeof scope.machineId === 'string' && Array.isArray(scope.tools))
  const available = new Set(Array.isArray(backends) ? backends : [])
  const allowed = name => { try { return granted(name) !== false } catch { return false } }
  const tools = []
  const unavailable = []
  for (const entry of CAPABILITIES) {
    // A durable backend is a precondition, not a runtime surprise: without it the capability is
    // named as unavailable instead of being offered and failing later.
    if (entry.backend && !available.has(entry.backend)) {
      unavailable.push({ name: entry.name, code: entry.backend === 'task-service' ? 'TASK_SERVICE_UNAVAILABLE' : 'TASK_BACKEND_UNAVAILABLE' })
      continue
    }
    if (!entry.grants.every(allowed)) {
      unavailable.push({ name: entry.name, code: 'CAPABILITY_NOT_GRANTED' })
      continue
    }
    if (entry.machineTool === null) {
      tools.push(Object.freeze({ name: entry.name, description: entry.description, parameters: entry.parameters }))
      continue
    }
    const grantedScope = live.some(scope => scope.tools.includes(entry.machineTool)
      && (entry.effect !== WRITE_EFFECT || scope.mode === 'workspace-write'))
    if (!grantedScope) {
      unavailable.push({ name: entry.name, code: entry.effect === WRITE_EFFECT ? 'MACHINE_WRITE_NOT_GRANTED' : 'MACHINE_TOOL_NOT_GRANTED' })
      continue
    }
    tools.push(Object.freeze({ name: entry.name, description: entry.description, parameters: entry.parameters }))
  }
  return {
    tools: Object.freeze(tools),
    unavailable: Object.freeze(unavailable),
    machines: Object.freeze([...new Set(live.map(scope => scope.machineId))].sort()),
  }
}
