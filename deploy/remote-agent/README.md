# Self-hosted agent installation (preview)

The installers create a versioned user directory and keep configuration/data separate. They do not alter global Node, firewall, VPN, scheduled tasks or running services. Verify the release SHA-256 manifest before installation. Run the installer as the intended low-privilege account; arbitrary scripts run with that account's OS permissions. Filesystem API roots alone do not sandbox shell commands.

Linux: `sh deploy/remote-agent/install-linux.sh SOURCE_ROOT PREFIX AUTHORIZED_ROOT`.
Windows: `powershell -File deploy/remote-agent/install-windows.ps1 -SourceRoot SOURCE_ROOT -Prefix PREFIX -AuthorizedRoot AUTHORIZED_ROOT [-DesktopTargetProcess EXPLICIT_NAME]`.

Default installation is current-user mode. For OS isolation, use a dedicated Linux user/container or a dedicated Windows account with ACLs that permit only its workspaces and data. The systemd file is an explicit **example**, requiring a locally selected Node path, account and writable roots before a user installs/enables it. Its cgroup stops descendants on service exit. Container deployments must not expose host sockets; add browser dependencies explicitly when browser execution is needed. No claim of verified container packaging is made by this source template.

Create `ceiling.json` locally: `{"botIds":["bot-implementer"],"roots":["project"],"tools":["machine_ping","fs_read","fs_list","fs_write","shell_exec","operation_status","operation_cancel","artifact_read","artifact_stat"]}`. Run `node VERSION_DIR/dist/cli.mjs pair PREFIX/config.json host-id ceiling.json`; save the once-displayed token in the Host secret service and retain only `secretRef` in Bot configuration. Local `rotate` and `revoke` commands work while the server is running and invalidate active grants. Pairing is personal-device authentication, not an OAuth authorization service.

For desktop operation, launch the native helper from the granted user's interactive desktop using `desktop-start.json`. A service deployment still needs this separate user-session helper. Session 0, a locked desktop and UAC secure desktop are explicit failures. Start the agent with `node VERSION_DIR/dist/cli.mjs serve PREFIX/config.json`. No GUI acceptance is implied by an SSH health check.

Network configuration is explicit:

| mode | Boundary |
| --- | --- |
| `loopback` (default) | Exact loopback address; authenticated MCP/control; exact Host/Origin allowlists |
| `wireguard` | Exact existing interface IP; `protectedTunnel:true` explicitly attests WireGuard; otherwise configure TLS |
| `tailscale` | Exact existing interface IP; `protectedTunnel:true` explicitly attests Tailscale; otherwise configure TLS |
| `cloudflare-tunnel` | Backend remains loopback; `protectedTunnel:true`; configure public Host/Origin explicitly |
| `public-tls` | Native `tls:{keyFile,certFile}`; optional `caFile,requireClientCertificate`; or loopback reverse proxy with exact `trustedProxies`, verified HTTPS forwarding and public Host/Origin allowlists |

Private IP addresses never establish trust by themselves. Wildcard bind is rejected. Forwarded source addresses do not bypass throttling. The Host client refuses redirects and checks the machine ID/API major before returning a grant. Do not put tokens in URLs, model arguments, logs or public configuration.

`public-tls` behind a reverse proxy requires an exact literal peer IP in `trustedProxies` and exactly `X-Forwarded-Proto: https` on each request. The proxy must overwrite this header, preserve an explicitly allowed `Host`, and keep the backend port private. The agent ignores forwarded client addresses and forwarded Host for identity and rate limits. Optional native mTLS requires an explicit `caFile` with `requireClientCertificate:true`; a valid client certificate still needs its independent Bearer token. Host and Origin lists use exact entries; opaque `Origin: null` is refused.

`network.authLimits` bounds anonymous and authenticated traffic separately. Defaults: `windowMs:60000`, `failureThreshold:5`, `baseBackoffMs:1000`, `maxBackoffMs:30000`, `maxSources:1024`, `globalFailureLimit:128`, `clientRequestLimit:120`, `maxClients:1024`. Source failures cause exponential temporary cooling, and a full global anonymous window refuses additional invalid tokens. Valid credentials bypass these anonymous counters, including behind a shared proxy. All control requests and tickets of the same verified client share its request allowance. A 429 response supplies `Retry-After`; stop retry loops until then. Cold restart clears in-memory limiter state, and idle entries can be evicted at the configured capacity. This is bounded local throttling, not distributed denial-of-service protection.

To unlock an authenticated client's request allowance immediately, use the local `rotate CONFIG_JSON CLIENT_ID` command, update its Host secretRef value, and request fresh tickets. The new revision invalidates the old pairing token and all old grants immediately. Anonymous cooling expires automatically; never remove authentication or widen proxy trust to work around it. The local TLS tests use ephemeral generated CA/server/client keys under ignored test directories and do not provide deployment certificates. Reproduce them with `node --test tests/remote-auth.native.mjs` from the repository root; OpenSSL must be available (Git for Windows includes it), or `DSH_TEST_TLS_FIXTURE` may point to an explicit ephemeral test fixture directory copied from another test host. This only supplies fixture files; TLS verification remains enabled in every test.

Upgrade: stop and reconcile active operations, take an offline copy of the data/configuration, install the new version alongside the old one, then point the launcher at the new version. Do not run two writers against the same data directory. Unknown operations remain unknown and cannot be replayed using their original ID. Downgrade only with a matching data backup/schema; do not overwrite a live SQLite database.

Uninstall: stop the agent and desktop helper, verify all owned tasks have stopped, remove only the selected version/program directory. Preserve config, credentials and data by default; delete those only with a separate explicit choice. Revoke the Host pairing before deleting credentials.

Runtime manifests record OS, architecture, Node version/ABI. Build/install native SQLite and helpers for the target platform; never copy development `node_modules` into a cross-platform archive. Browser binaries and OS dependencies require `node VERSION_DIR/node_modules/playwright/cli.js install chromium --only-shell` for the target account. Package/download/upgrade/Win10/Win11/DPI acceptance remains tracked separately from unit tests.
