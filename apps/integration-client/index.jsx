import React from 'react'
import { apply as applyDs, inject as dsInject } from '../../modules/bot-runtime/vendor/ds-bot/src/client/index.js'
import { TeamSidebar } from '../../modules/bot-runtime/vendor/ds-bot/src/client/sidebar.js'
import { apply as applyMr } from '../../.dsh-plugin/client/official-harness.jsx'
import { createProductApi, PRODUCT_PANELS } from './api.mjs'
import { ProductNavigation, ProductPage } from './panels.jsx'
import css from './product.css'
import workspaceCss from './workspace.css'
import chatCss from './chat.css'
import desktopCss from './desktop.css'
import usageCss from './usage.css'
import notificationsCss from './notifications.css'
import dataCss from './data.css'
import botThreadsCss from './bot-threads.css'
import webPanelCss from './web-panel.css'
import composerDraftCss from './composer-draft.css'
import botThreadHeaderCss from './bot-thread-header-bridge.css'
import { createProductSlots } from './product-slots.jsx'
import { installDesktopBridge } from './desktop-bridge.mjs'
import { DesktopPane } from './desktop-pane.jsx'
import { installWorkspaceAppearance } from './workspace-ui.jsx'
import { IndependentChatPage } from './independent-chat-page.jsx'
import { INDEPENDENT_CHAT_PANEL } from './independent-chat-navigation.mjs'
import independentChatCss from './independent-chat.css'
import { AiProvidersPage } from './ai-providers.jsx'
import aiProvidersCss from './ai-providers.css'
import refinementCss from './product-refinement.css'
import { requestWorkbenchView } from '../../.dsh-plugin/client/workbench-state.mjs'

export const inject = [...new Set([...dsInject, 'remote'])]
export { ProductPage, ProductNavigation, PRODUCT_PANELS }

export function productSlots(slots, openPanel, productApi, client) {
  return createProductSlots(slots,openPanel,productApi,TeamSidebar,client)
}

export async function apply(ctx) {
  const api = createProductApi()
  ctx.effect(() => installDesktopBridge(api, props => <DesktopPane {...props} />), 'bot-product: desktop bridge')
  const openPanel = id => ctx.layout.selectPanel(id)
  ctx.effect(() => {
    const previous = globalThis.__dshBotAiProvidersUi
    const bridge = Object.freeze({
      openSettings: () => openPanel(PRODUCT_PANELS.ai),
      renderSettings: ({ onClose } = {}) => <AiProvidersPage productApi={api}
        onOpenTools={() => { onClose?.(); requestWorkbenchView('tools'); openPanel('model-router-galgame') }}
        onOpenBindings={() => { onClose?.(); openPanel(PRODUCT_PANELS.bindings) }}/>,
    })
    globalThis.__dshBotAiProvidersUi = bridge
    return () => { if (globalThis.__dshBotAiProvidersUi === bridge) { if (previous) globalThis.__dshBotAiProvidersUi = previous; else delete globalThis.__dshBotAiProvidersUi } }
  }, 'bot-product: AI settings')
  const slots = productSlots(ctx.slots, openPanel, api, { sessionBindingOf: id => ctx.sessions.binding(id), openSession: id => ctx.uiWorkspace.openSession(id) })
  const dsContext = new Proxy(ctx, { get: (target, key) => key === 'slots' ? slots : Reflect.get(target, key, target) })
  ctx.effect(() => {
    const previous = document.body.getAttribute('data-bot-product-ui')
    document.body.setAttribute('data-bot-product-ui', '1')
    const style = document.createElement('style'); style.dataset.botProduct = '1'; style.textContent = `${css}\n${workspaceCss}\n${chatCss}\n${desktopCss}\n${usageCss}\n${notificationsCss}\n${dataCss}\n${botThreadsCss}\n${webPanelCss}\n${composerDraftCss}\n${botThreadHeaderCss}\n${independentChatCss}\n${aiProvidersCss}\n${refinementCss}`; document.head.append(style)
    const disposeAppearance = installWorkspaceAppearance(window)
    return () => {
      disposeAppearance()
      style.remove()
      if (previous === null) document.body.removeAttribute('data-bot-product-ui')
      else document.body.setAttribute('data-bot-product-ui', previous)
    }
  }, 'bot-product: styles')
  applyDs(dsContext)
  const disposeMr = await applyMr(ctx)
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: INDEPENDENT_CHAT_PANEL,
    inject: () => ({ productApi: api, openPanel, openSession: id => ctx.uiWorkspace.openSession(id) }),
  }, IndependentChatPage)), 'bot-product: independent chat')
  for (const [section, key] of Object.entries(PRODUCT_PANELS)) {
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key,
      inject: () => ({ section, productApi: api, openPanel,
        openSession: id => ctx.uiWorkspace.openSession(id),
      }),
    }, ProductPage)), `bot-product: ${section}`)
  }
  return disposeMr
}
