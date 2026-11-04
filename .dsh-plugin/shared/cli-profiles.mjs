/**
 * What each official CLI is allowed to touch, in one table.
 *
 * Every limitation the product had was a literal inside an argv builder, which made it
 * invisible: Claude's read-only run lost its shell, Codex's read-only run could read the whole
 * user profile, and Gemini could not run a team step at all. Those limits now live here as
 * data, so a limit can be lifted (or tightened) in one place and reviewed as a row.
 *
 * Vocabulary:
 * - `readScope` is what the CLI itself may read: `'workspace'` (its own working directory),
 *   `'user'` (anything the operating user can read), `'confined'` (the Harness process sandbox
 *   decides, so the value is not the CLI's own choice).
 * - `writes` says whether this mode may change files at all.
 * - `requiresConfinement` says the mode is only safe when the process sandbox is applied; the
 *   Host refuses the run when `executionEnvironment` is not `harness`.
 */

const CLAUDE_READ_ARGS = Object.freeze([
  '--restricted', '--disable-slash-commands', '--strict-mcp-config',
  '--tools', 'Read,Glob,Grep', '--disallowedTools', 'mcp__*',
  '--permission-mode', 'dontAsk',
])

const CLAUDE_WRITE_ARGS = Object.freeze(['--permission-mode', 'bypassPermissions'])

/**
 * Per tool and mode: the argv fragment (without `-p`/prompt, which the caller adds), the read
 * scope that fragment actually gives the CLI, and whether writes are possible.
 */
export const CLI_PROFILES = Object.freeze({
  'claude-code': Object.freeze({
    readOnly: Object.freeze({ args: CLAUDE_READ_ARGS, readScope: 'workspace', writes: false, requiresConfinement: false }),
    workspaceWrite: Object.freeze({ args: CLAUDE_WRITE_ARGS, readScope: 'workspace', writes: true, requiresConfinement: false }),
  }),
  codex: Object.freeze({
    // Codex's own read-only sandbox forbids writes and network commands but still lets the
    // process read anything the user can read. `-C` pins the working root; the Harness
    // process sandbox is what actually narrows the read scope.
    readOnly: Object.freeze({ args: Object.freeze(['--sandbox', 'read-only']), readScope: 'user', writes: false, requiresConfinement: true }),
    workspaceWrite: Object.freeze({ args: Object.freeze(['--sandbox', 'workspace-write']), readScope: 'user', writes: true, requiresConfinement: true }),
  }),
  gemini: Object.freeze({
    readOnly: Object.freeze({ args: Object.freeze(['--approval-mode', 'plan']), readScope: 'workspace', writes: false, requiresConfinement: false }),
    // Declared, not yet reachable: the signed team runner does not launch Gemini yet.
    workspaceWrite: Object.freeze({
      args: Object.freeze(['--approval-mode', 'yolo', '--include-directories', '<workspace>']),
      readScope: 'workspace', writes: true, requiresConfinement: true, reachable: false,
    }),
  }),
})

/** The declared profile for one tool and mode; null when the tool cannot run that mode here. */
export function cliProfile(toolId, mode) {
  const entry = CLI_PROFILES[toolId]
  if (!entry) return null
  return (mode === 'workspace-write' ? entry.workspaceWrite : entry.readOnly) ?? null
}

/** The same view a panel needs, without executing anything. */
export function cliScopeTable() {
  return Object.entries(CLI_PROFILES).flatMap(([toolId, modes]) => Object.entries(modes).map(([mode, profile]) => ({
    toolId,
    mode: mode === 'workspaceWrite' ? 'workspace-write' : 'read-only',
    readScope: profile.readScope,
    writes: profile.writes,
    requiresConfinement: profile.requiresConfinement,
    reachable: profile.reachable !== false,
  })))
}
