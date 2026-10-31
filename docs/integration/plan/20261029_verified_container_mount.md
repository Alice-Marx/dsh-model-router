# Verified container workspace mount

The real Docker/runc experiment rejected a direct `/proc/<pid>/fd/<n>` bind
source with EINVAL. Keep that failed experiment as evidence; do not advertise
this route as supported or silently retry a normal path without another gate.

Instead hold the selected Linux directory descriptor while creating/starting
the container. Derive its device, inode and nonzero birth generation from native
bigint stat, and a bounded actual ancestor identity snapshot for admission. A
trusted fixed PID1 receives that expected identity before any caller argv. It
must stat both its mounted `/workspace` and current directory and compare all
three fields before spawning the unprivileged child. A mismatched or unsupported
filesystem fails closed. The kernel bind mount then holds the verified directory
for the process lifetime, even if its host pathname is later renamed. Never
change ownership or permissions of an existing user project to make this pass.

Check the selected descriptor and current path/ancestor snapshot again before
Docker create/start. Scan the retained descriptor tree for protected data and
links. The supervisor identity gate closes the last path-replacement interval
between the Agent check and actual runtime bind. The Docker daemon, image and
host administrator remain trusted. This does not defend arbitrary host-root
mount manipulation or implement a Windows isolation boundary.

Persist the expected mount identity with the original container operation and
verify its immutable argv on observation. Existing rows gain a nullable column;
unknown older supervisor generations are not restarted or adopted as current.
No status/cancel path may create a replacement worker. A gate exit still reports
the original stopped process conservatively; no exit code alone proves that a
user program caused no effects.

Validate actual swaps after create and just before start, in both directions:
the replaced directory must never run its program, and swapping a live mount's
host path must not redirect the already started worker. Retain existing seven
Agent death checks. Model shell Task tools stay disabled until physical-root
admission, permissions and every native/Git path meet their remaining contracts.

The current integration admits `fs_write` and container-profile `shell_exec`
against the actual configured root, including its aliases and overlapping root
registrations. A configured parent may conservatively serialize its own child
operations; unrelated roots remain independent. Plain file reads take no lock.
Container profile worktree create/diff/integrate fail before native Git and are
omitted from its machine capability advertisement. Raw application-profile
native shell/Git remain explicit owner-managed compatibility operations; they
are not accepted as an isolated model Task backend, and the completed contract
must not be inferred for those entries from these component tests.

On startup, unresolved older mutating operations with no physical snapshot gain
a persistent recovery fence. New controlled writes fail closed until original
receipts prove those writers ended; reads/status remain available. A directory
cannot be guessed from the old input digest. No deadline or grant expiry clears
the fence. The normal component's unknown physical reservations continue to
exclude only their original roots.

File jobs are joined during graceful shutdown. Cancellation before the atomic
publication checks its signal and records confirmed stop/no applied target
write; cancellation racing an already completed publication retains its actual
digest and conservatively reports possibly applied effects. The file parent and
leaf paths still need a separate descriptor-based implementation on supported
platforms; do not equate a root admission identity with a pinned leaf rename.
