import { openBotSessionStore } from '../../packages/orchestration/src/bot-session-store.mjs'
const [dir, count = '1'] = process.argv.slice(2)
const store = openBotSessionStore({ dir }), accepted = [], refused = []
for (let i = 0; i < Number(count); i++) {
  const messageId = `writer-${process.pid}-${i}`
  try { store.append('a', [{ role: 'user', content: messageId, messageId }]); accepted.push(messageId) }
  catch (error) { if (error.code !== 'BOT_SESSION_WRITE_BUSY') throw error; refused.push(messageId) }
}
process.stdout.write(JSON.stringify({ accepted, refused }))
