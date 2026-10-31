# Agent integration of Linux pinned creation

The standalone pinned-create suite is green on Ubuntu. This checkpoint wires it
only into Linux `fs_write` with `expectedHash:null`. Existing-file hash overwrite
is refused on Linux with `OVERWRITE_UNSUPPORTED` until a separately verified
external-writer CAS and metadata contract exists. Windows retains its existing
path and is not claimed to gain descriptor semantics.

The same `WorkspacePin` used for physical admission is passed to the write. Its
real root is the pinned-create root. Before pin, before publish and after
publish, the Agent rechecks the grant, root identity and protected paths. The
second `Roots.assertPublicTree` is the final pre-publication policy check; an
after-publish refusal becomes `PINNED_WRITE_UNVERIFIED` and then Agent `unknown`.

Pre-publication `TARGET_EXISTS` maps to the existing public `FILE_CHANGED`
contract. Pre-publication cancellation explicitly carries
`possiblyApplied:false`. The first observation after `link()` uses the
post-publication guard, so every later error carries `published:true`.

Agent outcome mapping is deliberate: pre-publish cancellation is cancelled with
no target effects; post-publish cancellation is cancelled with conservative
effects and a shape-checked digest/size; other post-publish errors are unknown
with no stop proof and a retained lock. A naked result never creates Host
provenance. Existing-target overwrite remains disabled rather than falling back
to the old path.

New real Linux Agent fixtures cover exact new-file bytes/mode/link count,
existing-target refusal, root replacement, an external creator, after-publish
policy failure and after-publish cancellation. Existing workspace cancellation
barriers are adapted to the new `assertPublicTree` phases without weakening the
E66 assertions. Component and Agent suites enter root/CI; non-Linux runs only
the unsupported guard and explicit skips.

This does not solve external-writer CAS, mount/security-label confinement,
Windows handle-relative creation, cross-Agent coordination, permissions/config
generations or full OS isolation. No real model inference, user data write or
release operation is involved.
