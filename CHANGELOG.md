# Changelog

## 0.25.3 — 2026-10-26

- Add npm installation for ZCode CLI via the fixed `@ljwei-stak/zcode-cli@latest` package. Keep GitHub Release as the default alternative; the selected method controls detection, install/update/repair/uninstall, directory and download source.
- Keep npm and GitHub latest-version lookups, cached results and concurrent requests separate. Health checks use one captured settings snapshot for probing and version lookup.
- Resolve the selected npm package to its verified runtime for TUI, login and managed tasks. Verify npm metadata, the embedded archive and actual runtime files; prepare a bounded runtime cache when install scripts are disabled, without an extra GitHub download or fallback to another installation.

Validation evidence and limits are tracked in the [0.25.3 acceptance report](docs/releases/0.25.3-validation.md).

## 0.25.2 — 2026-10-26

- Replace the Windows desktop-bundled ZCode entry with the standalone [Alice-Marx/zcode-cli](https://github.com/Alice-Marx/zcode-cli) distribution. The tool keeps its `zcode` route identity and now uses the common install directory and install/update/repair/uninstall controls.
- Download the complete runtime from fixed GitHub Release assets, verify SHA256 before extraction, and check installed files before discovery or execution. Removal targets only the plugin-owned runtime; existing desktop installations, settings and sessions are preserved.
- Accept normal Windows short-path aliases while rejecting actual linked installation ancestors; bind installation and removal to canonical directories.
- Launch TUI, login and managed execution through `bin/zcode.mjs` with Node 24.14.0 or a newer Node 24. Add `zcode login` / `zcode login bigmodel` guidance and retain the CLI's configured default model. Identify this distribution as a community extraction, not an official Z.AI release.

Validation evidence and limits are tracked in the [0.25.2 acceptance report](docs/releases/0.25.2-validation.md).

## 0.25.1 — 2026-10-24

- Add DeepSeek Harness Desktop 0.2.1-rc.3 to the exact Host peer range while retaining the existing 0.2.0-rc.1, 0.2.0-rc.2 and 0.2.1-rc.2 declarations.
- Pin the published 0.2.1-rc.3 SDK dependency graph for source installation and regenerate the Desktop client against that SDK. Compatibility validation covers the plugin's Host/client contracts in addition to the version declarations.
- Refresh current installation examples and workbench documentation for 0.25.1. Existing API monetary budgets, independent subscription usage, progress/cancellation and schema v3 state remain in place.

Validation evidence and limits are tracked in the [0.25.1 acceptance report](docs/releases/0.25.1-validation.md). Offline SDK/build tests do not establish installed-Desktop operation or real vendor inference; earlier execution evidence retains its original version and date.

## 0.25.0 — 2026-10-24

- Separate API financial accounting from subscription usage. API costs and API reservations govern monetary budgets; subscriptions track calls and reported input/output/cache tokens, with incomplete or missing usage retained as unknown.
- Keep confirmed subscription execution independent of exhausted API budgets or missing API prices. Before an actual API call or subscription-to-API fallback, estimate the actual API route and acquire the applicable confirmation and atomic reservation. A CLI using an API key remains API-billed.
- Preserve subscription-attempt receipts alongside API fallback results and retain both ledgers across retry replacement and history trimming. Old reference-dollar fields remain readable without converting them into current subscription money or fabricated token counts.
- Show API money and subscription quantities separately in the workbench, execution preview and history. Subscription tokens do not imply vendor allowance, remaining quota or percentage. Additional API quality/review calls still incur API charges.
- Upgrade persistent state to schema v3 while migrating readable v1/v2 histories and protected execution state. Fully stop all Hosts before updating and keep state backups before downgrading.

Final validation and release evidence are tracked in the [0.25.0 acceptance report](docs/releases/0.25.0-validation.md). No new real vendor inference or installed-DSH end-to-end claim is made by these changes.

## 0.24.0 — 2026-10-24

- Reserve remaining execution estimates in shared persistent state before admission. Daily/monthly checks account for recorded API spending plus other active or interrupted reservations, preventing concurrent tasks from independently admitting the same estimated capacity. Unknown estimates or unresolved costs under a finite budget require explicit confirmation.
- Save mandatory package checkpoints before external calls and after receipts, with actual usage replacing the completed estimate before another paid step. Apply the lifecycle to routed runs, retries/reassignment, official teams, single-tool runs and consultations; optional review and quality-upgrade calls reserve extra capacity first. Checkpoint failures stop later calls and retain evidence.
- Recheck fresh actual spending and remaining reservations before each later paid call. Earlier costs above estimate or unresolved under a finite budget stop downstream calls; after worker cleanup, a budget stop retains completed receipts and releases unused holds. Subscription-to-API fallback re-estimates the actual route and rejects missing-price or over-budget calls. Save the first receipt and pending extra attempt before a quality upgrade starts.
- Preserve interrupted reservations and unknown usage when an execution owner is confirmed dead. Protect referenced run records from trimming, block rerun/reassignment while a hold exists, and distinguish actual spending from reserved estimates in the UI. No automatic replay, time-based hold expiry or manual reconciliation/release control is added.
- Upgrade state schema from v1 to v2 while preserving the ledger. Older plugin versions reject v2 state, so fully stop all Host processes before updating and back up state before a downgrade.
- Add Windows/Linux Node 24 CI for strict frozen dependency installation, the complete test suite, committed and rebuilt client consistency, offline preview compilation, and npm archive verification against raw Git blobs and the runtime import closure.

Validation evidence and pending release checks are tracked in the [0.24.0 acceptance report](docs/releases/0.24.0-validation.md). No new real provider or vendor CLI inference is claimed. Budget reservations are local estimates, not a provider billing cap; interrupted fees must be reconciled before their capacity can safely be reused.
- Preserve observed receipt timestamps across checkpoints; handle Windows lock contention and declared-platform PATH/ZCode paths, with canonical temporary-path and explicit adapter-capability CI fixtures.


## 0.23.1 — 2026-10-23

- Check retry budgets against the target and every unfinished downstream package that will execute. Reassignment uses the selected route estimate; successful downstream packages are excluded and unknown prices remain unknown.
- Bound workbench preview, progress and cancel requests to 15 seconds, abort stalled transport waits, retry progress against the same job and allow an unacknowledged cancellation to be retried. Never automatically replay task starts.
- Preserve late-response fences and clear request lifetimes on panel close. Add offline Host budget, real SDK cancellation transport and hung-request UI regressions.


## 0.23.0 — 2026-10-23

- Return an observable Host job when a workbench execution starts. Show elapsed time, the current work package and per-package states, with status reads and cancellation through the typed desktop gateway.
- Propagate cancellation to API streams and official CLI teams, wait for execution cleanup, retain completed results and reported usage, and prevent cancelled editable worktrees from starting integration. Closing the panel does not cancel execution.
- Keep preview and permission checks before job acceptance, preserve legacy synchronous execution helpers, and cover job lifecycles, gateway boundaries, cancellation accounting and UI races with offline fixtures.

- Preserve the incomplete-history budget marker when a corrupt-state recovery fails before a later read or write commits its pending notice, so missing charge history cannot become a zero-spend assumption.

## 0.22.2 — 2026-10-19

- Render the README's mathematical symbols and expressions in running prose as inline math in both languages, while retaining code formatting for actual API fields. Keep ordinary display equations on one line.
- Write the routing weights, quality floors and other decimal values with a leading zero throughout both READMEs, without changing their values.
- Extend the README checks to inline formula pairing, mathematical symbols accidentally formatted as code, and omitted decimal zeros. Actual-page acceptance covers complete explanatory paragraphs and the weight table in addition to display formulas.

## 0.22.1 — 2026-10-19

- Render the English and Chinese README accounting, planning, latency and assignment formulas with GitHub math fences instead of plain text code blocks. Keep ordinary equations on one line using short symbols explained in prose; reserve line breaks for the latency function's conditions. Escape currency dollar signs and document the historical P90 latency branch already used by the router.
- Guard all six paired formulas and translation hashes with `npm run check:readme`, the full test command, `prepack`, and a focused GitHub Actions workflow. Reject ordinary code fences, missing formulas, mismatched translations and ambiguous dollar signs.
- Require actual GitHub rendering and a narrow viewport check when changing README formulas. Routing and execution behavior are unchanged.

## 0.22.0 — 2026-10-19

- Add an explicit algorithm/manual assignment choice after task decomposition. Manually select an exact model API or registered official tool for every package, retain the original recommendation and dependencies, restore recommendations, and invalidate stale execution previews after edits.
- Validate the entire assignment before the first paid request, recompute per-package API estimates, check tool readiness, and execute the prepared plan. Manual APIs use adapter-default effort and stay pinned through budget checks and JSON validation; manual tools use their own default model and never silently fall back to API. Mixed execution is read-only; editable official teams retain their existing isolated-worktree lifecycle.
- Persist manual intent and original recommendations with actual channels, model evidence and costs. Retries retain selected targets, preserve completed upstream results even when their model leaves the catalog, and revalidate image capabilities after reassignment.
- Import explicit objective training evidence for task-related quality estimates and compare model/effort actions only with enough matching evidence. Learn empirical P90 token and duration resources from complete successful records, retaining conservative cold-start and missing-price fallbacks.
- Improve bounded DAG assignment search using future dependency boundaries, safe prefix dominance and optimistic handoff ranking. Beam search remains approximate, and synthetic/oracle tests do not establish production answer-quality or cost gains.
- Carry exact supported API effort IDs into execution, distinguish requested controls from unverified backend effort, and prevent cross-model effort leakage. Optional JSON-structure validation and one API upgrade default to off and respect subscription and budget restrictions.
- Retain earlier paid attempts when an upgrade fails or never starts; preserve unknown spending separately. Fix short dependency answers being replaced by truncation markers while keeping the total UTF-8 prompt limit.

Validation: 966 automated tests, 963 passed and 3 platform-dependent skips; 12 real Chromium interactions against offline UI fixtures passed. Frozen pnpm installation, client build/check and package verification passed. No new real provider or vendor CLI model calls were made. An existing Windows multi-process lock test had one transient EPERM during development; isolated rechecks and the final full suite passed, without a lock implementation change. See [release acceptance and limits](docs/releases/0.22.0-validation.md).

Fully quit Harness, including its tray and Host background processes, update the plugin to 0.22.0, and restart.

## 0.21.1 — 2026-10-18

- Honor Hermes custom program directories on Windows and POSIX through the official `-InstallDir` / `--dir` parameter. Place the checkout in the shared root's `hermes-agent` child and bind probes and terminals to its source-local `.hermes/bin` launcher; an old global command cannot satisfy a missing selected installation.
- Retain existing Hermes configuration, login and history locations. Keep vendor-default discovery when the shared root is empty, preserve old source trees and explain the separate program/data locations. Installation does not migrate user data; the official installer may refresh its global convenience command.
- Move the official-tools interactive terminal above onboarding and tool maintenance, preserving the existing component and tab/session lifecycle.
- Add offline directory, installer-argument and selected-entry regressions. Vendor installation and model calls are not part of this release's acceptance.

## 0.21.0 — 2026-10-18

- Added support for Hermes Agent (NousResearch source installer): includes native Windows PowerShell and POSIX Bash non-interactive flags, vendor-specific launcher and data paths, `hermes auth` authentication flow, and manual uninstall via `hermes uninstall`.
- Added support for Pi coding agent (official `@earendil-works/pi-coding-agent` npm package): supports installation via npm/pnpm with `--ignore-scripts`, requires Node >=22.19.0, and uses `pi` followed by `/login` for credential setup. Discovery, version checks, install/update/repair, and interactive terminal functionality are integrated for both new tools; login status is unknown without credential reads, and no verified managed restricted execution is available for either tool.
- Updated OpenCode dependency from legacy V1 `opencode-ai` to official V2 `@opencode/cli`; legacy V1 scripts are clearly labeled as OpenCode 1, and existing V2 databases are preserved for compatibility.
- Added official GitHub release lookup for Hermes and official npm version lookup for Pi. Installation and login checks remain separate from managed execution readiness.

Automated validation: 844 tests, 841 passed, 3 conditional skips, no failures; strict frozen pnpm install and real client build/check passed. UI checks used mock fixtures. Hermes/Pi installation, authentication and model execution were not performed.

To upgrade, fully quit Harness including its tray icon and Host background process, update the dsh-model-router plugin, then restart Harness.

## 0.20.2 — 2026-10-17

- Add explicit compatibility with official DeepSeek Harness Desktop 0.2.1-rc.2, retaining the two supported 0.2.0 release candidates. Older router versions are rejected by the updated Host before plugin code loads. No exact-version exemption or Host modification is needed.
- Pin development dependencies to the updated official SDK and cover the new compatibility gate's structured `requirements` result. Keep rejection checks for unverified versions and add the packaged client loader test to the standard test command.
- Retain the existing plugin id, saved configuration and run ledger. This compatibility patch adds no vendor model calls or new execution-quality claims.

## 0.20.1 — 2026-10-16

- Expand the English and Simplified Chinese READMEs together: architecture and execution contracts, workbench/session request examples, platform capabilities and executable trust, sequential team lifecycle, model identity, worktree integration/retry, accounting formulas, routing weights/floors/search limits, persistence and verification layers. Add matching navigation anchors and record the reviewed translation pair in `README.i18n.yaml`.
- Correct stale claims about Windows Codex editable support and the Harness/native permission boundary. Distinguish registry-file consistency from npm provenance and clarify installer-marker and ZCode first-seen script trust.
- Forward explicit unsandboxed confirmation through the workbench retry dispatcher, allowing an approved native CLI team retry to reach the existing execution gate. Missing confirmation remains blocked. Add focused regression coverage; no new model calls or billing claims. The dated 0.20.0 real-execution report remains unchanged.

Validation: strict frozen pnpm 10.34.6 install, real client build and generated-client consistency passed; 834 tests, 831 passed, 3 conditional skips, no failures. The new gateway/Host retry regression fails before the forwarding fix and passes afterward. Bilingual checks cover section anchors, table shape, local links and protocol/formula/command examples.

## 0.20.0 — 2026-10-15

Fully quit Harness, including its tray or WebUI Host process, and restart after upgrading.

- Add **官方工具协作** to the workbench launcher for **团队分工**. Choose read-only checks or approved editing in an isolated Git worktree. Preview and the session tool share `planOfficialTeam` / `executeOfficialTeamPlan`, filter CLI readiness for the selected mode, execute dependency packages sequentially and record results. This executor has no automatic model-directory API fallback; editable integration retains the existing clean-source and matching-baseline checks.
- Preserve every vendor CLI's configured model by default. Catalog recommendation IDs are no longer passed as implicit CLI model arguments. Only explicit `cliModel`, saved route mappings or team `cliModelsJson` select a CLI model; package bindings take precedence over tool bindings and saved mappings. ZCode keeps its per-call model limitation.
- Retain verified CLI model, entry, sandbox, usage and reported-cost evidence through routed, single-tool and team records. Separate recommended, requested and actual reported model identities. Preserve a valid reported zero cost; incomplete usage or unknown/unmatched actual CLI model identity cannot be costed using a recommended catalog price.
- Bind installation/version and CLI login-status checks to the actual selected npm, pnpm or native copy. Refuse silent PATH substitution when the saved installation cannot be resolved or its concrete entry is unavailable.
- Keep Windows Codex's original `CODEX_HOME` under the reviewed Harness ACL state-directory contract for read-only tasks. Explicitly selected native editable teams can use Codex's own workspace-write policy. Real Codex network checks failed in this batch; they are not reported as accepted execution.
- Store Windows isolated Git worktrees in Host-derived per-source private temporary storage. Real use exposed source drives with Modify permission but no WRITE_OWNER, where the SDK could not initialize its ACL boundary. Keep source authorization and patch checks, reject redirected storage, and preserve failed worktrees for retry. A no-model SDK confined-write and cross-drive integration probe passed.
- Add an explicit **厂商 CLI 正常环境** option for editable official teams. It retains normal vendor state, shell, skills and MCP under current user permissions, outside Harness's process sandbox. Git worktrees collect changes rather than restrict OS access. Startup and retry require separate confirmation even when legacy direct-CLI confirmation is disabled; restricted runs never switch automatically. Native Kimi and ordinary npm MiniMax entries additionally require registry package/manifest/entry attestation.
- Preserve bounded, scrubbed failure diagnostics and exit codes, including Claude result errors. Keep verified usage and reported costs after failures, cancellation and timeouts, mark partial usage incomplete, and retain earlier team results if a later adapter throws. Reassignment applies the new route's saved CLI model mapping.
- Clear obsolete failure details after a successful rerun and display the stored execution mode accurately. Update the English/Chinese README and workbench guide, including the existing Windows ZCode bundled TUI terminal support.

Real Windows validation: authenticated workbench RPC executed one Claude package; the installed production runtime then executed Claude analysis → MiniMax delivery with dependency context and source patch integration. Independent JSON readback passed. Successful calls report $0.253848 known API cost in total; earlier unknown amounts and unpriced subscription reference usage remain separate. File/shell tools passed; every MCP service and vendor are not claimed tested. See [validation evidence and limits](docs/releases/0.20.0-validation.md). Automated checks and exact totals are included in the GitHub release notes.

Engineering checks: frozen-lockfile strict-peer install passed; 833 tests, 830 passed, 3 conditional skips, no failures; client build and generated-client consistency passed. Skipped process/PTY checks are not counted as real execution acceptance.

## 0.19.0 — 2026-10-12

Stable minor under the npm latest tag. Fully quit Harness (including its tray or WebUI Host process) and restart after upgrading.

- Synchronize interactive terminal targets with the complete official-tool registry, adding OpenCode, Step Code and the verified Windows ZCode desktop-bundled TUI. Terminal refresh discovers current installations; older requests and health snapshots cannot restore stale target lists.
- Resolve terminals from the saved package manager, package entry or private script directory. Refuse to launch a different PATH copy when the selected installation is missing. Fix Windows pipe fallback argument handling for command shims.
- Add independent ZCode desktop-directory configuration in its tool card and plugin settings. Explicit selection is authoritative; missing, unsigned or modified bundles cannot silently fall back to another desktop. The built-in CLI follows desktop updates, while users configure login, models and plugins in TUI.
- Offer separate desktop update checks and reinstall controls, preserve reviewed queued-job settings and refuse known downgrades or an unverified latest version. Opening an installer remains distinct from completed installation.
- Fix ZCode discovery/installer signature checks under inherited PowerShell 7 module paths by using the Windows PowerShell system module directory. Prefer signed external Node 24 for TUI; a verified desktop Electron runtime can run the same bundled entry when Node is unavailable.
- Add directory, refresh-race, desktop lifecycle and terminal launch regressions. Release notes record full validation and version-only probes of all ten installed CLI entries; no model requests were made.

## 0.18.2 — 2026-10-12

Stable patch under the npm latest tag. Upgrade and fully restart Harness before using Step install, repair or update.

- Treat the configured install directory as a shared base. Configurable vendor scripts use dedicated tool subdirectories; npm/pnpm retain their existing shared prefix. Step's official installer replaces its entire runtime directories, so passing the shared root could delete every other npm package there.
- Check script targets before download or execution: refuse shared roots, other tool/project manifests and commands, package stores, and junctions into another tool's tree. Codex's junction within its own release tree and intentional shared default launcher directories remain supported. Legacy script roots are discovered read-only and cannot satisfy or redirect new install jobs.
- Separate successful version/install verification from unsupported restricted execution capabilities. Gemini, OpenCode and Step can be installed successfully while retaining explicit execution limitations; supported tools still require their original trusted-entry checks.
- Resolve Windows Gemini through its selected npm/pnpm package bin and a verified Node executable. Check package-tree containment and official registry file digests before launch, and preserve API fallback when the selected copy is missing or fails verification.
- Add regressions for destructive vendor runtime replacement, shared-prefix sentinels, junctions, legacy discovery, install capability status and Windows Gemini entry selection. Release notes record validation and the original-version recovery performed on the reported machine.

## 0.18.1 — 2026-10-12

Stable patch under the npm latest tag. Fully quit Harness, including the tray or WebUI host process, and restart after upgrading.

- Fix official-tool method selection stuck on saving: configuration persistence no longer waits for CLI inspection, and selectors reflect the acknowledged settings snapshot.
- Refresh install commands through a lightweight Host endpoint; delayed tool inspections cannot overwrite a newer install preview. Install actions wait for confirmed settings while method selection remains available.
- Synchronize volatile install settings into Host preferences without requiring plugin reload. Invalid configuration is reported and cannot start an operation with older settings.
- Add regression coverage using the real settings controller and Loader, plus a mock UI scenario with a hanging tool inspection. Release validation is recorded in the release notes.

## 0.18.0 — 2026-10-12

Stable minor under the npm latest tag. Fully quit Harness, including the tray or WebUI host process, and restart after upgrading. Existing releases remain unchanged.

- Add verified vendor curl/irm channels for Kimi, Claude, Codex, MiniMax, MiMo and Grok. Gemini retains npm/pnpm, OpenCode adds its Unix script, Step uses vendor scripts, and ZCode opens its signed Windows installer. Fixed vendor paths and unsupported platform methods are explained on each row.
- Fix MiniMax’s official Windows installer rejection: leading PowerShell `<# ... #>` help is accepted; HTML pages and missing vendor markers are still refused. Legacy MiniMax updates preserve the discovered native install root, including attested repair-release pointers.
- Correct pnpm global package/bin/store directory options and retain MiniMax native dependency build flags. Updates probe the selected directory, never accept an unrelated newer PATH copy, and refuse known downgrades. Queued jobs keep their selected method, source and directory snapshot.
- Make shared installation settings an explicit Save/Discard form. Pending edits, saves and summary refreshes block install actions; saved unavailable methods retain their explanation. Removal stays available when future script installations are disabled.
- Resolve restricted execution entries from the selected installation. Claude/Codex native Windows files require publisher verification. Kimi/MiMo/Grok standalone script installations currently lack npm-file attestation and report this execution limit; npm/pnpm execution remains supported. Do not delete the Windows Codex standalone junction through generic script uninstall.
- Vendor downloads remain size-limited, staged and marker-checked. Windows retries through the system network/proxy transport when Node cannot retrieve an installer; the downloaded response is never executed during transport.
- Validation results are recorded in the release notes. Verification uses automated regressions, current official script downloads without execution, and the actual-component mock UI. No real vendor CLI installation or paid model request is part of release acceptance.

## 0.17.1 — 2026-10-11

Stable patch under the npm `latest` tag. Fully quit Harness, including the tray or WebUI host process, and restart after upgrading so the Host reloads. Existing 0.17.0 artifacts remain unchanged.

- **MiniMax Windows one-click update accepts the official installer again.** The published `install.ps1` opens with PowerShell comment-based help (`<#`), and the sanity check treated every leading `<` as an HTML page, so the real script was refused before it ran. HTML and XML documents are still refused. UTF-8/UTF-16 BOMs are decoded first. Content-Type is not used: the CDN serves the script as `application/octet-stream`. A download that is empty, HTML, or missing `@minimax-ai/code`, `MCODE_INSTALL_DIR` and `MiniMax Code` still fails with the missing piece named.
- **Official script installers are selectable.** Claude Code, Codex, MiniMax, Kimi, MiMo and Grok now offer the vendor `curl | bash` / `irm | iex` installer next to npm and pnpm, on the platforms that script supports. Gemini stays on npm/pnpm. ZCode stays the signed desktop installer. One-click install, repair and uninstall run the method shown on the row. MiniMax on Windows defaults to `irm | iex` (that is the copy npm does not update); pinning npm or pnpm runs that manager instead, and still falls back to the official script if the probed version does not advance.
- **Updates use the configured install directory.** npm/pnpm keep `--prefix`. Scripts that document a directory variable (`MCODE_INSTALL_DIR`, `CODEX_INSTALL_DIR`, `KIMI_INSTALL_DIR`, `GROK_BIN_DIR`, `MIMOCODE_INSTALL_DIR`, Step Code's flag) receive that path. The MiniMax Windows fallback no longer substitutes the npm prefix: a configured directory wins, otherwise an existing official layout is updated in place, otherwise `%USERPROFILE%\.minimax-code`. Scripts that hardcode a path (Claude, OpenCode, MiMo on Unix) say so on the row.
- Windows validation for this patch: MiniMax `irm | iex` against a configured install directory completed with `mcode.cmd` present and version 0.6.8; the false “not an official Windows install script” refusal did not recur on main tip `1162f276`.

## 0.17.0 — 2026-10-11

Stable minor under the npm `latest` tag. Fully quit Harness, including the tray or WebUI host process, and restart after upgrading so the Host reloads. Existing 0.16.4 artifacts remain unchanged.

- **Two new official tools.** `opencode` (OpenCode, `opencode-ai` on npm or the official `curl -fsSL … | bash` installer) and `stepcode` (Step Code from StepFun, installed only by the vendor's `curl | bash` / `irm | iex` script — it publishes no npm package). Both are covered by the registry's probe, version lookup, health check and login guidance. Step Code's latest version is read from the same `latest.json` release manifest its own installer uses. Neither has a verified restricted execution entry yet, and both say so rather than claiming one.
- **Every tool can now declare several install methods.** `installMethods` is the closed list the Host may use: `npm` and `pnpm` everywhere a package exists, plus the vendor installer script where the vendor ships one. The existing `manager` / `installArgs` stay the default method, so nothing about the old one-click path changed.
- **Unified install settings.** New volatile config: `toolInstallDir`, `toolNpmRegistry`, `toolInstallMethodsJson`, `toolScriptUrlsJson`, `toolAllowScriptInstall`. They are editable from the **官方工具** page and from the plugin settings form, and apply to one-click install, repair and uninstall as well as `/tools` and the agent tools. An install directory becomes `--prefix` for npm/pnpm and `-InstallDir` / `--install-dir` for Step Code. OpenCode's official script hardcodes `~/.opencode/bin` and takes no directory, so for that tool the row says where it will actually land.
- **Vendor scripts are verified before they run, never piped.** The plugin downloads the script with a size cap, requires the vendor's own markers, refuses an HTML error page or another vendor's installer, writes a staged copy and runs that. A configured mirror may rehost the same script; it may not substitute another program. A Step Code script mirror also redirects that vendor's binary and checksum downloads. Script installs can be switched off entirely.
- **One-click repair and uninstall.** Repair re-runs the same fixed official command even when the tool already reports the latest version, which is the case a broken install actually presents. Uninstall removes only the program: package-manager installs go back through the same manager, script installs delete the single executable the vendor installer placed plus that install's own `# stepcode` PATH block in the shell profile. Configuration, credentials and session history are always kept. `checkedRemovableFile` re-checks the basename, the install directory and the root/home guards on every delete.
- **The RPC stays closed.** `installTool`, `uninstallTool` and `repairTool` take one strict `{ tool, method? }` request; an unknown field, an unknown tool id or a method the tool does not declare is refused. Install addresses still come only from Host config, so a compromised client cannot redirect an install. `list()` now also reports the effective install directory, source and per-tool commands so the panel can show what will run.
- `/tools` accepts `install`, `uninstall`, `repair`, `cancel` and `method`, each with an optional method id. New agent tools `model_router_tool_repair` and `model_router_tool_uninstall`, plus a `method` parameter on `model_router_tool_install`. Install, repair and uninstall each ask for approval, and uninstall's prompt states that settings and login are kept.
- The workbench panel shows the settings block, a per-row method selector with the platform reason for anything unavailable, the resolved command, and repair/uninstall buttons. Install settings also appear in the plugin settings card with the same client-side validation as the Host.
- Release validation on Windows 11: 649 tests passed, 3 conditional skips, `npm run build:client` and `npm run check:client` passed. No real vendor CLI was installed, no vendor script was executed, and no paid model call was made as part of this verification.

## 0.16.4 — 2026-10-09

Stable patch under the npm `latest` tag. Fully quit Harness, including the tray or WebUI host process, and restart after upgrading so the Host reloads. Existing 0.16.3 artifacts remain unchanged.

- PATH probes and `npm config get prefix` omit the install-log callback. 0.16.3 only stored stdout inside `onOutput?.(...)`, so the optional call skipped capture and `where` / `--version` returned success with empty output. Every PATH CLI was reported not-installed. MiniMax and ZCode still appeared because they do not use that probe.
- Capture now always records stdout and stderr, then forwards text to `onOutput` when a caller supplied one. Install logs are unchanged.
- The 0.16.3 spawn shape (no pre-quoted Windows command line) and the 0.16.2 update-button job ownership remain.
- Linux validation: 631 tests passed, 4 conditional skips, `npm run check:client` passed. This environment did not re-run the Windows PATH probe.

## 0.16.3 — 2026-10-09

Stable patch under the npm `latest` tag. Fully quit Harness, including a WebUI server process or the desktop tray, and restart after upgrading so the Host reloads. Existing 0.16.2 artifacts remain unchanged.

- Windows `shell: true` spawns again pass the executable and arguments separately. 0.16.2 pre-quoted that command line; cmd then started Node on a missing script (`MODULE_NOT_FOUND`, empty `requireStack`, Node 24) for every official tool's probe, `npm config get prefix`, and `npm install -g`.
- A `--version` banner that contains a version counts as installed, including UTF-16 output from a native Windows executable. If the name on PATH fails, the absolute path from `where`/`which` is tried without a shell. One probe or readiness failure stays on that card.
- Package entry lookup accepts `./dist/main.mjs` and a `bin/` directory that is itself on PATH. A CLI that is already the latest release stays on “已是最新版本” instead of “修复官方执行入口”.
- The 0.16.2 update-button behavior remains: the click keeps its own job, refresh does not disable a visible update, and an install that leaves the probed version older fails with a row error.
- Release validation on Linux: 630 tests passed, 4 conditional skips, `npm run check:client` passed. No Harness WebUI, Harness Desktop, or Windows `cmd.exe` run was available in this environment.

## 0.16.2 — 2026-10-09

Stable patch under the npm `latest` tag. Fully quit Harness, including the tray process, and restart after upgrading. Existing 0.16.1 artifacts remain unchanged.

- Official-tools update/install clicks keep the job started by that click. A status poll no longer replaces it with an older finished job or clears a failure.
- Refreshing an existing probe no longer disables the update button. A click that cannot start, and an install whose probed version is still older than latest, show an error on that row.
- Installed Claude Code runs `claude update` before the registry npm install. Installed Windows MiniMax runs the official installer. Other registry cards share the same click path and fail visibly when the probed version does not advance.
- Release validation: 628 tests passed, 4 conditional skips, client check passed. No paid calls or real CLI installs were part of this verification.

## 0.16.1 — 2026-10-08

Stable maturity patch under the npm `latest` tag. Fully quit Harness, including the tray process, and restart after upgrading. Existing 0.16.0 artifacts remain unchanged.

- Separate stable feedback evidence identity from hourly decay invalidation; expose bounded per-route/domain observed feedback diagnostics and exclusion reasons without changing objective quality floors.
- Remove superseded personalization, reject invalid/missing usage costs instead of treating them as free, and retain immutable historical charges.
- Recover interrupted public refresh leases, propagate overall timeout/cancellation, isolate source changes, sanitize public status, and reproject in-flight responses against current settings.
- Guard settings/rating submissions, preserve newer drafts, await summary refresh, fix paused-result Hook order, and surface retained-but-unverified summaries.
- Never steal live state locks; detach committed state, roll back rejected updates, preserve unsupported schemas and unique corrupt backups, and prevent incomplete charge history from passing configured budgets.
- Package the maturity derivations, regression reproduction and remaining limits in `docs/ROUTING_MATURITY.zh.md`. Release validation: 622 tests passed, 3 conditional skips, client/preview checks passed. No paid calls, real-user ledger changes or real quality-cost benefit claim.

## 0.16.0 — 2026-10-05

Stable release under the npm `latest` tag. Fully quit Harness, including the tray process, and restart after upgrading so both the Host and client load the new version. Public data refresh is opt-in; enabling it does not authorize paid model exploration.

- Add opt-in versioned public LiveBench/curated pricing snapshots with TTL, failure backoff, last-good fallback and atomic cross-process promotion; explicit manual prices win. Freeze each run's applied rates and data/policy versions, and disable cleared sources immediately without deleting recoverable snapshots.
- Replace production review/rating quality bias with task-specific, time-decayed, shrinkage-regularized subjective utility. Preserve objective proxy quality floors; expose learning controls/reset and the local DSH_HOME / last-200-runs scope. Agent rating tools require approval; Desktop ratings bind to the displayed result timestamp.
- Require explicit score scale for dynamic benchmark mirrors and exact benchmark model identity; expose optional benchmarkModel mapping without claiming verified execution effort. Add controlled synthetic adaptation and Host/Client integration tests; no paid exploration, real-user result collection, universal official pricing scraper or actual quality-cost benefit claim.

- Use estimated per-package token cost against a fixed reference pricing scale, not the most expensive configured route; an irrelevant expensive model no longer rescales existing preferences. Remove the model-name-specific synthesis bonus.
- Protect least-cost known-price candidates before truncating pools. Disable local Pareto pruning for dependency-coupled tasks, where route identity changes later handoff penalties.
- Solve retained candidate spaces of at most 4,096 combinations exactly; larger spaces use bounded beam search with a protected affordable prefix. Expose exact/approximate search, candidate truncation and the surrogate-objective scope instead of claiming global answer-quality optimality.
- Correct repeated quality-bias application for unknown models. Explain that benchmark/manual scores and quality floors are not calibrated correctness probabilities.
- Preserve explicit/derived benchmark provenance, exclude image-ineligible savings baselines, and use unrounded totals for budget gates. Report quality filtering, Pareto pruning, and candidate truncation separately.
- Add independent exhaustive-oracle tests and a label-matrix offline evaluation tool with validation-selected single-model baselines, random routing, hindsight Oracle, actual recorded costs and rare-expert recall. No paid model calls or real quality-improvement claim.
- Audit the official LiveBench 2026-06-25 aggregate score/cost release with pinned source hashes, complete-coverage checks and descriptive static Pareto profiles. Add continuous-score, domain-stratified whole-group paired bootstrap tooling and document the missing latest per-question cost/quality matrix. Aggregates are not replayed as question outcomes; no real routing-benefit claim or production routing change.

Validation: 558 tests, with 555 passed, 3 existing platform-condition skips and no failures. Strict frozen-lockfile installation, generated-client check and actual-component mock-preview compilation passed. Nine controlled synthetic adaptation checks passed; these are mechanism tests, not real model quality-cost gains. Real paid model calls, user-result collection, execution-effort validation and Harness Desktop end-to-end acceptance were not part of this verification. Research artifacts are in the complete GitHub source checkout, not the npm runtime package; historical experiments retain their original development-version identifiers.

## 0.15.0 — 2026-10-03

- Reorganize the workbench into task/execution, model configuration, official tools, and budget/security pages. Keep panels mounted so drafts, installation polling, and terminal sessions survive navigation; add keyboard tab navigation and panel-width responsive layouts.
- Show local routing results immediately after task planning, with expandable work-package details and human-readable dependency names.
- Discard pending execution previews when their inputs change, and confirm only the request that was actually previewed. Invalidate local plans when model profiles or routing settings change externally.
- Preserve API spending, unknown-call counts, and subscription reference costs when detailed history is pruned or a step is retried. Retain 200 detailed runs plus bounded calendar aggregates; previously discarded costs cannot be recovered.
- Add `npm run preview:ui`: a localhost-only preview of the actual client with in-memory fixtures, five normal/error/empty/onboarding/delayed scenarios, and no real model calls or terminal processes.
- Rewrite the English/Chinese README, installation instructions, and workbench guide around the current capabilities, source setup, execution boundaries, and local-data behavior. Include the guide and a clearly labeled simulated UI screenshot in the package.

Validation: 220 tests passed, with 3 existing Windows-specific skips; the generated client and packaged file bytes were checked. Browser preview checks cover navigation, narrow panels, validation, draft persistence, and stale-preview rejection. Real vendor accounts, paid CLI calls, and Harness Desktop end-to-end execution were not exercised in this release's validation.

## 0.14.0 — 2026-10-03

Stable release under the npm `latest` tag. It folds in the 0.14.0-beta.1 – beta.4 prereleases (published under `next` only). **After updating, quit Harness completely (including the tray icon) and start it again**: Harness serves the new workbench UI at once, but the running Host keeps the plugin code it already imported, so the new Host methods are missing until a full restart. The workbench now warns when the Host and client versions differ.

### Added
- **官方工具终端** workbench card: interactive sessions of the system shell (PowerShell on Windows, the login `$SHELL` elsewhere) or an installed official CLI (codex, claude, kimi, mcode, mimo, grok, gemini), in tabs, rendered with xterm.js 6 (bundled into `client.js`). Each CLI also has a fixed **登录** mode (`codex login`, `claude auth login`, …). Sessions start only after a confirmation showing the command, the absolute working directory, and that the terminal runs outside the Harness process sandbox with the user's own CLI login and environment.
- Host session manager (`shared/cli-terminal.mjs`) on the prebuilt N-API `@lydell/node-pty@1.2.0-beta.15` (optional dependency, per-platform binaries, no install scripts), with a pipe fallback and a clear limitation note when the PTY cannot load. Verified on Windows inside Harness Desktop (Electron 44 as Node).
- Typert remote methods `terminalInfo`, `terminalStart`, `terminalRead` (long poll), `terminalWrite`, `terminalResize`, `terminalStop`; every request is validated on both sides (`shared/cli-terminal-protocol.mjs`). The client unwraps both the Host and gateway `{ ok, value }` envelopes, never sends reads or writes for an invalid session id, and clamps resizes into the accepted 10–500 × 3–300 range.
- Session metadata (tool, mode, directory, start/end, duration, exit code, end reason) in `state.json` → `terminalSessions` and in the card's history. Input and output are never logged or stored. Sessions end on tab stop, panel close, plugin unload/reload, Host exit, after about 2 minutes without a reader, or after 6 hours; at most 4 at once.
- `list()` reports `hostVersion`, the plugin version the Host actually loaded. When it differs from the client's version (or is missing), the workbench shows "插件后台版本较旧，请完全退出并重启 Harness（包括托盘图标）后再使用。" and the terminal's 开始 is disabled for missing methods.

### Changed: official tools follow the vendors' latest releases
- The plugin no longer pins Codex, Claude Code, Kimi Code, MiniMax Code, MiMo, Grok Build, Gemini CLI or ZCode versions. One-click installs use `<package>@latest` from `https://registry.npmjs.org/`; the MiniMax Windows fallback runs the official installer script as published; ZCode downloads the newest Windows installer linked from `https://zcode.z.ai/en/docs/install` (HTTPS, `cdn-zcode.z.ai` only, size cap).
- 健康检查 no longer flags installs as "older"/mismatched. Each card shows the installed version and, when available, the latest version with an 有新版本 hint and an 更新到最新版 X button. Latest versions come from the npm registry `<package>/latest` documents and the ZCode download page, cached ~12 h in `model-router/latest-versions.json`; failures are non-fatal (stale value or "最新版本未知"; retried after 30 min). An install newer than the latest release is never downgraded.
- The health card notes that new vendor versions are untested by the plugin. Parsers stay tolerant of output changes.

### Security checks
- Kept (version-independent): Authenticode publisher checks for `codex.exe` (OpenAI OpCo, LLC), `claude.exe` (Anthropic, PBC; plus ≥ 2.1.259 for restricted flags), `ZCode.exe` and the ZCode installer (北京智谱华章科技股份有限公司). The ZCode 3.14.3 version gate is gone: any validly signed build is enabled, with the version read from the signed file.
- Replaced: the per-version hash of ZCode's unsigned `resources/glm/zcode.cjs` became a trust-on-first-use record per (install root, signed build, signer thumbprint) in `model-router/zcode-trust.json`, plus a `.node-bundle-meta.json` entry check. A script that changes under the same signed build is refused; a new signed build re-records it.
- Replaced: the per-version sha256 pins for MiMo `mimo.exe`, Grok `grok.exe(.br)` and MiniMax `cli.js` (these vendors do not sign them) became registry attestation: every code file must equal the file in the official npm tarball for the installed version, whose sha512 comes from registry.npmjs.org (the npm cache is reused when it matches). Results are cached per package@version in `model-router/npm-attestations.json`; the first run of a new version needs network.
- Removed: the hash of MiniMax's official installer script (it now runs as published; only a sanity check that it is the official PowerShell script remains).

### Tests
- `tests/cli-terminal.test.mjs` (protocol, launch resolution, env, manager with a fake PTY, pipe fallback, real PTY on Linux, Host wiring, client transport); `tests/cli-terminal-gateway.test.mjs` with `tests/helpers/typert-gateway.mjs` (the card's real payloads through a copy of Harness's gateway boundary); `tests/latest-versions.test.mjs` (latest lookup with mocked fetch, cache, offline fallback; npm attestation; ZCode/Codex/Claude signer-only acceptance; ZCode first-use record; installer URL validation). Version-pin assertions removed.

## 0.13.3 — 2026-10-03

Bug-fix release for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` and `latest` tags.

**After updating, quit Harness completely (including the tray icon) and start it again.** A live patch reload does not replace plugin code that the running Host has already imported.

### Fixed
- On Harness Desktop for Windows, every official CLI run that went through the Harness process sandbox exited 0 with no output, so the step paused with "Codex 未返回完整成功终态和回答" and no model was called. The sandbox runner is started as `DeepSeek Harness.exe …/runner.js`, which needs `ELECTRON_RUN_AS_NODE=1`; the plugin's minimal CLI environment dropped it, so the executable started the desktop app instead, lost the single-instance lock and quit. The runner now gets that variable whenever it is the Electron executable.
- Codex cannot start inside the Harness Windows sandbox at all: it must write `CODEX_HOME` (`~/.codex`) and the sandbox denies those writes (`failed to initialize in-process app-server client: … (os error 5)`). On Windows, Codex now skips the Harness sandbox and starts directly with its own `--sandbox read-only`. This is the launch the "不经沙箱启动 CLI" confirmation already describes.
- A CLI that exits without writing anything to stdout or stderr is now reported as such, for example "Codex 退出码 0，无任何输出（stdout 与 stderr 均为空）。", instead of a generic "incomplete answer" message.

## 0.13.2 — 2026-10-03

Bug-fix release for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` and `latest` tags.

### Fixed
- Codex runs through the signed Windows runner failed in any workspace that is not a Git repository (for example a plain project folder chosen in the workbench). The step paused with "Codex 未返回完整成功终态和回答" and no model call was made. Codex 0.157.1 refuses such directories unless `--skip-git-repo-check` is passed (`Not inside a trusted directory and --skip-git-repo-check was not specified.`). The flag was only in the portable adapter; the signed runner now passes it too. Read-only runs stay confined by `--sandbox read-only` and the Harness process sandbox.
- When Codex exits without a successful turn, the error now names the cause: an untrusted directory, or no JSON events at all (with the last CLI output line). The pause detail no longer comes out empty when stderr is empty but stdout has output.

## 0.13.1 — 2026-10-03

Bug-fix release for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` and `latest` tags.

### Fixed
- Workbench runs ("在工作台执行": preview, then confirm), `model_router_execute` and step reruns failed in the Harness with `cannot get property "credentials" without inject`. The executor read `ctx?.credentials`, which is not in the plugin's `inject` list; Cordis throws for every non-injected `ctx.<service>` read, and optional chaining does not help. Optional services are now read through `ctx.get(name)`, as the Harness itself does, so nothing new is required at load time. The run never started, so no model was called and nothing was billed. The failed run stays in history with that error.
- The source-only npm update helper (not shipped in the package) reads `connection`, `desktopProfiles` and `desktopPnpm` the same safe way.

### Tests
- Test mocks for Host code paths now enforce `inject` like Cordis (`tests/helpers/strict-ctx.mjs`).
- New `tests/cordis-inject.test.mjs` runs the workbench preview and run, `executeConfiguredAssignment` and a step rerun in a real Cordis plugin context with the Host `inject` list and sibling-provided services, with and without a `credentials` service. It also scans Host sources for `ctx.<name>` reads of non-injected services.

## 0.13.0 — 2026-10-03

Prerelease for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` tag. Merges PR #1 and PR #2.

### Package renamed
- The npm package is now **`@ljwei-stak/dsh-model-router`**. The last version under the old name `@ljwei-stak/model-router-galgame` is 0.13.0, with the same content as `@ljwei-stak/dsh-model-router@0.13.0`; the old name will get no further updates. Upgrade by removing the old plugin and adding the new one; do not install both.
- The profile entry id, panel id, settings namespace and Cordis plugin name stay `model-router-galgame`, and state stays in `~/.dsh/model-router/`, so saved settings and run history carry over. See [MIGRATION.md](docs/archive/MIGRATION.md).

### Official CLI execution (PR #1)
- Assigned work packages run through the official vendor CLIs (Claude Code, Codex, Gemini CLI, Kimi Code, MiniMax Code, MiMo Code, Grok Build) with headless adapters; failures fall back to the Harness model catalog API.
- `model_router_execute` can pin a single `provider`/`model` (direct mode) instead of comparing routes.
- Claude instructions stay positional; Codex reconnect notices are no longer treated as failures.

### Health check, routing visibility and cost control (PR #2)
- **Health check** (`model_router_health`, onboarding banner): install state, pinned version and login state per CLI. Uses read-only status commands (`claude auth status`, `codex login status`) or the presence of credential/state files (Gemini, Kimi, MiMo, Grok, MiniMax `auth-state.json`); credentials are never read. Logged-out CLIs are skipped immediately.
- **Routing decisions** carry the vendor's sanitized error, difficulty, estimated cost and channel per package; manual reassignment.
- **Cost control**: daily/monthly budgets, pre-run estimates (also for `model_router_tool_run`), actual cost from CLI-reported cost or token usage × configured price (Claude, Codex, Gemini, Grok, MiMo, MiniMax), auto-downgrade or pause when over budget.
- **Presets**: cheapest / balanced / best quality.
- **Subscription-first billing** for every vendor: CLI account logins and coding-plan key routes are used first; quota exhaustion or rate limits switch to the API key until the vendor's reset time; other subscription failures pause and ask (retry subscription / use API / cancel). Only API-billed spend counts toward budgets.
- **Run history and DAG**: every execute / team / tool run is recorded locally with status per step; single-step rerun (read-only teams), continuation of a failed editable team run in a fresh worktree seeded with earlier changes, and rerun of failed tool calls.
- **Workbench run launcher**: start a read-only run from the workbench with plan preview, cost estimate and one confirmation listing every reason.
- **Security boundaries**: per-route read/write scope and sandbox status; one combined approval prompt for file writes, API-key fallback, over-budget and unsandboxed CLI starts.
- **Quality loop**: optional stronger-model review (off / sample / always) and 👍/👎 ratings with bounded influence.
- Multi-process safe state (`state.json.lock`, merged writes); quota and auth marks from other processes apply without restart; corrupted state is backed up and reported.
- Windows: CRLF-safe client build check, Grok `GROK_HOME` login hint, ZCode unverified-version notice.

### Known limitations
- The workbench launcher starts read-only runs only; editable runs start from a session.
- Kimi and ZCode headless output reports no token usage; ZCode login state stays unknown; only ZCode 3.14.3 is verified.
- Not yet verified end to end inside the Harness Desktop UI.

## 0.12.0

First independent router release; GAL moved to `@ljwei-stak/dsh-galgame`.
