import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GENERATOR_PATH = 'scripts/integration-upstream-proposal.mjs'
const INPUT_PATHS = [
  'docs/integration/baseline.json',
  'docs/integration/feature-inventory.json',
  'docs/integration/scope.json',
  'docs/integration/tasks.json',
]
const SOURCE_IDS = new Set(['mr', 'ds'])
const OUTPUT_ROOT_RELATIVE = 'tmp/integration'
const OUTPUT_FILE_NAMES = new Set(['proposal.json', 'proposal.md', 'manifest.json'])
const FULL_SHA = /^[0-9a-f]{40}$/
// Mirrors the F40 component registration in scripts/integration-f-difference.mjs.
// It is used for inferred mapping only; it never implies behavior verification.
const NEW_COMPONENT_PATHS = [
  'packages/orchestration/src/remote-machines.mjs',
  'packages/orchestration/src/remote-execution.mjs',
  'packages/orchestration/src/remote-command-execution.mjs',
  'packages/orchestration/src/machine-secrets.mjs',
  'packages/orchestration/src/funding-admission.mjs',
  'packages/orchestration/src/funding-projection.mjs',
  'packages/orchestration/src/product-funding.mjs',
  'packages/orchestration/src/funding-accounts.mjs',
  'packages/orchestration/src/model-receipt.mjs',
  'packages/orchestration/src/model-accounting.mjs',
  'packages/orchestration/src/task-contract.mjs',
  'packages/orchestration/src/task-admission.mjs',
  'packages/orchestration/src/task-journal.mjs',
  'packages/orchestration/src/task-stage.mjs',
  'packages/orchestration/src/task-service.mjs',
  'packages/orchestration/src/task-tools.mjs',
  'packages/cli-runtime/src',
  'packages/capability-broker/src',
  'remote-computer-agent/src',
  'native/windows-desktop',
  'deploy/remote-agent',
]
const USAGE = [
  'Usage: node scripts/integration-upstream-proposal.mjs --source <mr|ds> --candidate <full-40-hex-sha> --output <tmp/integration/...> [--baseline <full-40-hex-sha>]',
  '  --source     frozen source repository id: mr (this product repository) or ds (tmp/integration/upstream/ds-bot-frozen).',
  '  --candidate  complete 40-hex commit SHA present in the local source repository object database. HEAD, branch names and short SHAs are rejected.',
  '  --output     explicit output directory under tmp/integration of this repository, forward slashes, no symlink components.',
  '  --baseline   optional; may only equal the frozen baseline commit from docs/integration/baseline.json (equality check only).',
  '  --root       optional isolated project root; defaults to this repository.',
  '  --source-root optional local object repository for --source; no clone/fetch is performed.',
  '  --help       print this usage.',
  'Read-only and offline: no fetch/pull/clone, no worktree read for the diff, no baseline/scope/acceptance updates. The decision is fixed to not-included.',
].join('\n')

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requirePortableRelativePath(path, label) {
  requireValue(typeof path === 'string' && path && !path.includes('\\') && !isAbsolute(path)
    && !/^[A-Za-z]:/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..'),
  `${label}: invalid repository-relative path`)
  return path
}

export function parseArgs(argv) {
  const named = new Map()
  let index = 0
  while (index < argv.length) {
    const arg = argv[index]
    requireValue(arg.startsWith('--'), `Unexpected positional argument ${arg}`)
    const name = arg.slice(2)
    requireValue(['source', 'candidate', 'output', 'baseline', 'root', 'source-root', 'help'].includes(name),
      `Unknown option ${arg}`)
    requireValue(!named.has(name), `Duplicate option ${arg}`)
    if (name === 'help') {
      requireValue(argv.length === 1, '--help cannot be combined with other options')
      return { help: true }
    }
    const value = argv[index + 1]
    requireValue(typeof value === 'string' && value !== '' && !value.startsWith('--'), `${arg} requires a value`)
    named.set(name, value)
    index += 2
  }
  requireValue(named.has('source') && named.has('candidate') && named.has('output'),
    'Missing required options. Usage:\n' + USAGE)
  const sourceId = named.get('source')
  requireValue(SOURCE_IDS.has(sourceId), `Unknown source ${sourceId}: expected mr or ds`)
  const candidate = named.get('candidate')
  requireValue(/^[0-9a-fA-F]{40}$/.test(candidate),
    `Candidate must be a complete 40-hex commit SHA; HEAD, branch names and short SHAs are rejected: ${candidate}`)
  const output = requirePortableRelativePath(named.get('output'), '--output')
  const baseline = named.get('baseline')
  requireValue(baseline === undefined || /^[0-9a-fA-F]{40}$/.test(baseline),
    `--baseline must be a complete 40-hex commit SHA: ${baseline}`)
  return {
    sourceId,
    candidate: candidate.toLowerCase(),
    output,
    ...(baseline === undefined ? {} : { baseline: baseline.toLowerCase() }),
    ...(named.has('root') ? { root: resolve(named.get('root')) } : {}),
    ...(named.has('source-root') ? { sourceRoot: resolve(named.get('source-root')) } : {}),
  }
}

export function parseNameStatusZ(bytes) {
  const fields = (Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)).split('\0')
  const records = []
  let index = 0
  while (index < fields.length) {
    const status = fields[index]
    if (status === '') { index += 1; continue }
    requireValue(/^[ACDMRT]\d{0,3}$/.test(status), `Malformed name-status record: ${JSON.stringify(status)}`)
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index + 1]
      const newPath = fields[index + 2]
      requireValue(oldPath !== undefined && oldPath !== '' && newPath !== undefined && newPath !== '',
        `Malformed rename/copy name-status record: ${status}`)
      records.push({ status, oldPath, newPath })
      index += 3
    } else {
      const path = fields[index + 1]
      requireValue(path !== undefined && path !== '', `Malformed name-status record: ${status}`)
      records.push({ status, oldPath: null, newPath: path })
      index += 2
    }
  }
  return records
}

export function parseNumstatZ(bytes) {
  const fields = (Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)).split('\0')
  const records = []
  let index = 0
  while (index < fields.length) {
    const field = fields[index]
    if (field === '') { index += 1; continue }
    const first = field.indexOf('\t')
    const second = first === -1 ? -1 : field.indexOf('\t', first + 1)
    requireValue(first > 0 && second > first, `Malformed numstat counts: ${JSON.stringify(field)}`)
    const addedRaw = field.slice(0, first)
    const deletedRaw = field.slice(first + 1, second)
    const rest = field.slice(second + 1)
    requireValue(/^(\d+|-)$/.test(addedRaw) && /^(\d+|-)$/.test(deletedRaw),
      `Malformed numstat counts: ${JSON.stringify(field)}`)
    const added = addedRaw === '-' ? null : Number(addedRaw)
    const deleted = deletedRaw === '-' ? null : Number(deletedRaw)
    if (rest !== '') {
      records.push({ added, deleted, oldPath: null, newPath: rest })
      index += 1
    } else {
      const oldPath = fields[index + 1]
      const newPath = fields[index + 2]
      requireValue(oldPath !== undefined && oldPath !== '' && newPath !== undefined && newPath !== '',
        `Malformed rename/copy numstat record: ${JSON.stringify(field)}`)
      records.push({ added, deleted, oldPath, newPath })
      index += 3
    }
  }
  return records
}

function changeFor(status) {
  if (status.startsWith('R')) return 'renamed'
  if (status.startsWith('C')) return 'copied'
  return { A: 'added', M: 'modified', D: 'deleted', T: 'typechanged' }[status[0]]
}

function diffKey(record) {
  return record.oldPath ? `${record.oldPath}\0${record.newPath}` : record.newPath
}

async function gitText(repoPath, args) {
  const result = await execute('git', ['-C', repoPath, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024,
  })
  return result.stdout
}

async function gitRaw(repoPath, args) {
  const result = await execute('git', ['-C', repoPath, ...args], {
    encoding: 'buffer', windowsHide: true, maxBuffer: 256 * 1024 * 1024,
  })
  return result.stdout
}

async function gitExit(repoPath, args) {
  try {
    await execute('git', ['-C', repoPath, ...args], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024,
    })
    return true
  } catch (error) {
    if (typeof error.code === 'number' && error.code !== 0) return false
    throw error
  }
}

async function requireCommitObject(repoPath, sha, label) {
  let kind = null
  try {
    kind = (await gitText(repoPath, ['cat-file', '-t', sha])).trim()
  } catch {
    throw new Error(`${label} ${sha} is not present in the local source repository object database (offline; no fetch is performed)`)
  }
  requireValue(kind === 'commit', `${label} ${sha} is a ${kind} object, not a commit`)
}

async function readJsonInput(root, path) {
  const bytes = await readFile(join(root, path))
  const info = await stat(join(root, path))
  return { path, value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes), mtimeIso: info.mtime.toISOString() }
}

function loadMappingInputs(inputs) {
  const { baseline, inventory, scope, tasks } = inputs
  for (const [label, value] of Object.entries({ baseline, inventory, scope, tasks })) {
    requireValue(value && typeof value === 'object' && !Array.isArray(value)
      && value.schemaVersion === 1, `${label}: unsupported schema`)
  }
  const repositories = baseline.repositories
  const featuresById = new Map()
  for (const feature of inventory.features ?? []) {
    requireValue(feature && typeof feature.id === 'string' && !featuresById.has(feature.id),
      `inventory: invalid feature ${feature?.id}`)
    featuresById.set(feature.id, feature)
  }
  const scopeFeatures = new Map()
  for (const feature of scope.features ?? []) {
    requireValue(feature && typeof feature.id === 'string' && !scopeFeatures.has(feature.id),
      `scope: invalid feature ${feature?.id}`)
    scopeFeatures.set(feature.id, feature)
  }
  const requirements = (scope.requirements ?? []).map(requirement => ({
    id: requirement.id,
    acceptanceIds: requirement.acceptanceIds ?? [],
  }))
  const evidence = new Map()
  for (const result of tasks.acceptanceResults ?? []) {
    for (const path of result.evidence ?? []) evidence.set(path, result.id)
  }
  return { repositories, featuresById, scopeFeatures, requirements, evidence }
}

function registeredSourcePaths(featuresById, repositoryId) {
  const byPath = new Map()
  const directories = []
  let count = 0
  for (const feature of featuresById.values()) {
    if (feature.repository !== repositoryId) continue
    for (const source of feature.sources ?? []) {
      const normalized = requirePortableRelativePath(
        source.kind === 'directory' ? String(source.path).replace(/\/$/, '') : source.path,
        `${feature.id} source`)
      count += 1
      const list = byPath.get(normalized) ?? []
      list.push(feature.id)
      byPath.set(normalized, list)
      if (source.kind === 'directory') directories.push({ path: normalized, featureId: feature.id })
    }
  }
  return { byPath, directories, count }
}

function registeredFeaturesForPath(registered, path) {
  const features = new Set(registered.byPath.get(path) ?? [])
  for (const directory of registered.directories) {
    if (path.startsWith(`${directory.path}/`)) features.add(directory.featureId)
  }
  return [...features]
}

function inferenceFor(path, evidence, scopeFeatures, requirements) {
  const acceptanceId = evidence.get(path)
  if (acceptanceId !== undefined) {
    const featureIds = [...scopeFeatures.values()]
      .filter(feature => (feature.acceptanceIds ?? []).includes(acceptanceId)).map(feature => feature.id)
    return { kind: 'inferred', basis: 'matches a registered acceptance evidence path', featureIds,
      acceptanceIds: [acceptanceId], requirementIds: requirementsFor(featureIds, scopeFeatures, requirements) }
  }
  const component = NEW_COMPONENT_PATHS.find(prefix => path === prefix || path.startsWith(`${prefix}/`))
  if (component !== undefined) {
    return { kind: 'inferred', basis: `falls under the registered F40 current component path ${component}`,
      featureIds: ['F40'], acceptanceIds: [], requirementIds: [] }
  }
  if (path.startsWith('docs/integration/')) {
    return { kind: 'inferred', basis: 'governance document under docs/integration', featureIds: [], acceptanceIds: [], requirementIds: [] }
  }
  if (path.startsWith('docs/releases/')) {
    return { kind: 'inferred', basis: 'release evidence under docs/releases', featureIds: [], acceptanceIds: [], requirementIds: [] }
  }
  return { kind: 'unknown', basis: null, featureIds: [], acceptanceIds: [], requirementIds: [] }
}

function requirementsFor(featureIds, scopeFeatures, requirements) {
  const acceptance = new Set()
  for (const id of featureIds) {
    for (const acceptanceId of scopeFeatures.get(id)?.acceptanceIds ?? []) acceptance.add(acceptanceId)
  }
  return requirements.filter(requirement => requirement.acceptanceIds.some(id => acceptance.has(id)))
    .map(requirement => requirement.id)
}

const IMPACT_MATCHERS = [
  ['config', '配置（config/settings/锁文件/清单）', path => {
    const base = path.split('/').pop()
    return /(^|\/)(config|configs|settings)(\/|$)/i.test(path)
      || /^(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|npm-shrinkwrap\.json|\.editorconfig|\.gitattributes|\.gitignore|\.npmrc|\.nvmrc)$/i.test(base)
      || /^tsconfig[^/]*\.json$/i.test(base)
      || /(^|_|\.)config(\.|$)/i.test(base) || /(^|_|\.)rc$/i.test(base)
      || /settings/i.test(base) || /\.ya?ml$/i.test(path)
  }],
  ['data', '数据（storage/state/ledger/memory/session/migration）', path => {
    const base = path.split('/').pop()
    return /(^|\/)(data|storage|state|db|database|migrations?|ledger|memory|sessions?)(\/|$)/i.test(path)
      || /\.(db|sqlite3?|ledger)$/i.test(base)
      || /(ledger|memory|session|storage|migration|state|database)/i.test(base)
  }],
  ['cli', 'CLI（cli-runtime/capability-broker/remote-agent/deploy）', path =>
    ['packages/cli-runtime/', 'packages/capability-broker/', 'remote-computer-agent/', 'deploy/'].some(prefix => path.startsWith(prefix))
    || /cli/i.test(path.split('/').pop())],
  ['native', 'native（native 目录/native 脚本与二进制）', path =>
    path.startsWith('native/') || /\.(node|ps1|py|bat|cmd|dll|exe|sys)$/i.test(path)],
  ['platform', '平台（CI/windows-desktop/平台标识）', path =>
    path.startsWith('.github/') || path.startsWith('native/windows-desktop/')
    || /(win32|windows|darwin|macos|linux|posix|arm64|x64|ubuntu)/i.test(path)],
]

function markdownCell(value) {
  return String(value ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('`', '&#96;')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
}

function markdownPath(path) {
  return path === null || path === undefined ? '—' : `<code>${markdownCell(path)}</code>`
}

function defaultRepositories(root) {
  return {
    MR: root,
    DS: join(root, 'tmp/integration/upstream/ds-bot-frozen'),
  }
}

function resolveRepository(root, sourceId, repositories) {
  const map = repositories ?? defaultRepositories(root)
  const path = map[sourceId.toUpperCase()]
  requireValue(typeof path === 'string' && path !== '', `No local repository configured for source ${sourceId}`)
  return resolve(path)
}

// Separate candidate review from the integration-worktree release preview.
// Git tree/blob metadata is immutable: no source worktree path is read here.
async function objectTreeSnapshot(repoPath, commit) {
  const listing = await gitRaw(repoPath, ['ls-tree', '-r', '-l', '-z', commit])
  const files = listing.toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/.exec(row)
    requireValue(match, `Functional snapshot: malformed Git object entry at ${commit}`)
    const [, mode, objectKind, gitObject, size, path] = match
    requirePortableRelativePath(path, 'functional snapshot source')
    return { path, mode, objectKind, gitObject, bytes: size === '-' ? null : Number(size) }
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  requireValue(new Set(files.map(file => file.path)).size === files.length, 'Functional snapshot: duplicate Git paths')
  const tree = (await gitText(repoPath, ['rev-parse', `${commit}^{tree}`])).trim()
  requireValue(FULL_SHA.test(tree), 'Functional snapshot: invalid Git tree object')
  return { files, summary: { commit, tree, files: files.length, entriesSha256: sha256(`${JSON.stringify(files)}\n`) } }
}

function registeredObjectSnapshot(tree, path) {
  const exact = tree.files.find(file => file.path === path)
  const files = exact ? [exact] : tree.files.filter(file => file.path.startsWith(`${path}/`))
  const kind = !files.length ? 'missing' : !exact ? 'directory'
    : exact.objectKind === 'commit' ? 'submodule' : exact.mode === '120000' ? 'symlink' : 'file'
  return { kind, fileCount: files.length, sha256: sha256(`${JSON.stringify(files)}\n`), files }
}

async function buildFunctionalSnapshot({ repoPath, repositoryId, baseline, candidate, inputs }) {
  const [before, after] = await Promise.all([
    objectTreeSnapshot(repoPath, baseline), objectTreeSnapshot(repoPath, candidate),
  ])
  const features = [...inputs.scopeFeatures.values()].sort((left, right) => left.id.localeCompare(right.id)).map(feature => {
    const registration = inputs.featuresById.get(feature.id)
    requireValue(registration, `Functional snapshot: missing inventory feature ${feature.id}`)
    const observed = registration.repository === repositoryId || (feature.id === 'F40' && repositoryId === 'MR')
    const paths = observed ? registration.repository === repositoryId
      ? (registration.sources ?? []).map(source => requirePortableRelativePath(String(source.path).replace(/\/$/, ''), `${feature.id} source`))
      : NEW_COMPONENT_PATHS : []
    const sources = [...new Set(paths)].map(path => ({ path,
      baseline: registeredObjectSnapshot(before, path), candidate: registeredObjectSnapshot(after, path) }))
    return { id: feature.id, title: feature.title, repository: registration.repository,
      sourceCommit: registration.commit ?? null, acceptanceIds: [...(feature.acceptanceIds ?? [])],
      requirementIds: requirementsFor([feature.id], inputs.scopeFeatures, inputs.requirements),
      status: observed ? 'candidate-source-reviewed-not-behavior-verified' : 'other-source-lock-only-not-observed',
      behaviorVerified: false, sources }
  })
  const snapshot = { schemaVersion: 1, kind: 'candidate-functional-source-snapshot', sourceRepository: repositoryId,
    commits: { baseline, candidate }, includesDirtyWorktree: false, behaviorVerified: false,
    coverageMeaning: 'All frozen F rows; selected repository uses exact baseline/candidate Git objects. Other repositories are lock references only, never observed or passed. Source differences are not behavioral equivalence.',
    featureIds: features.map(feature => feature.id), trees: { baseline: before.summary, candidate: after.summary }, features }
  snapshot.sha256 = sha256(`${JSON.stringify(snapshot)}\n`)
  return snapshot
}

export function validateFunctionalSnapshot(snapshot, { sourceRepository, commits } = {}) {
  requireValue(snapshot?.schemaVersion === 1 && snapshot.kind === 'candidate-functional-source-snapshot'
    && ['MR', 'DS'].includes(snapshot.sourceRepository) && snapshot.includesDirtyWorktree === false
    && snapshot.behaviorVerified === false, 'Functional snapshot: invalid identity or verification boundary')
  requireValue(FULL_SHA.test(snapshot.commits?.baseline ?? '') && FULL_SHA.test(snapshot.commits?.candidate ?? '')
    && (!sourceRepository || sourceRepository === snapshot.sourceRepository)
    && (!commits || (commits.baseline === snapshot.commits.baseline && commits.candidate === snapshot.commits.candidate)),
  'Functional snapshot: source/commit binding mismatch')
  requireValue(Array.isArray(snapshot.features) && Array.isArray(snapshot.featureIds)
    && snapshot.featureIds.length > 0 && new Set(snapshot.featureIds).size === snapshot.featureIds.length
    && JSON.stringify(snapshot.features.map(feature => feature.id)) === JSON.stringify(snapshot.featureIds),
  'Functional snapshot: complete feature coverage mismatch')
  for (const side of ['baseline', 'candidate']) {
    const tree = snapshot.trees?.[side]
    requireValue(tree?.commit === snapshot.commits[side] && FULL_SHA.test(tree.tree ?? '')
      && Number.isSafeInteger(tree.files) && tree.files >= 0 && /^[a-f0-9]{64}$/.test(tree.entriesSha256 ?? ''),
    `Functional snapshot: invalid ${side} tree binding`)
  }
  for (const feature of snapshot.features) {
    const observed = feature.repository === snapshot.sourceRepository
      || (feature.id === 'F40' && snapshot.sourceRepository === 'MR')
    requireValue(feature.behaviorVerified === false && Array.isArray(feature.sources)
      && ['MR', 'DS', 'new', 'NEW'].includes(feature.repository)
      && feature.status === (observed ? 'candidate-source-reviewed-not-behavior-verified' : 'other-source-lock-only-not-observed')
      && (observed ? feature.sources.length > 0 : feature.sources.length === 0)
      && new Set(feature.sources.map(source => source.path)).size === feature.sources.length,
    `Functional snapshot: invalid ${feature.id} boundary`)
    for (const source of feature.sources) {
      requirePortableRelativePath(source.path, 'Functional snapshot registration')
      for (const side of ['baseline', 'candidate']) {
        const entry = source[side]
        requireValue(entry && Array.isArray(entry.files) && Number.isSafeInteger(entry.fileCount)
          && entry.fileCount === entry.files.length,
        `Functional snapshot: invalid ${feature.id} ${side} file count`)
        const paths = entry.files.map(file => file.path)
        requireValue(new Set(paths).size === paths.length
          && JSON.stringify(paths) === JSON.stringify([...paths].sort()),
        `Functional snapshot: invalid ${feature.id} ${side} path ordering`)
        for (const file of entry.files) {
          requirePortableRelativePath(file.path, 'Functional snapshot object')
          requireValue((file.path === source.path || file.path.startsWith(`${source.path}/`))
            && FULL_SHA.test(file.gitObject ?? '')
            && (file.mode === '160000' ? file.objectKind === 'commit' && file.bytes === null
              : ['100644', '100755', '120000'].includes(file.mode) && file.objectKind === 'blob'
                && Number.isSafeInteger(file.bytes) && file.bytes >= 0),
          `Functional snapshot: invalid ${feature.id} ${side} source object`)
        }
        const exact = entry.files.find(file => file.path === source.path)
        const expectedKind = !entry.files.length ? 'missing' : !exact ? 'directory'
          : exact.objectKind === 'commit' ? 'submodule' : exact.mode === '120000' ? 'symlink' : 'file'
        requireValue(entry.kind === expectedKind && (!exact || entry.files.length === 1)
          && entry.sha256 === sha256(`${JSON.stringify(entry.files)}\n`),
        `Functional snapshot: invalid ${feature.id} ${side} source digest or kind`)
      }
    }
  }
  const { sha256: digest, ...contents } = snapshot
  requireValue(/^[a-f0-9]{64}$/.test(digest ?? '') && digest === sha256(`${JSON.stringify(contents)}\n`),
    'Functional snapshot: content digest mismatch')
  return true
}

export async function buildProposal({
  root = ROOT, sourceId, candidate, baseline: baselineOverride, generatedAt = new Date().toISOString(),
  repositories,
} = {}) {
  requireValue(SOURCE_IDS.has(sourceId), `Unknown source ${sourceId}: expected mr or ds`)
  requireValue(FULL_SHA.test(candidate), `Candidate must be a complete 40-hex commit SHA: ${candidate}`)
  requireValue(typeof generatedAt === 'string' && !Number.isNaN(Date.parse(generatedAt)), 'Invalid generation timestamp')
  const repositoryId = sourceId.toUpperCase()
  const loaded = {}
  for (const [index, path] of INPUT_PATHS.entries()) {
    loaded[['baseline', 'inventory', 'scope', 'tasks'][index]] = await readJsonInput(root, path)
  }
  const inputs = loadMappingInputs({ ...Object.fromEntries(Object.entries(loaded).map(([key, item]) => [key, item.value])) })
  const declared = inputs.repositories[repositoryId]
  requireValue(declared && FULL_SHA.test(declared?.commit ?? ''), `${repositoryId}: frozen baseline commit missing from the source lock`)
  const baselineCommit = declared.commit
  if (baselineOverride !== undefined) {
    requireValue(FULL_SHA.test(baselineOverride), `--baseline must be a complete 40-hex commit SHA: ${baselineOverride}`)
    requireValue(baselineOverride === baselineCommit,
      `Provided baseline ${baselineOverride} differs from the frozen ${repositoryId} baseline ${baselineCommit}; this entry can only confirm equality and never changes the acceptance scope`)
  }
  const repoPath = resolveRepository(root, sourceId, repositories)
  const repoInfo = await stat(repoPath).catch(error => {
    throw new Error(`Local source repository for ${repositoryId} is not accessible at ${repoPath}: ${error.code}`)
  })
  requireValue(repoInfo.isDirectory(), `Local source repository for ${repositoryId} is not a directory: ${repoPath}`)
  await requireCommitObject(repoPath, baselineCommit, 'Frozen baseline commit')
  await requireCommitObject(repoPath, candidate, 'Candidate commit')
  const diffArgs = ['--no-ext-diff', '--no-textconv', '--find-renames']
  const nameStatus = parseNameStatusZ(await gitRaw(repoPath, ['diff', ...diffArgs, '--name-status', '-z', baselineCommit, candidate]))
  const numstat = parseNumstatZ(await gitRaw(repoPath, ['diff', ...diffArgs, '--numstat', '-z', baselineCommit, candidate]))
  const numstatByKey = new Map(numstat.map(record => [diffKey(record), record]))
  requireValue(nameStatus.length === numstatByKey.size,
    `Mechanical diff integrity failure: name-status rows ${nameStatus.length} differ from numstat rows ${numstatByKey.size}`)
  const registered = registeredSourcePaths(inputs.featuresById, repositoryId)
  const files = []
  for (const record of nameStatus) {
    const key = diffKey(record)
    const counts = numstatByKey.get(key)
    requireValue(counts !== undefined, `Mechanical diff integrity failure: numstat row missing for ${key}`)
    const change = changeFor(record.status)
    const candidates = record.oldPath ? [record.newPath, record.oldPath] : [record.newPath]
    const directFeatures = []
    for (const path of candidates) {
      for (const featureId of registeredFeaturesForPath(registered, path)) {
        if (!directFeatures.includes(featureId)) directFeatures.push(featureId)
      }
    }
    let mapping
    if (directFeatures.length > 0) {
      mapping = {
        kind: 'direct',
        basis: `matches a frozen feature-inventory registered file or directory source of ${repositoryId}`,
        featureIds: directFeatures,
        acceptanceIds: directFeatures.flatMap(id => inputs.scopeFeatures.get(id)?.acceptanceIds ?? []),
        requirementIds: requirementsFor(directFeatures, inputs.scopeFeatures, inputs.requirements),
      }
    } else {
      mapping = inferenceFor(record.newPath, inputs.evidence, inputs.scopeFeatures, inputs.requirements)
    }
    const included = candidates.some(path => registeredFeaturesForPath(registered, path).length > 0)
    files.push({
      path: record.newPath,
      change,
      status: record.status,
      ...(record.oldPath ? { oldPath: record.oldPath } : {}),
      added: counts.added,
      deleted: counts.deleted,
      binary: counts.added === null || counts.deleted === null,
      includedInFrozenSourceFilter: included,
      mapping,
    })
  }
  const summary = {
    totalFiles: files.length,
    byChange: {
      added: files.filter(file => file.change === 'added').length,
      modified: files.filter(file => file.change === 'modified').length,
      deleted: files.filter(file => file.change === 'deleted').length,
      renamed: files.filter(file => file.change === 'renamed').length,
      copied: files.filter(file => file.change === 'copied').length,
      typechanged: files.filter(file => file.change === 'typechanged').length,
    },
    textInsertions: files.reduce((total, file) => total + (file.added ?? 0), 0),
    textDeletions: files.reduce((total, file) => total + (file.deleted ?? 0), 0),
    binaryFiles: files.filter(file => file.binary).length,
  }
  const baselineIsAncestorOfCandidate = await gitExit(repoPath, ['merge-base', '--is-ancestor', baselineCommit, candidate])
  const zeroDelta = files.length === 0
  const featureCoverage = []
  for (const file of files) {
    for (const featureId of file.mapping.featureIds) {
      let entry = featureCoverage.find(item => item.featureId === featureId)
      if (entry === undefined) {
        entry = {
          featureId,
          kind: file.mapping.kind,
          files: [],
          acceptanceIds: inputs.scopeFeatures.get(featureId)?.acceptanceIds ?? [],
          requirementIds: requirementsFor([featureId], inputs.scopeFeatures, inputs.requirements),
        }
        featureCoverage.push(entry)
      } else if (file.mapping.kind === 'direct') {
        entry.kind = 'direct'
      }
      entry.files.push(file.path)
    }
  }
  featureCoverage.sort((left, right) => left.featureId.localeCompare(right.featureId))
  for (const entry of featureCoverage) entry.files = [...new Set(entry.files)]
  const impactAreas = IMPACT_MATCHERS.map(([area, label, match]) => {
    const affectedPaths = []
    for (const file of files) {
      if (match(file.path)) affectedPaths.push(file.path)
      if (file.oldPath !== undefined && match(file.oldPath)) affectedPaths.push(file.oldPath)
    }
    return {
      area,
      label,
      status: 'review-required',
      behaviorVerified: false,
      affectedFileCount: affectedPaths.length,
      affectedPaths: [...new Set(affectedPaths)].sort((left, right) => left.localeCompare(right)),
      note: affectedPaths.length === 0
        ? 'No path matched this area in the mechanical diff; a non-match is not behavioral verification.'
        : 'Mechanical path match only; migration risk stays review-required and no behavior was verified.',
    }
  })
  const includedFiles = files.filter(file => file.includedInFrozenSourceFilter).map(file => file.path)
  const excludedFiles = files.filter(file => !file.includedInFrozenSourceFilter).map(file => file.path)
  const sourceFilter = {
    kind: 'frozen-feature-inventory-sources',
    matching: 'registered-files-or-directory-descendants',
    repository: repositoryId,
    registeredSourcePaths: registered.count,
    includedCount: includedFiles.length,
    excludedCount: excludedFiles.length,
    includedFiles,
    excludedFiles,
    policy: 'Excluded files stay fully listed in files[] with mapping and numstat; exclusion never becomes a passed verdict and never silently drops a diff row.',
  }
  const mappingSummary = {
    direct: files.filter(file => file.mapping.kind === 'direct').length,
    inferred: files.filter(file => file.mapping.kind === 'inferred').length,
    unknown: files.filter(file => file.mapping.kind === 'unknown').length,
  }
  const decision = {
    effectiveDecision: 'not-included',
    approvalStatus: 'pending-user-review',
    userDecision: null,
    approvedCommit: null,
    baselineChangeApproved: false,
    behaviorVerified: false,
    baselineChangedByThisRun: false,
    note: 'This entry only produces a mechanical read-only proposal. Adopting any increment or changing the frozen baseline, scope or acceptance requires a separate explicit user approval.',
  }
  const relativeRepo = relative(root, repoPath)
  const functionalSnapshot = await buildFunctionalSnapshot({ repoPath, repositoryId,
    baseline: baselineCommit, candidate, inputs })
  const document = {
    schemaVersion: 1,
    kind: 'readonly-candidate-increment-proposal',
    title: '只读候选增量提案（非远端最新声明）',
    generatedAt,
    sourceRepository: {
      id: repositoryId,
      name: declared.name,
      localPath: repoPath,
      localPathRelativeToProductRoot: relativeRepo === '' ? '.' : relativeRepo,
      repositoryDeclarationSource: 'docs/integration/baseline.json repositories declaration (declared, not remotely verified)',
    },
    commits: { baseline: baselineCommit, candidate },
    relationship: {
      baselineIsAncestorOfCandidate,
      zeroDelta,
      candidateEqualsBaseline: candidate === baselineCommit,
      diffDirection: 'baseline->candidate',
    },
    observation: {
      marker: 'local-observation-only',
      remoteVerification: 'unverified',
      remoteLatestClaimed: false,
      networkOperationsPerformed: false,
      fetchPullClonePerformed: false,
      candidateProvenance: 'caller-supplied complete 40-hex commit object resolved only against the local source repository object database',
      candidateIncludesDirtyWorktree: false,
      dirtyWorktreeNeverReadForDiff: true,
      localHeadIsNotUpstreamEvidence: true,
      note: 'Local object existence, ancestry or the current integration HEAD does not establish that the candidate is the latest upstream main. No remote verification was performed and no upstream update is claimed.',
    },
    generator: { path: GENERATOR_PATH, sha256: sha256(await readFile(join(root, GENERATOR_PATH))) },
    inputs: INPUT_PATHS.map((path, index) => {
      const item = loaded[['baseline', 'inventory', 'scope', 'tasks'][index]]
      return { path, sha256: item.sha256, mtimeIso: item.mtimeIso }
    }),
    mappingSummary,
    featureCoverage,
    functionalSnapshot,
    impactAreas,
    sourceFilter,
    summary,
    files,
    decision,
    behaviorVerified: false,
    acceptanceImpact: 'none: this tool updates no acceptance results and no baseline; T61 stays partial',
  }
  document.mechanicalSha256 = sha256(`${JSON.stringify({
    kind: document.kind,
    sourceRepository: { id: document.sourceRepository.id, name: document.sourceRepository.name },
    commits: document.commits,
    relationship: document.relationship,
    summary: document.summary,
    mappingSummary: document.mappingSummary,
    featureCoverage: document.featureCoverage,
    functionalSnapshot: document.functionalSnapshot,
    impactAreas: document.impactAreas,
    sourceFilter: document.sourceFilter,
    files: document.files,
  })}\n`)
  validateDocument(document)
  return { document, markdown: renderMarkdown(document) }
}

export function validateDocument(document) {
  requireValue(document && typeof document === 'object' && !Array.isArray(document)
    && document.schemaVersion === 1, 'Unsupported proposal schema')
  requireValue(document.kind === 'readonly-candidate-increment-proposal', 'Invalid proposal identity')
  requireValue(FULL_SHA.test(document.commits?.baseline ?? '') && FULL_SHA.test(document.commits?.candidate ?? ''),
    'Baseline and candidate must be complete 40-hex commit SHAs')
  requireValue(document.decision?.effectiveDecision === 'not-included'
    && document.decision.userDecision === null
    && document.decision.baselineChangeApproved === false
    && document.decision.behaviorVerified === false
    && document.decision.approvedCommit === null, 'Decision fields are fixed and must stay not-included')
  requireValue(document.behaviorVerified === false, 'behaviorVerified must stay false')
  validateFunctionalSnapshot(document.functionalSnapshot, { sourceRepository: document.sourceRepository?.id, commits: document.commits })
  requireValue(document.observation?.marker === 'local-observation-only'
    && document.observation.remoteVerification === 'unverified'
    && document.observation.remoteLatestClaimed === false, 'Observation must stay local-observation-only/unverified')
  requireValue(Array.isArray(document.files), 'files must be an array')
  const total = document.files.length
  requireValue(document.summary?.totalFiles === total, 'summary.totalFiles mismatch')
  requireValue(document.relationship?.zeroDelta === (total === 0), 'zeroDelta mismatch')
  const kinds = new Map()
  for (const file of document.files) {
    requireValue(typeof file.path === 'string' && file.path !== '', 'Invalid file path')
    requireValue(['added', 'modified', 'deleted', 'renamed', 'copied', 'typechanged'].includes(file.change), `Unknown change ${file.change}`)
    requireValue(/^[ACDMRT]\d{0,3}$/.test(file.status), `Unknown raw status ${file.status}`)
    requireValue(file.binary === (file.added === null || file.deleted === null), `binary flag mismatch for ${file.path}`)
    requireValue((file.change === 'renamed' || file.change === 'copied') === (file.oldPath !== undefined), `oldPath mismatch for ${file.path}`)
    requireValue(['direct', 'inferred', 'unknown'].includes(file.mapping?.kind), `Unknown mapping kind for ${file.path}`)
    kinds.set(file.mapping.kind, (kinds.get(file.mapping.kind) ?? 0) + 1)
  }
  for (const kind of ['direct', 'inferred', 'unknown']) {
    requireValue(document.mappingSummary[kind] === (kinds.get(kind) ?? 0), `mappingSummary.${kind} mismatch`)
  }
  requireValue(document.sourceFilter?.includedCount + document.sourceFilter?.excludedCount === total, 'sourceFilter counts mismatch')
  requireValue(document.impactAreas?.length === 5
    && document.impactAreas.every(area => area.status === 'review-required' && area.behaviorVerified === false),
  'All five migration risk areas must stay review-required without behavior verification')
  return true
}

export function renderMarkdown(document) {
  validateDocument(document)
  const escape = (value => markdownCell(value))
  const lines = [
    `# ${document.sourceRepository.id} 只读候选增量提案（非远端最新声明）`,
    '',
    `> 由 \`${GENERATOR_PATH}\` 机械生成。标记 \`${document.observation.marker}\`：仅本地对象观察，远端 \`${document.observation.remoteVerification}\`，不声明任何上游新更新；本提案不做任何行为验证。`,
    '',
    `- 生成时间：${document.generatedAt}`,
    `- 来源仓库声明：${markdownPath(document.sourceRepository.name)}（${markdownPath(document.sourceRepository.id)}，本地路径 ${markdownPath(document.sourceRepository.localPathRelativeToProductRoot)}；声明来自 baseline 锁，未经远端核验）`,
    `- 冻结基线：\`${document.commits.baseline}\`；候选：\`${document.commits.candidate}\``,
    `- 关系：baseline 是候选祖先 = ${document.relationship.baselineIsAncestorOfCandidate}；候选等于冻结基线 = ${document.relationship.candidateEqualsBaseline}；零差分 = ${document.relationship.zeroDelta}`,
    `- 候选来源：${escape(document.observation.candidateProvenance)}；dirty worktree 从未读入对象差分；当前 integration HEAD 不是上游证据。`,
    '',
    '## 固定决策',
    '',
    `- effectiveDecision = \`not-included\`；approvalStatus = \`${document.decision.approvalStatus}\`；userDecision = \`null\`；approvedCommit = \`null\``,
    `- baselineChangeApproved = \`false\`；behaviorVerified = \`false\`；本轮基线变更 = \`false\``,
    `- ${escape(document.decision.note)}`,
    `- 验收影响：${escape(document.acceptanceImpact)}`,
    '',
    '## 输入与生成器 SHA-256',
    '',
    '| 输入 | SHA-256 | 来源时间(mtime, UTC) |',
    '|---|---|---|',
    ...document.inputs.map(input => `| ${markdownPath(input.path)} | \`${input.sha256}\` | ${input.mtimeIso} |`),
    `| ${markdownPath(document.generator.path)} | \`${document.generator.sha256}\` | — |`,
    '',
    '## 机械摘要',
    '',
    `- 文件总数 ${document.summary.totalFiles}：added ${document.summary.byChange.added}、modified ${document.summary.byChange.modified}、deleted ${document.summary.byChange.deleted}、renamed ${document.summary.byChange.renamed}、copied ${document.summary.byChange.copied}、typechanged ${document.summary.byChange.typechanged}`,
    `- 文本增删：+${document.summary.textInsertions} / -${document.summary.textDeletions}；二进制文件 ${document.summary.binaryFiles}（增删行数为 null）`,
    `- 映射：direct ${document.mappingSummary.direct}、inferred ${document.mappingSummary.inferred}、unknown ${document.mappingSummary.unknown}`,
    `- 冻结来源过滤器：登记 ${document.sourceFilter.registeredSourcePaths} 条；included ${document.sourceFilter.includedCount}、excluded ${document.sourceFilter.excludedCount}（excluded 完整保留在逐文件清单，绝不写 passed）`,
    `- 机械内容 SHA-256（重跑稳定，不含时间戳）：\`${document.mechanicalSha256}\``,
    '',
  ]
  lines.push(
    '## Candidate Functional Source Snapshot', '',
    `- kind = \`candidate-functional-source-snapshot\`; SHA-256 = \`${document.functionalSnapshot.sha256}\`.`,
    '- Exact baseline/candidate Git objects only; dirty worktree excluded. Other repository rows are unobserved lock references. Source coverage is not behavioral equivalence.', '',
    '| F | Source | Snapshot Status | Registered Paths | behaviorVerified |',
    '|---|---|---|---|---|',
    ...document.functionalSnapshot.features.map(feature => `| ${feature.id} | ${feature.repository} | ${feature.status} | ${feature.sources.length} | false |`), '',
  )
  if (document.relationship.zeroDelta) {
    lines.push(
      '## 真实零差分',
      '',
      `- 候选与冻结基线之间的对象 diff 为空（candidateEqualsBaseline = ${document.relationship.candidateEqualsBaseline}）。`,
      '',
    )
  }
  lines.push(
    '## 迁移风险领域（全部 review-required，无行为验证）',
    '',
    '| 领域 | 匹配文件数 | 说明 |',
    '|---|---|---|',
    ...document.impactAreas.map(area => `| ${escape(area.label)} | ${area.affectedFileCount} | ${escape(area.note)} |`),
    '',
  )
  if (document.featureCoverage.length > 0) {
    lines.push(
      '## 特征覆盖（仅 direct/inferred 映射聚合；unknown 不进入）',
      '',
      '| F | 映射 | 关联 T | 关联 R | 文件 |',
      '|---|---|---|---|---|',
      ...document.featureCoverage.map(entry => `| ${entry.featureId} | ${entry.kind} | ${escape(entry.acceptanceIds.join(', ') || '—')} | ${escape(entry.requirementIds.join(', ') || '—')} | ${escape(entry.files.length)} 个文件（清单见 JSON） |`),
      '',
    )
  }
  lines.push(
    '## 逐文件完整清单（name-status + numstat）',
    '',
    '| 变更 | 原始状态 | 旧路径 | 新路径 | +行 | -行 | 二进制 | 映射 | F | 过滤器 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...document.files.map(file => `| ${file.change} | \`${file.status}\` | ${markdownPath(file.oldPath ?? null)} | ${markdownPath(file.path)} | ${file.added === null ? 'null' : file.added} | ${file.deleted === null ? 'null' : file.deleted} | ${file.binary} | ${file.mapping.kind} | ${escape(file.mapping.featureIds.join(', ') || '—')} | ${file.includedInFrozenSourceFilter ? 'included' : 'excluded'} |`),
    '',
    '## 复算与边界',
    '',
    '- 只读入口：不 fetch/pull/clone，不运行上游代码；对象 diff 使用 `git diff --no-ext-diff --no-textconv -z`，NUL 分隔，绝不按空格切分路径。',
    '- 重跑确定性：同一候选重跑时逐文件机械内容与 `mechanicalSha256` 稳定，时间戳只出现在 generatedAt/输入 mtime，不使 diff 本体漂移。',
    '- direct 来自冻结 feature-inventory 的精确文件路径或登记目录的后代路径（目录边界按 path/ 匹配，不含同名兄弟前缀）；inferred 仅来自证据路径、F40 组件路径、docs/integration、docs/releases 的机械规则；其余为 unknown，不虚构映射。',
    '- 本提案不更新 baseline/source lock/scope/验收，也不把候选称为远端最新上游更新。',
    '',
  )
  return lines.join('\n')
}

function validateOutputArgument(root, output) {
  requirePortableRelativePath(output, '--output')
  requireValue(output.startsWith(`${OUTPUT_ROOT_RELATIVE}/`),
    `--output must be a new subdirectory under ${OUTPUT_ROOT_RELATIVE}/ of this repository (forward slashes): ${output}`)
  requireValue(output.slice(OUTPUT_ROOT_RELATIVE.length + 1).length > 0,
    `--output must be deeper than ${OUTPUT_ROOT_RELATIVE} itself`)
  return output
}

async function assertNoSymlinkEscape(root, output) {
  const rootReal = await realpath(root)
  const integrationRoot = resolve(rootReal, OUTPUT_ROOT_RELATIVE)
  const info = await lstat(resolve(root, OUTPUT_ROOT_RELATIVE)).catch(error => {
    throw new Error(`${OUTPUT_ROOT_RELATIVE} is missing; create it before running: ${error.code}`)
  })
  requireValue(info.isDirectory(), `${OUTPUT_ROOT_RELATIVE} must be a directory`)
  const segments = output.split('/')
  let current = resolve(root, OUTPUT_ROOT_RELATIVE)
  for (let index = 2; index < segments.length; index += 1) {
    current = join(current, segments[index])
    const segmentInfo = await lstat(current).catch(() => null)
    if (segmentInfo === null) break
    requireValue(segmentInfo.isDirectory() && !segmentInfo.isSymbolicLink(),
      `Output path escapes through a non-directory or symbolic link: ${output} (component ${segments[index]})`)
  }
  let deepest = resolve(root, OUTPUT_ROOT_RELATIVE)
  const deepestInfo = await stat(deepest)
  if (deepestInfo.isDirectory()) {
    deepest = await realpath(deepest)
  }
  requireValue(deepest === integrationRoot || deepest.startsWith(integrationRoot + sep),
    `Output path resolves outside ${OUTPUT_ROOT_RELATIVE}: ${output}`)
}

async function prepareOutputDirectory(root, output) {
  validateOutputArgument(root, output)
  await assertNoSymlinkEscape(root, output)
  const target = resolve(root, output)
  const existing = await readdir(target, { withFileTypes: true }).catch(() => null)
  if (existing !== null) {
    const foreign = existing.filter(entry => !OUTPUT_FILE_NAMES.has(entry.name)).map(entry => entry.name)
    requireValue(foreign.length === 0,
      `Output directory already contains unrelated entries; refusing to touch them: ${foreign.join(', ')}`)
    for (const entry of existing) {
      const entryInfo = await lstat(join(target, entry.name))
      requireValue(entryInfo.isFile() && !entryInfo.isSymbolicLink(), `Refusing to overwrite non-file or link: ${entry.name}`)
    }
  }
  await mkdir(target, { recursive: true })
  return target
}

export async function writeProposal({
  root = ROOT, sourceId, candidate, baseline, generatedAt = new Date().toISOString(),
  output, repositories,
} = {}) {
  const target = await prepareOutputDirectory(root, output)
  const { document, markdown } = await buildProposal({
    root, sourceId, candidate, ...(baseline === undefined ? {} : { baseline }), generatedAt, repositories,
  })
  const proposalJson = `${JSON.stringify(document, null, 2)}\n`
  const proposalMarkdown = markdown
  await writeFile(join(target, 'proposal.json'), proposalJson)
  await writeFile(join(target, 'proposal.md'), proposalMarkdown)
  const manifest = {
    schemaVersion: 1,
    kind: 'readonly-candidate-increment-proposal-manifest',
    generatedAt: document.generatedAt,
    source: { id: document.sourceRepository.id, name: document.sourceRepository.name },
    commits: document.commits,
    generator: document.generator,
    inputs: document.inputs,
    mechanicalSha256: document.mechanicalSha256,
    decision: document.decision.effectiveDecision,
    outputs: [
      { path: 'proposal.json', sha256: sha256(Buffer.from(proposalJson, 'utf8')), bytes: Buffer.byteLength(proposalJson) },
      { path: 'proposal.md', sha256: sha256(Buffer.from(proposalMarkdown, 'utf8')), bytes: Buffer.byteLength(proposalMarkdown) },
    ],
  }
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(join(target, 'manifest.json'), manifestJson)
  return { document, markdown, manifest, outputDirectory: target }
}

function compactSummary(result) {
  const { document } = result
  const lines = [
    `source ${document.sourceRepository.id} (${document.sourceRepository.name}) baseline ${document.commits.baseline} -> candidate ${document.commits.candidate}`,
    `ancestor=${document.relationship.baselineIsAncestorOfCandidate} zeroDelta=${document.relationship.zeroDelta} files=${document.summary.totalFiles} (added ${document.summary.byChange.added}, modified ${document.summary.byChange.modified}, deleted ${document.summary.byChange.deleted}, renamed ${document.summary.byChange.renamed}) +${document.summary.textInsertions}/-${document.summary.textDeletions} binary ${document.summary.binaryFiles}`,
    `mapping: direct ${document.mappingSummary.direct}, inferred ${document.mappingSummary.inferred}, unknown ${document.mappingSummary.unknown}; frozen filter: included ${document.sourceFilter.includedCount}, excluded ${document.sourceFilter.excludedCount}`,
    `impact areas (review-required): ${document.impactAreas.map(area => `${area.area} ${area.affectedFileCount}`).join(', ')}`,
    `decision: not-included (behaviorVerified=false, userDecision=null, baselineChangeApproved=false)`,
    `outputs: ${result.outputDirectory} -> proposal.json, proposal.md, manifest.json (mechanicalSha256 ${document.mechanicalSha256.slice(0, 16)}...)`,
  ]
  return lines.join('\n')
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const result = await writeProposal({
    ...(options.root === undefined ? {} : { root: options.root }),
    sourceId: options.sourceId,
    candidate: options.candidate,
    output: options.output,
    ...(options.baseline === undefined ? {} : { baseline: options.baseline }),
    ...(options.sourceRoot === undefined ? {} : {
      repositories: { [options.sourceId.toUpperCase()]: options.sourceRoot },
    }),
  })
  process.stdout.write(`${compactSummary(result)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
