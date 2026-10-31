import { readdir, readFile, readlink, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const DEFAULTS = Object.freeze({ maxDomains: 32, maxRootsPerDomain: 64, maxPids: 16384, maxFdsPerPid: 16384, maxAccessors: 2048 })

/**
 * PRIVATE owner-only read-only writer/domain inventory (stop-fence design slice 1).
 *
 * Takes explicitly declared domains and reports, per physical root, the live
 * processes that hold open handles or working directories inside those roots,
 * with per-handle write-access flags from the kernel. It is a diagnostic: it
 * never claims a stop-write proof, never touches a single byte of the
 * domains, and reports partial enumeration honestly — on Linux, processes
 * whose descriptors cannot be read (other users) are counted as an
 * enumeration gap, and on every other platform open-handle enumeration is
 * simply unavailable. Old programs do not know this component; absence of
 * observed writers is never evidence that none exist.
 */
export async function inventoryMigrationWriters({ domains, limits = {}, signal } = {}) {
  if (!Array.isArray(domains) || domains.length < 1 || domains.length > (limits.maxDomains ?? DEFAULTS.maxDomains)) fail('MIGRATION_WRITER_INPUT_INVALID')
  for (const domain of domains) {
    if (!record(domain) || Object.keys(domain).some(key => !['name', 'roots'].includes(key))) fail('MIGRATION_WRITER_INPUT_INVALID')
    if (typeof domain.name !== 'string' || !domain.name.length || domain.name.length > 128 || /[\0-\x1f\x7f]/.test(domain.name)) fail('MIGRATION_WRITER_INPUT_INVALID')
    if (!Array.isArray(domain.roots) || domain.roots.length < 1 || domain.roots.length > (limits.maxRootsPerDomain ?? DEFAULTS.maxRootsPerDomain)) fail('MIGRATION_WRITER_INPUT_INVALID')
    for (const root of domain.roots) if (typeof root !== 'string' || !root.length || root.length > 4096 || root.includes('\0') || /^\/|^[a-zA-Z]:[\\/]/.test(root) === false) fail('MIGRATION_WRITER_INPUT_INVALID')
  }
  if (!record(limits) || Object.keys(limits).some(key => !Object.hasOwn(DEFAULTS, key))) fail('MIGRATION_WRITER_INPUT_INVALID')
  for (const [key, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULTS[key]) fail('MIGRATION_WRITER_INPUT_INVALID')
  const bound = { ...DEFAULTS, ...limits }
  const abort = () => { if (signal?.aborted) fail('MIGRATION_WRITER_CANCELLED') }

  // Resolve every declared root once and key it by its physical identity so
  // aliases and overlapping declarations converge instead of double-counting.
  const resolvedRoots = new Map()
  const domainReports = []
  for (const domain of domains) {
    abort()
    const roots = []
    for (const declared of domain.roots) {
      let identity = null, resolved = null, diagnostic = 'ROOT_MISSING'
      try {
        resolved = await realpath(declared)
        const observed = await stat(resolved, { bigint: true })
        identity = `${observed.dev}:${observed.ino}`
        diagnostic = null
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) diagnostic = 'ROOT_UNREADABLE'
      }
      const entry = { declared, resolved, identity, ...(diagnostic ? { diagnostic } : {}) }
      roots.push(entry)
      if (identity !== null) {
        const shared = resolvedRoots.get(identity)
        if (shared) shared.domains.push(domain.name)
        else resolvedRoots.set(identity, { resolved, identity, domains: [domain.name] })
      }
    }
    domainReports.push({ name: domain.name, roots, accessors: [], diagnostics: [] })
  }
  const byPath = [...resolvedRoots.values()].map(root => ({ ...root, prefix: root.resolved.endsWith('/') ? root.resolved : root.resolved + '/' }))

  const platform = process.platform
  if (platform !== 'linux') {
    // Open-handle enumeration needs per-process descriptor access this
    // platform cannot provide from this runtime; report the capability gap
    // instead of pretending an empty answer is an answer.
    return {
      schemaVersion: 1, stopWriteProvable: false,
      enumeration: { platform, mode: 'unavailable', reason: 'WRITER_ENUMERATION_PLATFORM_UNSUPPORTED' },
      domains: domainReports.map(domain => ({ ...domain, diagnostics: [...domain.diagnostics, 'WRITER_ENUMERATION_UNAVAILABLE'] })),
    }
  }

  const accessors = new Map()
  let inaccessible = 0, scanned = 0
  const inside = target => {
    const clean = target.endsWith(' (deleted)') ? target.slice(0, -' (deleted)'.length) : target
    for (const root of byPath) if (clean === root.resolved || clean.startsWith(root.prefix)) return { root: root.identity, domains: root.domains, deleted: clean !== target }
    return null
  }
  const note = (pid, evidence) => {
    let accessor = accessors.get(pid)
    if (!accessor) {
      if (accessors.size >= bound.maxAccessors) return false
      accessor = { pid, startedAtTicks: null, comm: null, commandLine: null, accesses: [] }
      accessors.set(pid, accessor)
    }
    if (accessor.accesses.length < 4096) accessor.accesses.push(evidence)
    return true
  }
  let pids
  try { pids = (await readdir('/proc')).filter(name => /^[0-9]+$/.test(name)).map(Number) }
  catch { fail('MIGRATION_WRITER_PROCFS_UNAVAILABLE') }
  if (pids.length > bound.maxPids) fail('MIGRATION_WRITER_PID_LIMIT')

  for (const pid of pids) {
    abort()
    // No self-exclusion: if the calling process itself holds domain handles,
    // that is a writer fact worth reporting, not hiding.
    scanned++
    const base = `/proc/${pid}`
    let fds
    try { fds = await readdir(`${base}/fd`) }
    catch (error) {
      // Another user's process (or a kernel worker): its descriptors cannot
      // be inspected. That is an enumeration gap, not an absence of writers.
      if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ENOENT') { inaccessible++; continue }
      inaccessible++; continue
    }
    if (fds.length > bound.maxFdsPerPid) { inaccessible++; continue }
    for (const fd of fds) {
      abort()
      let target
      try { target = await readFileLink(`${base}/fd/${fd}`) }
      catch { continue }
      const hit = inside(target)
      if (!hit) continue
      let mode = 'unknown', flags = null
      try {
        const info = await readFile(`${base}/fdinfo/${fd}`, 'utf8')
        const raw = /flags:\s*(\S+)/.exec(info)?.[1]
        if (raw) {
          const octal = raw.replace(/^0o?/, '')
          if (/^[0-7]+$/.test(octal)) { flags = octal; mode = (parseInt(octal, 8) & 0o3) !== 0 ? 'write' : 'read' }
        }
      } catch {}
      if (!note(pid, { kind: 'handle', fd, target, mode, ...(flags ? { flags } : {}), domains: hit.domains, root: hit.root, deleted: hit.deleted })) break
    }
    for (const [kind, link] of [['cwd', `${base}/cwd`], ['exe', `${base}/exe`]]) {
      let target
      try { target = await readFileLink(link) }
      catch { continue }
      const hit = inside(target)
      if (hit) note(pid, { kind, target, mode: 'unknown', domains: hit.domains, root: hit.root, deleted: hit.deleted })
    }
  }

  for (const accessor of accessors.values()) {
    const base = `/proc/${accessor.pid}`
    accessor.comm = await readFile(`${base}/comm`, 'utf8').then(value => value.trim()).catch(() => null)
    accessor.commandLine = await readFile(`${base}/cmdline`, 'utf8').then(value => value.split('\0').filter(Boolean)).catch(() => null)
    // /proc/<pid>/stat field 22 (starttime) is the 20th token after the comm
    // parens; identity survives PID reuse.
    accessor.startedAtTicks = await readFile(`${base}/stat`, 'utf8').then(value => Number(value.slice(value.lastIndexOf(')') + 1).trim().split(/\s+/)[19])).catch(() => null)
  }
  for (const report of domainReports) {
    for (const accessor of accessors.values()) {
      const accesses = accessor.accesses.filter(entry => entry.domains.includes(report.name))
      if (accesses.length) report.accessors.push({ pid: accessor.pid, startedAtTicks: accessor.startedAtTicks, comm: accessor.comm, commandLine: accessor.commandLine, accesses: accesses.map(({ domains, ...entry }) => entry), writable: accesses.some(entry => entry.mode === 'write') })
    }
    if (inaccessible > 0) report.diagnostics.push('WRITER_ENUMERATION_PARTIAL')
  }
  return {
    schemaVersion: 1, stopWriteProvable: false,
    enumeration: { platform, mode: inaccessible > 0 ? 'linux-procfs-partial' : 'linux-procfs', scannedProcesses: scanned, inaccessibleProcesses: inaccessible, ...(inaccessible > 0 ? { reason: 'WRITER_ENUMERATION_PARTIAL' } : {}) },
    domains: domainReports,
  }
}

/** Bounded readlink that never follows into the target itself. */
async function readFileLink(path) {
  const value = await readlink(path)
  if (typeof value !== 'string' || value.length > 8192) fail('MIGRATION_WRITER_PROCFS_INVALID')
  return value
}
