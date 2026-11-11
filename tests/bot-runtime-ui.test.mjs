import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { build } from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const fixtureRequire = createRequire(join(ROOT, 'tests/fixtures/integration-host/package.json'))
const { JSDOM } = fixtureRequire('jsdom')
const parent = join(ROOT, 'tmp/integration/product-ui'); await mkdir(parent, { recursive: true })
const dir = await mkdtemp(join(parent, 'components-'))
const bundle = await build({ absWorkingDir: ROOT, entryPoints: ['apps/integration-client/panels.jsx'], bundle: true, format: 'esm', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*'], write: false , loader: { '.css': 'text' } })
const file = join(dir, 'panels.mjs'); await writeFile(file, bundle.outputFiles[0].text)
const { ProductPage, BotBindings, Usage, Machines } = await import(pathToFileURL(file))

async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  const previous = Object.fromEntries(['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  try { await work({ container, root, click: async button => act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }) }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } }
}

const sample = () => ({ schemaVersion: 1, observedAt: '2026-10-27T00:00:00Z', bots: [{ id: 'bot-main', name: 'Main', model: 'fixture/gpt-exact', main: true, sessionId: 'main-session' }],
  readOnly: null, tasks: { status: 'available', items: [{ taskId: 'task-existing', botId: 'bot-main', state: 'needs-reconciliation', input: { task: '原始执行任务' }, attempts: [{ id: 'attempt-original', state: 'unknown' }], operationId: 'op-original', legacyRunIds: ['run-original'] }] },
  availableActions: ['task.reconcile'], bindings: { status: 'blocked', reason: '尚未接入宿主绑定', nextAction: '在宿主设置中授权。', items: [] } })

test('bot product UI: cancelling a confirmed remote write does not imply file changes were undone',async()=>{
  await withDom(async({root,container,click})=>{
    const snapshot=sample();snapshot.tasks.items[0].state='cancelled';snapshot.tasks.items[0].result={remote:{status:'succeeded',stopConfirmed:true,possiblyApplied:true,sha256:'a'.repeat(64),bytes:10}}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async()=>{}},openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,/写入已确认/);assert.match(container.textContent,/取消未撤销文件变更/)
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='原始执行任务'));assert.match(container.textContent,/remoteReceipt/);assert.ok(container.textContent.includes('a'.repeat(64)))
  })
})

test('bot product UI: a cancelled container command keeps applied effects and its exit code is receipt evidence',async()=>{
  await withDom(async({root,container,click})=>{
    const snapshot=sample();snapshot.tasks.items[0].state='cancelled';snapshot.tasks.items[0].result={remote:{status:'cancelled',stopConfirmed:true,possiblyApplied:true,exitCode:137}}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async()=>{}},openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,/操作已停止/);assert.match(container.textContent,/重试不会撤销/)
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='原始执行任务'));assert.match(container.textContent,/remoteReceipt/);assert.ok(container.textContent.includes('exitCode'));assert.ok(container.textContent.includes('137'))
  })
})

test('bot product UI: a never-started command receipt reads as not started, not as failure effects',async()=>{
  await withDom(async({root,container})=>{
    const snapshot=sample();snapshot.tasks.items[0].state='failed';snapshot.tasks.items[0].result={remote:{status:'failed',stopConfirmed:true,notStarted:true,possiblyApplied:false}}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async()=>{}},openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,/原操作未启动/)
  })
})

test('bot product UI: missing remote stop receipt explains uncertainty and offers only observation for unknown tasks',async()=>{
  await withDom(async({root,container,click})=>{
    const snapshot=sample(),calls=[];snapshot.availableActions=['task.retry','task.reconcile'];snapshot.tasks.items[0].result={remote:{status:'unknown',stopConfirmed:false,possiblyApplied:true}}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async(action,payload)=>calls.push({action,payload})},openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,/写入或停止尚未确认/);assert.match(container.textContent,/不会自动重发/);assert.ok(![...container.querySelectorAll('button')].some(button=>button.textContent==='重试'))
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='核对原收据'));assert.equal(calls[0].action,'task.reconcile');assert.equal(calls[0].payload.taskId,'task-existing')
  })
})

test('bot product UI: terminal tasks cannot be retried while remote stopping lacks strict evidence',async()=>{
  for(const [state,remote] of [
    ['failed',{status:'failed',stopConfirmed:false,possiblyApplied:true}],
    ['cancelled',{status:'cancelled',stopConfirmed:'true',possiblyApplied:true}],
    ['failed',{status:'failed',stopConfirmed:1}],
    ['cancelled',{status:'cancelled',notStarted:'true'}],
    ['failed',{status:'failed',notStarted:1}],
    ['failed',{status:'failed',notStarted:true,possiblyApplied:true}],
  ]) await withDom(async({root,container,click})=>{
    const snapshot=sample(),calls=[];snapshot.availableActions=['task.retry','task.reconcile']
    snapshot.tasks.items[0].state=state;snapshot.tasks.items[0].result={remote}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async(action,payload)=>calls.push({action,payload})},openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,/停止尚未确认/);assert.match(container.textContent,/暂不能重试/)
    const retry=[...container.querySelectorAll('button')].find(button=>button.textContent==='重试')
    assert.ok(retry);assert.equal(retry.disabled,true,`${state} ${JSON.stringify(remote)}`)
    await click(retry);assert.equal(calls.length,0,'disabled retry must not dispatch')
  })
})

test('bot product UI: confirmed remote stop may be retried without claiming its effects were undone',async()=>{
  for(const [remote,notice] of [
    [{status:'failed',stopConfirmed:true,possiblyApplied:true},/文件可能已改变；重试不会撤销已有变更/],
    [{status:'failed',stopConfirmed:true,notStarted:true,possiblyApplied:false},/原操作未启动/],
  ]) await withDom(async({root,container,click})=>{
    const snapshot=sample(),calls=[];snapshot.availableActions=['task.retry']
    snapshot.tasks.items[0].state='failed';snapshot.tasks.items[0].result={remote}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async(action,payload)=>calls.push({action,payload})},openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,notice)
    const retry=[...container.querySelectorAll('button')].find(button=>button.textContent==='重试')
    assert.equal(retry.disabled,false);await click(retry)
    assert.equal(calls.length,1);assert.equal(calls[0].action,'task.retry');assert.equal(calls[0].payload.taskId,'task-existing')
  })
})

test('bot product UI: budget waiting remains retryable while unknown tasks only offer reconciliation',async()=>{
  await withDom(async({root,container,click})=>{
    let snapshot=sample();const calls=[];snapshot.availableActions=['task.retry','task.reconcile']
    snapshot.tasks.items[0].state='waiting-budget'
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch:async(action,payload)=>calls.push({action,payload})},openSession:()=>{},openPanel:()=>{}})))
    const retry=[...container.querySelectorAll('button')].find(button=>button.textContent==='重试')
    assert.equal(retry.disabled,false);await click(retry);assert.equal(calls[0].action,'task.retry')
    snapshot={...snapshot,tasks:{...snapshot.tasks,items:[{...snapshot.tasks.items[0],state:'needs-reconciliation',result:{remote:{stopConfirmed:false,possiblyApplied:true}}}]}}
    const refresh=[...container.querySelectorAll('button')].find(button=>button.textContent==='刷新');await click(refresh)
    assert.ok(![...container.querySelectorAll('button')].some(button=>button.textContent==='重试'))
    const reconcile=[...container.querySelectorAll('button')].find(button=>button.textContent==='核对原收据')
    assert.ok(reconcile);await click(reconcile);assert.equal(calls[1].action,'task.reconcile')
  })
})

test('bot product UI: original unknown operation stays visible and reconciliation calls host with same task', async () => {
  await withDom(async ({ root, container, click }) => {
    const calls = []
    const api = { snapshot: async () => sample(), dispatch: async (action, payload) => calls.push({ action, payload }) }
    await act(async () => root.render(React.createElement(ProductPage, { section: 'tasks', productApi: api, openSession: () => {}, openPanel: () => {} })))
    assert.match(container.textContent, /等待收据核对/)
    assert.ok(!container.textContent.includes('已完成'))
    await click([...container.querySelectorAll('button')].find(button => button.textContent === '原始执行任务'))
    assert.match(container.textContent, /op-original/); assert.match(container.textContent, /attempt-original/)
    await click([...container.querySelectorAll('button')].find(button => button.textContent === '核对原收据'))
    assert.equal(calls.length, 1); assert.equal(calls[0].action, 'task.reconcile'); assert.equal(calls[0].payload.taskId, 'task-existing')
    assert.ok(calls[0].payload.requestKey)
  })
})

test('bot product UI: a plan with unconfirmed stop retains dependency states and cancels under the original owner',async()=>{
  await withDom(async({root,container,click})=>{
    const snapshot=sample(),calls=[]
    snapshot.availableActions=['task.plan.cancel']
    snapshot.tasks.plans=[{planId:'plan-original',ownerBotId:'bot-main',state:'cancelling',needsReconciliation:true,packages:[
      {id:'running',targetBotId:'bot-main',state:'needs-reconciliation',dependsOn:[]},
      {id:'later',targetBotId:'bot-main',state:'skipped',dependsOn:['running']},
    ]}]
    const api={snapshot:async()=>snapshot,dispatch:async(action,payload)=>calls.push({action,payload})}
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:api,openSession:()=>{},openPanel:()=>{}})))
    assert.match(container.textContent,/停止尚未确认/);assert.match(container.textContent,/前置：running/);assert.match(container.textContent,/未执行/)
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='停止整个计划'))
    assert.deepEqual(calls,[{action:'task.plan.cancel',payload:{botId:'bot-main',planId:'plan-original'}}])
  })
})

test('bot product UI: Bot identity, exact model and permission blocker remain separate', async () => {
  await withDom(async ({ root, container, click }) => {
    const snapshot = sample()
    snapshot.bots.push({ id: 'bot-review', name: '评审', role: '独立评审', model: 'fixture/gpt-exact', sessionId: 'review-session' })
    let opened
    await act(async () => root.render(React.createElement(BotBindings, { snapshot, openSession: id => { opened = id } })))
    await click([...container.querySelectorAll('button')].find(button => button.textContent.includes('评审')))
    assert.match(container.textContent, /bot-review/); assert.match(container.textContent, /fixture\/gpt-exact/); assert.match(container.textContent, /尚未接入宿主绑定/)
    await click([...container.querySelectorAll('button')].find(button => button.textContent === '打开私聊'))
    assert.equal(opened, 'review-session')
  })
})

test('bot product UI: missing receipts never display zero; offline desktop reports actionable reason', async () => {
  await withDom(async ({ root, container }) => {
    await act(async () => root.render(React.createElement(Usage, { snapshot: { usage: { status: 'available', summary: { subscriptionSummary: { callsToday: 2, callsMonth: 7 } }, items: [{ id: 'receipt-unknown', botId: 'main', source: 'cli', status: 'unknown', model: 'fixture/gpt-exact', amountUsd: null }] } }, openAdvanced: () => {} })))
    assert.match(container.textContent, /未知（待收据核对）/); assert.ok(!container.textContent.includes('USD 0.000000'))
    assert.match(container.textContent, /今日 2 次 · 本月 7 次/)
    await act(async () => root.render(React.createElement(Machines, { snapshot: { machines: { status: 'available', items: [{ id: 'win-fixture', status: 'offline', platform: 'win32', desktop: { status: 'locked' }, blockedReason: 'Windows 用户桌面已锁定', nextAction: '登录并解锁配对用户的桌面。' }] } } })))
    assert.match(container.textContent, /Windows 用户桌面已锁定/); assert.match(container.textContent, /登录并解锁/)
  })
})
test('bot product UI: an unconfirmed receipt is reviewed by the owner and a resolved receipt keeps its audit tag', async () => {
  // React is imported before withDom installs the DOM, so React's input-event
  // support probe runs without a document and text input events never produce
  // onChange in this harness (click listeners are attached unconditionally).
  // Typing is therefore not simulated here; the resolve payload and its money
  // semantics are covered by the real-host default probe and the native suite.
  await withDom(async ({ root, container }) => {
    const dispatch = async () => { throw new Error('the review form is gated until an owner writes a note') }
    const snapshot = { usage: { status: 'available', summary: { apiUsd: 0.000021, reservedUsd: 0, unknownCount: 1, subscriptionSummary: null },
      unresolved: [{ botId: 'bot-cli', runId: 'cli-run-1', packageId: 'cli', billing: 'api', provider: 'integration-gpt-fixture', model: 'gpt-fixture', usage: { inputTokens: 11, outputTokens: 5 }, finishedAt: 1_793_000_000_000 }],
      items: [{ id: 'receipt-unknown', botId: 'bot-cli', source: 'cli', status: 'unknown', model: 'fixture/gpt-exact', amountUsd: null }] } }
    await act(async () => root.render(React.createElement(Usage, { snapshot, dispatch, busy: false, openAdvanced: () => {} })))
    assert.match(container.textContent, /待人工核对的未确认费用/)
    assert.match(container.textContent, /不会放行新的付费调用/)
    assert.match(container.textContent, /bot-cli/); assert.match(container.textContent, /cli-run-1/)
    assert.match(container.textContent, /11 \/ 5/)
    const note = container.querySelector('input[aria-label="核对说明 cli-run-1"]'), amount = container.querySelector('input[aria-label="核对金额 cli-run-1"]')
    assert.ok(note && amount, 'the review form exposes a required note and a confirmed amount')
    const attest = [...container.querySelectorAll('button')].find(button => button.textContent === '按厂商账单确认')
    const waive = [...container.querySelectorAll('button')].find(button => button.textContent === '按零费用放行')
    assert.equal(attest.disabled, true, 'a note is required before any resolution')
    assert.equal(waive.disabled, true)
    // A resolved receipt keeps its receipt status and shows the audit tag.
    await act(async () => root.render(React.createElement(Usage, { snapshot: { usage: { status: 'available', unresolved: [], summary: { apiUsd: 0, reservedUsd: 0, unknownCount: 0 },
      items: [{ id: 'receipt-unknown', botId: 'bot-cli', source: 'cli', status: 'unknown', model: 'fixture/gpt-exact', amountUsd: 0,
        resolution: { kind: 'waive', costUsd: 0, note: '厂商账单未核对，按零费用放行。', resolvedAt: 1_793_000_000_000 } }] } }, dispatch, busy: false, openAdvanced: () => {} })))
    assert.match(container.textContent, /已按零费用放行/)
    assert.ok(!container.textContent.includes('待人工核对的未确认费用'))
    assert.equal(container.querySelector('input[aria-label="核对说明 cli-run-1"]'), null, 'a resolved package leaves no review form')
  })
})
test('bot product UI: machine grants, controlled read and revoke use the selected Bot and saved revision',async()=>{
  await withDom(async({root,container,click})=>{
    const calls=[],snapshot=sample()
    snapshot.availableActions=['machine.secret','machine.pair','machine.bind','machine.probe','machine.revoke']
    snapshot.machines={status:'available',items:[{id:'machine-fixture',revision:4,name:'Machine fixture',status:'online',roots:['project'],tools:['machine_ping','fs_list','fs_read'],bindings:[{botId:'bot-main',revision:3,revoked:false,roots:['project'],tools:['machine_ping','fs_read']}]}]}
    await act(async()=>root.render(React.createElement(Machines,{snapshot,busy:false,dispatch:async(action,payload)=>{calls.push({action,payload})}})))
    // Pairing moved to an imported file: there is no secret input in the panel any more, and the
    // values that used to be typed by hand now come from the file the Agent printed.
    const pairingFile=container.querySelector('input[type=file]')
    assert.ok(pairingFile,'the pairing form imports a file')
    assert.equal(container.querySelector('input[aria-label="远程配对凭据"]'),null,'no hand-typed credential remains')
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='保存此 Bot 的机器授权'))
    assert.deepEqual(calls[0],{action:'machine.bind',payload:{machineId:'machine-fixture',botId:'bot-main',roots:['project'],tools:['machine_ping','fs_list','fs_read'],mode:'read-only',expectedRevision:3}})
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='检查 Agent 在线状态'))
    assert.equal(calls[1].action,'machine.probe');assert.equal(calls[1].payload.rootId,'project')
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='撤销此 Bot 的机器访问'))
    assert.deepEqual(calls[2],{action:'machine.revoke',payload:{machineId:'machine-fixture',botId:'bot-main',expectedRevision:3}})
    snapshot.machines.items[0].bindings[0].revoked=true
    await act(async()=>root.render(React.createElement(Machines,{snapshot,busy:false,dispatch:async(action,payload)=>{calls.push({action,payload})}})))
    assert.equal([...container.querySelectorAll('button')].find(button=>button.textContent==='检查 Agent 在线状态').disabled,true)
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='保存此 Bot 的机器授权'))
    assert.equal(calls.at(-1).payload.expectedRevision,3,'revoked bindings retain CAS revision for explicit regrant')
    snapshot.availableActions.push('machine.reconcile');snapshot.machines.items[0].revocations=[{botId:'bot-main',status:'unconfirmed'}]
    await act(async()=>root.render(React.createElement(Machines,{snapshot,busy:false,dispatch:async(action,payload)=>{calls.push({action,payload})}})))
    assert.match(container.textContent,/远程停止尚未确认/)
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='重试确认远程撤销'))
    assert.deepEqual(calls.at(-1),{action:'machine.reconcile',payload:{machineId:'machine-fixture'}})
  })
})

test('bot product UI: long execution logs preserve their tail and the original recovery action',async()=>{
  await withDom(async({root,container,click})=>{
    const snapshot=sample(),calls=[],lastLine='log-line-19999: final reconciliation sentinel'
    snapshot.availableActions=['task.reconcile']
    snapshot.tasks.items[0].attempts[0].output=Array.from({length:20000},(_,index)=>index===19999?lastLine:`log-line-${index}: ${'x'.repeat(80)}`).join('\n')
    const dispatch=async(action,payload)=>calls.push({action,payload})
    await act(async()=>root.render(React.createElement(ProductPage,{section:'tasks',productApi:{snapshot:async()=>snapshot,dispatch},openSession:()=>{},openPanel:()=>{}})))
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='原始执行任务'))
    assert.match(container.textContent,/log-line-0:/);assert.match(container.textContent,new RegExp(lastLine))
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='核对原收据'))
    assert.equal(calls.length,1);assert.equal(calls[0].action,'task.reconcile');assert.equal(calls[0].payload.taskId,'task-existing')
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='关闭'))
    assert.ok(!container.textContent.includes(lastLine));assert.equal(calls.length,1)
  })
})

test('bot product UI: artifact download verifies before linking and reports expiry without exposing content',async()=>{
  await withDom(async({root,container,click})=>{
    const calls=[],snapshot=sample()
    snapshot.availableActions=['machine.artifact']
    snapshot.machines={status:'available',items:[{id:'machine-fixture',revision:1,name:'Machine fixture',status:'online',roots:['project'],tools:['artifact_stat','artifact_read'],bindings:[]}]}
    const dispatch=async(action,payload)=>{calls.push({action,payload});return{artifactId:payload.artifactId,sha256:'a'.repeat(64),size:4,mediaType:'application/octet-stream',content:Buffer.from('test').toString('base64')}}
    await act(async()=>root.render(React.createElement(Machines,{snapshot,busy:false,dispatch})))
    for(const [key,value] of [['Task','task-a'],['Attempt','attempt-a'],['Operation','operation-a'],['Artifact','artifact-a']]){
      const input=container.querySelector(`input[aria-label="机器 machine-fixture 的 artifact ${key}"]`)
      Object.getOwnPropertyDescriptor(container.ownerDocument.defaultView.HTMLInputElement.prototype,'value').set.call(input,value)
      await act(async()=>input.dispatchEvent(new container.ownerDocument.defaultView.Event('input',{bubbles:true})))
    }
    const submit=[...container.querySelectorAll('button')].find(button=>button.textContent==='核验并下载')
    assert.equal(submit.disabled,false,'all required fields are populated before submission')
    await click(submit)
    assert.deepEqual(calls[0],{action:'machine.artifact',payload:{machineId:'machine-fixture',botId:'bot-main',taskId:'task-a',attemptId:'attempt-a',operationId:'operation-a',artifactId:'artifact-a'}})
    const link=container.querySelector('a[download="artifact-a.bin"]')
    assert.ok(link);assert.match(link.href,/^data:application\/octet-stream;base64,/)
    assert.match(link.textContent,/SHA-256 已匹配/)
    assert.equal(container.textContent.includes('test内容'),false)
  })
  await withDom(async({root,container,click})=>{
    const snapshot=sample();snapshot.availableActions=['machine.artifact']
    snapshot.machines={status:'available',items:[{id:'machine-fixture',revision:1,name:'Machine fixture',status:'online',roots:['project'],tools:['artifact_stat','artifact_read'],bindings:[]}]}
    await act(async()=>root.render(React.createElement(Machines,{snapshot,busy:false,dispatch:async()=>{throw Object.assign(new Error('expired'),{code:'ARTIFACT_DOWNLOAD_EXPIRED'})}})))
    for(const [key,value] of [['Task','task-a'],['Attempt','attempt-a'],['Operation','operation-a'],['Artifact','artifact-a']]){
      const input=container.querySelector(`input[aria-label="机器 machine-fixture 的 artifact ${key}"]`)
      Object.getOwnPropertyDescriptor(container.ownerDocument.defaultView.HTMLInputElement.prototype,'value').set.call(input,value)
      await act(async()=>input.dispatchEvent(new container.ownerDocument.defaultView.Event('input',{bubbles:true})))
    }
    await click([...container.querySelectorAll('button')].find(button=>button.textContent==='核验并下载'))
    assert.match(container.textContent,/ARTIFACT_DOWNLOAD_EXPIRED/)
    assert.match(container.textContent,/不存在、已过期或未获授权/)
    assert.equal(container.querySelector('a[download]'),null)
  })
})
