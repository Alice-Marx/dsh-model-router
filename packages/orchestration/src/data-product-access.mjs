import { createDataActions } from './bot-data-actions.mjs'

/** The two data doors share a Host-selected Bot; model arguments never select one. */
export function createProductDataAccess({ engine, authority, directory, lifecycle }) {
  const actions = createDataActions({ engine })
  /**
   * The one Bot door, for a subject the Host already resolved.
   *
   * The calling Bot comes from the live subject's own committed grant and
   * configuration — never from an argument, a path, an endpoint or another
   * Bot's id. A Bot without the `tool/data` grant, or one whose configuration
   * is not committed yet, is refused HERE with the Host's own reason instead of
   * a vague "unknown subject".
   */
  const botIdForSubject = subject => {
    authority.assertTool(subject, 'tool/data')
    const id = authority.describe(subject).botId
    if (!lifecycle.committedBot(id)) throw Object.assign(new Error('当前 Bot 尚未取得已保存的配置。'), { code: 'INVALID_DATA_OWNER' })
    return id
  }
  return Object.freeze({
    ownerAction(name, payload) {
      if (!Object.hasOwn(actions, name)) throw Object.assign(new Error('未知数据操作。'), { code: 'INVALID_DATA_ACTION' })
      if (!lifecycle.committedBot(payload?.botId)) throw Object.assign(new Error('请选择当前团队中已保存的 Bot。'), { code: 'INVALID_DATA_OWNER' })
      return actions[name](payload)
    },
    /**
     * The SDK door: the Bot is derived from the live session's real Agent
     * object. A matching string id never resolves one, so a model-supplied
     * botId or agent identity cannot reach the database.
     */
    botIdFor(exec) { return botIdForSubject(directory.forAgent(exec?.agent)) },
    botIdForSubject,
    /** The native door: same gate, then the engine for exactly that Bot. */
    forSubject(subject, { signal } = {}) { return engine.forBot(botIdForSubject(subject), { signal }) },
  })
}
