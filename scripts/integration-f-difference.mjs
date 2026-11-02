import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify, isDeepStrictEqual } from 'node:util'
import { assertNoInclusionTransaction, validateIncludedIncrements, validateIncludedRegressionEvidence } from './integration-progress.mjs'

const execute = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = '0.26.0-preview.1'
const JSON_OUTPUT = `docs/releases/${RELEASE}-f-difference.json`
const MARKDOWN_OUTPUT = `docs/releases/${RELEASE}-f-difference.md`
const GENERATOR_PATH = 'scripts/integration-f-difference.mjs'
const INPUT_PATHS = [
  'docs/integration/scope.json',
  'docs/integration/feature-inventory.json',
  'docs/integration/behavior-audit.json',
  'docs/integration/tasks.json',
  'docs/integration/baseline.json',
  'docs/integration/included-increments.json',
]
const RESULT_STATES = new Set(['not_run', 'partial', 'passed', 'failed', 'blocked'])
// Precise genesis invariant: the frozen DS manifest has exactly 297 files. After a ledgered DS
// increment the reviewed after-manifest count governs, so reviewed candidate adds/deletes are representable.
const GENESIS_DS_FILES = 297
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

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitBlob(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

function portablePath(path, label) {
  requireValue(typeof path === 'string' && path && !path.includes('\\') && !isAbsolute(path)
    && !/^[A-Za-z]:/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..'),
  `${label}: invalid repository-relative path`)
  return path
}

function indexed(items, label) {
  requireValue(Array.isArray(items), `${label}: expected an array`)
  const result = new Map()
  for (const item of items) {
    requireValue(item && typeof item.id === 'string', `${label}: missing id`)
    requireValue(!result.has(item.id), `${label}: duplicate id ${item.id}`)
    result.set(item.id, item)
  }
  return result
}

function expectedIds(prefix, count) {
  return Array.from({ length: count }, (_value, index) => `${prefix}${String(index + 1).padStart(2, '0')}`)
}

async function defaultGit(root, args, { binary = false } = {}) {
  const result = await execute('git', ['-C', root, ...args], {
    encoding: binary ? 'buffer' : 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  })
  return result.stdout
}

async function readJson(root, path) {
  const bytes = await readFile(join(root, path))
  return { value: JSON.parse(bytes.toString('utf8')), bytes, sha256: sha256(bytes) }
}

function requireSchema(value, label) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label}: invalid document`)
  requireValue(value.schemaVersion === 1, `${label}: unsupported schemaVersion`)
}

async function validateInputs(root, inputs) {
  const { scope, inventory, behavior, tasks, baseline, includedIncrements } = inputs
  for (const [label, value] of Object.entries(inputs)) requireSchema(value, label)
  validateIncludedIncrements({ baseline, inventory, includedIncrements })
  await validateIncludedRegressionEvidence(root, includedIncrements)
  const features = indexed(scope.features, 'scope features')
  const inventoried = indexed(inventory.features, 'inventory features')
  const expected = expectedIds('F', 40)
  requireValue(features.size === expected.length && inventoried.size === expected.length,
    'Feature catalog must contain exactly F01-F40')
  for (const id of expected) requireValue(features.has(id) && inventoried.has(id), `Missing feature ${id}`)

  const results = indexed(tasks.acceptanceResults, 'acceptance results')
  for (const [id, result] of results) {
    requireValue(/^T\d{2}$/.test(id), `Unknown acceptance id ${id}`)
    requireValue(RESULT_STATES.has(result.status), `${id}: unknown status ${result.status}`)
    requireValue(Array.isArray(result.evidence), `${id}: evidence must be an array`)
    for (const path of result.evidence) {
      portablePath(path, `${id} evidence`)
      requireValue((await stat(join(root, path))).isFile(), `${id}: missing evidence ${path}`)
    }
  }

  for (const id of expected) {
    const feature = features.get(id)
    const source = inventoried.get(id)
    requireValue(feature.title === source.title, `${id}: title mapping differs`)
    requireValue(Array.isArray(feature.acceptanceIds) && feature.acceptanceIds.length, `${id}: missing acceptance mapping`)
    requireValue(isDeepStrictEqual(feature.acceptanceIds, source.acceptanceIds), `${id}: acceptance mapping differs`)
    requireValue(feature.decision === source.destination, `${id}: destination mapping differs`)
    requireValue(source.behaviorVerified === false, `${id}: behavior verification must remain false`)
    for (const acceptanceId of feature.acceptanceIds) requireValue(results.has(acceptanceId), `${id}: unknown acceptance ${acceptanceId}`)
    requireValue(['DS', 'MR', 'new'].includes(source.repository), `${id}: unknown repository`)
    const expectedCommit = source.repository === 'new' ? null : baseline.repositories[source.repository]?.commit
    requireValue(/^[a-f0-9]{40}$/.test(expectedCommit ?? '') || expectedCommit === null, `${id}: invalid frozen commit`)
    requireValue(source.commit === expectedCommit, `${id}: frozen commit differs from baseline`)
    requireValue(inventory.baseline[source.repository] === expectedCommit || source.repository === 'new',
      `${id}: inventory baseline differs`)
    requireValue(Array.isArray(source.sources), `${id}: sources must be an array`)
    if (source.repository === 'new') requireValue(id === 'F40' && source.sources.length === 0, `${id}: invalid new source`)
    else {
      requireValue(id !== 'F40' && source.sources.length > 0, `${id}: missing frozen sources`)
      for (const registered of source.sources) {
        portablePath(registered.kind === 'directory' ? registered.path.replace(/\/$/, '') : registered.path, `${id} source`)
        if (registered.kind === 'directory') {
          requireValue(Number.isInteger(registered.fileCount) && registered.fileCount > 0
            && /^[a-f0-9]{64}$/.test(registered.treeFingerprintSha256), `${id}: invalid directory source`)
        } else {
          requireValue(/^[a-f0-9]{40}$/.test(registered.gitBlob) && Number.isInteger(registered.bytes),
            `${id}: invalid file source`)
        }
      }
    }
  }

  const entries = indexed(behavior.entries, 'behavior entries')
  for (const entry of entries.values()) {
    requireValue(Array.isArray(entry.featureIds) && (entry.remaining === undefined || Array.isArray(entry.remaining)),
      `${entry.id}: invalid behavior entry`)
    for (const id of entry.featureIds) requireValue(features.has(id), `${entry.id}: unknown feature ${id}`)
  }
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(behavior.updatedOn), 'behavior-audit: invalid snapshot date')
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(tasks.updatedOn), 'tasks: invalid snapshot date')
  for (const side of ['DS', 'MR']) {
    requireValue(/^[a-f0-9]{40}$/.test(baseline.repositories[side]?.commit), `${side}: full frozen commit required`)
    requireValue(inventory.baseline[side] === baseline.repositories[side].commit, `${side}: baseline mapping differs`)
  }
  return { features, inventoried, results, entries }
}

function expectedDsFileCount(includedIncrements) {
  const dsIncrements = (includedIncrements?.increments ?? []).filter(increment => increment.sourceRepository === 'DS')
  if (dsIncrements.length === 0) return GENESIS_DS_FILES
  const last = dsIncrements[dsIncrements.length - 1]
  const reviewed = last.review?.dsMigration?.after?.fileCount
  requireValue(Number.isInteger(reviewed) && reviewed > 0,
    `${last.id}: ledgered DS increment needs a reviewed after-manifest fileCount`)
  return reviewed
}

async function verifyDsManifest(root, commit, expectedFileCount) {
  const manifestPath = 'modules/bot-runtime/SOURCE.json'
  const { value: manifest, sha256: manifestSha256 } = await readJson(root, manifestPath)
  requireSchema(manifest, 'DS SOURCE')
  requireValue(manifest.commit === commit, 'DS SOURCE commit differs from frozen baseline')
  requireValue(Array.isArray(manifest.files) && manifest.files.length === expectedFileCount,
    `DS SOURCE must contain exactly ${expectedFileCount} files (genesis ${GENESIS_DS_FILES}; ledgered reviewed count otherwise)`)
  const bySource = new Map()
  const currentPaths = new Set()
  for (const file of manifest.files) {
    portablePath(file.path, 'DS manifest path')
    portablePath(file.sourcePath, 'DS manifest sourcePath')
    requireValue(file.path.startsWith('vendor/ds-bot/') && !currentPaths.has(file.path) && !bySource.has(file.sourcePath),
      'DS SOURCE contains duplicate paths')
    currentPaths.add(file.path)
    const currentPath = `modules/bot-runtime/${file.path}`
    const bytes = await readFile(join(root, currentPath))
    requireValue(sha256(bytes) === file.sha256, `DS raw bytes changed: ${currentPath}`)
    requireValue(gitBlob(bytes) === file.gitBlob, `DS Git blob changed: ${currentPath}`)
    bySource.set(file.sourcePath, { ...file, currentPath, currentRawSha256: sha256(bytes), currentGitBlob: gitBlob(bytes) })
  }
  return { manifestPath, manifestSha256, bySource, currentPaths }
}

async function pathKind(root, path) {
  try {
    const info = await stat(join(root, path))
    return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function dsSourceRow(root, registered, manifest) {
  if (registered.kind === 'directory') {
    const currentPath = `modules/bot-runtime/vendor/ds-bot/${registered.path}`
    const present = await pathKind(root, currentPath)
    return {
      path: registered.path,
      kind: 'directory',
      frozenFileCount: registered.fileCount,
      frozenTreeFingerprintSha256: registered.treeFingerprintSha256,
      currentPath,
      currentPathKind: present,
      status: present === 'directory' ? 'directory-present-equivalence-unknown' : 'path-missing-equivalence-unknown',
    }
  }
  const current = manifest.bySource.get(registered.path)
  requireValue(current, `DS registered source is absent from fixed SOURCE manifest: ${registered.path}`)
  requireValue(current.gitBlob === registered.gitBlob, `DS registered blob differs: ${registered.path}`)
  return {
    path: registered.path,
    kind: 'file',
    frozenGitBlob: registered.gitBlob,
    frozenBytes: registered.bytes,
    currentPath: current.currentPath,
    currentRawSha256: current.currentRawSha256,
    currentGitBlob: current.currentGitBlob,
    rawBytesEqual: current.currentRawSha256 === current.sha256,
    gitBlobEqual: current.currentGitBlob === registered.gitBlob,
    status: 'raw-and-git-identical',
  }
}

function parseNumstat(text, path) {
  if (!text.trim()) return { added: 0, deleted: 0 }
  const lines = text.trimEnd().split('\n')
  requireValue(lines.length === 1, `Unexpected numstat rows for ${path}`)
  const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(lines[0])
  requireValue(match, `Malformed numstat for ${path}`)
  return {
    added: match[1] === '-' ? null : Number(match[1]),
    deleted: match[2] === '-' ? null : Number(match[2]),
  }
}

async function mrSourceRow(root, commit, registered, git) {
  const path = registered.path
  const frozenBytes = await git(root, ['show', `${commit}:${path}`], { binary: true })
  requireValue(Buffer.isBuffer(frozenBytes), `Git show did not return bytes for ${path}`)
  requireValue(frozenBytes.length === registered.bytes && gitBlob(frozenBytes) === registered.gitBlob,
    `Frozen MR source differs from inventory: ${path}`)
  let currentBytes = null
  let currentRawSha256 = null
  let currentRawGitBlob = null
  let currentGitBlob = null
  let missing = false
  try {
    currentBytes = await readFile(join(root, path))
    currentRawSha256 = sha256(currentBytes)
    currentRawGitBlob = gitBlob(currentBytes)
    currentGitBlob = (await git(root, ['hash-object', `--path=${path}`, '--', path])).trim()
    requireValue(/^[a-f0-9]{40}$/.test(currentGitBlob), `Invalid current Git blob for ${path}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    missing = true
  }
  const numstat = parseNumstat(await git(root, ['diff', '--numstat', commit, '--', path]), path)
  const rawBytesEqual = currentBytes !== null && currentBytes.equals(frozenBytes)
  const gitNormalizedEqual = currentGitBlob === registered.gitBlob
  return {
    path,
    kind: 'file',
    frozenGitBlob: registered.gitBlob,
    frozenBytes: registered.bytes,
    frozenRawSha256: sha256(frozenBytes),
    currentPath: path,
    currentPathKind: missing ? null : 'file',
    currentRawSha256,
    currentRawGitBlob,
    currentGitBlob,
    rawBytesEqual,
    gitNormalizedEqual,
    numstat,
    status: missing ? 'path-missing-capability-unknown'
      : rawBytesEqual && gitNormalizedEqual ? 'raw-and-git-identical'
        : gitNormalizedEqual ? 'raw-bytes-differ-git-normalized-identical' : 'git-content-changed',
  }
}

async function digestComponent(root, path) {
  const kind = await pathKind(root, path)
  if (!kind) return { path, present: false, kind: null, fileCount: 0, treeSha256: null }
  const files = []
  const walk = async (absolute, relativeBase) => {
    const entries = await readdir(absolute, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      requireValue(!entry.isSymbolicLink(), `F40 component contains a symbolic link: ${path}`)
      const child = join(absolute, entry.name)
      const childRelative = relativeBase ? `${relativeBase}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(child, childRelative)
      else if (entry.isFile()) files.push({ path: childRelative, sha256: sha256(await readFile(child)) })
    }
  }
  if (kind === 'directory') await walk(join(root, path), '')
  else files.push({ path: '', sha256: sha256(await readFile(join(root, path))) })
  files.sort((left, right) => left.path.localeCompare(right.path))
  return {
    path,
    present: true,
    kind,
    fileCount: files.length,
    treeSha256: sha256(files.map(file => `${file.path}\0${file.sha256}\n`).join('')),
  }
}

function differenceFor(feature, sources) {
  if (feature.repository === 'new') return '新建'
  if (sources.some(source => source.status.startsWith('path-missing') || source.status.startsWith('directory-present'))) {
    return '改变（登记来源未全部原样迁入；能力/等价性未据此判定）'
  }
  if (feature.repository === 'DS') return '迁入（固定 SOURCE 原始字节与 Git blob 一致）'
  if (sources.every(source => source.rawBytesEqual && source.gitNormalizedEqual)) return '保留（原始字节与 Git 内容一致）'
  if (sources.every(source => source.gitNormalizedEqual)) return '保留（Git 内容一致；原始字节/行尾不同）'
  return '改变（Git 内容存在差异）'
}

function specialBoundaries(id) {
  if (id === 'F13') return {
    equivalence: 'unknown',
    notes: ['原 22 个 browser-plugins 与当前实现的逐项等价性未证实；路径缺失不自动表示能力不支持。'],
  }
  if (id === 'F22') return {
    carrier: 'unknown',
    notes: ['app/ 与 docker/ 的当前承载及最终载体形态未证实；路径缺失不自动表示能力不支持。'],
  }
  if (id === 'F40') return {
    activationSupported: false,
    postActivationRollbackSupported: false,
    stopWriteProvable: false,
    c9: false,
    notes: ['C9 与激活、激活后回滚、全域停写能力保持关闭；本附录不升格行为或平台验收。'],
  }
  return null
}

function historicalFor(id, behavior, entries) {
  return [...entries.values()].filter(entry => entry.featureIds.includes(id)).map(entry => ({
    id: entry.id,
    historicalOnly: true,
    snapshotOn: behavior.updatedOn,
    level: entry.level ?? null,
    observed: entry.observed ?? null,
    remaining: [...(entry.remaining ?? [])],
  }))
}

export async function buildDifference({ root = ROOT, generatedAt = new Date().toISOString(), git = defaultGit } = {}) {
  await assertNoInclusionTransaction(root)
  requireValue(typeof generatedAt === 'string' && !Number.isNaN(Date.parse(generatedAt)), 'Invalid generation timestamp')
  const loaded = Object.fromEntries(await Promise.all(INPUT_PATHS.map(async path => [path, await readJson(root, path)])))
  const keys = ['scope', 'inventory', 'behavior', 'tasks', 'baseline', 'includedIncrements']
  const inputs = Object.fromEntries(keys.map((key, index) => [key, loaded[INPUT_PATHS[index]].value]))
  const catalogs = await validateInputs(root, inputs)
  const { baseline, behavior, tasks, scope, includedIncrements } = inputs
  const ds = await verifyDsManifest(root, baseline.repositories.DS.commit, expectedDsFileCount(includedIncrements))
  const features = []
  const allMrRows = []
  for (const id of expectedIds('F', 40)) {
    const inventory = catalogs.inventoried.get(id)
    const scopeFeature = catalogs.features.get(id)
    let sources = []
    let currentComponents = null
    if (inventory.repository === 'DS') {
      sources = await Promise.all(inventory.sources.map(source => dsSourceRow(root, source, ds)))
    } else if (inventory.repository === 'MR') {
      for (const source of inventory.sources) {
        const row = await mrSourceRow(root, inventory.commit, source, git)
        sources.push(row)
        allMrRows.push(row)
      }
    } else {
      currentComponents = []
      for (const path of NEW_COMPONENT_PATHS) currentComponents.push(await digestComponent(root, path))
      requireValue(currentComponents.every(component => component.present), 'F40: a registered current component path is missing')
    }
    const acceptance = scopeFeature.acceptanceIds.map(acceptanceId => {
      const result = catalogs.results.get(acceptanceId)
      return {
        id: acceptanceId,
        status: result.status,
        level: result.level ?? null,
        verifiedOn: result.verifiedOn ?? null,
        evidence: [...result.evidence],
        notes: result.notes ?? null,
      }
    })
    features.push({
      id,
      title: scopeFeature.title,
      repository: inventory.repository,
      frozenCommit: inventory.commit,
      integrationDecision: inventory.destination,
      difference: differenceFor(inventory, sources),
      behaviorVerified: false,
      sources,
      currentComponents,
      acceptance,
      currentOpenItems: acceptance.filter(item => item.status !== 'passed').map(item => ({
        id: item.id, status: item.status, verifiedOn: item.verifiedOn, notes: item.notes,
      })),
      historicalBehavior: historicalFor(id, behavior, catalogs.entries),
      boundaries: specialBoundaries(id),
    })
  }
  const document = {
    schemaVersion: 1,
    kind: 'preview-feature-difference',
    release: RELEASE,
    generatedAt,
    coverageMeaning: 'Recomputable source/provenance difference and current acceptance snapshots; behaviorVerified remains false for every feature.',
    baselines: {
      DS: { repository: baseline.repositories.DS.name, commit: baseline.repositories.DS.commit },
      MR: { repository: baseline.repositories.MR.name, commit: baseline.repositories.MR.commit },
    },
    inputSha256: Object.fromEntries(INPUT_PATHS.map(path => [path, loaded[path].sha256])),
    generator: { path: GENERATOR_PATH, sha256: sha256(await readFile(join(root, GENERATOR_PATH))) },
    snapshots: {
      behaviorAuditUpdatedOn: behavior.updatedOn,
      tasksUpdatedOn: tasks.updatedOn,
      acceptanceVerifiedOn: Object.fromEntries([...catalogs.results].map(([id, result]) => [id, result.verifiedOn ?? null])),
    },
    sourceStatus: {
      DS: {
        commit: baseline.repositories.DS.commit,
        manifestPath: ds.manifestPath,
        manifestSha256: ds.manifestSha256,
        expectedFiles: expectedDsFileCount(includedIncrements),
        verifiedFiles: ds.currentPaths.size,
        status: 'passed',
      },
      MR: {
        commit: baseline.repositories.MR.commit,
        registeredSources: allMrRows.length,
        rawIdentical: allMrRows.filter(row => row.rawBytesEqual).length,
        gitNormalizedIdentical: allMrRows.filter(row => row.gitNormalizedEqual).length,
        changedOrMissing: allMrRows.filter(row => !row.gitNormalizedEqual).length,
        numstat: Object.fromEntries(allMrRows.map(row => [row.path, row.numstat])),
      },
      newComponents: {
        frozenCommit: null,
        paths: NEW_COMPONENT_PATHS.length,
        treeSha256: sha256(features.find(feature => feature.id === 'F40').currentComponents
          .map(component => `${component.path}\0${component.treeSha256}\n`).join('')),
      },
    },
    historicalRemainingPolicy: `behavior-audit entries are historical observations dated ${behavior.updatedOn}; they are not current defect facts. Current open items come only from tasks.json acceptance results not marked passed.`,
    includedIncrements: {
      genesis: { ...includedIncrements.genesis },
      increments: includedIncrements.increments.map(increment => structuredClone(increment)),
    },
    features,
  }
  validateDocument(document)
  return { document, markdown: renderMarkdown(document) }
}

export function validateDocument(document) {
  requireSchema(document, 'F difference output')
  requireValue(document.kind === 'preview-feature-difference' && document.release === RELEASE, 'Invalid F difference identity')
  requireValue(typeof document.generatedAt === 'string' && !Number.isNaN(Date.parse(document.generatedAt)), 'Invalid saved generation timestamp')
  const features = indexed(document.features, 'output features')
  const expected = expectedIds('F', 40)
  requireValue(features.size === expected.length, 'Output must contain exactly 40 features')
  for (const id of expected) {
    const feature = features.get(id)
    requireValue(feature?.id === id && feature.behaviorVerified === false, `${id}: missing or behavior upgraded`)
    requireValue(Array.isArray(feature.acceptance) && feature.acceptance.length > 0, `${id}: missing acceptance`)
    for (const acceptance of feature.acceptance) requireValue(RESULT_STATES.has(acceptance.status), `${id}: unknown acceptance status`)
  }
  requireValue(document.sourceStatus?.DS?.verifiedFiles === document.sourceStatus?.DS?.expectedFiles,
    'DS source summary must bind the reviewed manifest file count')
  const dsLedgered = (document.includedIncrements?.increments ?? []).some(increment => increment.sourceRepository === 'DS')
  requireValue(dsLedgered || document.sourceStatus?.DS?.expectedFiles === GENESIS_DS_FILES,
    `DS genesis manifest must contain exactly ${GENESIS_DS_FILES} files`)
  requireValue(document.sourceStatus?.DS?.commit === document.baselines?.DS?.commit,
    'DS source summary must bind the current DS baseline candidate')
  requireValue(document.features.find(feature => feature.id === 'F40').frozenCommit === null, 'F40 frozen commit must be null')
  requireValue(document.includedIncrements && Array.isArray(document.includedIncrements.increments),
    'Included-increment ledger comparison is required')
  for (const increment of document.includedIncrements.increments) {
    requireValue(/^[0-9a-f]{40}$/.test(increment.commits?.candidate ?? '')
      && typeof increment.targetVersion === 'string' && increment.targetVersion
      && increment.regressionSummary?.status === 'passed'
      && Array.isArray(increment.regressions) && increment.regressions.length > 0,
    `${increment.id ?? 'increment'}: candidate, target version and passed regression evidence are required`)
  }
}

function markdown(value) {
  return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', '<br>')
}

function inline(path) {
  return path ? `\`${markdown(path)}\`` : '—'
}

export function renderMarkdown(document) {
  validateDocument(document)
  const lines = [
    `# ${RELEASE} F01–F40 可复算差分附录`,
    '',
    '> 本附录由 `scripts/integration-f-difference.mjs` 机械生成。它绑定冻结来源、当前工作树和当前 T 快照，不表示行为、平台、产品或发布验收全部通过；全部 40 行 `behaviorVerified=false`。',
    '',
    `- 生成时间：${document.generatedAt}`,
    `- DS 基线：${inline(document.baselines.DS.repository)} @ \`${document.baselines.DS.commit}\``,
    `- MR 基线：${inline(document.baselines.MR.repository)} @ \`${document.baselines.MR.commit}\``,
    `- behavior-audit 历史快照：${document.snapshots.behaviorAuditUpdatedOn}；tasks 快照：${document.snapshots.tasksUpdatedOn}。各 T 的 \`verifiedOn\` 逐行保留。`,
    `- 历史 remaining 仅属 ${document.snapshots.behaviorAuditUpdatedOn} 快照，不是当前缺陷清单；当前开放项只取未 passed 的 T。`,
    '',
    '## 输入与生成器 SHA-256',
    '',
    '| 文件 | SHA-256 |',
    '|---|---|',
    ...Object.entries(document.inputSha256).map(([path, digest]) => `| ${inline(path)} | \`${digest}\` |`),
    `| ${inline(document.generator.path)} | \`${document.generator.sha256}\` |`,
    '',
    '## 源校验摘要',
    '',
    `- DS：固定 ${inline(document.sourceStatus.DS.manifestPath)}（SHA-256 \`${document.sourceStatus.DS.manifestSha256}\`），本轮 ${document.sourceStatus.DS.verifiedFiles}/${document.sourceStatus.DS.expectedFiles} 文件原始 SHA-256 与 Git blob 校验通过。`,
    `- MR：登记 ${document.sourceStatus.MR.registeredSources} 个源文件；raw bytes 一致 ${document.sourceStatus.MR.rawIdentical}，Git 归一化一致 ${document.sourceStatus.MR.gitNormalizedIdentical}，Git 内容改变或缺失 ${document.sourceStatus.MR.changedOrMissing}。逐文件 numstat 与 raw/Git 状态见 JSON。`,
    `- F40：无冻结源，\`frozenCommit=null\`；${document.sourceStatus.newComponents.paths} 个当前组件路径的摘要树为 \`${document.sourceStatus.newComponents.treeSha256}\`，不伪造基线 commit。`,
    '',
    '## 已纳入增量台账比较',
    '',
    ...(document.includedIncrements.increments.length === 0 ? [
      '当前台账为空；仅登记 MR/DS genesis 完整 SHA，没有虚构已纳入事件。',
      '',
    ] : [
      '| 来源 | baseline → candidate | 拟纳入版本 | reviewer / 评审 | 迁移 | 风险 | 受影响回归与日志 SHA-256 |',
      '|---|---|---|---|---|---|---|',
      ...document.includedIncrements.increments.map(increment => [
        increment.sourceRepository,
        `${increment.commits.baseline} → ${increment.commits.candidate}`,
        increment.targetVersion,
        `${increment.review.reviewer.id}；F ${increment.review.features.length} / R ${increment.review.requirements.length} / T ${increment.review.acceptance.length} / 文件 ${increment.review.files.length}；approval ${increment.approvalSha256}`,
        `interface=${increment.review.migrations.interface.status}；data=${increment.review.migrations.data.status}`,
        increment.review.risks.map(risk => `${risk.area}=${risk.status}`).join(', '),
        increment.regressions.map(regression => `${regression.id} ${regression.status} exit=${regression.exitCode} stdout=${regression.stdoutSha256} stderr=${regression.stderrSha256}`).join('<br>'),
      ].map(value => markdown(value)).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      '',
    ]),
    '## F 差分（恰 40 行）',
    '',
    '| F | 标题 | 冻结来源 | 当前差异 | 当前 T（status / level / verifiedOn / evidence） | 历史 behavior | unknown / 当前边界 |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const feature of document.features) {
    const frozen = feature.repository === 'new' ? '新建；commit=null' : `${feature.repository}@${feature.frozenCommit}`
    const acceptance = feature.acceptance.map(item => [
      `${item.id} ${item.status} / ${item.level ?? 'null'} / ${item.verifiedOn ?? 'null'}`,
      ...item.evidence.map(path => inline(path)),
    ].join('<br>')).join('<br><br>')
    const historical = feature.historicalBehavior.length
      ? `${feature.historicalBehavior.map(entry => entry.id).join(', ')} @ ${document.snapshots.behaviorAuditUpdatedOn}（历史未回填）`
      : '—'
    const boundaries = [
      ...feature.currentOpenItems.map(item => `${item.id} ${item.status}（当前 T；notes 见 JSON）`),
      ...(feature.boundaries?.notes ?? []),
    ]
    lines.push(`| ${feature.id} | ${markdown(feature.title)} | ${markdown(frozen)} | ${markdown(feature.difference)} | ${acceptance} | ${markdown(historical)} | ${markdown(boundaries.join('<br>') || '—')} |`)
  }
  lines.push(
    '',
    '## 复算与边界',
    '',
    '- 默认只读：`node scripts/integration-f-difference.mjs`。',
    '- 写入两个固定派生文件：`node scripts/integration-f-difference.mjs --write`。',
    '- 确定性校验：`node scripts/integration-f-difference.mjs --check`；复用已保存生成时间，输入、生成器或源状态变化均拒绝。',
    '- raw bytes 与 Git 归一化是不同事实；Git 内容一致不意味着工作树原始字节一致。路径缺失不自动推出能力不支持。',
    '- F13 的逐项插件等价性、F22 的载体形态均为 unknown。F40 的 C9、activation、post-activation rollback 与 stop-write 能力继续为 false。',
    '- preview.1 尚未发布，本附录不是 Release 挂载或在线 CI 证据。',
    '',
  )
  return lines.join('\n')
}

export async function writeDifference({ root = ROOT, generatedAt, git } = {}) {
  const result = await buildDifference({ root, generatedAt, git })
  await writeFile(join(root, JSON_OUTPUT), `${JSON.stringify(result.document, null, 2)}\n`)
  await writeFile(join(root, MARKDOWN_OUTPUT), result.markdown)
  return result
}

export async function checkDifference({ root = ROOT, git } = {}) {
  const saved = await readJson(root, JSON_OUTPUT)
  validateDocument(saved.value)
  const result = await buildDifference({ root, generatedAt: saved.value.generatedAt, git })
  if (!isDeepStrictEqual(saved.value, result.document)) throw new Error('F difference JSON is stale or malformed')
  const savedMarkdown = await readFile(join(root, MARKDOWN_OUTPUT), 'utf8')
  if (savedMarkdown !== result.markdown) throw new Error('F difference Markdown is stale or malformed')
  return result
}

async function main(args) {
  let root = ROOT
  const positional = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      root = resolve(args[index + 1])
      index += 1
    } else positional.push(args[index])
  }
  requireValue(positional.length <= 1 && (positional.length === 0 || positional[0] === '--write' || positional[0] === '--check'),
    'Usage: node scripts/integration-f-difference.mjs [--write|--check] [--root <project-root>]')
  if (positional[0] === '--write') {
    const { document } = await writeDifference({ root })
    process.stdout.write(`Wrote ${JSON_OUTPUT} and ${MARKDOWN_OUTPUT}: ${document.features.length} features, included increments ${document.includedIncrements.increments.length}.\n`)
  } else if (positional[0] === '--check') {
    const { document } = await checkDifference({ root })
    process.stdout.write(`F difference verified: ${document.features.length} features, DS ${document.sourceStatus.DS.verifiedFiles} files, included increments ${document.includedIncrements.increments.length}, generatedAt ${document.generatedAt}.\n`)
  } else {
    const { document } = await buildDifference({ root })
    process.stdout.write(`Read-only F difference: ${document.features.length} features; DS ${document.sourceStatus.DS.verifiedFiles} files; included increments ${document.includedIncrements.increments.length}; behaviorVerified=true 0.\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
