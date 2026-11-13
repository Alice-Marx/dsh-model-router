import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { openCliProviders } from '../packages/orchestration/src/cli-providers.mjs'
import { CLI_CHAT_DRIVERS } from '../packages/bot-engines/src/cli-driver-specs.mjs'
import { normalizeCliCredential, provisionCliCredential, importCliAccount, cliCredentialTemplate } from '../packages/bot-engines/src/cli-credentials.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3'), owner = { kind: 'owner' }
const secret = JSON.stringify({ schemaVersion: 1, billing: 'subscription', files: { 'auth.json': { tokens: { access_token: 'fixture-private-access', refresh_token: 'fixture-private-refresh' } } }, env: {} })
const input = patch => ({ expectedRevision: 0, driver: 'codex', name: 'Native connection', model: 'gpt-fixture', enabled: true, entry: { executable: process.execPath, version: process.versions.node }, credentialJson: secret, ...patch })
test('Step Plan credentials are isolated, reject platform billing and import only the selected Step account',async()=>{
 const root=resolve('tmp/integration/cli-providers');await mkdir(root,{recursive:true});const home=await mkdtemp(join(root,'step-'))
 const content={step:{type:'oauth',access:'fixture-step-plan',refresh:'fixture-refresh',expires:123,profile:'step_plan'}}
 const raw=JSON.stringify({schemaVersion:1,billing:'subscription',files:{'.stepcode/auth.json':content},env:{}})
 assert.equal(JSON.parse(normalizeCliCredential('stepAgent',raw)).files['.stepcode/auth.json'].step.access,'fixture-step-plan')
 for(const profile of ['platform_cn','platform_oversea',undefined]){
  const changed=JSON.parse(raw);changed.files['.stepcode/auth.json'].step.profile=profile
  assert.throws(()=>normalizeCliCredential('stepAgent',JSON.stringify(changed)),{code:'CLI_CHAT_CREDENTIAL_INVALID'})
 }
 const provisioned=await provisionCliCredential(home,{driver:'stepAgent',credentialRef:'fixture'},async()=>raw)
 assert.equal(provisioned.env.STEP_CODING_AGENT_DIR,join(home,'.stepcode/agent'));assert.equal(provisioned.env.STEPCODE_AUTH_PATH,join(home,'.stepcode/auth.json'))
 assert.deepEqual(JSON.parse(await readFile(provisioned.env.STEPCODE_AUTH_PATH,'utf8')),content)
 const importedHome=await mkdtemp(join(root,'step-import-'));await mkdir(join(importedHome,'.stepcode'))
 await writeFile(join(importedHome,'.stepcode/auth.json'),JSON.stringify({...content,other:{type:'oauth',access:'must-not-copy'}}))
 const imported=JSON.parse(await importCliAccount('stepAgent',{userHome:importedHome}));assert.deepEqual(imported.files['.stepcode/auth.json'],content)
 await writeFile(join(importedHome,'.stepcode/auth.json'),JSON.stringify({apiKey:'legacy-plan-bearer',profile:'step_plan_oversea'}))
 assert.match(await importCliAccount('stepAgent',{userHome:importedHome}),/legacy-plan-bearer/)
 await writeFile(join(importedHome,'.stepcode/auth.json'),JSON.stringify({apiKey:'platform-key',profile:'platform_cn'}))
 await assert.rejects(importCliAccount('stepAgent',{userHome:importedHome}),{code:'CLI_CHAT_CREDENTIAL_INVALID'})
})
async function setup(run, overrides = {}) {
  const base = resolve('tmp/integration/cli-providers'); await mkdir(base, { recursive: true }); const home = await mkdtemp(join(base, 'case-')), file = join(home, 'sqlite.db'), values = new Map()
  const credentials = { async set(key, value) { values.set(key, value) }, async resolve(key) { return values.has(key) ? { value: values.get(key) } : undefined }, async describe(key) { return { configured: values.has(key) } }, async unset(key) { values.delete(key) } }
  const options = { Database, file, credentials, drivers: CLI_CHAT_DRIVERS, normalizeCredential: normalizeCliCredential,
    inspectEntry: async entry => ({ ...entry, sha256: 'a'.repeat(64) }), importAccount: async () => secret, ...overrides }
  const service = openCliProviders(options)
  try { await run({ service, options, values, file, home }) } finally { service.close() }
}
test('CLI connection owner save keeps credentials write-only, separate accounts and exact private references', async () => {
  await setup(async ({ service, values, file }) => {
    await assert.rejects(service.save(input(), { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
    const first = await service.save(input(), owner), second = await service.save(input({ name: 'Other account' }), owner)
    assert.notEqual(first.provider, second.provider); assert.equal(values.size, 2)
    assert.equal(first.state, 'configured'); assert.equal(first.credentialConfigured, true)
    const view = await service.list(owner); assert.doesNotMatch(JSON.stringify(view), /fixture-private-access|fixture-private-refresh|credentialRef|DSH_BOT_CLI_/)
    const db = new Database(file, { readonly: true }); try { assert.ok(db.prepare('SELECT payload FROM bot_cli_providers').all().every(row => !row.payload.includes('fixture-private'))) } finally { db.close() }
    assert.equal(service.profiles()[0].hostTools, false)
    service.markResult(first.provider, { kind: 'verified' }, first.revision); assert.equal((await service.list(owner)).profiles[0].state, 'ready')
    const saved = await service.save(input({ id: first.id, expectedRevision: first.revision, credentialJson: undefined, name: 'Renamed' }), owner)
    service.markResult(first.provider, { kind: 'verified' }, first.revision); assert.equal(saved.state, 'configured'); assert.equal((await service.list(owner)).profiles[0].state, 'configured')
  })
})
test('explicit local import is the only import path; invalid version or conflicting credential forms do not mutate state', async () => {
  let imports = 0, broken = false
  await setup(async ({ service }) => {
    await service.save(input(), owner); assert.equal(imports, 0)
    await service.save(input({ credentialJson: undefined, importLocalAccount: true }), owner); assert.equal(imports, 1)
    await assert.rejects(service.save(input({ importLocalAccount: true }), owner), { code: 'CLI_CHAT_INVALID' })
    broken = true
    await assert.rejects(service.save(input(), owner), /version/)
    assert.equal((await service.list(owner)).profiles.length, 2)
  }, { importAccount: async () => { imports++; return secret }, inspectEntry: async entry => { if (broken) throw new Error('version mismatch'); return { ...entry, sha256: 'a'.repeat(64) } } })
})
test('two SQLite owners racing on one revision keep the winning credential and reject a stale generation', async () => {
  await setup(async ({ service, options, values }) => {
    const initial = await service.save(input(), owner), other = openCliProviders(options)
    try {
      const results = await Promise.allSettled([service.save(input({ id: initial.id, expectedRevision: 1, name: 'One' }), owner), other.save(input({ id: initial.id, expectedRevision: 1, name: 'Two' }), owner)])
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CLI_CHAT_CONFLICT'); assert.equal(values.size, 1)
      const current = (await service.list(owner)).profiles[0]
      await service.save(input({ id: current.id, expectedRevision: current.revision, credentialJson: undefined, clearCredential: true }), owner)
      assert.equal(values.size, 0); assert.deepEqual(service.routes(), [])
    } finally { other.close() }
  })
})
test('in-use deletion is refused and a damaged record cannot resolve an unrelated Host credential', async () => {
  await setup(async ({ service, file }) => {
    const saved = await service.save(input(), owner)
    await assert.rejects(service.remove({ id: saved.id, expectedRevision: saved.revision }, owner), { code: 'CLI_CHAT_IN_USE' })
    const db = new Database(file); try { const row = db.prepare('SELECT payload FROM bot_cli_providers WHERE id=?').get(saved.id), data = JSON.parse(row.payload); data.credentialRef = 'cli-secret/UNRELATED_HOST_KEY'; db.prepare('UPDATE bot_cli_providers SET payload=? WHERE id=?').run(JSON.stringify(data), saved.id) } finally { db.close() }
    await assert.rejects(service.list(owner), { code: 'CLI_CHAT_STORE_INVALID' })
  }, { usedBy: () => [{ id: 'bot', name: 'Bot' }] })
})
test('credential envelopes refuse arbitrary files, launch environment and metered API credentials', async () => {
  const wrap = (files, env = {}) => JSON.stringify({ schemaVersion: 1, billing: 'subscription', files, env })
  for (const value of [wrap({ '../auth.json': {} }), wrap({ 'auth.json': { OPENAI_API_KEY: 'must-not-be-used' } }), wrap({}, { NODE_OPTIONS: '--require unsafe' }), wrap({ 'auth.json': { tokens: { access_token: 'a', refresh_token: 'b' }, hooks: { run: 'unsafe' } } })]) {
    assert.throws(() => normalizeCliCredential('codex', value), { code: 'CLI_CHAT_CREDENTIAL_INVALID' })
  }
  await setup(async ({ home }) => {
    const target = join(home, 'private'); await mkdir(target)
    await provisionCliCredential(target, { driver: 'codex', credentialRef: 'fixture' }, async () => secret)
    assert.equal(JSON.parse(await readFile(join(target, 'auth.json'), 'utf8')).tokens.access_token, 'fixture-private-access')
    const original = join(home, 'explicit-import'); await mkdir(join(original, '.codex'), { recursive: true }); await writeFile(join(original, '.codex/auth.json'), JSON.stringify({ tokens: { access_token: 'fixture-import', refresh_token: 'fixture-refresh' } }))
    assert.match(await importCliAccount('codex', { userHome: original }), /fixture-import/)
  })
})
test('Muse and Cline accounts provision only into their private native configuration paths', async () => {
  await setup(async ({ home }) => {
    for (const driver of ['museCode', 'clineAgent']) {
      const target = join(home, driver); await mkdir(target)
      const template = cliCredentialTemplate(driver)
      if (driver === 'clineAgent') template.files['.cline/data/settings/providers.json'].providers.cline.settings.model = 'fixture-model'
      const encoded = normalizeCliCredential(driver, JSON.stringify(template))
      const { env } = await provisionCliCredential(target, { driver, model: 'fixture-model' }, async () => encoded)
      if (driver === 'museCode') {
        assert.ok(JSON.parse(await readFile(join(target, 'config/muse/auth.json'), 'utf8')).access_token)
        assert.equal(env.MUSE_NO_AUTO_UPDATE, '1')
      } else {
        assert.equal(env.CLINE_PROVIDER, 'cline'); assert.equal(env.CLINE_MODEL, 'fixture-model')
        assert.equal(env.CLINE_DATA_DIR, join(target, '.cline/data'))
        const mismatch = join(home, 'mismatch'); await mkdir(mismatch)
        await assert.rejects(provisionCliCredential(mismatch, { driver, model: 'other' }, async () => encoded), { code: 'CLI_CHAT_CREDENTIAL_INVALID' })
        template.files['.cline/data/settings/providers.json'].providers.cline.settings.auth.apiKey = 'forbidden'
        assert.throws(() => normalizeCliCredential(driver, JSON.stringify(template)), { code: 'CLI_CHAT_CREDENTIAL_INVALID' })
      }
    }
  })
})
