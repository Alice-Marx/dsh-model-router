/** Full Bot + routing plugin; package: @ljwei-stak/dsh-model-route-bot. */
import { apply as applyRouter, createRouterConfig, inject as routerInject } from './router-core.mjs'
import * as product from './bot-product.mjs'

export * from './router-core.mjs'
// Preserve the existing Cordis ID and storage namespace across the package rename.
export const inject = [...new Set([...product.inject, ...routerInject])]
export const Config = createRouterConfig(product.configFields)
export function apply(ctx, config = {}) { return applyRouter(ctx, config, product) }
