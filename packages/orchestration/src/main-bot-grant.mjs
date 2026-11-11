/** Main's full-control role comes from committed Host state. Worker checkbox
 * grants do not narrow it. Services still own actual availability and accounting.
 */
export function compileMainBotGrant({ base, catalog, routes, toolNames = [], teamToolNames = [] }) {
  return {
    tools: [...new Set([
      ...(base.tools ?? []), 'model/infer', 'task/execute', 'task/submit', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile',
      ...(catalog.capabilities ?? []).flatMap(item => item.tools ?? []),
      ...(catalog.tools ?? []).flatMap(item => item.grantTools ?? []),
      ...toolNames.map(name => `tool/${name}`), ...teamToolNames.map(name => `tool/${name}`),
      'tool/bot_dispatch', 'tool/bot_handoff_task',
    ])].sort(),
    modelRoutes: routes.map(route => ({ provider: route.provider, model: route.model })),
  }
}
