# Windows desktop helper (preview)

Build with `powershell -File build.ps1`. The source uses Windows .NET Framework 4.8 and does not require changing the global Node or .NET installation. This is the GDI capture backend; Windows Graphics Capture and the full multi-display/DPI matrix remain acceptance gates.

Start **inside the selected logged-in user's desktop**, with `--pipe dsh-desktop-<random-id> --secret-file <protected-file> --allowed-process <explicit-process-name>`. A service account may be added using `--agent-sid <explicit-SID>`. Session 0 exits with `DESKTOP_UNAVAILABLE`; SSH cannot establish desktop acceptance. The helper exposes a tray menu to pause/resume and stop/revoke its session.

The named pipe ACL permits the interactive user and the optional explicit agent SID; network principals are denied. The per-installation random secret adds client authentication. No listening TCP port exists. Screenshot and input requests require the foreground window handle, its configured process, interactive session ID and actual display ID. Capture returns physical origin, DPI, scale, session and screenshot revision. Input checks the window, foreground, DPI, bounds, screenshot hash and a 15-second lifetime, then consumes that screenshot. UAC/lock desktops pause with an error. The helper never sets or reads the clipboard; Unicode SendInput avoids temporary clipboard secrets.

The application-layer target checks cannot isolate mutually hostile programs already running as the same Windows user. Deploy under a dedicated low-privilege account and restrict the data directory/secret file ACL. The agent additionally leases desktop control to one Bot/attempt for 15 seconds.
