import { isAbsolute, relative, resolve, sep } from 'node:path'

const READ_PATHS = Object.freeze({ read: 'file_path', read_image: 'file_path', glob: 'path', grep: 'path' })
const denied = (code = 'BOT_WORKSPACE_READ_DENIED') => { throw Object.assign(new Error(code), { code }) }

export function guardDsWorkspaceReads(ctx, runtime) {
  return ctx.on('tools/execute', async (execution, next) => {
    if (execution.name === 'pwsh' && execution.agent?.session) denied('BOT_NATIVE_EXECUTION_DENIED')
    const field = READ_PATHS[execution.name]
    if (!field || !execution.agent?.session) return next()
    const input = execution.arguments?.[field]
    if (input !== undefined && typeof input !== 'string') denied()
    const base = runtime.sessionFolder?.(execution.agent.session)
    if (typeof base !== 'string' || !base || typeof runtime.real !== 'function') denied()
    const root = await runtime.real(base)
    const target = await runtime.real(resolve(root, input ?? '.'))
    const offset = relative(root, target)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) denied()
    return next()
  })
}
