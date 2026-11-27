export function validateNamespace(value) {
  if (!value || typeof value !== 'object') throw new Error('宿主没有返回界面存储标识。')
  if (value.schemaVersion !== 1) throw new Error('宿主界面存储标识版本不被此客户端支持。')
  if (typeof value.hostId !== 'string' || !/^host-[0-9a-f]{16}$/.test(value.hostId)) throw new Error('宿主界面存储标识格式无效。')
  return value.hostId
}
