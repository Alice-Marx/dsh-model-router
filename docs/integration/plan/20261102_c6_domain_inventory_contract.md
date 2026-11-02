# C6 independent captured-domain inventory contract

Status: bounded observation, not complete migration acceptance. The approved
master plan section 15 and C1-C10 remain the full acceptance boundary.

## Authority and scope

The operation's independently expected profile-plan, capture manifest, capture
journal row, ledger archive and layout digests remain authoritative. Observation
runs only after existing archive and operation-binding verification. Obligations
come from the captured configuration, never the caller's domain labels, selected
layout, or a completeness boolean.

The fixed DS Bot home, team state, secret-store location and memory directory
can be derived from the pinned plan. Other storage providers lack an independent
path-authority contract and remain unknown even if a plausible archive/layout
exists. Extra roots cannot discharge missing obligations. No live source reads,
credential reads, restore, external calls, activation or stop-write occur here.

## Required, absent and unknown

- Required is a fixed obligation, not caller selection. A missing Bot home or
  required team file is blocked, not a successful empty domain.
- Observed means a unique captured parent contains the derived location with
  its expected type. It proves captured membership, not live or semantic truth.
- Absent means an optional fixed location is missing inside a captured parent.
  It never means absent across the machine, at another epoch or in a missing root.
- Unknown means an unsupported provider or unverified configuration authority.
  Caller null, extra roots or successful unrelated audits cannot resolve it.

Team/secret layout references must match independently derived locations. Null
cannot hide an observed file. Memory selection must cover the derived subtree
once without importing unrelated paths. Decoys, ambiguous roots, invalid types
and missing selections stay diagnostics. None produces complete coverage.

## Epoch and persistence

There is no caller epoch or complete flag. The capture-relative descriptor
binds operation ID/digest, profile-plan, data/ledger manifest and ledger content,
capture journal row and layout/input digests from the existing owner binding.
The verifier regenerates the observation from reverified source archives and
compares the full closed result, not artifact-supplied hashes alone.

Capture epoch status is always unproven: serial data capture plus a consistent
single-ledger backup is not a simultaneous cross-domain stopped-writer epoch.
Complete, cross-domain/database consistency, apply, activation, post-activation
rollback, stop-write and restored permissions remain false.

Schema 2 persists the deterministic inventory observation. Schema 1 retains its
original verification semantics and exact public summary shape with no inventory
fields; old bytes are not rewritten or treated as new observation evidence.
Schema-two observations are mandatory, and version-mixed fields are refused.
Existing owner/ACL, bounded descriptor reads, identity, archive,
journal, operation and cold-resume protections remain in force.

## Verification and remaining gates

Negative coverage includes omitted required roots with matching caller domains,
extra/decoy roots, absent versus unknown, redirected layout, forged results and
stale/cross-operation capture/journal/layout. Existing archive byte/identity,
permission, partial artifact and actual crash/cold-resume tests must still pass.
Skipped platform cases remain skipped; no inferred ownership/ACL proof.

This slice is configuration-derived captured obligations only. SDK sessions,
attachments, workspace registry/data, usage, router/funding authority, remote
agents, CLI state and external connectors remain unknown until independent
provider contracts exist. Complete-domains automatic attestation and C1-C10
remain disabled. Full migration/platform/deployment/release acceptance stays open.
