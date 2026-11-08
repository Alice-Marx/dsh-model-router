import React from 'react'
import { apply as applyDs, inject as dsInject } from '../../modules/bot-runtime/vendor/ds-bot/src/client/index.js'
import { TeamSidebar } from '../../modules/bot-runtime/vendor/ds-bot/src/client/sidebar.js'
import { registerTheme } from '../../modules/bot-runtime/vendor/ds-bot/src/client/themes.js'
import { registerSkins } from './skins.mjs'
import { apply as applyMr } from '../../.dsh-plugin/client/official-harness.jsx'
import { createProductApi, PRODUCT_PANELS } from './api.mjs'
import { ProductNavigation, ProductPage } from './panels.jsx'
import css from './product.css'
import { installDesktopBridge } from './desktop-bridge.mjs'
import { DesktopPane } from './desktop-pane.jsx'

export const inject = [...new Set([...dsInject, 'remote'])]
export { ProductPage, ProductNavigation, PRODUCT_PANELS }

export function productSlots(slots, openPanel) {
  return new Proxy(slots, { get(target, key) {
    if (key === 'register') return (options, component) => {
      if (component !== TeamSidebar) return target.register(options, component)
      const Sidebar = props => {
        const sidebarAddon = () => <ProductNavigation panels={PRODUCT_PANELS} openPanel={openPanel} compact={!props.wide} />
        return <TeamSidebar {...props} actions={{ ...props.actions, sidebarAddon }} />
      }
      Sidebar.dsBotTeamSidebar = TeamSidebar
      return target.register(options, Sidebar)
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

export async function apply(ctx) {
  const api = createProductApi()
  ctx.effect(() => installDesktopBridge(api, props => <DesktopPane {...props} />), 'bot-product: desktop bridge')
  const openPanel = id => ctx.layout.selectPanel(id)
  const slots = productSlots(ctx.slots, openPanel)
  const dsContext = new Proxy(ctx, { get: (target, key) => key === 'slots' ? slots : Reflect.get(target, key, target) })
  ctx.effect(() => {
    const previous = document.body.getAttribute('data-bot-product-ui')
    document.body.setAttribute('data-bot-product-ui', '1')
    const style = document.createElement('style'); style.dataset.botProduct = '1'; style.textContent = css; document.head.append(style)
    return () => {
      style.remove()
      if (previous === null) document.body.removeAttribute('data-bot-product-ui')
      else document.body.setAttribute('data-bot-product-ui', previous)
    }
  }, 'bot-product: styles')
  // Registered before DS applies the saved theme, so a saved skin never flashes the default.
  ctx.effect(() => registerSkins(registerTheme), 'bot-product: skins')
  applyDs(dsContext)
  const disposeMr = await applyMr(ctx)
  for (const [section, key] of Object.entries(PRODUCT_PANELS)) {
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key,
      inject: () => ({ section, productApi: api, openPanel,
        openSession: id => ctx.uiWorkspace.openSession(id),
      }),
    }, ProductPage)), `bot-product: ${section}`)
  }
  return disposeMr
}
