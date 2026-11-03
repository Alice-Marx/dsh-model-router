# C6 captured-profile provider selection: bounded private contract

## Authority and scope

This follow-on to E161 reads an owner-pinned captured configuration, not a live
profile or a running Host. It reparses the captured source texts using the fixed
SDK YAML dialect and recomposes the ordered source layers with the installed
`composeEntries`. Both the parsed layers and the saved `effectiveBefore` must
match. The target proposal is excluded: proposed configuration is not source
authority. No plugin, expression, launcher, service, provider or Host is started.

The installed rc.3 storage hub, attachment service and session persistence are
abstractions. Their package identities do not establish a concrete backend,
directory, object store, ownership, generation or consistent export epoch.
`storage-domain` selects a backend by `routes[domain] ?? backend`; a captured
static selector can be reported, but it does not resolve Cordis injection scopes
or prove which backend supplies a consumer. Workspace registry storage and the
workspace content directories are separate obligations.

## Private observation

- Owner-pinned complete profile-plan and capture-manifest digests are mandatory
  for archive reads. The archive is reverified before use. No original profile,
  selected source tree, environment variable or credential file is read.
- Each captured plugin declaration is retained as a private ordinal, ancestry,
  name/id, declared enabled state and configuration digest. Unknown plugins are
  not dropped: they may register additional providers or consumers.
- Disabled, inherited-disabled, dynamic-disabled, dynamic names/includes,
  configuration expressions and nonstandard scope options remain explicit.
  Expressions are AST data and are never evaluated. Inline launcher layers are
  owner-declared captured input, not independently observed launcher authority.
- Only exact `@deepseek-ai/dsh-storage-domain` declarations with static, valid
  backend/routes configuration may expose a configured workspace selector.
  This is `configured-selector-only`, never a resolved provider or storage root.
- Adding capture directories, receipt URLs, `complete` booleans, service names,
  provider-looking names or plausible path strings never proves authority.
- All sessions, attachments and workspace provider authorities remain unknown;
  `complete=false`, `providerPathAuthority=false`, `providerIdentityVerified=false`,
  `providerGenerationAvailable=false`, `captureEpochStatus=unproven` and all apply,
  activation, rollback and stop-write capabilities remain false.

## Compatibility and verification

This is a source-only private component, not an automatic attestation, public
tool, installed Host integration or package/release acceptance. Existing schema1
and schema2 domain artifacts and their summaries are not changed or rewritten.
The complete-domains automatic attestation remains unsupported.

Required isolated checks cover static route override/default, source-byte and
layer/effective-entry mismatch, omitted/extra backend-looking entries, disabled
ancestry, dynamic name/config/disabled, includes, inline launcher declarations,
scope options, reordered layers, stale owner bindings, missing provider config,
remote/path-looking settings and malicious expressions. An archive read must
still work after original fixture sources move, and fail on capture tampering or
wrong owner-pinned digests. No fixture success closes concrete provider, path,
ownership, generation, stopped-writer or cross-domain epoch gates.

Full C1-C10, migration/platform/performance/deployment/release acceptance stays
open. Formal 0/20, 44/63, M0 11/12, G1-G4 in_progress and T61 partial are unchanged.
