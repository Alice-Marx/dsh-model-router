/**
 * Pure x.y.z[-pre] ordering shared by the Host and the Desktop client.
 * No Node APIs: the client bundle imports this file.
 */
const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]{1,64})?$/

export function isReleaseVersion(value) {
  return typeof value === 'string' && VERSION.test(value)
}

/** Numeric comparison of x.y.z[-pre]; a prerelease sorts below its release. */
export function compareReleaseVersions(left, right) {
  const parse = value => {
    const match = VERSION.exec(String(value ?? ''))
    return match ? { parts: match.slice(1, 4).map(Number), pre: String(value).includes('-') } : null
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1
  }
  if (a.pre !== b.pre) return a.pre ? -1 : 1
  return 0
}

/** True when both versions parse and the installed copy is strictly older. */
export function versionStillOlder(installedVersion, latestVersion) {
  return compareReleaseVersions(installedVersion, latestVersion) === -1
}
