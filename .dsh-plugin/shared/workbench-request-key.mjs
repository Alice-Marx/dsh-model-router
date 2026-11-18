const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function workbenchRequestKey(value) {
  if (typeof value !== 'string' || !KEY.test(value)) throw new TypeError('requestKey must be a UUID v4')
  return value
}
