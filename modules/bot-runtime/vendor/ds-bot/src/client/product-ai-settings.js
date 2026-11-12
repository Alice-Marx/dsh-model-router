import { createElement as h } from 'react'

export function ProductAiSettings(props) {
  const bridge = globalThis.__dshBotAiProvidersUi
  return typeof bridge?.renderSettings === 'function' ? bridge.renderSettings(props)
    : h('p', { role: 'status' }, '请启用完整插件以管理独立 AI 提供方。')
}
