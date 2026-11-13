export const PRODUCT_ROUTE = '/api/bot-product'
export const PRODUCT_SCHEMA_VERSION = 1

const blocked = (reason, nextAction) => ({ status: 'blocked', reason, nextAction, items: [] })
const missing = {
  bindings: blocked('宿主尚未提供 Bot 的工具、机器和预算绑定投影。', '在插件配置中接入统一 Bot 绑定服务后刷新。'),
  botBindings: blocked('宿主尚未提供 Bot 执行绑定投影。', '接入 Bot 设置服务后，可在这里查看和配置每个 Bot 的模型、工作区与资金范围。'),
  fundingAccounts: blocked('宿主尚未提供资金账户目录投影。', '接入资金账户服务后，可在这里按 provider 配置本地限额策略。'),
  tasks: blocked('宿主尚未提供统一任务服务的只读投影。', '接入 Task Service 后，可在这里跟踪、取消或核对任务。'),
  threads: blocked('宿主尚未提供 Bot 线程目录投影。', '接入 Bot 线程服务后，可在这里为同一个 Bot 建立多条独立会话。'),
  machines: blocked('尚未接入远程电脑目录。', '安装并配对同版本 remote-computer-agent，然后在机器目录中登记。'),
  webPanels: blocked('宿主尚未提供固定网页面板目录。', '接入固定网页面板存储后，可在这里把常用网页固定在侧栏。'),
  usage: blocked('宿主尚未提供统一费用与预占投影。', '接入唯一 MR 资金库的只读投影；已有 Token 用量仍可在 DS 用量页查看。'),
}
const ACTIONS = new Set([
  'ui.namespace',
  'nativeActivity.list',
  'botProfile.inspect', 'botProfile.save',
  'independentChat.send', 'independentChat.inspect', 'independentChat.cancel', 'independentChat.view', 'independentChat.messages',
  'independentChat.newConversation',
  'task.inspect', 'task.attention', 'task.cancel', 'task.retry', 'task.reconcile', 'task.plan.submit', 'task.plan.cancel', 'usage.resolve',
  'threads.readModel', 'threads.list', 'threads.create', 'threads.rename', 'threads.switch', 'threads.open', 'threads.archive', 'threads.unarchive', 'threads.ensure', 'threads.recover', 'threads.reconcile',
  'webPanels.list', 'webPanels.probe', 'webPanels.save', 'webPanels.remove', 'webPanels.order',
  'notifications.readModel', 'notifications.list', 'notifications.read', 'notifications.markAll',
  'data.catalog', 'data.load', 'data.describe', 'data.sql', 'data.show', 'data.page', 'data.export', 'data.remove', 'data.cancel',
  'binding.inspect', 'binding.save', 'funding.account.save', 'machine.secret', 'machine.pair', 'machine.pair.invite', 'machine.bind', 'machine.probe',
  'aiProviders.list', 'aiProviders.suggestions', 'aiProviders.save', 'aiProviders.remove', 'aiProviders.check', 'aiProviders.cliStatus',
  'cliProviders.list', 'cliProviders.save', 'cliProviders.remove', 'cliProviders.inspect',
  'machine.revoke', 'machine.reconcile', 'machine.artifact', 'machine.desktop.view', 'machine.desktop.act',
  'machine.host.status', 'machine.host.configure', 'machine.host.start', 'machine.host.stop', 'machine.host.invite', 'machine.host.devices', 'machine.host.revoke',
  'machine.desktop.open', 'machine.desktop.renew', 'machine.desktop.close',
  'machine.desktop.poll', 'machine.desktop.send',
  'library.list', 'library.read', 'library.write', 'library.upload', 'library.download', 'library.remove', 'library.mkdir', 'library.search',
  'routine.list', 'routine.run', 'routine.save', 'routine.remove', 'routine.history', 'routine.cancel', 'routine.resolve', 'roles.list',
  'botRoutingInspect', 'botRoutingDecide', 'botRouting.dispatch', 'botRouting.save', 'botRouting.status',
  'botRuntimeStatus', 'botRuntimeMove', 'botRuntimeHistory', 'botRuntimeMessage',
])
const READ_ONLY_ACTIONS = new Set(['independentChat.inspect', 'independentChat.view', 'independentChat.messages', 'nativeActivity.list'])
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const error = (code, message) => Object.assign(new Error(message), { code })
const desktopClientOrigin = request => {
  // This is a session restriction, never authentication. The native shell's
  // bridge strips the browser Origin, so its viewer supplies one exact hint.
  const nativeOrigin = request.headers.get('x-dsh-desktop-origin')
  if (nativeOrigin !== null) {
    if (nativeOrigin !== 'dsh-app://app') throw error('INVALID_CLIENT_ORIGIN', '无效的桌面来源。')
    return nativeOrigin
  }
  return new URL(request.url).origin
}

/** Read-through projections; never creates a second config or monetary store. */
export function createProductReadModel({ runtime, lifecycle, providers = {}, actions = {} }) {
  const read = async (key, signal) => {
    if (typeof providers[key] !== 'function') return structuredClone(missing[key])
    try {
      const value = await providers[key]({ runtime, signal })
      if (!plain(value) || !['available', 'blocked'].includes(value.status) || !Array.isArray(value.items)) {
        throw error('INVALID_READ_MODEL', `${key} 投影必须返回 status 和 items。`)
      }
      // Ensure JSON-transportable data and detach provider-owned values. Providers
      // are trusted host code and must expose only explicitly public fields.
      return JSON.parse(JSON.stringify(value))
    } catch (cause) {
      return blocked(`${key} 读取失败：${String(cause?.message ?? cause).slice(0, 500)}`, '查看宿主诊断、修复服务后刷新。')
    }
  }
  return Object.freeze({
    version: PRODUCT_SCHEMA_VERSION,
    async snapshot({ signal } = {}) {
      signal?.throwIfAborted()
      await runtime.load()
      const values = await Promise.all(Object.keys(missing).map(async key => [key, await read(key, signal)]))
      signal?.throwIfAborted()
      const state = runtime.state
      return {
        schemaVersion: PRODUCT_SCHEMA_VERSION,
        observedAt: new Date().toISOString(),
        lifecycle: lifecycle.status(),
        readOnly: runtime.readOnly() ?? null,
        bots: Object.values(state.bots).map(bot => ({ id: bot.id, name: bot.name, role: bot.role ?? '', model: bot.model ?? null,
          appliedModel: typeof bot.appliedModel === 'string' ? bot.appliedModel : null,
          sessionId: runtime.chatOf(bot.id), workDir: bot.workDir ?? null, main: state.mainBotIds?.includes(bot.id) ?? false })),
        mainBotId: state.mainBotIds?.[0] ?? null,
        ...Object.fromEntries(values),
        // Presence is only UI availability; action handlers must authorize again.
        availableActions: [...ACTIONS].filter(name => typeof actions[name] === 'function'),
      }
    },
    async dispatch(request, context) {
      if (context?.kind !== 'owner') throw error('REMOTE_OWNER_REQUIRED', '此操作需要已认证的宿主拥有者。')
      if (!plain(request) || Object.keys(request).some(key => !['action', 'payload'].includes(key)) || !ACTIONS.has(request.action)) {
        throw error('INVALID_PRODUCT_ACTION', '未知或格式无效的操作。')
      }
      if (typeof actions[request.action] !== 'function') throw error('PRODUCT_ACTION_UNAVAILABLE', '此宿主尚未接入该操作，请查看页面中的接入说明。')
      const readOnlyReason = runtime.readOnly()
      if (readOnlyReason !== undefined && !READ_ONLY_ACTIONS.has(request.action)) throw error('PRODUCT_READ_ONLY', readOnlyReason)
      // context belongs to authorizeRequest(), never to the JSON request.
      return actions[request.action](request.payload, readOnlyReason !== undefined ? { ...context, readOnly: true } : context)
    },
  })
}

/** The parent supplies real owner authentication; absence never enables a route. */
export function registerProductChannel(ctx, readModel, authorizeRequest) {
  if (typeof authorizeRequest !== 'function') throw new TypeError('PRODUCT_AUTHENTICATION_REQUIRED')
  return ctx.connection.fetch.register({ path: PRODUCT_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    try {
      const context = await authorizeRequest(request)
      if (!context || context.kind !== 'owner') return Response.json({ ok: false, error: { code: 'REMOTE_OWNER_REQUIRED', message: '请先登录宿主拥有者账号。' } }, { status: 403 })
      const body = await request.json()
      const value = body?.action === 'snapshot'
        ? await readModel.snapshot({ signal: request.signal })
        : await readModel.dispatch(body, { ...context, clientOrigin: desktopClientOrigin(request), signal: request.signal })
      return Response.json({ ok: true, value })
    } catch (cause) {
      return Response.json({ ok: false, error: { code: cause?.code ?? 'PRODUCT_REQUEST_FAILED', message: String(cause?.message ?? cause).slice(0, 500) } }, { status: 400 })
    }
  } })
}
