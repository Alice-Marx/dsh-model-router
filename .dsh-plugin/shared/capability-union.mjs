/**
 * The feature union the unified product promises, as evidence rather than prose.
 *
 * Each row names a capability and the file that must still exist for it. A capability that
 * loses its evidence fails the test — that is what "逐项兑现" means here: a migration is
 * only real while the code behind it is still shipped.
 */

/** @type {Array<{ id: string, label: string, evidence: string, note?: string }>} */
export const CAPABILITY_UNION = Object.freeze([
  Object.freeze({ id: 'groups', label: '群聊', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/groups.js' }),
  Object.freeze({ id: 'memory', label: '长期记忆', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/memory.js' }),
  Object.freeze({ id: 'learning', label: '长期记忆 · 学习', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/learning.js' }),
  Object.freeze({ id: 'capabilities', label: '能力包', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/capabilities.js' }),
  Object.freeze({ id: 'office-skills', label: '能力包 · 办公技能', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/office-skills.js' }),
  Object.freeze({ id: 'voice', label: '语音', evidence: 'modules/bot-runtime/vendor/ds-bot/src/client/composer.js' }),
  Object.freeze({ id: 'side', label: '侧聊', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/side.js' }),
  Object.freeze({ id: 'btw', label: '侧聊 · /btw', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/btw.js' }),
  Object.freeze({ id: 'schedules', label: '计划任务', evidence: 'modules/bot-runtime/vendor/ds-bot/src/host/schedules.js' }),
  Object.freeze({ id: 'views', label: '交互视图', evidence: 'modules/bot-runtime/vendor/ds-bot/src/client/right-panel.js' }),
  Object.freeze({ id: 'tools', label: '官方工具注册表', evidence: '.dsh-plugin/shared/official-tool-registry.mjs' }),
  Object.freeze({ id: 'terminal', label: '终端', evidence: '.dsh-plugin/shared/cli-terminal.mjs' }),
  Object.freeze({ id: 'routing', label: '高级路由', evidence: '.dsh-plugin/shared/harness-plan.mjs' }),
  Object.freeze({ id: 'presets', label: '高级路由 · 方案', evidence: '.dsh-plugin/shared/routing-presets.mjs' }),
  Object.freeze({ id: 'tasks', label: '唯一任务系统', evidence: 'packages/orchestration/src/task-service.mjs' }),
  Object.freeze({ id: 'receipts', label: '事务收据', evidence: 'packages/orchestration/src/model-receipt.mjs' }),
  Object.freeze({ id: 'remote', label: '远程能力授权入口', evidence: 'packages/orchestration/src/remote-computer-tools.mjs' }),
  Object.freeze({ id: 'attention', label: '需要你处理（工作台）', evidence: '.dsh-plugin/shared/attention.mjs' }),
  Object.freeze({ id: 'bot-attention', label: '需要你处理（Bot 任务）', evidence: 'apps/integration-client/bot-attention.mjs' }),
  Object.freeze({ id: 'ledgers', label: '两本账', evidence: '.dsh-plugin/shared/ledgers.mjs' }),
])
