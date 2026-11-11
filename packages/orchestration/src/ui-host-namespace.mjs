import { randomBytes } from 'node:crypto'

/** Public UI storage identity, persisted by the Host; never an authentication credential. */
export function openUiHostNamespace({ Database, file }) {
  const db = new Database(file)
  let closed = false
  try {
    db.pragma('busy_timeout = 5000')
    db.pragma('synchronous = FULL')
    db.exec('CREATE TABLE IF NOT EXISTS product_ui_namespace (scope TEXT PRIMARY KEY, namespace TEXT NOT NULL)')
    db.prepare('INSERT OR IGNORE INTO product_ui_namespace(scope,namespace) VALUES(?,?)').run('owner', `host-${randomBytes(8).toString('hex')}`)
    const hostId = db.prepare('SELECT namespace FROM product_ui_namespace WHERE scope=?').get('owner')?.namespace
    if (!/^host-[a-f0-9]{16}$/.test(hostId ?? '')) throw Object.assign(new Error('宿主界面存储标识无效，请核对插件状态。'), { code: 'UI_NAMESPACE_INVALID' })
    return Object.freeze({
      read(payload = {}) {
        if (closed) throw Object.assign(new Error('宿主界面存储已关闭。'), { code: 'UI_NAMESPACE_CLOSED' })
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) throw Object.assign(new Error('无效的界面标识请求。'), { code: 'INVALID_UI_NAMESPACE_REQUEST' })
        return { schemaVersion: 1, hostId }
      },
      close() { if (!closed) { closed = true; db.close() } },
    })
  } catch (error) { db.close(); throw error }
}
