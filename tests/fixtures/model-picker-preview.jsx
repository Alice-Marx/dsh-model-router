import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BotModelPicker } from '../../apps/integration-client/model-picker.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
document.body.setAttribute('data-bot-product-ui', '1'); document.body.setAttribute('data-bp-appearance', 'light')
const style = document.createElement('style'); style.textContent = `${productCss}\n${workspaceCss}\nhtml,body{margin:0;height:100%;background:var(--bp-bg);font:14px var(--bp-font);color:var(--bp-ink)}main{box-sizing:border-box;max-width:760px;margin:auto;padding:40px 22px}.fixture-note{font-size:11px;color:var(--bp-muted)}.fixture-picker-card{margin:24px 0;padding:20px;border:1px solid var(--bp-border);border-radius:14px;background:var(--bp-surface)}h1{font-size:24px}h2{font-size:15px}.fixture-copy{font-size:13px;line-height:1.7;color:var(--bp-muted)}`; document.head.append(style)
const models = [
  { provider: 'OpenAI', model: 'fixture-reasoning', label: '推理模型 · 合成目录' },
  { provider: 'OpenAI', model: 'fixture-fast', label: '快速模型 · 合成目录' },
  { provider: 'Anthropic', model: 'fixture-writing', label: '写作模型 · 合成目录' },
  { provider: '本地模型', model: 'fixture-local', label: '本地助手 · 合成目录' },
]
function Fixture() {
  const [value, setValue] = useState('OpenAI/fixture-reasoning')
  window.__pickerFixture = { value }
  return <main><p className="fixture-note">本地组件验证 · 合成模型目录 · 不调用模型</p><h1>研究伙伴</h1><p className="fixture-copy">选择这个 Bot 使用的模型。</p><section className="fixture-picker-card"><BotModelPicker models={models} value={value} onSelect={model => setValue(`${model.provider}/${model.model}`)}/></section><section className="fixture-picker-card"><h2>官方工具</h2><p className="fixture-copy">在 Bot 配置中选择可用的官方工具与执行模式。</p></section><button id="outside" type="button">其他设置</button></main>
}
createRoot(document.getElementById('root')).render(<Fixture />)
