# Linux pinned-create validation checkpoint

The standalone `pinned-write.ts` component is not wired into `Agent`. Its first
real Ubuntu run had 24 passes and three failures: the returned link count was
observed before the private name was retired, and Linux reported `ENOTDIR`
rather than `ELOOP` for a symlink opened with `O_DIRECTORY|O_NOFOLLOW`.

The current draft already moves final result construction after private-name
retirement, verifies the published name has exactly one link and classifies the
refused component through `lstat` without following it. This checkpoint first
reruns the real Linux suite against those exact sources and preserves the
original failure record. Windows executes only the explicit unsupported-platform
case; all other Linux cases remain skipped there.

No product integration is implied by a passing standalone suite. Any later
`Agent` wiring must remain limited to brand-new files, preserve existing-target
refusal, E66 cancellation effects, stop provenance and workspace admission, and
add its own Host/product evidence. Existing-target hash CAS, external-writer
coordination, permissions/config generations and Windows descriptor publication
remain separate work.

There is no real model inference, user data write or release operation.
