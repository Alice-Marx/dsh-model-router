import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { normalizeBotRouting } from './bot-routing-mode.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }

export function openBotRoutingSettings({ Database, file, initial = null, now = Date.now }) {
  if (file !== ':memory:') { file = resolve(file); mkdirSync(dirname(file), { recursive: true }) }
  const db = new Database(file)
  db.pragma('busy_timeout=5000'); db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL')
  db.exec('CREATE TABLE IF NOT EXISTS bot_routing_settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,settings TEXT NOT NULL,updated_at INTEGER NOT NULL)')
  const read = () => {
    const row = db.prepare('SELECT * FROM bot_routing_settings WHERE id=1').get()
    return row ? { revision: row.revision, settings: normalizeBotRouting(JSON.parse(row.settings)), updatedAt: row.updated_at }
      : { revision: 0, settings: normalizeBotRouting(typeof initial === 'function' ? initial() : initial), updatedAt: null }
  }
  return Object.freeze({
    get: read,
    save(input, context) {
      if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED')
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['expectedRevision', 'settings'].includes(key))
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('INVALID_BOT_ROUTING_SETTINGS')
      const settings = normalizeBotRouting(input.settings)
      return db.transaction(() => {
        const current = read()
        if (input.expectedRevision !== current.revision) fail('BOT_ROUTING_SETTINGS_CONFLICT')
        db.prepare('INSERT INTO bot_routing_settings VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,settings=excluded.settings,updated_at=excluded.updated_at')
          .run(current.revision + 1, JSON.stringify(settings), now())
        return read()
      }).immediate()
    },
    close: () => db.close(),
  })
}
