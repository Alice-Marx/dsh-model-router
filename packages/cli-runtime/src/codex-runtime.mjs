import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { createCodexSessionCore, pinCodexExecutable } from './codex-session-core.mjs'

export { pinCodexExecutable }

/** A local runner never silently accepts a remote workspace binding. */
export async function createCodexSession(options) {
  if (options?.binding?.location !== 'local') throw new Error('REMOTE_CLI_REQUIRES_REMOTE_AGENT')
  await mkdir(options.runtimeRoot, { recursive: true, mode: 0o700 })
  const [root, cwd] = await Promise.all([realpath(options.runtimeRoot), realpath(options.workspace)])
  const part = relative(root, cwd)
  if (!part || part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error('CLI_WORKSPACE_OUTSIDE_RUNTIME_ROOT')
  return createCodexSessionCore(options)
}

export async function startCodexTask(options) {
  const session = await createCodexSession(options)
  try { const result = await session.run(options.prompt); await session.close(); return { ...result, ...session.snapshot() } }
  catch (error) { await session.close(); return { ...session.snapshot(), status: error.message === 'CLI_MODEL_IDENTITY_MISMATCH' ? 'identity-mismatch' : 'outcome-unknown', error: error.message } }
}
