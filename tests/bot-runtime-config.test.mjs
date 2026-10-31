import test from 'node:test'
import assert from 'node:assert/strict'
import { BotRuntimeConfig, normalizeBotRuntimeConfig } from '../packages/orchestration/src/bot-runtime-config.mjs'
import { Config } from '../.dsh-plugin/index.mjs'

test('Bot runtime config preserves custom paths, identity, disabled features and extensions', () => {
  const input = { home: './旧团队 home', workspace: '~/literal-workspace', mainName: '原主助理', mainRole: '原角色',
    browser: false, memory: false, memoryReview: false, github: false, diagnosticsFile: false,
    checkRatio: 0.63, memoryReviewDelayMs: 120, timeZone: 'Asia/Shanghai', timeRefreshIntervalMs: 0,
    textOnlyModels: ['fixture/exact-model'], ocrModel: 'fixture/ocr', handoffListTokens: 8192,
    handoffRecentTokens: 32768, browserHeadless: true, browserPlugin: 'existing-browser',
    playwrightUrl: 'ws://127.0.0.1:9000', browserExecutablePath: 'D:/浏览器/browser.exe',
    updateRegistry: 'https://registry.example.invalid/', extensionOption: { nested: ['preserved', 0, false] } }
  const before = structuredClone(input)
  assert.deepEqual(BotRuntimeConfig(input), input)
  assert.deepEqual(normalizeBotRuntimeConfig(input), { ...input, updateCheck: false })
  assert.deepEqual(input, before, 'validation does not rewrite the saved profile')
})

test('Bot runtime config keeps actual host APIs without invoking them', () => {
  let calls = 0
  const browserPluginApi = { complete() { calls++ } }, browserComplete = () => { calls++ }
  const value = normalizeBotRuntimeConfig({ browserPluginApi, browserComplete, future: { __jsExpr: 'throw new Error("not evaluated")' } })
  assert.equal(value.browserPluginApi, browserPluginApi)
  assert.equal(value.browserComplete, browserComplete)
  assert.deepEqual(value.future, { __jsExpr: 'throw new Error("not evaluated")' })
  assert.equal(calls, 0)
})

test('Bot runtime config forces unified updates and leaves frozen runtime defaults intact', () => {
  assert.deepEqual(normalizeBotRuntimeConfig(), { updateCheck: false })
  assert.deepEqual(normalizeBotRuntimeConfig({ updateCheck: true }), { updateCheck: false })
  assert.deepEqual(normalizeBotRuntimeConfig({ mainName: '', mainRole: '' }), { mainName: '', mainRole: '', updateCheck: false })
})

test('Bot runtime config rejects malformed known fields rather than dropping them', () => {
  for (const input of [{ home: 12 }, { memory: 'false' }, { browser: [] }, { github: 'disabled' }, { textOnlyModels: [7] }]) {
    assert.throws(() => normalizeBotRuntimeConfig(input), /expected/)
  }
  assert.throws(() => normalizeBotRuntimeConfig([]), /expected object/)
})

test('public MR Config retains old settings alongside nested runtime config', () => {
  const value = Config({ botRuntime: { home: 'D:/团队', memory: false, browser: false, futureOption: 'kept' },
    modelProfilesJson: '[{"model":"fixture/exact"}]', dailyBudgetUsd: 23, monthlyBudgetUsd: 45,
    toolInstallDir: 'D:/原工具', legacyExtension: { retained: true } })
  assert.equal(value.botProduct, true)
  assert.deepEqual(value.botRuntime, { home: 'D:/团队', memory: false, browser: false, futureOption: 'kept' })
  assert.equal(value.modelProfilesJson.get(), '[{"model":"fixture/exact"}]')
  assert.equal(value.dailyBudgetUsd.get(), 23)
  assert.equal(value.monthlyBudgetUsd.get(), 45)
  assert.equal(value.toolInstallDir.get(), 'D:/原工具')
  assert.deepEqual(value.legacyExtension, { retained: true })
})
