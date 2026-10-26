/** Host receiver for the official desktop's typed one-click installer RPC. */
import { readFileSync } from 'node:fs'
import { legacyPolicy } from './shared/legacy-policy.mjs'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOfficialTool, installMethodBlockReason, OFFICIAL_TOOLS } from './shared/official-tool-registry.mjs'
import { resolveInstallLocation, resolveInstallPlan, resolveUninstallPlan } from './shared/tool-install-preferences.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness } from './shared/official-tool-executor.mjs'
import {
  cancelInstall,
  currentInstallOptions,
  defaultRunner,
  ensureNpmPrefixOnPath,
  installPreferences,
  installStatus,
  planCommandLine,
  probeAllTools,
  probeToolWith,
  startInstall,
  startRepair,
  startUninstall,
} from './shared/official-tools-runtime.mjs'
import {
  OFFICIAL_TOOLS_HOST_TYPERT,
  OFFICIAL_TOOLS_REMOTE_DESCRIPTORS,
  OFFICIAL_TOOLS_REMOTE_NAMESPACE,
} from './shared/official-tools-remote.mjs'

/** Version of the plugin code this Host process actually imported. */
export const HOST_PLUGIN_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? null }
  catch { return null }
})()

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

const unavailable = () => { throw new Error('模型路由工作台服务尚未加载。') }

/**
 * What the panel needs to render the install controls: the effective settings
 * and, per tool, every method with the reason it is unavailable here plus the
 * command line that would actually run. The panel shows this before the user
 * clicks, so an install is never a surprise command.
 */
export function installSummary(preferences = installPreferences(), options = currentInstallOptions()) {
  return {
    installDir: preferences.installDir ?? '',
    registry: preferences.registry ?? '',
    allowScriptInstall: preferences.allowScriptInstall !== false,
    scriptUrls: { ...(preferences.scriptUrls ?? {}) },
    methods: { ...(preferences.methods ?? {}) },
    tools: OFFICIAL_TOOLS.map(tool => {
      const entry = {
        id: tool.id,
        methods: [],
        command: null,
        uninstallCommand: null,
        methodId: null,
        // A pinned unavailable method stays selected and reports its reason.
        savedMethodId: preferences.methods?.[tool.id] ?? null,
        notices: [],
      }
      for (const method of tool.installMethods ?? []) {
        const item = { id: method.id, label: method.label, kind: method.kind,
          supportsInstallDir: method.supportsInstallDir === true,
          blocked: installMethodBlockReason(method, options.platform) }
        try {
          const plan = resolveInstallPlan(tool, method.id, preferences, options)
          item.command = planCommandLine(plan)
          item.installDir = plan.kind === 'archive' ? plan.installDir : resolveInstallLocation(tool, method, preferences, options)?.dir ?? ''
          item.notices = plan.notices ?? []
        } catch (error) {
          item.blocked = errorText(error).slice(0, 200)
        }
        try {
          const removal = resolveUninstallPlan(tool, method.id, preferences, options)
          item.uninstallCommand = planCommandLine(removal, 'uninstall')
        } catch (error) { item.uninstallError = errorText(error).slice(0, 200) }
        entry.methods.push(item)
      }
      try {
        const plan = resolveInstallPlan(tool, undefined, preferences, options)
        entry.methodId = plan.methodId
        entry.command = planCommandLine(plan)
        entry.installDir = plan.kind === 'archive' ? plan.installDir : resolveInstallLocation(tool, plan.method, preferences, options)?.dir ?? ''
        entry.updateMethodId = plan.methodId
        entry.updateCommand = entry.command
        entry.updateInstallDir = entry.installDir
        entry.notices = plan.notices ?? []
      } catch (error) {
        entry.installError = entry.error = errorText(error).slice(0, 200)
      }
      try {
        const removal = resolveUninstallPlan(tool, undefined, preferences, options)
        entry.methodId ??= removal.methodId
        entry.installDir ??= removal.kind === 'archive' ? removal.installDir : resolveInstallLocation(tool, removal.method, preferences, options)?.dir ?? ''
        entry.uninstallCommand = planCommandLine(removal, 'uninstall')
      } catch (error) {
        entry.uninstallError = errorText(error).slice(0, 200)
      }
      return entry
    }),
  }
}

/** Wrap a Host operation so the client always receives a plain object. */
async function settled(operation) {
  try { return { ok: true, value: await operation() } }
  catch (error) { return { ok: false, error: errorText(error) } }
}

export class OfficialToolsRemoteService extends TypertRemoteService {
  constructor(ctx, services = {}) {
    super(ctx, OFFICIAL_TOOLS_REMOTE_NAMESPACE)
    this.services = services
  }

  /** 开箱体检: installed, version and login state per registry tool. */
  health(fresh) { return settled(() => (this.services.health ?? unavailable)(fresh === true)) }

  completeOnboarding() { return settled(() => (this.services.completeOnboarding ?? unavailable)()) }

  /** Recent runs, spending, budget status and learned route biases. */
  ledger() { return settled(() => (this.services.ledger ?? unavailable)()) }

  rateResult(request) { return settled(() => (this.services.rate ?? unavailable)(request)) }

  /** Retry one recorded step (optionally reassigned); unfinished downstream steps follow. */
  rerunStep(request) { return settled(() => (this.services.rerun ?? unavailable)(request)) }

  boundaries() { return settled(() => (this.services.boundaries ?? unavailable)()) }

  /** Plan, cost estimate and the reasons that need the user's confirmation; runs nothing. */
  previewRun(request) { return settled(() => (this.services.previewRun ?? unavailable)(request)) }

  /** Execute a previewed run once every listed reason was confirmed. */
  startRun(request) { return settled(() => (this.services.startRun ?? unavailable)(request)) }
  runStatus(request) { return settled(() => (this.services.runStatus ?? unavailable)(request)) }
  cancelRun(request) { return settled(() => (this.services.cancelRun ?? unavailable)(request)) }

  /** Terminal backend (PTY or pipe fallback), limits and live sessions. */
  terminalInfo() { return settled(() => (this.services.terminalInfo ?? unavailable)()) }

  /** Start one confirmed session: the user's shell or a fixed official CLI. */
  terminalStart(request) { return settled(() => (this.services.terminalStart ?? unavailable)(request)) }

  /** Long-poll new output from a cursor. */
  terminalRead(request) { return settled(() => (this.services.terminalRead ?? unavailable)(request)) }

  /** Forward keystrokes verbatim; never logged. */
  terminalWrite(request) { return settled(() => (this.services.terminalWrite ?? unavailable)(request)) }

  terminalResize(request) { return settled(() => (this.services.terminalResize ?? unavailable)(request)) }

  terminalStop(request) { return settled(() => (this.services.terminalStop ?? unavailable)(request)) }

  /** Re-probe the local fixed registry; the caller cannot supply a command. */
  async list() {
    const tools = await probeAllTools({ fresh: true })
    const executionReadiness = await Promise.all(tools.map(async tool => {
      if (!tool.installed) return { id: tool.id, ready: false, reason: 'CLI 尚未安装或版本检测失败。' }
      try {
        return await officialToolReadiness(tool.id)
      } catch (error) {
        return { id: tool.id, ready: false, reason: `执行入口检测失败：${String(error?.message ?? error).slice(0, 200)}` }
      }
    }))
    return {
      tools,
      executionCapabilities: officialToolExecutionCapabilities(),
      executionReadiness,
      hostVersion: HOST_PLUGIN_VERSION,
      install: this.installSettings().install,
    }
  }

  /** Refresh saved methods and commands without spawning CLIs or checking downloads. */
  installSettings() {
    const error = this.services?.installSettingsError?.()
    if (error) throw new Error(`官方工具安装设置无效：${error}`)
    const install = installSummary()
    // The saved input can contain Host-only home/environment expansions. Keep
    // it separate from the resolved directory used by the actual command.
    install.requestedInstallDir = this.services?.installRequestedDirectory?.() ?? install.installDir
    return { install, hostVersion: HOST_PLUGIN_VERSION }
  }

  /** Start one serialized fixed-registry install; return immediately for UI polling. */
  async installTool(request) {
    return settled(async () => {
      this.installSettings()
      await ensureNpmPrefixOnPath()
      return { accepted: true, job: startInstall(request.tool, { method: request.method }) }
    })
  }

  /**
   * Remove one tool. Configuration, credentials and session history are kept;
   * only the program itself (and the vendor installer's own PATH block) goes.
   */
  async uninstallTool(request) {
    return settled(async () => {
      this.installSettings()
      await ensureNpmPrefixOnPath()
      return { accepted: true, job: startUninstall(request.tool, { method: request.method }) }
    })
  }

  /** Reinstall the tool even when it already reports the latest version. */
  async repairTool(request) {
    return settled(async () => {
      this.installSettings()
      await ensureNpmPrefixOnPath()
      return { accepted: true, job: startRepair(request.tool, { method: request.method }) }
    })
  }

  /** Stop a queued or running install, retaining its bounded job log. */
  cancel(toolId) {
    try {
      return { accepted: true, job: cancelInstall(toolId) }
    } catch (error) {
      return { accepted: false, error: errorText(error) }
    }
  }

  /** Read bounded progress; after command success, verify that the CLI resolves. */
  async status(toolId) {
    const job = installStatus(toolId)
    if (job?.status !== 'succeeded') return { job }
    await ensureNpmPrefixOnPath()
    const tool = getOfficialTool(toolId)
    const postInstallProbe = tool === null ? null
      : await probeToolWith(tool, defaultRunner, { cacheMs: 0 })
    return { job, postInstallProbe }
  }


}

// Cover the exported contract, including installer/terminal methods that do not
// delegate through routerRemoteServices. RPC identity comes only from the Gateway.
for (const { method } of OFFICIAL_TOOLS_REMOTE_DESCRIPTORS) {
  const original = OfficialToolsRemoteService.prototype[method]
  if (typeof original !== 'function') throw new Error(`Missing Remote receiver: ${method}`)
  Object.defineProperty(OfficialToolsRemoteService.prototype, method, { configurable: true, writable: true,
    value: function (...args) {
      const policy = legacyPolicy(this.ctx, this.services?.requireBotPolicy?.() === true)
      if (!policy) return original.apply(this, args)
      return policy.run({ kind: 'remote', name: method, invocation: this.ctx.invocation }, () => original.apply(this, args))
    },
  })
}

/** Registration follows the Host plugin fiber; unload withdraws all endpoints. */
export function registerOfficialToolsRemote(ctx, services = {}) {
  new OfficialToolsRemoteService(ctx, services)
  ctx.effect(() => ctx.typert.register(OFFICIAL_TOOLS_HOST_TYPERT), 'model-router-galgame: official tools remote descriptors')
}
