# Full desktop engine — 2026-11-05

Implemented the native/remote-Agent part of a long-lived full-desktop session. Host and React integration belong to the coordinator. No remote installation or real `10.0.0.2` input was performed by this subtask.

## Components and launch

- `native/windows-desktop/Program.cs`: existing protocol-v2 window tools and tray lifecycle. Full desktop requires explicit `--desktop-mode full`; the default still requires `--allowed-process`.
- `FullDesktop.cs`: physical monitor enumeration/capture and a separate full-desktop path for existing Bot `desktop_screenshot/click/type/key/scroll` tools. These actions retain native lease ownership/generation, selected display/session, bounds/DPI, 15-second frame freshness, and a single-use screenshot ID. They intentionally omit whole-image hash equality: a clock/caret/animation must not invalidate a full-monitor action. Default window mode retains its existing target/foreground/occlusion/hash checks.
- `DesktopLease.cs`: explicit human takeover reserves the arbiter, fences the Bot generation, waits up to five seconds for its in-flight step/cleanup to exit, then grants control. A failed wait reports `DESKTOP_TAKEOVER_PENDING`; it never acknowledges control early. Watch sessions do not enter this lease. Releasing human control makes it available to Bots immediately, without a 15-second idle delay.
- `DesktopStream.cs`: private `-stream` named pipe, GDI BitBlt monitor capture, JPEG quality 70, acknowledged input/control/renew/stop, and held-key/button release. The helper refuses Session 0 and a locked/UAC/secure desktop. The application uses per-monitor DPI awareness and preserves negative monitor origins.
- `remote-computer-agent/src/desktop-session.ts`: grant-bound, process-lifetime tickets; native channel; WebSocket session lifecycle; bounded audit; input serialization/replay refusal; video backpressure.
- `transport.ts`, `agent.ts`, `client.ts`, `index.ts`: existing Agent HTTP(S) server upgrade/API integration and exported clients. `ws@8.22.1` is an explicit Agent dependency, used without compression; no custom WebSocket implementation and no RustDesk source/wire protocol was copied.

Deploy the current `remote-computer-agent/dist`, production dependencies including `ws`, and `tmp/integration/agent-helper-build/dsh-desktop-helper.exe`. Launch the helper in the signed-in interactive Windows session with the same `--pipe` and protected `--secret-file` configured for the Agent. Example option shape: `--desktop-mode full --pipe dsh-desktop-<installation> --secret-file <private file>`. Optional `--agent-sid` admits a separate local Agent identity through the named-pipe ACL. No endpoint, secret, process path or ownership comes from Bot tool arguments.

## Trusted HTTP APIs

Each call requires `Authorization: Bearer <valid Host-issued short grant>` and passes the normal Host/network/TLS validation. They are separate from MCP tools and cannot be invoked as model desktop actions.

| Path | JSON body | Reply |
| --- | --- | --- |
| `POST /desktop/v1/session` | `{mode:'watch',fps:15,displayId?,origin?}` | `{sessionId,token,expiresAt,path:'/desktop/v1/socket',displayId,displays,width,height,mode,controlAllowed}` |
| `POST /desktop/v1/session/renew` | `{sessionId,origin?}` | Same full ticket shape; same session/token/socket and current mode |
| `POST /desktop/v1/session/close` | `{sessionId}` | `{stopConfirmed:boolean}` after native teardown acknowledgement |

`expiresAt` is UTC epoch milliseconds. Tokens are random 32-byte base64url values (43 characters). The renderer receives only this session capability; neither machine pairing secret nor grant/native secret reaches it. `desktop_screenshot` authorizes watching. All four input tools (`desktop_click`, `desktop_type`, `desktop_key`, `desktop_scroll`) are required for control. Initial `mode:'control'` is also supported, with the native acquire acknowledgement preceding the ready message.

Renewal requires the same client/Bot/task/attempt/revision and identical roots, plus the existing tool scope. It replaces the live grant only after acknowledged native expiry update. Keep the coordinator's 45-second refresh for 60-second grants; renewal does not reconnect or release control. A changed Origin is refused. `RemoteAgentClient` exports `desktopSession`, `renewDesktopSession`, and `closeDesktopSession` for these APIs.

The authenticated Host supplies its trusted page Origin in the session body. Upgrade validates the committed Agent Host, network/TLS/proxy policy, and either configured `allowedOrigins` or an unexpired session's bound Origin. First-message authentication then verifies that specific session's exact Origin. Missing Origin is permitted for trusted Node clients/tests. Query parameters on the socket path are refused; credentials must never be placed in a URL.

## WebSocket protocol

Open `ws(s)://<committed Agent endpoint>/desktop/v1/socket`. First message must be `{type:'auth',sessionId,token}`. No video/control is sent before authentication. A second connection cannot reuse an already used session ticket. Anonymous sockets time out; connection/session counts and payload/queues are bounded.

Ready JSON:

```json
{"type":"ready","sessionId":"desktop-...","mode":"watch","width":1280,"height":720,"displayId":"\\\\.\\DISPLAY2","displays":[{"id":"\\\\.\\DISPLAY2","name":"\\\\.\\DISPLAY2","width":1280,"height":720,"x":-1280,"y":0,"dpi":144,"primary":false}],"dpi":144,"physicalOrigin":{"x":-1280,"y":0},"coordinateSpace":"display-physical-pixels","captureBackend":"GDI-BitBlt","expiresAt":0,"controlAllowed":true}
```

The example expiry is a placeholder, not a real ticket. Binary messages are ordered JPEG keyframes or dirty rectangles. A preceding `type:"frame"` JSON packet states physical `width/height`, encoded canvas `frameWidth/frameHeight`, and optional `region:{x,y,width,height}` / `keyframe`. Apply rectangle JPEGs to the previous canvas in order; do not treat each rectangle as a complete display. Input coordinates and routine geometry always use the physical monitor dimensions. Display geometry/DPI changes end the session rather than silently remapping input.

Client messages:

```js
{type:'control',action:'acquire'|'release',id?:number}
{type:'input',id:number,event:
  {type:'pointer',action:'move'|'down'|'up',x:int,y:int,button:'left'|'middle'|'right'} |
  {type:'key',action:'down'|'up',code:DOMCode,key:DOMKey} |
  {type:'wheel',deltaX:int,deltaY:int} |
  {type:'text',text:string}}
{type:'release-input',id?:number}
{type:'close'}
```

Pointer coordinates are LOCAL physical pixels of the selected display. Only native code adds its monitor origin. DOM wheel positive Y scrolls downward (native wheel sign is converted); X scroll is supported. Wheel values are limited to ±4800, text to 8192 UTF-16 characters, key codes cover letters/digits/modifiers/navigation/punctuation/numpad/F1–F24. Unicode text uses SendInput, not clipboard. Input IDs must be increasing positive safe integers; duplicates are refused without native dispatch.

Server acknowledgements:

```js
{type:'control',mode:'control'|'watch',ok:true,id?:number}
{type:'control',mode:'watch',ok:false,code,id?:number,possiblyApplied?:boolean}
{type:'input',id,ok:true}
{type:'input',id,ok:false,code,possiblyApplied:boolean}
{type:'release-input',id?:number,ok:true}
{type:'release-input',id?:number,ok:false,code,possiblyApplied:boolean}
{type:'status',status:'disconnected',mode:'watch',code,stopConfirmed:boolean}
```

Native rejection supplies an explicit error. A missing acknowledgement after dispatch is `OUTCOME_UNKNOWN` with `possiblyApplied:true`; the action is never retried. The socket/session is stopped. `release-input` releases held keys/buttons while retaining the human lease, for blur/pointer loss; explicit `control/release` releases the lease and preserves video. Input remains refused in watch mode regardless of the renderer's UI state.

## Lifecycle, buffering and evidence

Native IPC is a private little-endian uint32 length (including one-byte tag), followed by `J` UTF-8 JSON or `F` JPEG bytes. `streamVersion:1` is separate from unchanged model-facing protocol v2. Native requests use correlated monotonic IDs and ACKs. Native capture is credit driven: no capture before authenticated first frame request and at most one requested video frame. The Agent consumes the pipe regardless of browser speed, drops a frame when the socket is over its high-water mark, and requests the next frame after browser flush. Capture cadence includes capture time; requested fps defaults to 15 and is capped at 30. There are no per-frame MCP calls or durable video artifacts.

Grant checks run before authentication/control/input/frame delivery and in a 100 ms sweep. Native independently checks expiry/interactive desktop/display state, renews the human arbiter ticket while alive, and tears down at expiry. Revocation, close, socket loss, lock, pause and shutdown release held input before relinquishing control. Native bookkeeping stores button-UP flags, fixing the partial patch's down/up mismatch. Stop is reported confirmed only after native acknowledgement; missing release/stop evidence stays false/unknown.

Each session has a 128-event audit ring with trusted task/attempt identity and input type/ID/outcome, omitting typed text and frame data. Store lifecycle audit inherits its existing 10,000-row bound. Active sessions are limited to four, WS peers to sixteen, queued input to 64, closed tickets to a bounded short retention window.

## Validation performed locally

- `native/windows-desktop/build.ps1`: exit 0; .NET Framework C# 5 helper and process-job binaries compiled. Current helper SHA256 after the final regression's rebuild: `19008C987DE990C43854400CDD06E66AA6EC23E87EE9CFDFACFDAA4C928150D7` (the Framework compiler includes build-dependent PE metadata, so an equivalent rebuild may have a different hash).
- `npm --prefix remote-computer-agent run build`: exit 0; updated Agent ESM bundles generated.
- `node --test tests/desktop-session.test.mjs tests/desktop-client.test.mjs tests/desktop-lease.native.mjs`: 24 passed, zero failed/skipped. The native lease fixture itself executes 15 assertions/cases, including active-Bot takeover, idle-TTL preemption, queued fencing, takeover timeout, renewal, cancellation and bounded tombstones.
- `node --test tests/remote-agent.test.mjs`: 13 passed, zero failed/skipped, including existing HTTP/MCP, grant revocation, real operation handling, and explicit unavailable-desktop behavior.
- Session tests use real HTTP/WebSocket connections and controllable native fixtures. Windows pipe tests use actual isolated named pipes, fragmented metadata/JPEG framing, correlated ACKs and disconnect-after-dispatch. Tests do not inject input into the user's desktop.

## Remaining acceptance and limits

The coordinator owns deployment and real interactive acceptance on `10.0.0.2`, including measured FPS/latency, mixed-monitor geometry and actual application input/takeover. No real FPS claim is made from fake-native tests. This is a GDI/JPEG LAN session, without RustDesk encoding, cursor-shape transport, audio, clipboard, file transfer or secure-attention/elevated-desktop support. GDI capture/input may be refused for protected or elevated surfaces. Native takeover waits for existing bounded input to exit; it cannot kill a hung graphics driver. Failed native input release remains unconfirmed and fails closed. HTTPS browsers also need a reachable permitted `wss` endpoint or platform-appropriate mixed-content policy supplied by deployment.

The coordinator should keep both user-facing README translations aligned with the full-desktop opt-in and these limits; this subtask was instructed not to change the repository root README/version files.

## User-configured Windows setup follow-up

Added `remote-computer-agent/start.cmd`, interactive `setup.ps1`, and a hidden `launch-agent.ps1`. This is installation on an existing user-supplied computer, without VM provisioning. The coordinator packages Node/dependencies/dist/native helpers. The wizard asks for workspace, private VPN address/URL, explicit team-Bot trust, and optional command/browser permission. It writes configuration and independent random native/pair secrets under a protected dedicated install directory. The pairing export includes `endpoint`, `protectedTunnel`, `machineId`, `clientId`, informational `secretRef`, `rootIds`, and nonsecret `hostManagedBots`; the token remains in `private/pairing.private.json` and is never printed. The Host must derive its own secretRef/committed authority rather than accepting executables/authority from an imported file.

The helper and Agent tasks use the current user's SID, `InteractiveToken`, `LeastPrivilege`, logon triggers and distinct installation-derived names. The Agent is launched hidden; the helper is launched with explicit full-desktop mode. No Windows login password is stored. Existing configuration/pairing is backed up into a private directory and left intact. Existing task names are never overwritten; choosing another setup directory creates another installation. The operator must deactivate an old helper before activating a second one because the native arbiter remains exclusive. A currently running Agent database is not copied as an unsafe live backup.

The setup supports answer files and an environment-gated mock task registry for isolated tests. Tests create no real scheduled tasks and never start Agent/helper on this machine. `tests/desktop-setup.test.mjs` covers real isolated local pairing, exact private file ACL, paths containing spaces, task XML/principal/full-mode arguments, repeated backup preserving token/config/task content, task-name collision refusal, and local-admin-only team-Bot authority. `hostManagedBots:true` requires `Store` opened with `{admin:true}`; fixed-Bot pair ceilings stay unchanged. Grant issuance/revocation still checks authenticated client/revision and exact root/tool ceilings. A grant request's own `hostManagedBots` field has no effect.

Final combined validation after the setup/authority change: `node --test tests/desktop-session.test.mjs tests/desktop-client.test.mjs tests/desktop-lease.native.mjs tests/desktop-setup.test.mjs tests/remote-agent.test.mjs` completed with **40 passed, zero failed/cancelled/skipped**. `git diff --check` for owned files exited 0. Actual Windows Task Scheduler registration/start and remote full-desktop performance remain coordinator/deployment acceptance, because this subtask deliberately used the isolated mock registry and fake native input transport.


## Coordinator final acceptance

The initial subtask report above preceded integration. The completed implementation adds native dirty-rectangle comparison, a five-second full keyframe, scale/quality adaptation, and at most two small patches in flight (one full image). Post-JPEG WebSocket pong credits bound actual receiver progress; write callbacks alone do not. Input acknowledgements are not queued behind a stream of full wallpaper images. The React viewer composes ordered patches on one backing canvas and preserves physical input coordinates when encoded resolution changes.

Actual Windows 10 `10.0.0.2`, interactive Session 1, selected physical monitor1920×1080 /96DPI:

- Original full JPEG path:1.50–2.00FPS over this WireGuard link; same-machine loopback14.60FPS established the network bottleneck.
- Final eight-second sample:105 frames /8.005seconds =13.12FPS (requested15); input ACK p50=125ms, p95=274ms across16 acknowledged/rejected test commands. This is an observation on this link, not a fixed frame-rate guarantee.
- Real button counter, Unicode text and Backspace, held Shift release, watch-mode rejection, same-token renewal crossing the old expiry, native stop confirmation all passed. Raw samples remain in `tmp/integration/remote-desktop-live/delta-pipeline-final/summary.json`.
- Chromium decoded/recomposed live patches from the production9701 Agent, authenticated the exact origin, acquired/released control and confirmed disconnect; no test input was sent to the user's ordinary apps. Evidence: `tmp/integration/live-browser-desktop/summary.json`.
- Production Agent9701 was backed up under `D:/dsh-agent/backup-20261105-desktop-205010`, then upgraded. Configuration and original pairing bytes were unchanged; original machine ID/token were accepted and12 live frames plus stopConfirmed were observed. No QQ/other app process was stopped.

The Windows setup was tested through real Task Scheduler, uncovering/fixing the UTF-8 XML declaration in a UTF-16 BSTR and the single-value allowedHosts serialization. The portable package includes plain Node, production SQLite/ws/Playwright dependencies, both native helpers, setup and launch scripts. No locked/UAC desktop, audio, multi-monitor switching, 125% DPI matrix, native iOS app or RustDesk wire compatibility is claimed.
