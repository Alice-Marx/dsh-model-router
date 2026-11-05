// Reports what the vendored DS Bot runtime actually is, and what the product adds on top of
// it. Every row of the feature matrix is proved by a file in the vendored tree plus a marker
// inside it, so a sync that copied bytes without keeping a feature cannot pass; the rows that
// are NOT upstream are proved by their absence in the upstream runtime, so the product's own
// remote computer and document work is never mistaken for shipped DS Bot code.
//
//   node scripts/check-upstream-parity.mjs [--source <upstream checkout>] [--diff] [--json]
//
// With `--source` the vendored tree is also proved byte for byte against that checkout (see
// scripts/sync-ds-bot.mjs). Without one, only the tree and its recorded manifest are checked,
// which is what a packaged repository can do.
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncDsBot, readOverlay, overlayDiff, pinSource } from './sync-ds-bot.mjs'

const PROJECT = resolve(import.meta.dirname, '..')
const RUNTIME = join(PROJECT, 'modules/bot-runtime')
const VENDOR = join(RUNTIME, 'vendor/ds-bot')
const SOURCE_FILE = join(RUNTIME, 'SOURCE.json')

// Upstream DS Bot features, each with the vendored files that carry it and a marker that must
// appear in one of them. The 0.2.7 additions are the ones the upstream CHANGELOG names.
const UPSTREAM_FEATURES = [
  { id: 'team-runtime', feature: 'long-lived Bot team runtime', evidence: ['index.js'], marker: 'export function createRuntime' },
  { id: 'bots', feature: 'Bots, roles, models and working folders', evidence: ['src/host/roster.js', 'src/host/agents.js', 'src/host/folders.js'], marker: 'workDir' },
  { id: 'groups', feature: 'group chats with reply modes', evidence: ['src/host/groups.js', 'src/shared/group-replies.js', 'src/host/channel.js'], marker: 'parseReplies' },
  { id: 'group-goals', feature: 'group goals: staged, checked by the admin (0.2.7)', evidence: ['src/host/goals.js', 'src/client/goal.js'], marker: 'group_goal' },
  { id: 'goal-skills', feature: 'the goal-grill skill pack (0.2.7)', evidence: ['src/host/goal-skills.js', 'src/host/skills/goal-grill/SKILL.md'], marker: 'goal-grill' },
  { id: 'memory', feature: 'Bot, group and team memory with change history (0.2.7)', evidence: ['src/host/memory.js', 'src/client/memory-panel.js'], marker: 'memoryHistory' },
  { id: 'browser-panel', feature: 'Bot browser panel and page reads', evidence: ['src/host/browser.js', 'src/host/browser/session.js', 'src/client/browser-pane.js', 'src/client/read-page.js'], marker: 'read_browser' },
  { id: 'browser-plugins', feature: 'browser plugins: refs, script and task', evidence: ['src/host/browser-plugins.js', 'src/host/browser/refs.js', 'src/host/browser/script.js'], marker: 'browserPlugin' },
  { id: 'avatar-library', feature: 'reusable avatar library (a photo per Bot)', evidence: ['src/host/avatar-library.js', 'src/client/avatar-library.js'], marker: 'avatarLibrary' },
  { id: 'office-documents', feature: 'Word, Excel and PowerPoint reads and previews', evidence: ['src/office/docx.js', 'src/office/xlsx.js', 'src/office/pptx.js'], marker: 'docx' },
  { id: 'web-search', feature: 'web search', evidence: ['web-search.js', 'src/host/links.js'], marker: 'web_search' },
  { id: 'capabilities', feature: 'capabilities: MCP servers, skills and packs', evidence: ['src/host/capabilities.js', 'src/client/capability-settings.js'], marker: 'capabilityLibraryView' },
  { id: 'schedules', feature: 'scheduled tasks per Bot (0.2.7 status detail)', evidence: ['src/host/schedules.js', 'src/client/schedules.js'], marker: 'schedule' },
  { id: 'secrets', feature: 'secrets a Bot asks for and never sees', evidence: ['src/host/secrets.js', 'src/client/secret-card.js'], marker: 'request_secret' },
  { id: 'steward', feature: 'context steward for long chats', evidence: ['src/host/steward.js'], marker: 'steward' },
  { id: 'learning', feature: 'learned notes and skill proposals', evidence: ['src/host/learning.js', 'src/client/learning-card.js'], marker: 'learning' },
  { id: 'usage', feature: 'token usage by Bot, model and time', evidence: ['src/host/usage.js', 'src/client/usage-page.js'], marker: 'usage' },
  { id: 'side-chat', feature: 'side chat from a chat snapshot', evidence: ['src/client/side-chat.js', 'src/host/side.js'], marker: 'side' },
  { id: 'speech', feature: 'speech input and read-aloud', evidence: ['src/client/speech.js', 'src/client/voice.js'], marker: 'speech' },
  { id: 'enter-key', feature: 'Enter sends or wraps, and steers a queued message (0.2.7)', evidence: ['src/client/enter-key.js', 'src/client/enter-steer.js', 'src/host/steer.js'], marker: 'steerQueued' },
  { id: 'message-times', feature: 'message times in private chats (0.2.7)', evidence: ['src/client/text.js', 'src/client/user-message.js'], marker: 'messageClock' },
  { id: 'default-model', feature: 'default model for new Bots (0.2.7)', evidence: ['src/client/settings.js', 'src/client/bot-draft.js'], marker: 'defaultBotModel' },
  { id: 'models-step', feature: 'the Models onboarding step (0.2.7)', evidence: ['src/client/sidebar.js', 'src/client/index.js'], marker: 'MODELS_STEP' },
  { id: 'turn-failure', feature: 'a failed turn says what to do (0.2.7)', evidence: ['src/client/turn-error.js', 'src/client/index.js'], marker: 'FailureCell' },
  { id: 'app-ready', feature: "the desktop app's start-window handoff (0.2.7)", evidence: ['src/client/sidebar.js'], marker: 'useReportReady' },
  { id: 'themes', feature: 'characters, colors and themes', evidence: ['src/host/constants.js', 'src/client/characters.js'], marker: 'COLORS' },
]

// Features the product needs that upstream DS Bot does not ship. Each row is proved by the
// absence of its implementation markers in the upstream runtime, and names where the product
// implements it instead, so nobody reads the vendored tree as carrying them.
const NOT_UPSTREAM = [
  {
    id: 'remote-computer',
    feature: 'remote computer control: paired machines, desktop view and input',
    markers: ['remote_computer', 'remoteDesktop', 'remote-computer', 'machine.desktop', 'desktopSession'],
    product: ['packages/orchestration/src/remote-machines.mjs', 'packages/orchestration/src/desktop-actions.mjs', 'apps/integration-client/desktop-bridge.mjs'],
    note: "The vendored desktop tab is a product overlay over the product client's __dshDesktop bridge; it holds no remote authority of its own.",
  },
  {
    id: 'document-library',
    feature: 'a document knowledge library shared with Bots',
    markers: ['documentLibrary', 'knowledgeBase', 'knowledge_base', 'docLibrary', 'documentIndex'],
    product: ['packages/orchestration/src/bot-library.mjs', '.dsh-plugin/shared/library-tools.mjs'],
    note: 'Upstream ships document readers (Word, Excel, PowerPoint) and Bot memory, not a document knowledge library.',
  },
]

// The product's own changes that must survive every sync, with the marker the overlay puts in
// the vendored file.
const PRODUCT_ADAPTATIONS = [
  { id: 'desktop-pane', feature: 'the desktop tab delegates to the product pane', path: 'src/client/desktop-pane.js', marker: 'renderPane' },
  { id: 'desktop-tab', feature: 'the drawer gains the desktop tab', path: 'src/client/details-drawer.js', marker: "tab === 'desktop'" },
  { id: 'sidebar-addon', feature: 'the sidebar renders the product navigation', path: 'src/client/sidebar.js', marker: 'actions.sidebarAddon' },
  { id: 'slot-probe', feature: 'a wrapped TeamSidebar still counts as the team surface', path: 'src/client/index.js', marker: 'dsBotTeamSidebar' },
]

async function walk(root) {
  const result = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path))
    else if (entry.isFile()) result.push({ path, relative: relative(root, path).replaceAll('\\', '/') })
  }
  return result.sort((a, b) => (a.relative < b.relative ? -1 : 1))
}

/** Reads the named paths under `root`; a missing file reads as null. */
async function reader(root) {
  const cache = new Map()
  return async path => {
    if (!cache.has(path)) {
      const absolute = join(root, path)
      cache.set(path, existsSync(absolute) ? await readFile(absolute, 'utf8') : null)
    }
    return cache.get(path)
  }
}

async function featureRows(root, rows, origin) {
  const read = await reader(root)
  return Promise.all(rows.map(async row => {
    const evidence = row.evidence ?? [row.path]
    const found = []
    for (const path of evidence) {
      const text = await read(path)
      if (text !== null && text.includes(row.marker)) found.push(path)
    }
    return { id: row.id, feature: row.feature, origin, path: row.path, evidence, marker: row.marker, status: found.length > 0 ? 'present' : 'missing', found }
  }))
}

/** Proves a marker is nowhere in a tree, and names every file that would carry it. */
async function absenceRow(row, files, tree) {
  const hits = new Map()
  for (const file of files) {
    const text = await readFile(file.path, 'utf8').catch(() => '')
    for (const marker of row.markers) if (text.includes(marker)) hits.set(marker, [...(hits.get(marker) ?? []), file.relative])
  }
  return {
    id: row.id, feature: row.feature, origin: 'product', markers: row.markers, tree,
    hits: Object.fromEntries(hits), status: hits.size === 0 ? 'absent-upstream' : 'present',
    product: row.product, note: row.note,
  }
}

/**
 * The parity report. `status` is `failed` when an upstream feature the matrix declares is
 * missing from the vendored tree, when a product adaptation was lost, when something the
 * product owns turned up in the upstream runtime, or when the vendored bytes no longer match
 * the source that is named.
 */
export async function checkUpstreamParity({ source = null, diff = false } = {}) {
  const manifest = JSON.parse(await readFile(SOURCE_FILE, 'utf8'))
  const overlay = await readOverlay()
  const features = await featureRows(VENDOR, UPSTREAM_FEATURES, 'upstream')
  const adaptations = await featureRows(VENDOR, PRODUCT_ADAPTATIONS, 'product')
  // Absence is proved against the upstream runtime when one is named, and against the
  // vendored tree without its product overlay otherwise.
  const pinned = source ? pinSource({ source }) : null
  const tree = pinned ? await walk(pinned.runtime) : await walk(VENDOR)
  const searched = pinned ? `upstream ${pinned.commit}` : 'the vendored tree without the product overlay'
  const owned = new Set(overlay.entries.map(entry => entry.path))
  const notUpstream = []
  for (const row of NOT_UPSTREAM) {
    notUpstream.push(await absenceRow(row, pinned ? tree : tree.filter(file => !owned.has(file.relative)), searched))
  }
  const problems = []
  for (const row of features) if (row.status !== 'present') problems.push(`upstream feature missing: ${row.id} (${row.evidence.join(', ')})`)
  for (const row of adaptations) if (row.status !== 'present') problems.push(`product adaptation lost: ${row.id} (${row.path})`)
  for (const row of notUpstream) if (row.status !== 'absent-upstream') problems.push(`not upstream but present: ${row.id} in ${Object.keys(row.hits).join(', ')}`)
  let sourceReport = null
  if (pinned) {
    const verified = await syncDsBot({ check: true, source, sourceCommit: pinned.commit })
    sourceReport = { commit: verified.commit, version: verified.version, files: verified.files, overlays: verified.overlays, drifted: verified.drifted, clientBundle: verified.rebuilt.client }
    for (const row of verified.drifted) problems.push(`overlay base drifted: ${row.path} (recorded ${row.base}, source ${row.source}) — rebase it`)
  }
  const overlays = []
  for (const entry of overlay.entries) overlays.push(diff ? { ...entry, patch: (await overlayDiff(entry)).patch } : { path: entry.path, kind: entry.kind, summary: entry.summary })
  return {
    status: problems.length === 0 ? 'passed' : 'failed',
    provenance: {
      repository: manifest.repository,
      commit: manifest.commit,
      runtime: manifest.runtime,
      files: manifest.files.length,
      origins: manifest.files.reduce((counts, file) => ({ ...counts, [file.origin]: (counts[file.origin] ?? 0) + 1 }), {}),
    },
    source: sourceReport,
    searched,
    features,
    notUpstream,
    adaptations,
    overlays,
    problems,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null)
  const report = await checkUpstreamParity({ source: value('--source'), diff: process.argv.includes('--diff') })
  const out = line => process.stdout.write(`${line}\n`)
  if (process.argv.includes('--json')) out(JSON.stringify(report, null, 2))
  else {
    const row = (label, text) => out(`${label.padEnd(30)} ${text}`)
    row('vendored runtime', `${report.provenance.runtime.name} ${report.provenance.runtime.version}`)
    row('pinned upstream commit', report.provenance.commit)
    row('repository', report.provenance.repository)
    row('vendored files', `${report.provenance.files} (${Object.entries(report.provenance.origins).map(([origin, count]) => `${origin} ${count}`).join(', ')})`)
    row('absence proved against', report.searched)
    if (report.source) {
      row('source verification', `${report.source.commit} ${report.source.version}, client bundle ${report.source.clientBundle}`)
      for (const drift of report.source.drifted) row('  overlay base drifted', `${drift.path}: ${drift.base} -> ${drift.source}`)
    }
    out('\nupstream features')
    for (const item of report.features) out(`  ${item.status === 'present' ? 'yes' : 'NO '} ${item.id.padEnd(16)} ${item.feature}`)
    out('\nnot upstream (the product owns these)')
    for (const item of report.notUpstream) out(`  ${item.status === 'absent-upstream' ? 'yes' : 'NO '} ${item.id.padEnd(16)} ${item.feature}`)
    out('\nproduct adaptations preserved')
    for (const item of report.adaptations) out(`  ${item.status === 'present' ? 'yes' : 'NO '} ${item.id.padEnd(16)} ${item.path}`)
    if (report.problems.length) {
      out('\nproblems')
      for (const problem of report.problems) out(`  NO  ${problem}`)
    }
    out(`\n${report.status}`)
  }
  if (report.status !== 'passed') process.exitCode = 1
}
