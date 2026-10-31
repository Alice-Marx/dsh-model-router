/**
 * Directory-descriptor-pinned creation of a brand-new file (Linux only).
 *
 * Why this exists: the product `fs_write` path in `agent.ts` validates a resolved
 * path and then re-checks the parent directory identity before a plain
 * `rename()`. That re-check is a *path based* observation, so it cannot prove
 * that an external directory replacement (rename, rmdir + mkdir, bind mount) or
 * an external writer did not swap the object between the check and the rename.
 *
 * What this component provides instead:
 *  - the parent directory is opened component-by-component with
 *    `O_DIRECTORY | O_NOFOLLOW` from a held descriptor, so the final access is
 *    bound to one directory inode instead of to a name;
 *  - every host-path observation is re-verified against the held descriptor
 *    (`/proc/<pid>/fd/<n>` realpath and `dev:ino`) immediately before publish and
 *    again after publish;
 *  - publication is `link()` inside the pinned directory, which is an atomic
 *    no-clobber name creation: an existing target (file, directory, symlink,
 *    fifo, device, hard link to a protected file) makes the whole write fail.
 *
 * What this component deliberately does NOT claim:
 *  - fd pinning binds us to an inode, not to a path, a mount or a security
 *    label. A concurrent process with enough privilege can still move the held
 *    directory (or place a mount over the host path) into or onto a protected
 *    location. The component cannot prevent that; it can only detect the
 *    resulting divergence and refuse, or report an unverified outcome.
 *  - the `check` callback is host policy, not a kernel guarantee. A callback
 *    that returns normally means the host approved what it could observe at
 *    that instant, nothing more.
 *  - strict hash CAS against an existing target is NOT solved. An existing
 *    target is always refused (fail closed); this component never overwrites.
 *  - `link()` is addressed through a path string, so the publish step keeps a
 *    small path-resolution window that fd pinning alone cannot close with
 *    Node's `fs` API (no `linkat(dirfd, ...)` is exposed). The window is bounded
 *    by the immediately preceding verification and observed afterwards.
 *  - `nlink` in the result is a single observation of the published name taken
 *    after the private temp name is retired. It is evidence, not an atomic
 *    compare-and-swap against external writers: a link created after that
 *    observation is not something the component can see or prevent.
 *  - durability is best effort: the temp file is fsynced before linking, the
 *    directory is fsynced after linking and again after the private name is
 *    retired, but a crash can still lose any of those steps, and a crash between
 *    `link()` and the temp unlink leaves one private temp name behind in the
 *    target directory. Nothing else is ever published by such a crash, and the
 *    component never removes names it does not own.
 *  - the reported `sha256` is the digest of the payload the component read back
 *    through its own descriptor and compared byte for byte with the request
 *    before returning. It is evidence about the bytes on disk at that moment, not
 *    a guarantee about any later write.
 *
 * The component creates files only. `Agent` uses it solely for Linux new-file
 * writes whose expectedHash is null; existing-target overwrite stays disabled.
 */
import { constants, type BigIntStats, type FileHandle } from 'node:fs'
import { open, lstat, stat, realpath, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { AgentError, sha } from './protocol.js'

/** Default and hard limits, mirroring the product `fs_write` content bound. */
export const PINNED_WRITE_MAX_BYTES = 1048576
export const PINNED_WRITE_MAX_LIMIT_BYTES = 16 * 1024 * 1024
export const PINNED_WRITE_MAX_PATH_BYTES = 4096
export const PINNED_WRITE_MAX_COMPONENTS = 64
export const PINNED_WRITE_MAX_COMPONENT_BYTES = 255
const PINNED_WRITE_TEMP_PREFIX = '.dsh-pinned-write-'
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0)
/**
 * The private temp file is opened read-write, not write-only, so the published
 * payload can be read back through this very descriptor and compared with what
 * was requested. It stays mode 0600 and is never exposed under a second name.
 */
const TEMP_FLAGS = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
const BIG = { bigint: true } as const

const failWrite = (code: string, status = 409, extra: Record<string, unknown> = {}): never => { throw Object.assign(new AgentError(code, status), extra) }
/**
 * Refusal raised once the target name exists. Such a failure must never read as
 * "nothing was written": the caller has to be able to tell that a file landed
 * and that the component could not certify the rest of the outcome.
 */
const failAfterPublish = (code: string, status = 409, extra: Record<string, unknown> = {}): never => { throw Object.assign(new AgentError(code, status), { published: true, possiblyApplied: true, ...extra }) }
/** Give an already-thrown refusal the same post-publication receipt. */
const annotatePublished = (e: unknown): unknown => e instanceof AgentError ? Object.assign(e, { published: true, possiblyApplied: true }) : e
/**
 * Retire our private temp name and report whether it is gone afterwards.
 *
 * A name that another writer already removed counts as gone, because the
 * directory is clean either way. A name that is still present does not: the
 * published target then keeps a second link and the directory keeps a private
 * entry this component failed to clean up, so the caller must not be told the
 * write finished cleanly.
 */
const retireTempName = async (pinned: PinnedDirectory, tempName: string): Promise<{ retired: boolean; fsCode: string }> => {
  let code = 'OK'
  try { await unlink(pinned.childPath(tempName)) } catch (e) { code = fsCode(e) }
  try { if ((await pinned.lstatChild(tempName)) === null) return { retired: true, fsCode: 'OK' } } catch (e) { code = fsCode(e) }
  return { retired: false, fsCode: code }
}
/** Turn an unexpected filesystem failure into a documented, fail-closed code. */
const guard = async <T>(work: () => Promise<T>, reason: string): Promise<T> => {
  try { return await work() } catch (e) { if (e instanceof AgentError) throw e; throw Object.assign(new AgentError('PINNED_WRITE_FAILED', 500), { reason, fsCode: fsCode(e), cause: e }) }
}
/** Same, for an observation taken after publication: the receipt is part of the answer. */
const publishedGuard = async <T>(work: () => Promise<T>, reason: string): Promise<T> => guard(work, reason).catch(e => { throw annotatePublished(e) })
const fsCode = (e: unknown): string => (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'UNKNOWN')
const identityOf = (s: { dev: bigint; ino: bigint }): PinnedIdentity => ({ dev: String(s.dev), ino: String(s.ino) })

/** True when this host can honour the descriptor-pinning contract. */
export function pinnedWriteSupported(platform: string = process.platform): boolean { return platform === 'linux' }

export type PinnedIdentity = { dev: string; ino: string }

/**
 * A held descriptor for one directory inode.
 *
 * All child access goes through `/proc/<pid>/fd/<n>/<name>`, so once the
 * descriptor is held the object we operate on is the inode we verified, not
 * whatever the host path happens to name later.
 */
export class PinnedDirectory {
  private constructor(private readonly handle: FileHandle, readonly hostPath: string) { }
  /**
   * Open `resolvedRoot` plus every `components` entry one at a time with
   * `O_DIRECTORY|O_NOFOLLOW`, so no intermediate component of the target path
   * can be a symlink or a non-directory. `resolvedRoot` must already be free of
   * symlinks (the caller resolves it once with `realpath`); resolving the whole
   * path here would silently follow a symlinked component instead of refusing.
   */
  static async pin(resolvedRoot: string, components: readonly string[] = []): Promise<PinnedDirectory> {
    if (!pinnedWriteSupported()) failWrite('PINNED_WRITE_UNSUPPORTED', 503, { platform: process.platform })
    if (typeof resolvedRoot !== 'string' || !resolvedRoot || resolvedRoot.includes('\0') || !path.posix.isAbsolute(resolvedRoot) || Buffer.byteLength(resolvedRoot) > PINNED_WRITE_MAX_PATH_BYTES) failWrite('INVALID_ARGUMENT', 400, { reason: 'pin-root' })
    for (const part of components) if (typeof part !== 'string' || !part || part.includes('\0') || part.includes('/') || part === '.' || part === '..' || Buffer.byteLength(part) > PINNED_WRITE_MAX_COMPONENT_BYTES) failWrite('INVALID_ARGUMENT', 400, { reason: 'pin-component' })
    const parts = [...resolvedRoot.split('/').filter(Boolean), ...components]
    let handle: FileHandle
    try { handle = await open('/', DIRECTORY_FLAGS) } catch (e) { throw await mapDirectoryError(e, '/', 'root') }
    for (const part of parts) {
      const child = `${descriptorPath(handle)}/${part}`
      let next: FileHandle
      try { next = await open(child, DIRECTORY_FLAGS) } catch (e) {
        // Classify while this descriptor is still open: the diagnostic reads the
        // refused entry through `/proc/<pid>/fd/<n>`, and a closed descriptor
        // number can already have been reused by an unrelated open file.
        let mapped: AgentError
        try { mapped = await mapDirectoryError(e, child, 'component') } finally { await handle.close().catch(() => { }) }
        throw mapped
      }
      await handle.close().catch(() => { })
      handle = next
    }
    return new PinnedDirectory(handle, path.posix.join(resolvedRoot, ...components))
  }
  get fd(): number { return this.handle.fd }
  /** Descriptor path of the held directory. */
  get fdPath(): string { return descriptorPath(this.handle) }
  /** Scan form of the descriptor path, mirroring `WorkspacePin.scanPath`. */
  get scanPath(): string { return `${this.fdPath}/` }
  /** Path of a child entry addressed through the held descriptor. */
  childPath(name: string): string { return `${this.fdPath}/${name}` }
  async identity(): Promise<PinnedIdentity> { return identityOf(await this.handle.stat(BIG)) }
  /** lstat a child through the descriptor; `null` when the name does not exist. */
  async lstatChild(name: string): Promise<BigIntStats | null> {
    try { return await lstat(this.childPath(name), BIG) } catch (e) { if (fsCode(e) === 'ENOENT') return null; throw await mapDirectoryError(e, this.childPath(name), 'child') }
  }
  /**
   * Re-observe the host path and require that it still denotes the held inode.
   * Detects rename, replacement, deletion and mount swaps of the directory.
   */
  async verifyHostPath(expectedHostPath: string): Promise<void> {
    const actual = await realpath(this.fdPath).catch(() => null)
    if (actual !== expectedHostPath) failWrite('DIRECTORY_CHANGED', 409, { reason: 'descriptor-path', expected: expectedHostPath, actual })
    const current = await stat(expectedHostPath, BIG).catch(() => null)
    if (!current) failWrite('DIRECTORY_CHANGED', 409, { reason: 'host-path-unreadable', expected: expectedHostPath })
    const pinned = await guard(() => this.identity(), 'descriptor-stat')
    if (pinned.dev !== String(current.dev) || pinned.ino !== String(current.ino)) failWrite('DIRECTORY_CHANGED', 409, { reason: 'descriptor-identity', expected: identityOf(current), actual: pinned })  }
  /** Best-effort durability of names created in this directory. */
  async sync(): Promise<void> { await this.handle.sync().catch(() => { }) }
  async close(): Promise<void> { await this.handle.close().catch(() => { }) }
}

const descriptorPath = (handle: FileHandle): string => `/proc/${process.pid}/fd/${handle.fd}`

async function mapDirectoryError(e: unknown, at: string, phase: string): Promise<AgentError> {
  const code = fsCode(e)
  if (code === 'ELOOP') return Object.assign(new AgentError('WORKSPACE_OUTSIDE_SCOPE', 403), { reason: 'symlink-component', at, phase })
  if (code === 'ENOTDIR') {
    // Linux answers `O_DIRECTORY|O_NOFOLLOW` on a symlink with ENOTDIR rather
    // than with ELOOP, and reports the same errno for a component that is
    // genuinely not a directory, so the open flags alone cannot separate an
    // escape attempt from a wrong-type component. Look at the entry the walk
    // refused; the refusal itself never depended on this observation, so a race
    // can only change the reported reason, never the outcome.
    const entry = await lstat(at, BIG).catch(() => null)
    if (entry?.isSymbolicLink()) return Object.assign(new AgentError('WORKSPACE_OUTSIDE_SCOPE', 403), { reason: 'symlink-component', at, phase, fsCode: code })
    return Object.assign(new AgentError('TARGET_PARENT_INVALID', 400), { reason: entry ? 'non-directory-component' : 'component-vanished', at, phase, fsCode: code })
  }
  if (code === 'ENOENT' || code === 'ENOTEMPTY') return Object.assign(new AgentError('TARGET_PARENT_INVALID', 400), { reason: 'missing-component', at, phase })
  if (code === 'EACCES' || code === 'EPERM') return Object.assign(new AgentError('PINNED_WRITE_FAILED', 500), { reason: 'permission', at, phase, fsCode: code })
  return Object.assign(new AgentError('PINNED_WRITE_FAILED', 500), { reason: 'directory-open', at, phase, fsCode: code })
}

/** Resolve the configured root once; the descriptor walk then sees no symlinks. */
async function resolveRoot(rootPath: unknown): Promise<string> {
  if (typeof rootPath !== 'string' || !rootPath || rootPath.includes('\0') || !path.posix.isAbsolute(rootPath) || Buffer.byteLength(rootPath) > PINNED_WRITE_MAX_PATH_BYTES) failWrite('INVALID_ARGUMENT', 400, { reason: 'root-path' })
  try { return await realpath(rootPath) } catch (e) {
    const code = fsCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') failWrite('TARGET_PARENT_INVALID', 400, { reason: 'root-missing', fsCode: code })
    if (code === 'ELOOP') failWrite('WORKSPACE_OUTSIDE_SCOPE', 403, { reason: 'root-symlink', fsCode: code })
    failWrite('PINNED_WRITE_FAILED', 500, { reason: 'root-unreadable', fsCode: code })
  }
}

/** Split and bound a root-relative target path; the last component is the name. */
function splitComponents(relativePath: unknown): string[] {
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || Buffer.byteLength(relativePath) > PINNED_WRITE_MAX_PATH_BYTES) failWrite('INVALID_ARGUMENT', 400, { reason: 'relative-path' })
  if (path.posix.isAbsolute(relativePath)) failWrite('WORKSPACE_OUTSIDE_SCOPE', 403, { reason: 'absolute-relative-path' })
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  if (!parts.length || parts.length > PINNED_WRITE_MAX_COMPONENTS) failWrite('INVALID_ARGUMENT', 400, { reason: 'component-count', count: parts.length })
  for (const part of parts) {
    if (part === '.' || part === '..') failWrite('WORKSPACE_OUTSIDE_SCOPE', 403, { reason: 'dot-component', component: part })
    if (Buffer.byteLength(part) > PINNED_WRITE_MAX_COMPONENT_BYTES) failWrite('INVALID_ARGUMENT', 400, { reason: 'component-too-long' })
    if (/[. ]$/.test(part)) failWrite('INVALID_ARGUMENT', 400, { reason: 'component-suffix' })
    if (/[\u0000-\u001f\u007f]/.test(part)) failWrite('INVALID_ARGUMENT', 400, { reason: 'component-control' })
  }
  return parts
}

function toBuffer(content: unknown, encoding: unknown): Buffer {
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') failWrite('INVALID_ARGUMENT', 400, { reason: 'encoding' })
  if (typeof content === 'string') {
    if (encoding === 'base64') {
      const compact = content.replace(/\s+/g, '')
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) failWrite('INVALID_ARGUMENT', 400, { reason: 'base64' })
      return Buffer.from(compact, 'base64')
    }
    return Buffer.from(content, 'utf8')
  }
  if (content instanceof Uint8Array) {
    try { return Buffer.from(content.buffer, content.byteOffset, content.byteLength) } catch { failWrite('INVALID_ARGUMENT', 400, { reason: 'content-buffer' }) }
  }
  failWrite('INVALID_ARGUMENT', 400, { reason: 'content-type' })
}

async function writeAll(handle: FileHandle, data: Buffer, signal?: AbortSignal): Promise<void> {
  let offset = 0
  while (offset < data.byteLength) {
    if (signal?.aborted) failWrite('WRITE_CANCELLED', 409, { reason: 'during-write', possiblyApplied: false })
    const written = await guard(() => handle.write(data, offset, data.byteLength - offset), 'temp-write')
    if (!written.bytesWritten) failWrite('PINNED_WRITE_FAILED', 500, { reason: 'short-write', offset })
    offset += written.bytesWritten
  }
}

export type PinnedWritePhase = 'before-pin' | 'before-publish' | 'after-publish'
export type PinnedWriteCheckReport = {
  /** Which decision point this report belongs to. */
  phase: PinnedWritePhase
  /** Real root directory the target must stay inside. */
  rootPath: string
  /** Real parent directory of the target. */
  directoryPath: string
  /**
   * Identity of the parent directory: observed on the host path at admission,
   * and taken from the held descriptor from `before-publish` onwards, so a
   * replacement between admission and the pin is visible to the caller.
   */
  directory: PinnedIdentity
  /** Intended target path (may not exist yet). */
  targetPath: string
  targetName: string
  size: number
  sha256: string
  /** Present at `before-publish` only: our own private temp file, retired before the write returns. */
  temp?: { name: string; identity: PinnedIdentity; mode: number; size: number }
}
/**
 * Host policy hook. Throwing aborts the write; the thrown error is propagated
 * unchanged (except after publication, see `pinnedCreateNewFile`). It is a
 * policy decision about what the host could observe, never a kernel guarantee.
 */
export type PinnedWriteCheck = (report: PinnedWriteCheckReport) => void | Promise<void>

export type PinnedWriteRequest = {
  /** Configured root directory; resolved with `realpath` before pinning. */
  rootPath: string
  /** Root-relative path of the file to create; it must not exist yet. */
  relativePath: string
  content: string | Uint8Array
  encoding?: 'utf8' | 'base64'
  maxBytes?: number
  signal?: AbortSignal
  check?: PinnedWriteCheck
}

export type PinnedWriteResult = {
  path: string
  directoryPath: string
  /** Identity of the directory the write was published through, from the held descriptor. */
  directory: PinnedIdentity
  dev: string
  ino: string
  /** Links on the published name, observed after the private temp name was retired. */
  nlink: number
  size: number
  sha256: string
}

/**
 * Create `relativePath` inside `rootPath` as a brand-new regular file.
 *
 * Refuses (fail closed, nothing published) when the target already exists, when
 * the directory identity diverges from the host path, when the caller cancels
 * before publication, or when the host `check` vetoes any phase.
 *
 * A refusal discovered after the target name exists carries
 * `published: true` and `possiblyApplied: true`, because by then the file is on
 * disk and the caller must not read the error as "nothing was written".
 */
export async function pinnedCreateNewFile(request: PinnedWriteRequest): Promise<PinnedWriteResult> {
  if (!request || typeof request !== 'object') failWrite('INVALID_ARGUMENT', 400, { reason: 'request' })
  const { rootPath, relativePath, content, encoding, maxBytes = PINNED_WRITE_MAX_BYTES, signal, check } = request
  if (!pinnedWriteSupported()) failWrite('PINNED_WRITE_UNSUPPORTED', 503, { platform: process.platform })
  if (check !== undefined && typeof check !== 'function') failWrite('INVALID_ARGUMENT', 400, { reason: 'check' })
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > PINNED_WRITE_MAX_LIMIT_BYTES) failWrite('INVALID_ARGUMENT', 400, { reason: 'max-bytes' })
  const data = toBuffer(content, encoding)
  if (data.byteLength > maxBytes) failWrite('INVALID_ARGUMENT', 400, { reason: 'content-too-large', limit: maxBytes })
  const digest = sha(data)
  const components = splitComponents(relativePath)
  const root = await resolveRoot(rootPath)
  const targetName = components[components.length - 1]!
  const directoryPath = path.posix.join(root, ...components.slice(0, -1))
  const targetPath = path.posix.join(directoryPath, targetName)
  // lstat, not stat: a symlinked parent has to be refused as an escape attempt
  // instead of being followed into whatever it points at, so the admission
  // report never claims an identity for a directory we did not verify. The
  // descriptor walk below re-checks every component with `O_NOFOLLOW`; this only
  // keeps the reported reason and the `check` report honest.
  const observed = await lstat(directoryPath, BIG).catch(e => {
    const code = fsCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') failWrite('TARGET_PARENT_INVALID', 400, { reason: 'parent-missing', at: directoryPath })
    if (code === 'ELOOP') failWrite('WORKSPACE_OUTSIDE_SCOPE', 403, { reason: 'parent-symlink', at: directoryPath })
    failWrite('PINNED_WRITE_FAILED', 500, { reason: 'parent-unreadable', at: directoryPath, fsCode: code })
  })
  if (observed.isSymbolicLink()) failWrite('WORKSPACE_OUTSIDE_SCOPE', 403, { reason: 'parent-symlink', at: directoryPath })
  if (!observed.isDirectory()) failWrite('TARGET_PARENT_INVALID', 400, { reason: 'parent-not-directory', at: directoryPath })
  const report = (phase: PinnedWritePhase, temp?: PinnedWriteCheckReport['temp']): PinnedWriteCheckReport => ({ phase, rootPath: root, directoryPath, directory: identityOf(observed), targetPath, targetName, size: data.byteLength, sha256: digest, ...(temp ? { temp } : {}) })
  if (signal?.aborted) failWrite('WRITE_CANCELLED', 409, { reason: 'before-pin', possiblyApplied: false })
  if (check) await check(report('before-pin'))
  // Pin the real parent directory: the root plus every intermediate component of
  // the relative path, so no symlink or non-directory can hide in between.
  const pinned = await PinnedDirectory.pin(root, components.slice(0, -1))
  let tempName = ''
  let held: FileHandle | undefined
  let tempRetired = false
  try {
    await pinned.verifyHostPath(directoryPath)
    if (await pinned.lstatChild(targetName)) failWrite('TARGET_EXISTS', 409, { target: targetPath })
    tempName = `${PINNED_WRITE_TEMP_PREFIX}${randomBytes(16).toString('hex')}`
    const temp = await open(pinned.childPath(tempName), TEMP_FLAGS, 0o600).catch(e => {
      const code = fsCode(e)
      if (code === 'EEXIST') failWrite('PINNED_WRITE_FAILED', 500, { reason: 'temp-name-collision' })
      if (code === 'EACCES' || code === 'EPERM') failWrite('PINNED_WRITE_FAILED', 500, { reason: 'temp-permission', fsCode: code })
      failWrite('PINNED_WRITE_FAILED', 500, { reason: 'temp-create', fsCode: code })
    })
    held = temp
    // The umask may strip owner bits, so make the private mode deterministic.
    await temp.chmod(0o600).catch(e => failWrite('PINNED_WRITE_FAILED', 500, { reason: 'temp-chmod', fsCode: fsCode(e) }))
    let created: BigIntStats
    await writeAll(temp, data, signal)
    await temp.sync().catch(() => { })
    // Our own temp file must stay a private, unlinked, exact-size regular file.
    const verifyTemp = async (label: string): Promise<BigIntStats> => {
      const current = await guard(() => temp.stat(BIG), 'temp-stat')
      if (!current.isFile()) failWrite('PINNED_WRITE_TAMPERED', 409, { reason: 'temp-not-regular', label })
      if (current.size !== BigInt(data.byteLength)) failWrite('PINNED_WRITE_TAMPERED', 409, { reason: 'temp-size', label, size: String(current.size) })
      if ((Number(current.mode) & 0o777) !== 0o600) failWrite('PINNED_WRITE_TAMPERED', 409, { reason: 'temp-mode', label, mode: Number(current.mode) & 0o777 })
      if (current.nlink !== 1n) failWrite('PINNED_WRITE_TAMPERED', 409, { reason: 'temp-linked', label, nlink: Number(current.nlink) })
      return current
    }
    created = await verifyTemp('written')
    if (signal?.aborted) failWrite('WRITE_CANCELLED', 409, { reason: 'before-publish', possiblyApplied: false })
    if (check) await check(report('before-publish', { name: tempName, identity: identityOf(created), mode: Number(created.mode) & 0o777, size: Number(created.size) }))
    created = await verifyTemp('pre-publish')
    // The host may have been unable to observe anything between the previous
    // line and the link below, so re-verify both halves of the pin here.
    await pinned.verifyHostPath(directoryPath)
    if (await pinned.lstatChild(targetName)) failWrite('TARGET_EXISTS', 409, { target: targetPath })
    if (signal?.aborted) failWrite('WRITE_CANCELLED', 409, { reason: 'before-link', possiblyApplied: false })
    await link(pinned.childPath(tempName), pinned.childPath(targetName)).catch(e => {
      const code = fsCode(e)
      if (code === 'EEXIST') failWrite('TARGET_EXISTS', 409, { target: targetPath })
      if (code === 'EXDEV') failWrite('PINNED_WRITE_FAILED', 500, { reason: 'cross-device', fsCode: code })
      if (code === 'EACCES' || code === 'EPERM') failWrite('PINNED_WRITE_FAILED', 500, { reason: 'publish-permission', fsCode: code })
      failWrite('PINNED_WRITE_FAILED', 500, { reason: 'publish', fsCode: code })
    })
    const published = await publishedGuard(() => pinned.lstatChild(targetName), 'published-initial-stat')
    if (!published || !published.isFile() || String(published.dev) !== String(created.dev) || String(published.ino) !== String(created.ino)) failAfterPublish('PINNED_WRITE_TAMPERED', 409, { reason: 'published-mismatch' })
    if (signal?.aborted) failAfterPublish('WRITE_CANCELLED', 409, { reason: 'after-publish', result: { path: targetPath, size: data.byteLength, sha256: digest } })
    await pinned.sync()
    // `link()` leaves the payload under two names for a moment. The result has
    // to describe the directory as it is once this call is finished, so retire
    // the private name first, make that retirement durable, and observe the
    // published name again instead of reporting the intermediate link count.
    const retired = await retireTempName(pinned, tempName)
    if (!retired.retired) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'temp-cleanup-failed', temp: tempName, fsCode: retired.fsCode })
    tempRetired = true
    await pinned.sync()
    /**
     * The published name must still be the private regular file we linked: one
     * link, the exact size, the exact mode, and the inode we wrote.
     */
    const verifyPublished = async (label: string, expected: { dev: string; ino: string }): Promise<BigIntStats> => {
      const current = await publishedGuard(() => pinned.lstatChild(targetName), 'published-stat')
      if (!current || !current.isFile() || String(current.dev) !== expected.dev || String(current.ino) !== expected.ino) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'published-replaced', label, target: targetPath })
      if (current.size !== BigInt(data.byteLength)) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'published-size', label, target: targetPath })
      if ((Number(current.mode) & 0o777) !== 0o600) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'published-mode', label, target: targetPath })
      // A second link means a foreign writer reached our private payload, so the
      // published file no longer has the one-link shape this component promises.
      if (current.nlink !== 1n) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'published-extra-links', label, target: targetPath, nlink: Number(current.nlink) })
      return current
    }
    const final = await verifyPublished('after-cleanup', { dev: String(published.dev), ino: String(published.ino) })
    // The reported digest is evidence about the bytes on disk, not a claim about
    // the buffer we were handed, so read the published payload back through the
    // descriptor we wrote it with and compare it with what was requested. The
    // descriptor still denotes the published inode: retiring the private name
    // removed a link, not the object.
    let offset = 0
    while (offset < data.byteLength) {
      const want = Math.min(65536, data.byteLength - offset)
      const chunk = Buffer.allocUnsafe(want)
      const read = await publishedGuard(() => temp.read(chunk, 0, want, offset), 'published-read')
      if (read.bytesRead !== want) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'published-short-read', offset, expected: want, read: read.bytesRead })
      if (chunk.compare(data.subarray(offset, offset + want)) !== 0) failAfterPublish('PINNED_WRITE_UNVERIFIED', 409, { reason: 'published-content', offset })
      offset += want
    }
    if (signal?.aborted) failAfterPublish('WRITE_CANCELLED', 409, { reason: 'after-publish', result: { path: targetPath, size: data.byteLength, sha256: digest } })
    const settled = await verifyPublished('after-read-back', { dev: String(final.dev), ino: String(final.ino) })
    // The directory identity comes from the descriptor we wrote through, never
    // from the admission observation: a replacement between admission and the
    // pin would otherwise be reported as the directory that is not on disk.
    const directory = await publishedGuard(() => pinned.identity(), 'published-directory')
    const result: PinnedWriteResult = { path: targetPath, directoryPath, directory, dev: String(settled.dev), ino: String(settled.ino), nlink: Number(settled.nlink), size: Number(settled.size), sha256: digest }
    // A divergence here means the name we created is no longer the name the
    // host asked for; the caller must treat the outcome as unknown.
    try { await pinned.verifyHostPath(directoryPath) } catch (e) { throw annotatePublished(e) }
    if (check) {
      const afterPublish = { ...report('after-publish'), directory }
      try { await check(afterPublish) } catch (e) {
        throw Object.assign(new AgentError('PINNED_WRITE_UNVERIFIED', 409), { possiblyApplied: true, published: true, cause: e })
      }
    }
    return result
  } finally {
    // Every path that did not already retire the private name gets one more
    // best-effort attempt: a leftover name is a workspace leak, but it must never
    // mask the real reason this write failed.
    if (tempName && !tempRetired) await unlink(pinned.childPath(tempName)).catch(() => { })
    await held?.close().catch(() => { })
    await pinned.close()
  }
}
