/** Full Bot product hooks. The router-only entry never imports this module. */
import z from '@deepseek-ai/schemastery'
import { dirname, join } from 'node:path'
import { defaultStatePath, resolveStateHome } from './shared/router-state.mjs'
import * as fs from 'node:fs'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'
import { libraryRoot, registerLibraryTools } from './shared/library-tools.mjs'
import { createBotRoutineStore, routineStoreDir } from '../packages/orchestration/src/bot-routine-store.mjs'
import { createPluginRuntime, runtimeSwitchPath } from '../modules/independent-runtime/index.mjs'
import { inject as botRuntimeInject } from '../modules/bot-runtime/index.mjs'
import { createBotServing } from '../packages/orchestration/src/bot-serving.mjs'
import { openRuntimeSwitch } from '../packages/orchestration/src/bot-runtime-switch.mjs'
import { createDiagnosticAccountStream, startBotProduct } from '../packages/orchestration/src/product-composition.mjs'
import { createDeferredRouterState } from '../packages/orchestration/src/deferred-router-state.mjs'
import { BotRuntimeConfig, normalizeBotRuntimeConfig } from '../packages/orchestration/src/bot-runtime-config.mjs'
import { assertMigrationStartupAllowed } from '../packages/orchestration/src/migration-startup-gate.mjs'
import { createIndependentConversationReader } from '../packages/orchestration/src/independent-chat-page.mjs'

export const inject = botRuntimeInject
// Which runtime serves a Bot is committed state: the switch file the independent runtime owns.
// It is read back on every admission, and a read that fails refuses the call instead of assuming
// the integration path. Absence of the adapter is not proof that nothing was ever moved — a Host
// that restarts with the independent runtime switched off still has the file a move wrote — so the
// file itself is read when no adapter answers. Only a Host that never constructed the independent
// runtime at all has no switch to read, and only there is integration the truth.
const switches = new Map()
const switchFor = file => {
  if (!switches.has(file)) switches.set(file, openRuntimeSwitch({ file }))
  return switches.get(file)
}
export const runtimeModeOf = ctx => botId => {
  const adapter = (() => { try { return ctx.get?.('botRuntimeAdapter') ?? null } catch { return null } })()
  if (adapter && typeof adapter.modeOf === 'function') return adapter.modeOf(botId)
  const file = (() => { try { return ctx.get?.('botRuntimeSwitchFile') ?? null } catch { return null } })()
  if (typeof file !== 'string' || file === '') return 'integration'
  // The switch's own reader: an absent file is "nothing was ever switched", a corrupt one throws
  // and the admission refuses. Nothing here resets or overwrites a committed mode.
  return switchFor(file).modeOf(botId)
}
const servingOf = ctx => { try { return ctx.get?.('botServing') ?? null } catch { return null } }
export const configFields = {
  // Unified Bot product composition (DS Bot runtime + this plugin). Isolated
  // test compositions provide their own policy/runtime and disable this.
  botProduct: z.boolean().default(true),
  // The former ds-bot entry's runtime options, kept separately from MR settings.
  // Non-volatile: changing home/workspace restarts the owning runtime.
  botRuntime: BotRuntimeConfig,
  botRouting: z.object({
    enabled: z.boolean().default(false),
    preset: z.union(['economy', 'balanced', 'quality']).default('balanced'),
    autoGrant: z.object({ machineTools: z.boolean().default(true), cliTools: z.boolean().default(false) })
      .default({ machineTools: true, cliTools: false }),
  }).default({ enabled: false, preset: 'balanced', autoGrant: { machineTools: true, cliTools: false } }),
  operatorPassthrough: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  independentRuntime: z.object({
    // `provider`, `model` and `workspaceRoot` are no longer read for authority: the committed Bot
    // decides the model it runs on, and the Host decides which tools it may reach. They stay in the
    // schema so an existing configuration keeps parsing; nothing here falls back to them.
    enabled: z.boolean().default(false), provider: z.string().default(''), model: z.string().default(''),
    dir: z.string().max(4096).default(''), workspaceRoot: z.string().max(4096).default(''),
    maxSteps: z.number().step(1).min(1).max(200).default(16), fullTextHistory: z.boolean().default(false),
  }).default({ enabled: false }),
  // Host-owned pinned conversation routes. Bot bindings select only the
  // advertised provider/model; messages cannot supply these launch details.
  conversationEngines: z.array(z.object({
    id: z.string().max(100), driver: z.union(['claude']).default('claude'),
    provider: z.string().max(100), model: z.string().max(100), name: z.string().max(128),
    entry: z.object({ executable: z.string().max(4096), sha256: z.string().pattern(/^[a-f0-9]{64}$/), version: z.string().max(32),
      script: z.string().max(4096), scriptSha256: z.string().pattern(/^[a-f0-9]{64}$/) }),
    credentialRef: z.string().max(80), deadlineMs: z.number().step(1).min(1000).max(7200000),
    hostTools: z.boolean().default(false),
  })).max(32).default([]),
  // 托管任务的官方 CLI 入口：executable/sha256/version 必须来自安装核验
  // （探针期由 pinCodexExecutable 复核），Bot 与任务入参均不能提供入口。
  // 未配置时默认产品不注册 CLI 任务后端。sessionFactory 仅供宿主级隔离验证
  // 覆盖真实 createCodexSession，默认不设置。
  taskCli: z.object({
    // Schemastery fields are optional by default; normalizeTaskCli validates
    // exact profile/entry keys before any CLI backend can be registered.
    entry: z.object({ executable: z.string().max(4_096), sha256: z.string().pattern(/^[a-f0-9]{64}$/), version: z.string().max(64) }).default(null),
    models: z.array(z.object({ provider: z.string().max(256), model: z.string().max(256), cliModel: z.string().max(128) })).max(64).default([]),
    sessionFactory: z.string().max(4_096).default(''),
    remote: z.array(z.object({
      machineId: z.string().max(128), rootId: z.string().max(128), profileId: z.string().max(128), profileRevision: z.number().step(1).min(1),
      entry: z.object({ sha256: z.string().pattern(/^[a-f0-9]{64}$/), version: z.string().max(64) }),
    })).max(64).default([]),
  }).default(null),
}

export function start(ctx, config, { installRouterStateStore, executeConfiguredAssignment, rerunRecordedStep, routerStateStore }) {
  // The unified Bot product composes the frozen DS Bot runtime with this plugin
  // body inside one Host. Lightweight direct apply() callers (plain-object test
  // contexts) have no Cordis surface or DS services and keep the legacy MR
  // behavior; a real DSH Host always provides the runtime's services.
  const botProductEnabled = (() => { const value = config?.botProduct; return (typeof value === 'function' ? value() : value) !== false })()
  const productHost = botProductEnabled && typeof ctx?.provide === 'function' && typeof ctx?.effect === 'function'
    && ['llm', 'tools', 'systemPrompt', 'sessionController', 'sessions', 'sessionTitle', 'workspaceRegistry', 'connection']
      .every(name => { try { return ctx.get(name) !== undefined } catch { return false } })
  if (typeof ctx?.provide === 'function' && typeof ctx?.effect === 'function') assertMigrationStartupAllowed({ home: resolveStateHome() })
  let deferredRouterState = null
  if (productHost && ctx.get('botIntegrationPolicy') === undefined) {
    const storageFile = join(resolveStateHome(), 'model-router', 'orchestration.sqlite')
    deferredRouterState = createDeferredRouterState({ file: storageFile })
    installRouterStateStore(deferredRouterState.state)
  }
  // The one serving admission, published before the runtime exists: the integrated stream and
  // the independent runtime both take their lease from it, so "is this Bot being served" has one
  // answer in one Host.
  let serving = null
  if (productHost) {
    serving = createBotServing({ modeOf: runtimeModeOf(ctx) })
    try { ctx.provide('botServing', serving) } catch { serving = servingOf(ctx) ?? serving }
  }
  let botProduct
  const taskCli = (() => { const value = config?.taskCli; return (typeof value === 'function' ? value() : value) ?? null })()
  const conversationEngines = (() => { const value = config?.conversationEngines; return (typeof value === 'function' ? value() : value) ?? [] })()
  try {
    botProduct = productHost ? startBotProduct(ctx, { config, accountStream: createDiagnosticAccountStream(),
      deferredRouterState, storageFile: deferredRouterState?.state.file, legacyFile: defaultStatePath(),
      // N09: the managed Task runner reuses this plugin's own execution entries,
      // so the composition never needs a second copy of the MR runtime.
      mr: { executeConfiguredAssignment, rerunRecordedStep, routerStateStore }, taskCli, conversationEngines,
      runtimeConfig: normalizeBotRuntimeConfig(config?.botRuntime) }) : null
  } catch (error) {
    deferredRouterState?.reject(error)
    throw error
  }
  if (botProduct) {
    ctx.effect(() => async () => { await botProduct.dispose() }, 'model-router-galgame: bot product')
  }
  return botProduct
}

export function connect(ctx, config, { stateDir, valueOf }) {
    // Opt-in independent Bot runtime. A failure here leaves the product on the integration path
    // instead of taking the plugin down.
    let botRouting = null
    try { botRouting = ctx.get?.('botRouting') ?? null } catch { botRouting = null }
    // The same admission the Bot product's model stream holds, so one Host answers "is this Bot
    // being served" once. The product publishes it; without a product there is still one switch
    // and one lease, so it is built here instead of being skipped.
    const serving = servingOf(ctx) ?? createBotServing({ modeOf: runtimeModeOf(ctx) })
    let botRuntime = null
    try {
      const runtime = createPluginRuntime({
        ctx,
        settings: { ...(valueOf(config, 'independentRuntime', {}) ?? {}), remoteInvoke: (botId, tool, args, context) => {
          const invoker = ctx.get?.('botRemoteToolInvoker')
          if (!invoker) throw new Error('REMOTE_TOOL_SERVICE_UNAVAILABLE')
          return invoker.invoke(botId, tool, args, context)
        } },
        stateDir,
        serving,
      })
      if (runtime) botRuntime = {
        turn: request => runtime.turn(request),
        contextOf: botId => runtime.contextOf(botId),
        newConversation: (botId, options) => runtime.newConversation(botId, options),
        reconcileConversation: (botId, options) => runtime.reconcileConversation(botId, options),
        conversationPage: createIndependentConversationReader({ dir: runtimeSwitchPath({ settings: valueOf(config, 'independentRuntime', {}) ?? {}, stateDir }) }),
        // One row per moved Bot: the runtime it is on plus its transcript size, never message bodies.
        list: async () => runtime.inventory(runtime.list().map(row => row.botId)).map(row => ({ botId: row.botId, mode: row.runtime, changedAt: row.updatedAt ?? null, turns: row.turns, messages: row.messages })),
        move: (botId, mode) => runtime.move(botId, mode),
        history: (botId, options) => runtime.history(botId, options),
        readMessage: (botId, index) => runtime.readMessage(botId, index),
        // The committed runtime, read from the switch itself. A Bot that cannot be read back is
        // refused by every admission that asks, never defaulted to the integration path.
        describe: botId => runtime.describe(botId),
        workThreadTurn: request => runtime.workThreadTurn(request),
        workThreadRead: (...args) => runtime.workThreadRead(...args),
        captureTeamOrigin: request => runtime.captureTeamOrigin(request),
        teamOriginCurrent: (...args) => runtime.teamOriginCurrent(...args),
        resumeTeamTurn: request => runtime.resumeTeamTurn(request),
        modeOf: botId => runtime.describe(botId)?.runtime ?? null,
        busyBots: () => runtime.busyBots(),
        dispose: () => runtime.close(),
      }
    } catch (error) {
      ctx.logger?.('model-router: independent runtime unavailable: %s', error?.message ?? error)
    }
    try { ctx.provide('botRuntimeAdapter', botRuntime) } catch { /* provided only once */ }
    if (botRuntime) ctx.effect(() => () => botRuntime.dispose(), 'model-router: independent runtime')
    // Where the committed mode lives, published whether or not the independent runtime was
    // constructed: a Bot moved before a restart that switched it off must still be readable, so a
    // Host that cannot answer "which runtime serves this Bot" refuses instead of assuming.
    try {
      ctx.provide('botRuntimeSwitchFile', join(runtimeSwitchPath({ settings: valueOf(config, 'independentRuntime', {}) ?? {}, stateDir }), 'runtime-switch.json'))
    } catch { /* provided only once */ }
  return { botRuntime, botRouting }
}

export function provideLibraries(ctx, config, { stateFile, defineTool, registerPolicyTool, JSON_OUTPUT, jsonValue }) {
  try {
    const libraryRootDir = libraryRoot(dirname(stateFile))
    const library = createBotLibrary({ root: libraryRootDir, fs })
    registerLibraryTools({ ctx, config, defineTool, registerPolicyTool, library, jsonOutput: JSON_OUTPUT, jsonValue, stateDir: libraryRootDir })
    try { ctx.provide('botLibrary', library) } catch { /* provided once */ }
    ctx.provide('routineStore', createBotRoutineStore({ dir: routineStoreDir(dirname(stateFile)) }))
  } catch (error) {
    ctx.logger?.('model-router: bot library unavailable: %s', error?.message ?? error)
  }

}
