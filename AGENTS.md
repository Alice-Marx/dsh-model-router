# Release Synchronization

## Bot integration continuity

- The approved implementation plan is in `docs/integration/plan/20261026_master_plan.md`.
- Before integration work, read `docs/integration/PROGRESS.md` and run
  `npm run integration:status`. Track work packages in `docs/integration/tasks.json`;
  the frozen R/F/T catalog is `docs/integration/scope.json`.
- Record completed steps, remaining gates, evidence and the next action in the
  project before ending a work session. Run `npm run integration:check` after
  updating tracking data. Do not equate a passing probe with product acceptance.
- Keep test homes, upstream checkouts, real machine settings and credentials out
  of user DSH data and Git. Use isolated `tmp/integration/` directories.
- Preserve the approved full scope, frozen upstream baselines and GPT-only model
  invocation policy. Do not publish an incomplete integration as a stable release.

## Existing release requirements

- Update both README translations together. Render formulas with anchored GitHub
  `math` fences; keep currency dollar signs escaped. Run `npm run check:readme`
  and inspect the actual GitHub MathJax output after formula changes, including
  a narrow viewport. A matching hash or raw Markdown preview is not rendering
  validation. Refresh `README.i18n.yaml` only after reviewing both texts.
- Prefer single-line mathematical expressions with short symbols explained in
  prose. Avoid wrapping ordinary equations; keep line breaks for genuine
  piecewise definitions only.
- Render mathematical symbols in prose as inline math, including subscripts and
  Greek letters. Reserve inline code for actual API fields, commands and paths.
  Check complete explanatory paragraphs as well as display blocks on GitHub.
  Use GitHub's dollar-plus-backtick inline delimiters to avoid missed rendering
  next to Chinese punctuation or consecutive expressions.
- Write decimals with their leading zero (0.28, 0.04, 0.5); do not abbreviate
  them as .28, .04 or .5 in tables or prose.

- Synchronize releases only when the user requests an update. Do not create
  scheduled synchronization jobs.
- Compare this repository's package version with all stable npm versions of
  `@ljwei-stak/dsh-model-router` (renamed in 0.13.0; the old
  `@ljwei-stak/model-router-galgame` last version is 0.13.0, same content as the new package's 0.13.0, and it gets no further updates) using semantic version ordering. Never
  downgrade either side or assume the `latest` tag is the highest version.
- When npm is newer, recover the corresponding complete source checkout and
  verify its published files against the npm tarball before pushing GitHub.
  The npm package currently excludes client source, scripts, tests, and assets;
  importing the tarball alone is not a complete source synchronization.
- When GitHub is newer, run tests and verify the generated client, then publish
  that same version and verify the registry payload. Do not add features or bump
  the version solely to synchronize an existing release.
- Equal version numbers require equal package contents. npm versions cannot be
  overwritten; report conflicting contents instead of silently replacing them.
- Run `pnpm install --frozen-lockfile --strict-peer-dependencies` (pnpm 10 has
  no `pnpm peers check`), `npm test`, and `npm run check:client`. A skipped client build does not count as validation. The
  repository pins the DSH SDK needed to reproduce the client build.
- Keep the release's `v<version>` tag on its verified source commit. Never move
  an existing tag or force-push over concurrent work.
- Preserve all older npm versions, Git tags, and GitHub Releases. Publish new
  code changes under a new version; never unpublish or delete release history
  as part of synchronization.
- Create or update the published GitHub Release for that tag, with release
  notes and the verified npm tarball. A pushed tag alone is not a GitHub Release.
  Verify the public release page and its assets before reporting completion.
- Preserve published file bytes, including line endings, and verify the final
  GitHub checkout against npm after pushing.
