import React from 'react'
import {createRoot} from 'react-dom/client'
import {UsageExplorer} from '../../apps/integration-client/usage-explorer.jsx'
import productCss from '../../apps/integration-client/product.css'
import workspaceCss from '../../apps/integration-client/workspace.css'
import usageCss from '../../apps/integration-client/usage.css'
document.body.setAttribute('data-bot-product-ui','1');document.body.setAttribute('data-bp-appearance','light')
const style=document.createElement('style');style.textContent=`${productCss}\n${workspaceCss}\n${usageCss}\nhtml,body,#root{height:100%;margin:0}.fixture-note{height:42px;padding:12px 20px;box-sizing:border-box;font:12px system-ui;background:#eef3fa;color:#34445f}.bp-workspace{height:calc(100% - 42px)}.bp-page{width:100%;padding:24px}`;document.head.append(style)
const section={timezone:'Asia/Shanghai',items:[
  {id:'fixture-known',botId:'analyst',botName:'研究伙伴',taskId:'task-review',source:'bot',provider:'fixture',model:'review-model',billing:'api',amountUsd:.2,inputTokens:3000,outputTokens:700,status:'settled',createdAt:Date.parse('2026-11-06T17:00:00Z')},
  {id:'fixture-unknown',botId:'analyst',botName:'研究伙伴',taskId:'task-uncertain',source:'cli',provider:'fixture',model:'code-model',billing:'api',amountUsd:null,inputTokens:null,outputTokens:null,status:'unknown',createdAt:Date.parse('2026-11-07T08:00:00Z')},
  {id:'fixture-subscription',botId:'writer',botName:'写作伙伴',taskId:'task-draft',source:'cli',provider:'fixture',model:'subscription-model-with-a-very-long-identifier-for-responsive-table-verification',billing:'subscription',amountUsd:null,inputTokens:1000,outputTokens:500,status:'settled',createdAt:Date.parse('2026-11-08T08:00:00Z')},
  {id:'fixture-undated',botId:'writer',botName:'写作伙伴',source:'review',model:'legacy-fixture',amountUsd:.03,status:'settled'},
]}
createRoot(document.getElementById('root')).render(<><aside className="fixture-note">离线费用预览 · 以下均为合成收据，不产生真实调用或费用</aside><div className="bp-workspace"><main className="bp-page"><div className="bp-page-inner"><UsageExplorer section={section}/></div></main></div></>)
