# Linux pinned-write recheck after post-verification edits

The E64 checkpoint verified the standalone pinned-create suite (27/27) on
Ubuntu against git blobs recorded in
`evidence/20261030_pinned_write_validation.json`. After that verification —
and after the E66 handoff — the working tree received further edits that were
never re-verified on Linux:

1. `remote-computer-agent/src/pinned-write.ts` moved from verified blob
   `c9493a16…` to `c3587544…`. The delta adds `possiblyApplied:false` to the
   four pre-`link()` cancellation points and routes the first post-`link()`
   observation through the published guard, aligning the component with the
   E66 cancellation contract. Every touched throw site was re-traced by hand:
   all four sit before `link()`, so the published/post-publish classification
   is unchanged.
2. `remote-computer-agent/src/agent.ts` moved from the E66-final blob
   `31d5a70c…` to `33f1a6ec…`: the `WorkspacePin` now flows into `write()`, and
   the exception summary maps `published:true` failures to `unknown` with a
   shape-checked digest. This is the plumbing of the (not yet implemented)
   Agent wiring checkpoint; `pinnedCreateNewFile` is imported but unused. For
   the existing write path the classification is provably identical because no
   pre-wiring error carries `published`.

This checkpoint re-establishes the component evidence for the current blobs
before any further work builds on them:

- Local (Win11): the suite runs its unsupported-platform guard only
  (1 pass / 26 explicit skips); the combined E66 suite (67 tests) passes
  against the current `agent.ts`, proving the plumbing is behavior-neutral for
  the verified surface; the full root regression is re-run for the tree.
- Linux (Ubuntu fixture): the 5-file package (pinned-write.ts, protocol.ts,
  the test and its two fixtures) is copied over the existing verified fixture
  — dependencies are reused, `prepare` is not run, nothing else is touched —
  and `node --test tests/pinned-write.native.mjs` must pass 27/27 with the
  three historic-failure cases green before this checkpoint is complete.

Scope stays the E64 boundary: brand-new files only, every existing target
refused, no external-writer CAS, no overwrite, no Windows descriptor claims,
no Agent integration. The half-finished Agent wiring in `agent.ts` is left
exactly as found and remains gated on its own checkpoint
(`plan/20261030_pinned_write_agent.md`); a naked component pass does not
release it.

No real model inference, no user data writes, no commit, push or release.
