export const PRODUCT_PANELS = Object.freeze({ bindings: 'bot-product-bindings', tasks: 'bot-product-tasks', machines: 'bot-product-machines', library: 'bot-product-library', usage: 'bot-product-usage' })

export function createProductApi(fetcher = globalThis.fetch) {
  const call = async (action, payload, signal) => {
    const response = await fetcher('api/bot-product', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...(payload === undefined ? {} : { payload }) }), signal })
    if (response.status === 404) throw new Error('当前宿主尚未启用统一产品入口。请更新宿主并接入 botProductReadModel 服务。')
    const body = await response.json()
    if (!response.ok || body.ok !== true) throw Object.assign(new Error(body.error?.message ?? `宿主请求失败（HTTP ${response.status}）`), { code: body.error?.code })
    return body.value
  }
  return Object.freeze({ snapshot: signal => call('snapshot', undefined, signal), dispatch: (action, payload, signal) => call(action, payload, signal) })
}

export const TASK_STATES = Object.freeze({ queued: '排队中', ready:'等待执行', running: '执行中', cancelling: '停止中', cancelled: '已停止', succeeded: '已完成', failed: '失败',
  admitting: '等待资金准入', 'waiting-budget': '等待预算', 'waiting-approval': '等待审批', 'needs-reconciliation': '等待收据核对', skipped: '未执行', blocked: '受阻' })
export const money = value => typeof value === 'number' && Number.isFinite(value) ? `USD ${value.toFixed(6)}` : '未知（待收据核对）'
export const modelName = model => typeof model === 'string' ? model : model?.provider && (model?.model ?? model?.id) ? `${model.provider}/${model.model ?? model.id}` : '尚未选择准确模型'
