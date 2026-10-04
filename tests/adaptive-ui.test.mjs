import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import {
  ADAPTIVE_DEFAULTS, ADAPTIVE_NUMBER_FIELDS, adaptiveSettingValue, dynamicSourceView,
  feedbackRatingArguments, learningView, parseAdaptiveNumber, parsePublicEndpoint, publicEndpointDraft,
} from '../.dsh-plugin/client/adaptive-state.mjs'

test('adaptive settings preserve default-off public data and explicit zero adjustment', () => {
  assert.equal(ADAPTIVE_DEFAULTS.dynamicDataEnabled, false)
  assert.equal(ADAPTIVE_DEFAULTS.feedbackLearningEnabled, true)
  assert.equal(adaptiveSettingValue({}, 'feedbackHalfLifeDays'), 30)
  assert.equal(adaptiveSettingValue({}, 'feedbackPriorWeight'), 3)
  assert.equal(adaptiveSettingValue({}, 'feedbackMaxAdjustment'), 0.04)
  assert.equal(adaptiveSettingValue({}, 'dynamicDataTtlMinutes'), 1440)
  assert.equal(adaptiveSettingValue({}, 'liveBenchEndpoint'), 'https://livebench.ai')
  assert.equal(adaptiveSettingValue({}, 'pricingSnapshotEndpoint'), '')
  assert.equal(adaptiveSettingValue({ feedbackMaxAdjustment: 0 }, 'feedbackMaxAdjustment'), 0)
  assert.equal(adaptiveSettingValue({ feedbackLearningEnabled: false }, 'feedbackLearningEnabled'), false)
})

test('all adaptive numeric drafts enforce Host bounds without interpreting a blank as zero', () => {
  for (const field of ADAPTIVE_NUMBER_FIELDS) {
    assert.equal(parseAdaptiveNumber(field.key, String(field.min)), field.min)
    assert.equal(parseAdaptiveNumber(field.key, field.max), field.max)
    for (const invalid of ['', ' ', null, true, [], {}, 'NaN', Infinity, field.min - 0.01, field.max + 1]) {
      assert.throws(() => parseAdaptiveNumber(field.key, invalid), `${field.key} must reject ${String(invalid)}`)
    }
  }
  assert.throws(() => parseAdaptiveNumber('provider', '1'))
})

test('public endpoint controls reject credentials, signed queries and non-HTTPS values', () => {
  assert.equal(parsePublicEndpoint('liveBenchEndpoint', ' https://livebench.ai '), 'https://livebench.ai')
  assert.equal(parsePublicEndpoint('pricingSnapshotEndpoint', ''), '')
  assert.equal(parsePublicEndpoint('pricingSnapshotEndpoint', 'https://public.example/pricing.json'), 'https://public.example/pricing.json')
  for (const invalid of ['', 'http://public.example', 'file:///private', 'https://user:secret@example.org/',
    'https://public.example/?token=secret', 'https://public.example/#secret', 'not a URL', 'https://x.example/' + 'x'.repeat(2048)]) {
    assert.throws(() => parsePublicEndpoint('liveBenchEndpoint', invalid))
    assert.equal(publicEndpointDraft('liveBenchEndpoint', invalid), '')
  }
  assert.throws(() => parsePublicEndpoint('unknown', 'https://livebench.ai'))
})

test('feedback actions carry the viewed result timestamp and preserve withdrawal semantics', () => {
  const run = { id: 'recorded-run' }
  const item = { id: 'recorded-package', finishedAt: 12345, rating: 1 }
  assert.deepEqual(feedbackRatingArguments(run, item, 'up'), ['recorded-run', 'recorded-package', 'clear', 12345])
  assert.deepEqual(feedbackRatingArguments(run, item, 'down'), ['recorded-run', 'recorded-package', 'down', 12345])
  assert.deepEqual(feedbackRatingArguments(run, { ...item, rating: -1 }, 'down'), ['recorded-run', 'recorded-package', 'clear', 12345])
  assert.throws(() => feedbackRatingArguments(run, item, 'arbitrary'))
  assert.equal(feedbackRatingArguments(run, { id: 'old' }, 'up')[3], undefined, 'legacy timestamps are not fabricated')
})

test('learning summary does not infer satisfaction from success or model review fields', () => {
  const absent = learningView(null, {})
  assert.equal(absent.available, false)
  assert.equal(absent.enabled, true)
  assert.equal(absent.feedbackCount, 0)
  const view = learningView({ enabled: false, feedbackCount: 4, effectiveWeight: 1.125, ignoredCount: 2,
    policyVersion: 'explicit-feedback-v1', review: { score: 5 }, ok: true }, { feedbackResetAt: 9 })
  assert.deepEqual(view, { available: true, enabled: false, feedbackCount: 4, effectiveWeight: 1.125,
    ignoredCount: 2, policyVersion: 'explicit-feedback-v1', resetAt: 9 })
  assert.equal(learningView({ feedbackCount: -1, effectiveWeight: NaN }).feedbackCount, 0)
})

test('dynamic source summary displays status/version while not echoing errors or credential URLs', () => {
  assert.deepEqual(dynamicSourceView({ status: 'fresh', source: 'https://public.example/rates.json', version: 'v2',
    verifiedAt: 123, rowCount: 7, error: 'secret failure' }), { status: 'fresh', label: '快照有效',
    source: 'https://public.example/rates.json', version: 'v2', verifiedAt: 123, count: 7 })
  const error = dynamicSourceView({ status: 'error', source: 'https://user:secret@example.org/?token=secret', error: 'secret failure' })
  assert.equal(error.source, '')
  assert.ok(!JSON.stringify(error).includes('secret'))
  assert.equal(dynamicSourceView({ status: 'unexpected' }).status, 'missing')
  assert.equal(dynamicSourceView({ status: 'disabled', modelCount: 66 }).label, '未启用')
})

let componentPromise
async function loadComponents() {
  componentPromise ??= build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/router-insights.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' })
    .then(result => {
      const module = { exports: {} }
      const localRequire = createRequire(import.meta.url)
      new Function('require', 'module', 'exports', result.outputFiles[0].text)(localRequire, module, module.exports)
      return module.exports
    })
  return componentPromise
}

const settingsScope = value => ({ getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value }),
  subscribe: () => () => {}, mutate: async () => true })

test('cost card SSR exposes safe local-learning defaults, limits and public-source controls', async () => {
  const { CostControlCard } = await loadComponents()
  const html = renderToStaticMarkup(React.createElement(CostControlCard, { ledger: null, settingsScope: settingsScope({}) }))
  for (const expected of ['持续反馈与本地偏好', '本地 DSH_HOME 工作室共享', '最近 200 次运行', '不抬高质量硬门槛',
    '模型复核也不作为人工评分', '不会为了学习发起付费探索', '从现在重新学习', '动态公共数据', '默认关闭',
    'feedbackHalfLifeDays', 'feedbackPriorWeight', 'feedbackMaxAdjustment', 'dynamicDataTtlMinutes', 'liveBenchEndpoint', 'pricingSnapshotEndpoint']) {
    assert.ok(html.includes(expected), `missing ${expected}`)
  }
  assert.match(html, /placeholder="30"/)
  assert.match(html, /placeholder="3"/)
  assert.match(html, /placeholder="0.04"/)
  assert.match(html, /placeholder="1440"/)
  assert.match(html, /max="0.1"/)
})

test('cost card SSR renders Host summaries, preserves history reset wording and hides upstream secrets', async () => {
  const { CostControlCard } = await loadComponents()
  const ledger = { learning: { enabled: true, feedbackCount: 5, ignoredCount: 1, effectiveWeight: 2.5, policyVersion: 'explicit-feedback-v1' },
    dynamicData: { liveBench: { status: 'fresh', verifiedAt: 123, version: '2026-06-25', modelCount: 66, source: 'https://livebench.ai' },
      pricing: { status: 'error', rowCount: 1, source: 'https://user:NEVER_DISPLAY@example.org/', error: 'NEVER_DISPLAY' } } }
  const html = renderToStaticMarkup(React.createElement(CostControlCard, { ledger,
    settingsScope: settingsScope({ feedbackResetAt: 123, pricingSnapshotEndpoint: 'https://user:NEVER_DISPLAY@example.org/' }) }))
  assert.match(html, /有效反馈 5/)
  assert.match(html, /有效权重 2.50/)
  assert.match(html, /忽略 1/)
  assert.match(html, /2026-06-25/)
  assert.match(html, /66 条记录/)
  assert.match(html, /学习起点/)
  assert.match(html, /更新失败/)
  assert.ok(!html.includes('NEVER_DISPLAY'))
})
