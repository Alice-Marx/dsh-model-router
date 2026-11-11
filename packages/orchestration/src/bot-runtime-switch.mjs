/**
 * Which runtime serves a Bot.
 *
 * A Bot is served by exactly one of two paths: the Harness session integration, or the independent
 * loop with its own session store. Moving a Bot is an atomic decision recorded on disk, and it is
 * refused while the Bot is busy — the one failure mode that matters here is a Bot being written by
 * both paths at once, because that produces two transcripts and no way to tell which is true.
 *
 * The switch is deliberately boring: a small JSON file, atomic rename, one entry per Bot. The
 * caller supplies `isBusy`, so this module never guesses about a live turn.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const RUNTIME_MODES = Object.freeze(['integration', 'independent'])
export const SWITCH_SCHEMA = 1

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)

export function openRuntimeSwitch({ file, now = Date.now } = {}) {
  if (typeof file !== 'string' || file === '') throw new TypeError('RUNTIME_SWITCH_FILE_REQUIRED')
  const read = () => {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      if (value?.schemaVersion !== SWITCH_SCHEMA) fail('RUNTIME_SWITCH_SCHEMA')
      if (!value.bots || typeof value.bots !== 'object') fail('RUNTIME_SWITCH_INVALID')
      return value
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { schemaVersion: SWITCH_SCHEMA, bots: {} }
      throw error
    }
  }
  const write = value => {
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(value))
    renameSync(temp, file)
    return value
  }

  return Object.freeze({
    /** The mode a Bot is served in; unswitched Bots stay on the integration path. */
    modeOf(botId) {
      if (!idOk(botId)) fail('INVALID_BOT_ID')
      return read().bots[botId]?.mode ?? 'integration'
    },
    /** Record the mode of every switched Bot without message bodies or credentials. */
    list() {
      return Object.entries(read().bots).map(([botId, entry]) => ({ botId, mode: entry.mode, changedAt: entry.changedAt, ...(entry.snapshot ? { snapshot: entry.snapshot } : {}) }))
    },
    /**
     * Move one Bot to a runtime, atomically.
     *
     * `isBusy` may be asynchronous — a Host that has to ask a live runtime about a running turn
     * can. `assertIdle` is the one that protects the commit: it is synchronous and it stands
     * directly in front of the write, because the await above can lose the race to a turn that
     * started while it was in flight.
     *
     * @param {string} botId
     * @param {'integration'|'independent'} mode
     * @param {{ isBusy?: (botId: string) => boolean | Promise<boolean>, assertIdle?: (botId: string) => boolean, snapshot?: object }} [options]
     */
    async move(botId, mode, { isBusy, assertIdle, snapshot = null } = {}) {
      if (!idOk(botId)) fail('INVALID_BOT_ID')
      if (!RUNTIME_MODES.includes(mode)) fail('INVALID_RUNTIME_MODE')
      const busy = typeof isBusy === 'function' ? await isBusy(botId) : false
      // A moving Bot must be idle: this is the whole point of the switch.
      if (busy === true) fail('BOT_BUSY', '这个 Bot 正在一轮对话中，等它空闲后再切换运行时。')
      const state = read()
      const current = state.bots[botId]?.mode ?? 'integration'
      if (current === mode) return { botId, mode, changed: false }
      // Nothing may await between this check and the write below, or a turn admitted during the
      // check above would be served by two runtimes at once.
      if (typeof assertIdle === 'function' && assertIdle(botId) === false) {
        fail('BOT_BUSY', '这个 Bot 正在一轮对话中，等它空闲后再切换运行时。')
      }
      // A snapshot makes a move auditable afterwards: counts only, never message bodies.
      state.bots[botId] = { mode, changedAt: now(), ...(snapshot ? { snapshot } : {}) }
      write(state)
      return { botId, mode, previous: current, changed: true }
    },
    /** Forget a Bot's entry, returning it to the default integration path. */
    reset(botId) {
      if (!idOk(botId)) fail('INVALID_BOT_ID')
      const state = read()
      if (!state.bots[botId]) return { botId, changed: false }
      delete state.bots[botId]
      write(state)
      return { botId, changed: true }
    },
  })
}

/**
 * The guard a turn runs under: it refuses to start when the requested mode is not the committed
 * one, so a stale caller cannot serve a Bot that was already moved.
 */
export function assertServing(switchApi, botId, requestedMode) {
  const committed = switchApi.modeOf(botId)
  if (requestedMode !== committed) {
    const error = new Error(`运行时已切换：${botId} 当前由 ${committed} 提供服务，本次 ${requestedMode} 请求被拒绝。`)
    error.code = 'RUNTIME_MODE_MISMATCH'
    throw error
  }
  return committed
}
