/**
 * Official DeepSeek Harness desktop client surface for @ljwei-stak/dsh-model-router.
 *
 * Adds a visible Desktop panel and a compact settings form within the
 * installed bundle's detail page. The official app still owns the conversation,
 * model selection, credentials and Agent Teams lifecycle.
 */

import React from 'react'
import { parseModelProfilesJson } from '../shared/model-profiles.mjs'
import { parseQuotaPatterns } from '../shared/subscription-billing.mjs'
import { toolBoundary } from '../shared/security-boundaries.mjs'
import { RouterMainPage, RouterPanelIcon } from './router-main.jsx'
import {
  OFFICIAL_TOOLS_CLIENT_REMOTE,
  OFFICIAL_TOOLS_REMOTE_NAMESPACE,
} from '../shared/official-tools-remote.mjs'
import {
  Button,
  SettingsForm,
  SettingsFormModel,
  SettingsValueField,
  Tag,
  settingsNumberField,
  settingsTextField,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** The Host plugin name is also the live configuration-form namespace. */
// Profile entry id and panel id predate the 0.13.0 package rename; they stay
// unchanged so existing settings and layout state keep applying.
export const ROUTER_NAMESPACE = 'model-router-galgame'
export const ROUTER_PACKAGE = '@ljwei-stak/dsh-model-router'
export const ROUTER_PANEL = 'model-router-galgame'

/** Required Cordis services supplied by the official desktop client. */
export const inject = ['remote']

const UI_INJECT = [
  'slots', 'configForms', 'remote', 'remote.session',
  `remote.${OFFICIAL_TOOLS_REMOTE_NAMESPACE}`, 'layout',
]

const FORM_LABELS = Object.freeze({
  unavailable: '该插件当前未加载，暂时无法配置。',
  readOnly: '当前配置为只读。',
  saveFailed: '设置没有被保存，请检查输入后重试。',
  save: '保存设置',
  saving: '保存中…',
})

const FIELD_COPY = Object.freeze({
  overridden: '已覆盖',
  reset: '恢复默认',
  invalidNumber: '请输入允许范围内的数字，或留空恢复默认。',
})

/**
 * The Host schema owns the real validation.  This client-side boundary keeps
 * malformed drafts from reaching it and gives the user a useful inline state.
 */
function boundedNumberField(field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const numeric = settingsNumberField(field)
  return {
    ...numeric,
    parse: (text) => {
      const write = numeric.parse(text)
      if (write?.kind !== 'set') return write
      const value = write.value
      if (typeof value !== 'number' || value < minimum || value > maximum) return undefined
      if (integer && (!Number.isSafeInteger(value) || Object.is(value, -0))) return undefined
      return write
    },
  }
}

function modelProfilesField() {
  const field = settingsTextField('modelProfilesJson')
  return {
    ...field,
    parse: text => {
      try { parseModelProfilesJson(text); return field.parse(text) }
      catch { return undefined }
    },
  }
}

function quotaPatternsField() {
  const field = settingsTextField('quotaPatternsJson')
  return {
    ...field,
    parse: text => {
      const raw = String(text ?? '').trim() || '{}'
      try {
        const value = JSON.parse(raw)
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
      } catch { return undefined }
      return parseQuotaPatterns(raw).errors.length ? undefined : field.parse(text)
    },
  }
}

/**
 * Bridges the Host config form onto a slot-friendly snapshot store.
 *
 * The config must expose these volatile schema fields: budgetUsd and
 * maxConsultOutputChars. Their defaults remain Host-owned.
 */
export class RouterSettingsCardController {
  constructor(scope) {
    this.form = new SettingsFormModel(scope, [
      boundedNumberField('budgetUsd', { minimum: 0 }),
      boundedNumberField('maxConsultOutputChars', { minimum: 500, maximum: 50_000, integer: true }),
      boundedNumberField('dailyBudgetUsd', { minimum: 0, maximum: 1_000_000 }),
      boundedNumberField('monthlyBudgetUsd', { minimum: 0, maximum: 1_000_000 }),
      boundedNumberField('reviewSampleRate', { minimum: 0, maximum: 1 }),
      boundedNumberField('subscriptionCooldownMinutes', { minimum: 1, maximum: 10_080, integer: true }),
      modelProfilesField(),
      quotaPatternsField(),
    ])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      budgetUsd: this.form.field('budgetUsd'),
      maxConsultOutputChars: this.form.field('maxConsultOutputChars'),
      dailyBudgetUsd: this.form.field('dailyBudgetUsd'),
      monthlyBudgetUsd: this.form.field('monthlyBudgetUsd'),
      reviewSampleRate: this.form.field('reviewSampleRate'),
      subscriptionCooldownMinutes: this.form.field('subscriptionCooldownMinutes'),
      modelProfilesJson: this.form.field('modelProfilesJson'),
      quotaPatternsJson: this.form.field('quotaPatternsJson'),
    }))
  }

  /** Supply the snapshot hook and staged form actions to the Plugins slot. */
  inject() {
    return { hooks: { modelRouterSettings: this.store }, ...this.form.actions() }
  }

  /** Release the live Host-form subscription when the client plugin unloads. */
  dispose() {
    this.form.dispose()
  }
}

/**
 * Bundle-detail card renderer. `useModelRouterSettings` is supplied by the
 * slot system from the `modelRouterSettings` hook in the controller face.
 */
export function RouterSettingsCard(props) {
  const state = props.useModelRouterSettings(snapshot => snapshot)
  if (props.view === 'summary') {
    return '为官方已配置的模型生成路由计划，并提供跨模型咨询工具。'
  }

  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={FORM_LABELS} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsValueField
        id="model-router-budget-usd"
        label="单次计划预算上限（USD）"
        hint="0 表示不设预算上限。只有填写下方实际使用的单价后，才能估算费用；预算只影响路由建议。"
        help={{
          label: '预算说明',
          content: '预算只影响路由建议，不会限制服务商扣费，也不会读取或保存 API Key。',
        }}
        disabled={disabled}
        {...state.budgetUsd}
        overriddenLabel={FIELD_COPY.overridden}
        resetLabel={FIELD_COPY.reset}
        invalidLabel={FIELD_COPY.invalidNumber}
        onEdit={(text) => { props.edit('budgetUsd', text) }}
        onReset={() => { props.resetField('budgetUsd') }}
      />

      <SettingsValueField
        id="model-router-consult-output"
        label="跨模型咨询最大输出字符数"
        hint="限制 model_router_consult 返回的字符数，防止单次咨询占用过多上下文。"
        numeric
        disabled={disabled}
        {...state.maxConsultOutputChars}
        overriddenLabel={FIELD_COPY.overridden}
        resetLabel={FIELD_COPY.reset}
        invalidLabel={FIELD_COPY.invalidNumber}
        onEdit={(text) => { props.edit('maxConsultOutputChars', text) }}
        onReset={() => { props.resetField('maxConsultOutputChars') }}
      />

      {[
        ['dailyBudgetUsd', 'model-router-daily-budget', '每日执行预算（USD）', '0 表示不限。按本机执行记录的实际费用累计，超出后按工作台设置自动降级或暂停询问。'],
        ['monthlyBudgetUsd', 'model-router-monthly-budget', '每月执行预算（USD）', '0 表示不限。按本地时区的自然月累计。'],
        ['reviewSampleRate', 'model-router-review-rate', '强模型抽检比例（0–1）', '质量回路设为“抽检”时，按此比例让更强的模型复核便宜模型的结果。'],
        ['subscriptionCooldownMinutes', 'model-router-subscription-cooldown', '订阅额度冷却时间（分钟）', '订阅额度用尽或限流、但厂商没有给出恢复时间时，暂停使用该订阅的时长；期间同一路线直接使用 API Key。'],
      ].map(([key, id, label, hint]) => (
        <SettingsValueField
          key={key}
          id={id}
          label={label}
          hint={hint}
          disabled={disabled}
          {...state[key]}
          overriddenLabel={FIELD_COPY.overridden}
          resetLabel={FIELD_COPY.reset}
          invalidLabel={FIELD_COPY.invalidNumber}
          onEdit={(text) => { props.edit(key, text) }}
          onReset={() => { props.resetField(key) }}
        />
      ))}

      <div style={styles.profileEditor}>
        <span style={styles.profileLabel}>官方 CLI 读写边界</span>
        <p style={styles.noticeText}>只读执行不写任何文件；修改文件的执行在独立 Git 工作树中进行，需要你确认后才会把补丁应用回当前工作区。工作台“安全边界”卡片按已配置模型逐条列出。</p>
        <table style={styles.boundaryTable}>
          <thead><tr><th style={styles.boundaryCell}>工具</th><th style={styles.boundaryCell}>只读执行可读</th><th style={styles.boundaryCell}>修改执行可写</th></tr></thead>
          <tbody>
            {[['claude-code', 'Claude Code'], ['codex', 'Codex'], ['gemini', 'Gemini CLI']].map(([toolId, label]) => {
              const boundary = toolBoundary(toolId)
              return <tr key={toolId}><td style={styles.boundaryCell}>{label}</td><td style={styles.boundaryCell}>{boundary.readOnly.readable}</td><td style={styles.boundaryCell}>{boundary.write?.writable ?? '不支持修改执行'}</td></tr>
            })}
          </tbody>
        </table>
      </div>

      <div style={styles.profileEditor}>
        <label htmlFor="model-router-profiles-json" style={styles.profileLabel}>模型价格与能力配置（JSON）</label>
        <p style={styles.noticeText}>按“模型目录”中的准确 provider/model 填写。quality 为自定的 0–100 分；input/output 是美元每百万 token。缺少价格时只给路线建议，不显示虚构费用。</p>
        <textarea
          id="model-router-profiles-json"
          value={state.modelProfilesJson.text}
          disabled={disabled}
          aria-invalid={state.modelProfilesJson.invalid}
          onChange={event => props.edit('modelProfilesJson', event.target.value)}
          spellCheck={false}
          style={styles.profileTextarea}
        />
        {state.modelProfilesJson.invalid && <p style={styles.profileError} role="alert">JSON 格式或某项配置无效。每项需提供准确的 provider/model，单价为非负 USD 数字，质量为 0–100。</p>}
        <details style={styles.profileExample}><summary>查看配置格式</summary><pre>{`[\n  {\n    "provider": "模型目录中的供应商 ID",\n    "model": "模型目录中的模型 ID",\n    "quality": 80,\n    "pricing": { "input": 0.2, "output": 0.8 },\n    "specialties": ["code"],\n    "cliModel": "厂商 CLI 使用的模型名（可选）",\n    "execution": "auto",\n    "billing": "subscription-first",\n    "subscription": "plan-key",\n    "apiRoute": { "provider": "按量付费供应商 ID", "model": "模型 ID" }\n  }\n]`}</pre><p style={styles.noticeText}>execution 可省略。auto 或 official 表示优先官方无界面工具，失败后回退 API；api 表示始终走模型目录。billing 默认 subscription-first（订阅优先，额度用尽或限流时切换 API Key），也可设为 api-only 或 subscription-only。subscription 为 plan-key 表示该路线本身是编程套餐端点（如 GLM Coding Plan、Kimi Code、MiniMax Token Plan），apiRoute 指定额度用尽时回退的按量付费路线。</p></details>
        <button type="button" disabled={disabled} onClick={() => props.resetField('modelProfilesJson')}>恢复默认配置</button>
      </div>

      <div style={styles.profileEditor}>
        <label htmlFor="model-router-quota-patterns" style={styles.profileLabel}>订阅额度识别规则（JSON，可选）</label>
        <p style={styles.noticeText}>内置规则已覆盖 Claude、Codex、Gemini、Kimi、MiniMax、GLM 的文档化报错。厂商改了报错文案时，可按工具 ID、供应商 ID 或 * 追加正则：quota 表示额度用尽，rateLimit 表示限流。</p>
        <textarea
          id="model-router-quota-patterns"
          value={state.quotaPatternsJson.text}
          disabled={disabled}
          aria-invalid={state.quotaPatternsJson.invalid}
          onChange={event => props.edit('quotaPatternsJson', event.target.value)}
          spellCheck={false}
          style={styles.profileTextarea}
        />
        {state.quotaPatternsJson.invalid && <p style={styles.profileError} role="alert">需要 JSON 对象，且每条规则都是有效的正则表达式。</p>}
        <details style={styles.profileExample}><summary>查看规则格式</summary><pre>{`{
  "kimi-code": { "quota": ["额度已用完"], "rateLimit": ["请求过于频繁"] },
  "my-glm-plan": { "quota": ["Usage limit reached for", "1308"] }
}`}</pre></details>
        <button type="button" disabled={disabled} onClick={() => props.resetField('quotaPatternsJson')}>恢复默认规则</button>
      </div>

      <aside style={styles.notice} aria-label="模型路由使用说明">
        <div style={styles.titleLine}><Tag tone="info">官方模型配置</Tag></div>
        <p style={styles.noticeText}>
          请在 DeepSeek Harness 的“模型”页面配置 DeepSeek、OpenAI 兼容或 Anthropic 兼容服务。此插件读取官方模型目录，不保存 API Key；目录中的路线仍需通过实际调用验证账号和网络可用性。
        </p>
        <p style={styles.noticeText}>
          使用 <code>model_router_plan</code> 获取可审阅的路由建议，使用 <code>model_router_consult</code> 咨询一个已配置模型。建议不会改写主会话模型；多人分工由官方 Agent Teams 工具执行。
        </p>
      </aside>
    </SettingsForm>
  )
}

function OpenRouterWorkspace({ subject, openPanel }) {
  if (subject?.kind !== 'bundle' || subject.pkg?.name !== ROUTER_PACKAGE) return null
  return <Button variant="outline" size="sm" type="button" onClick={openPanel}>打开工作台</Button>
}

/**
 * Register only while the Host serves this plugin's Config namespace. The
 * settings form belongs to this installed bundle; the matching main/sidebar
 * registrations create a visible root-level Desktop workspace.
 */
function registerUi(ctx) {
  const officialToolsRemote = ctx.remote[OFFICIAL_TOOLS_REMOTE_NAMESPACE]
  const settingsScope = ctx.configForms.get(ROUTER_NAMESPACE)
  const card = new RouterSettingsCardController(settingsScope)
  ctx.effect(() => () => { card.dispose() }, 'model-router-galgame: settings form subscription')
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: ROUTER_PACKAGE,
    inject: () => card.inject(),
  }, RouterSettingsCard))), 'model-router-galgame: installed bundle settings')
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: ROUTER_PANEL,
    inject: () => ({
      loadCatalog: () => ctx.remote.session.modelCatalog(),
      settingsScope,
      listOfficialTools: () => officialToolsRemote.list(),
      installOfficialTool: toolId => officialToolsRemote.installTool(toolId),
      cancelOfficialToolInstall: toolId => officialToolsRemote.cancel(toolId),
      officialToolInstallStatus: toolId => officialToolsRemote.status(toolId),
      toolHealth: fresh => officialToolsRemote.health(fresh),
      completeOnboarding: () => officialToolsRemote.completeOnboarding(),
      loadLedger: () => officialToolsRemote.ledger(),
      rateResult: request => officialToolsRemote.rateResult(request),
      rerunStep: request => officialToolsRemote.rerunStep(request),
      loadBoundaries: () => officialToolsRemote.boundaries(),
      previewRun: request => officialToolsRemote.previewRun(request),
      startRun: request => officialToolsRemote.startRun(request),
    }),
  }, RouterMainPage))), 'model-router-galgame: main workspace')
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: ROUTER_PANEL,
    order: 30,
    label: '模型路由',
  }, RouterPanelIcon))), 'model-router-galgame: sidebar entry')
  ctx.effect(() => ctx.configForms.whileServed([ROUTER_NAMESPACE], () => ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions',
    id: 'model-router-open-workspace',
    order: 30,
    inject: () => ({ openPanel: () => ctx.layout.selectPanel(ROUTER_PANEL) }),
  }, OpenRouterWorkspace))), 'model-router-galgame: bundle open action')
}

export async function apply(ctx) {
  // Mount first; the namespace becomes injectable only after its descriptors
  // are registered. UI registrations live in the dependent child fiber.
  const disposeRemote = await ctx.remote.$mount(OFFICIAL_TOOLS_CLIENT_REMOTE)
  const ui = ctx.inject(UI_INJECT, registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

const styles = Object.freeze({
  titleLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
  notice: {
    marginTop: '4px',
    padding: '12px',
    border: '1px solid var(--dsw-alias-border-l1)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-markdown-code-block)',
  },
  boundaryTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12, lineHeight: 1.5 },
  boundaryCell: { padding: '6px 8px', borderBottom: '1px solid rgba(127, 127, 127, .25)', textAlign: 'left', verticalAlign: 'top' },
  noticeText: {
    margin: '7px 0 0',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: '13px',
    lineHeight: '20px',
  },
  profileEditor: { display: 'grid', gap: '8px', marginTop: '14px' },
  profileLabel: { fontSize: '13px', fontWeight: 600 },
  profileTextarea: { width: '100%', minHeight: '150px', padding: '10px', fontFamily: 'monospace', fontSize: '12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l1)', boxSizing: 'border-box' },
  profileError: { color: 'var(--dsw-alias-label-danger)', fontSize: '12px', margin: 0 },
  profileExample: { fontSize: '12px', whiteSpace: 'pre-wrap' },
})
