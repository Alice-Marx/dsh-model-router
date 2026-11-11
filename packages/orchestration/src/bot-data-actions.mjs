/**
 * The panel-facing data actions. The human signs in as owner and picks which
 * Bot's data to view; the read-model's dispatch already requires an
 * authenticated owner and an allow-listed action, so these handlers only map
 * payloads onto the engine. A Bot id is still validated by the engine (never a
 * path, another service or an endpoint), and every failure is a structured
 * DataError the panel can render instead of a silent empty state.
 *
 * Wire these into product-composition's `actions` and add their names to the
 * read-model ACTIONS allow-list — see data-wiring.patch.
 *
 * Interface notes for the panel:
 *  - `data.show` takes `{ kind, table|sql, cardId? }`. With `cardId` it re-opens
 *    a SAVED card: the chart is re-rendered from its saved spec and the table
 *    from its saved result, so a chart card can be reopened (its id is a card
 *    id, never a table name).
 *  - `data.export` fails loudly: a library write that fails returns a structured
 *    error (output_too_large for the library's single-file limit) and NO path,
 *    so the panel must not report a completed export.
 *  - `data.cancel` reaches the Host and SIGKILLs the Bot's worker; it is a stop
 *    REQUEST, and the in-flight call fails with `cancelled`.
 */

import { DataFailure } from './bot-data-surface.mjs'

const errorOf = error => (error instanceof DataFailure ? error.error : { code: 'engine_unavailable', message: String(error?.message ?? error) })

/** @param {{ engine: object }} source */
export function createDataActions({ engine } = {}) {
  if (!engine || typeof engine.forBot !== 'function') throw new TypeError('DATA_ACTIONS_REQUIRE_ENGINE')
  const wrap = run => async payload => { try { return await run(payload) } catch (error) { return { error: errorOf(error) } } }
  const bot = payload => engine.forBot(payload?.botId)

  return Object.freeze({
    'data.catalog': wrap(payload => bot(payload).catalog()),
    'data.load': wrap(payload => bot(payload).load(payload)),
    'data.describe': wrap(payload => bot(payload).describe(payload?.target)),
    'data.sql': wrap(payload => bot(payload).sql(payload)),
    'data.show': wrap(payload => bot(payload).show(payload)),
    'data.page': wrap(payload => bot(payload).page(payload)),
    'data.export': wrap(payload => bot(payload).exportCsv(payload)),
    'data.remove': wrap(payload => bot(payload).remove(payload)),
    'data.cancel': wrap(payload => bot(payload).cancel()),
  })
}
