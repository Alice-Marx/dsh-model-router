const CONTENT_FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'nlink']

export function migrationImageMetadataMismatch(named, opened, after, again, platform = process.platform) {
  const observations = [['opened', opened], ['after-read', after], ['lstat-after-read', again]]
  for (const [observation, actual] of observations) {
    for (const field of CONTENT_FIELDS) {
      if (actual[field] !== named[field]) return { observation, field, baseline: named, actual }
    }
  }
  const ctimeBaseline = platform === 'win32' ? opened : named
  for (const [observation, actual] of observations.slice(1)) {
    if (actual.ctimeNs !== ctimeBaseline.ctimeNs) return { observation, field: 'ctimeNs', baseline: ctimeBaseline, actual }
  }
  return null
}

export function migrationImageCtimeRetry(error, platform = process.platform) {
  return platform === 'win32' && error?.code === 'MIGRATION_COMMIT_SOURCE_CHANGED' && error.diagnostic?.check === 'read-stable' && error.diagnostic.field === 'ctimeNs'
}
