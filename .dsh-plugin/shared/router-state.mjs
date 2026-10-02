/**
 * Small persistent Host state for the router: onboarding flag, last health
 * check, and the bounded run ledger (routing decisions, channels, fallback
 * errors, cost, review and user ratings). One JSON file under the DSH home;
 * writes are serialized and atomic (temp file + rename). Never stores keys.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export const MAX_RUNS = 200
const STATE_VERSION = 1

/** Same DSH home rule as the Host: DSH_HOME (with ~ expansion) or ~/.dsh. */
export function resolveStateHome(env = process.env, home = homedir(), cwd = process.cwd()) {
  const configured = String(env.DSH_HOME ?? '').trim()
  if (configured === '') return join(home, '.dsh')
  const expanded = configured === '~' ? home
    : configured.startsWith('~/') || configured.startsWith('~\\') ? join(home, configured.slice(2)) : configured
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

export function defaultStatePath(env = process.env) {
  return join(resolveStateHome(env), 'model-router', 'state.json')
}

function emptyState() {
  return { version: STATE_VERSION, onboarding: { completedAt: null }, health: null, runs: [] }
}

function sanitize(value) {
  if (!value || typeof value !== 'object' || value.version !== STATE_VERSION) return emptyState()
  return {
    version: STATE_VERSION,
    onboarding: { completedAt: Number.isFinite(value.onboarding?.completedAt) ? value.onboarding.completedAt : null },
    health: value.health && Array.isArray(value.health.tools) ? value.health : null,
    runs: Array.isArray(value.runs) ? value.runs.filter(run => run && typeof run.id === 'string').slice(-MAX_RUNS) : [],
  }
}

export function createRouterState({ file = defaultStatePath(), maxRuns = MAX_RUNS } = {}) {
  let state = null
  let chain = Promise.resolve()
  const load = async () => {
    if (state) return state
    try { state = sanitize(JSON.parse(await readFile(file, 'utf8'))) }
    catch { state = emptyState() }
    return state
  }
  const persist = async () => {
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, `${JSON.stringify(state)}\n`, 'utf8')
    await rename(temp, file)
  }
  /** Serialize read-modify-write updates; `change` mutates the loaded state. */
  const update = change => {
    const next = chain.then(async () => {
      await load()
      const result = await change(state)
      state.runs = state.runs.slice(-maxRuns)
      await persist()
      return result
    })
    chain = next.catch(() => {})
    return next
  }
  return {
    file,
    async read() { await chain; return structuredClone(await load()) },
    update,
    completeOnboarding: at => update(current => { current.onboarding.completedAt = at; return current.onboarding }),
    saveHealth: report => update(current => { current.health = report; return report }),
    appendRun: run => update(current => { current.runs.push(run); return run }),
    updateRun: (id, change) => update(current => {
      const run = current.runs.find(item => item.id === id)
      if (!run) throw new Error(`未找到运行记录 ${id}`)
      change(run)
      return structuredClone(run)
    }),
  }
}
