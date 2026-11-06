import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, copyFile, writeFile, readFile, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { resolverAnchor } from './integration-upstream-tests.mjs'
import { combinedOverlay, isolatedHostEnvironment } from './integration-combined-host.mjs'
import { buildRouterPackage } from './build-router-package.mjs'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const at = process.argv.indexOf('--host-root')
const hostRoot = resolve(at >= 0 ? process.argv[at + 1] : 'tests/fixtures/integration-host')
const requireHost = createRequire(join(hostRoot, 'package.json'))
const manifestPath = requireHost.resolve('@deepseek-ai/dsh/package.json')
const sdk = JSON.parse(await readFile(manifestPath, 'utf8'))
const { anchor } = await resolverAnchor(hostRoot, { expectedVersion: sdk.version })
const parent = join(ROOT, 'tmp/integration/router-only-host'); await mkdir(parent, { recursive: true })
const run = await mkdtemp(join(parent, 'run-'))
const fixtureHome = join(run, 'home'), profile = join(fixtureHome, 'profiles/integration'), workspace = join(run, 'workspace')
await mkdir(join(profile, 'node_modules/@ljwei-stak'), { recursive: true }); await mkdir(workspace)
const pkg = await buildRouterPackage({ output: join(run, 'package') })
await symlink(pkg.output, join(profile, 'node_modules/@ljwei-stak/dsh-model-router'), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'router-only-fixture', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@ljwei-stak/dsh-model-router'] } } }))
const modelFixture = join(anchor, `router-offline-${Date.now()}.mjs`)
await copyFile(join(ROOT, 'tests/fixtures/integration-combined/mock-plugin.mjs'), modelFixture)
const probeFile = join(anchor, `router-probe-${Date.now()}.mjs`)
await writeFile(probeFile, `import { discoverConfiguredRoutes, createRoutePlan } from ${JSON.stringify(pathToFileURL(join(pkg.output, '.dsh-plugin/router-only.mjs')).href)};
export const inject=['connection','tools','llm'];
export function apply(ctx){ctx.effect(()=>ctx.connection.fetch.register({path:'/api/router-edition-probe',methods:['POST'],requestBody:'buffered',fetch:async()=>{
 const routes=await discoverConfiguredRoutes(ctx);
 const plan=await createRoutePlan(ctx,'Summarize the fixture project in a few sentences.',{resourceLearningEnabled:false,dynamicDataEnabled:false});
 return Response.json({routes,selected:plan.selected,tools:ctx.tools.schemas().map(t=>t.name),
 entries:[...ctx.root.get('loader').entries()].map(e=>({id:e.options.id,name:e.options.name,state:e.fiber?.state??null})),
 botServices:['botIntegrationPolicy','botLibrary','routineStore','botRuntimeAdapter','botRouting'].filter(name=>ctx.get(name)!==undefined)});
}}))}`)
const overlay = combinedOverlay(modelFixture).filter(item => item.id !== 'bot')
overlay.push({ insert: [{ id: 'router-edition-probe', name: pathToFileURL(probeFile).href }] })
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify(overlay, null, 2))
const listener = createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done))
const port = listener.address().port; await new Promise(done => listener.close(done))
const base = `http://127.0.0.1:${port}`
const chunks = []; let child, closed = false, timer, summary
try {
  child = spawn(process.execPath, ['--import', pathToFileURL(join(ROOT, 'modules/bot-runtime/vendor/ds-bot/test/harness-resolve.mjs')).href,
    '--import', pathToFileURL(join(ROOT, 'tests/fixtures/integration-combined/offline-preload.mjs')).href,
    resolve(dirname(manifestPath), sdk.bin.dsh), '--profile', 'integration', '--no-open', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: workspace, env: isolatedHostEnvironment(fixtureHome, anchor), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  child.once('close', () => { closed = true })
  child.stdout.on('data', b => chunks.push(b)); child.stderr.on('data', b => chunks.push(b))
  timer = setTimeout(() => killProcessTree(child), 90000)
  const output = () => Buffer.concat(chunks).toString('utf8')
  let url
  const deadline = Date.now() + 45000
  while (Date.now() < deadline && !closed) {
    url = output().match(new RegExp(`${base.replaceAll('.', '\\.')}\\/\\?token=[^\\s]+`))?.[0]
    if (url) break
    await sleep(150)
  }
  assert.ok(url, 'isolated actual SDK Host starts')
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  let probe
  while (Date.now() < deadline && !closed) {
    const result = await fetch(`${base}/api/router-edition-probe`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })
    if (result.ok) { probe = await result.json(); break }
    await sleep(150)
  }
  assert.ok(probe, 'router probe endpoint becomes available')
  assert.equal(probe.entries.find(entry => entry.name === '@ljwei-stak/dsh-model-router')?.state, 2)
  assert.ok(probe.tools.includes('model_router_plan'))
  assert.ok(!probe.tools.some(name => name.startsWith('bot_')))
  assert.deepEqual(probe.botServices, [])
  assert.ok(!probe.entries.some(entry => /ds-bot|dsh-model-route-bot/.test(entry.name)))
  assert.equal(probe.selected.provider, 'integration-gpt-fixture')
  summary = { status: 'passed', sdkVersion: sdk.version, actualModelCalls: 0, package: pkg.name,
    checks: ['Actual SDK loads router-only package with its own patch', 'Routing tools and local planning use the official model catalog',
      'No Bot plugin entry, tools or runtime services are mounted'], hostFiles: pkg.hostFiles }
} catch (error) { summary = { status: 'failed', error: error.stack }; process.exitCode = 1 }
finally {
  clearTimeout(timer)
  if (child && !closed) killProcessTree(child)
  if (child && !closed) await Promise.race([new Promise(done => child.once('close', done)), sleep(10000)])
  await writeFile(join(run, 'host.log'), Buffer.concat(chunks).toString('utf8').replace(/(\?token=)[^\s]+/g, '$1[redacted]'))
}
await writeFile(join(run, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, runDirectory: run }, null, 2))
