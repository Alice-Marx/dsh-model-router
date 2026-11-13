# Attribution — packages/bot-engines

This module ports and adapts conversation-engine driver behavior from the upstream
**OpenMausBot** project (Apache License 2.0).

- Upstream repository: OpenMausBot (sibling checkout at `../../OpenMausBot`, read-only)
- Exact pinned source commit: `1bc4749aa8307d7d6998bf86de4ef6478460dd93`
- Upstream license: Apache-2.0, reproduced in full in `LICENSE-OpenMausBot` beside
  this notice from `LICENSE` in the upstream repository root at the pinned commit.
- Upstream license header convention: each upstream `server/drivers/*.ts` file carries the
  Apache-2.0 header; that license text governs the original code.

## Adapted files and upstream origins

| File in this module | Upstream origin (at pin `1bc4749a`) | What was adapted |
| --- | --- | --- |
| `src/claude-protocol.mjs` | `server/drivers/claude.ts` (frame handling, `claudeResultError`, `turnCostFromRunningTotal`, `claudeCostSnapshot`, `sumNativeTurnResults`, user-message wire shape) | Pure-protocol extraction; values kept semantically identical (running-total cost delta, per-turn usage in streaming-input sessions, error-result classification) |
| `src/claude-permission-broker.mjs` | `server/drivers/claude.ts` `createPermissionBroker` (newline-delimited JSON ask/answer protocol on a local socket, duplicate-id deny, post-close deny, timeout deny, fail-closed bind) | Re-grounded onto Node `net` named pipes / unix sockets under the engine's isolated home; identical wire protocol `{t:'ask'}` / `{t:'answer',behavior,message,source,always?}` |
| `src/claude-permission-proxy.mjs` | `server/drivers/claude.ts` + spawned `permission-proxy.ts` concept (`--permission-prompt-tool mcp__ogb__approve`) | Minimal MCP stdio `approve` tool that forwards to the broker pipe; referenced from the engine's `--mcp-config` |
| `src/claude-engine.mjs` | `server/drivers/claude.ts` (session flags `-p --output-format stream-json --input-format stream-json --verbose --include-partial-messages --permission-mode`, retained process, `result` frame settles a turn, `init` confirms `session_id`/model/permissionMode, `--resume`, error-result-before-init resume refusal, exit-before-result handling) | Re-grounded on this repository's seams: `nativeProcess(helper,'supervise',…)` launcher with Windows job-object tree-stop evidence, `createCliBootstrap` committed-grant tool bridge, `createAuthority` grant guard, `privateEnvironment` isolated home, pinned-entry digest check, Host-only funding lifecycle hooks |
| `src/driver-catalog.mjs` | `server/drivers/builtIn.ts` (`BUILT_IN_DRIVERS` list) and the per-driver source files cited in each entry | Closed catalog of the 26 upstream built-in drivers with per-driver evidence anchors; availability classification is new (target-side) |
| `src/codex-engine.mjs`, `src/pi-engine.mjs`, `src/muse-engine.mjs` | `server/drivers/codex.ts`, `server/drivers/pi.ts`, `server/drivers/muse-code.ts` and their protocol helpers | Native App Server, RPC and MSP wire shapes; target-owned retained process, exact model, cancellation and settlement boundaries |
| `src/cli-driver-specs.mjs`, `src/acp-chat-engine.mjs`, `src/cli-credentials.mjs` | Per-driver launch arguments and account locations cited in `src/driver-catalog.mjs`, plus `server/drivers/acp/*` | Fixed owner-selected launch shapes and account provisioning; explicit target-side availability and credential envelope restrictions |

## Non-adapted (target-original) code

Everything in this module that enforces target-repository policy — pinned executable
validation, grant-guard intervals, funding-hook single-ledger flow, stop-evidence
accounting, snapshot shapes, and all tests — is original to this repository and follows
this repository's conventions (`packages/cli-runtime/src/codex-session-core.mjs` as the
structural model).

Upstream code is referenced read-only; nothing in `modules/bot-runtime/vendor/ds-bot/` or
the upstream checkout is modified by this module.
