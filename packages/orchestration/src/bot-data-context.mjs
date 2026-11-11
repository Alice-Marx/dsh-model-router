/**
 * The data context envelope (apps.data-context, P2): a metadata-only summary
 * the Host can inject into a Bot's prompt so it knows what it can query,
 * WITHOUT ever leaking row data. It lists table names, columns, types and row
 * counts, plus saved card titles — never a single cell value.
 *
 * This is a pure function of the engine's catalog; the composition decides
 * where to inject it (see data-wiring.patch). It is bounded so a Bot with many
 * tables cannot bloat the prompt.
 */

import { DATA_LIMITS } from './bot-data-surface.mjs'

const TABLES_MAX = 25
const COLUMNS_MAX = 20

/**
 * @param {object} engine
 * @param {string} botId
 * @returns {Promise<{ tables: Array<{name:string,rowCount?:number,columns:string[]}>, cards: Array<{id:string,title:string,kind:string}> }>}
 */
export async function buildDataContext(engine, botId) {
  const catalog = await engine.forBot(botId).catalog()
  return {
    tables: catalog.tables.slice(0, TABLES_MAX).map(table => ({
      name: table.name,
      columns: table.columns.slice(0, COLUMNS_MAX).map(column => `${column.name} ${column.type}`.trim()),
      columnCount: table.columns.length,
    })),
    cards: catalog.cards.slice(0, DATA_LIMITS.sheetCardsMax).map(card => ({ id: card.id, title: card.title, kind: card.kind })),
  }
}

/** Render the envelope as compact prompt text. Metadata only — no cell values. */
export function renderDataContext(context) {
  if (!context || !context.tables?.length) return ''
  const lines = ['You have data tables you can query with data_describe, data_sql, data_show and data_export (metadata only; no rows are shown here):']
  for (const table of context.tables) {
    const columns = table.columns.length ? `: ${table.columns.join(', ')}` : ''
    lines.push(`- ${table.name}${columns}`)
  }
  for (const card of context.cards ?? []) lines.push(`- saved ${card.kind} card "${card.title}" (${card.id})`)
  return lines.join('\n')
}
