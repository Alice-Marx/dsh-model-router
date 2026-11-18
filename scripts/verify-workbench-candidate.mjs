import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) throw new Error('Usage: node scripts/verify-workbench-candidate.mjs <verification base> [--baseline] [--upgrade] [--quota-only] [--rehearsal] [--drop-ack]')
const baseline = process.argv.includes('--baseline')
const upgrade = process.argv.includes('--upgrade')
const quotaOnly = process.argv.includes('--quota-only')
const rehearsal = process.argv.includes('--rehearsal')
const dropAck = process.argv.includes('--drop-ack')
const { run, home, source, packageName, packageVersion, harnessVersion } = JSON.parse(await readFile(join(resolve(base), 'current.json'), 'utf8'))
const bot = packageName === '@ljwei-stak/dsh-model-route-bot'
const connection = JSON.parse(await readFile(join(run, 'connection.private.json'), 'utf8'))
const bytes = await readFile(join(source, '.dsh-plugin/client.js'))
if (quotaOnly && (!bot || baseline)) throw new Error('Quota verification needs the full candidate package')
if (dropAck && (bot || baseline || quotaOnly || rehearsal)) throw new Error('Dropped-reply verification needs an executable router candidate')
const callsFile = join(home, 'offline-model-calls.jsonl')
const countCalls = async () => {
  try { return (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).length }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error }
}
let exactClient = false
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
const label = name => page.getByRole('button', { name, exact: true }).first()
const task = baseline ? '核对旧版的离线样本' : dropAck ? '核对候选包的断线恢复样本' : '核对候选包的离线样本'
const checks = []
let releaseReply = () => {}
let submitted = 0
let droppedReplies = 0
if (dropAck) {
  const refresh = new Promise(resolve => { releaseReply = resolve })
  await page.route(url => url.pathname === '/api/modelRouterOfficialTools/startRun', async route => {
    submitted++
    try {
      const response = await route.fetch({ maxRetries: 0 })
      if (response.ok()) droppedReplies++
      await response.dispose()
      // Let the actual Host accept the submission while the browser receives no response.
      await refresh
    } finally {
      await route.abort('failed').catch(() => {})
    }
  })
}
page.on('response', async response => {
  if (response.status() !== 200 || !/javascript/.test(response.headers()['content-type'] ?? '')) return
  try { if ((await response.body()).includes(bytes)) exactClient = true } catch {}
})
async function poll(check, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await pause(150)
  }
  throw new Error('Verification condition was not observed')
}
async function dismissWelcome() {
  const beta = page.getByText('预览版说明', { exact: true })
  await beta.waitFor({ state: 'visible', timeout: 4500 }).catch(() => {})
  if (await beta.isVisible()) {
    await label('继续').click()
    await beta.waitFor({ state: 'hidden' })
  }
  const welcome = page.getByText('开始使用', { exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {})
  if (await welcome.isVisible()) {
    await page.keyboard.press('Escape')
    await welcome.waitFor({ state: 'hidden' })
  }
}
async function productAction(action, payload) {
  return page.evaluate(async ({ action, payload }) => {
    const response = await fetch('api/bot-product', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    })
    const result = await response.json()
    if (!result.ok) throw new Error(`${action}: ${result.error?.code ?? 'Verification action failed'}`)
    return result.value
  }, { action, payload })
}

async function setSubscriptionLimit(botId, dailyCalls) {
  let view = await productAction('binding.inspect', { botId })
  const provider = 'verification-offline', model = 'fixed-answer'
  const account = view.accounts.items.find(item => item.provider === provider)
  assert.ok(account, 'the isolated offline model has a local funding account')
  if (!account.enabled) {
    await productAction('funding.account.save', { scopeId: account.id, expectedRevision: account.revision, enabled: true, dailyLimitUsd: 0, monthlyLimitUsd: 0 })
    view = await productAction('binding.inspect', { botId })
  }
  const machine = view.record.catalog.machines.find(item => item.location === 'local')
  const rootId = machine.roots[0].rootId
  const routeFunding = { mode: 'subscription', scopeId: account.id, pricing: null, request: null }
  const subscription = { dailyCalls, monthlyCalls: 20 }
  await productAction('binding.save', { botId, expectedRevision: view.record.revision, settings: {
    ...view.record.settings, enabled: true, model: { provider, model }, capabilities: ['model-inference'],
    machineGrants: [{ machineId: machine.machineId, rootId, mode: 'read-only', capabilities: [] }],
    workspaceRef: { kind: 'local', machineId: machine.machineId, rootId },
    funding: { ...routeFunding, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription },
    mainRoutes: { schemaVersion: 1, limits: { api: null, subscription },
      routes: [{ provider, model, enabled: true, funding: routeFunding }] },
  } })
}

async function workbench() {
  if (await page.locator('#mr-tab-plan').isVisible()) return
  if (bot) {
    await label('远程电脑').click()
    if (!baseline) {
      await label('AI 连接').click()
      await label('查看订阅额度').click()
    } else {
      await label('搜索工作空间').click()
      await page.getByRole('dialog').getByRole('combobox').fill('费用与用量')
      await page.getByRole('dialog').getByRole('option', { name: /费用与用量/ }).first().click()
    }
    await page.getByRole('button', { name: /打开(高级费用|已有 MR)/ }).click()
  } else {
    await label('模型路由').click()
  }
}

try {
  const before = await countCalls()
  await page.goto(connection.ownerUrl)
  await (bot ? page.locator('.bp-workspace-shortcuts').first() : label('模型路由')).waitFor({ state: 'attached' })
  await dismissWelcome()
  if (bot && upgrade) {
    const { mainBotId } = await productAction('snapshot')
    const record = await productAction('library.read', { botId: mainBotId, relativePath: 'workbench-upgrade-fixture.txt' })
    assert.equal(record.content, 'Verified baseline library record')
    checks.push('the existing Bot library survives the upgrade')
  }
  if (bot && !baseline) {
    const { mainBotId } = await productAction('snapshot')
    await setSubscriptionLimit(mainBotId, 7)
    await label('远程电脑').click()
    await label('AI 连接').click()
    await label('查看订阅额度').click()
    const quota = page.getByRole('region', { name: '订阅额度' })
    await quota.getByText('剩余 7 次', { exact: true }).waitFor()
    await quota.getByText('剩余 20 次', { exact: true }).waitFor()
    await setSubscriptionLimit(mainBotId, 5)
    await label('刷新额度').click()
    await quota.getByText('剩余 5 次', { exact: true }).waitFor()
    assert.equal(await countCalls(), before, 'viewing quota starts no model call')
    checks.push('DS Bot displays its own shared daily and monthly limit and refreshes saved settings')
    await page.screenshot({ path: join(run, 'subscription-quota.png'), animations: 'disabled' })
    if (!quotaOnly) await page.getByRole('button', { name: /打开(高级费用|已有 MR)/ }).click()
  } else if (!quotaOnly) {
    await workbench()
  }
  if (!quotaOnly) {
    await page.locator('#mr-tab-plan').click()
    await page.locator('#mr-task').fill(task)
    await label('下一步：预览执行').click()
    await page.locator('#mr-launch-workspace').fill(run)
    if (rehearsal) {
      const settings = page.locator('.mr-execution-section details').first()
      if (!await settings.evaluate(element => element.open)) await settings.locator('summary').click()
      await settings.getByRole('checkbox').first().check()
    }
    if (baseline) await label('预览执行计划').click()
    else await label('下一步：预览执行').click()
    const confirmation = page.getByRole('button', { name: rehearsal ? /^(确认)?演练（不执行）$/ : /^(全部确认并执行|确认执行)$/ })
    await confirmation.waitFor({ timeout: 18000 }).catch(async error => {
      const detail = (await page.locator('.mr-execution-section [role="alert"]').allTextContents()).join(' ')
      throw detail ? new Error(detail) : error
    })
    assert.equal(await countCalls(), before, 'preview must not start a model call')
    await confirmation.click()
    if (rehearsal) {
      await page.getByText(/演练完成：没有执行任何步骤/).first().waitFor()
      assert.equal(await countCalls(), before, 'rehearsal must not start a model call')
      checks.push('workbench preview and rehearsal without a model call')
    } else {
      await poll(async () => (await countCalls()) > before)
      const recorded = page.getByText(/结果已记录（运行/).first()
      if (dropAck) {
        await poll(() => droppedReplies > 0)
        assert.equal(await recorded.isVisible(), false, 'the original page did not receive the receipt')
      }
      if (!baseline) {
        await page.reload()
        releaseReply()
        await dismissWelcome()
        await workbench()
      }
      await recorded.waitFor({ timeout: 20000 })
      assert.equal(await countCalls(), before + 1, 'refresh must not start another model call')
      await page.locator('#mr-tab-history').click()
      const history = await page.locator('#mr-panel-history').innerText()
      assert.ok(history.includes(task), 'the execution record is available')
      if (upgrade) assert.ok(history.includes('核对旧版的离线样本'), 'the previous package run survives the upgrade')
      checks.push('preview, execution, one offline model call, and the execution record')
      if (dropAck) {
        assert.equal(submitted, 1, 'recovery must not submit another start request')
        assert.equal(droppedReplies, 1)
        checks.push('recovered the same workbench submission without the original Host reply')
      }
    }
  }
  await poll(() => exactClient, 3000)
  const evidence = { packageName, packageVersion, harnessVersion, baseline, upgrade, quotaOnly, rehearsal, dropAck, exactClient, paidModelCalls: 0, checks }
  await writeFile(join(run, baseline ? 'baseline-check.json' : 'candidate-check.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
} catch (error) {
  const detail = (await page.locator('.mr-execution-section [role="status"],.mr-execution-section [role="alert"]').allTextContents().catch(() => [])).join(' ')
  console.error(`${error?.message ?? error}${detail ? `\n${detail}` : ''}`.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]'))
  process.exitCode = 1
} finally {
  releaseReply()
  await browser.close()
}
