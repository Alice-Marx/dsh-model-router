# Windows Job process creation checkpoint

The original Agent native-process probe hung in its 150ms timeout scenario: the
launcher exited while a suspended Node child retained the inherited pipes. A
deterministic barrier in the exact E57 source (Git blob
`3981ba6619301da3391ff6e9d8c96f15071674a8`) reproduced death after CreateProcess but
before AssignProcessToJobObject. That child survived its launcher. The fixture
was removed using its process handle and exact creation FILETIME, never a
process-name kill.

`native/windows-desktop/ProcessJob.cs` now uses STARTUPINFOEX and
PROC_THREAD_ATTRIBUTE_JOB_LIST. Job membership is established by CreateProcess
itself, while the child is suspended; unsupported systems fail closed. The
only Job handle stays in the launcher and KILL_ON_JOB_CLOSE ends its descendants.
Retain CREATE_NO_WINDOW. Input JSON is decoded as UTF-8 so Chinese arguments do
not become OEM-codepage text. Attribute cleanup is conditional on successful
initialization.

The launcher also holds the actual creator's kernel process handle, validating
its creation timestamp before accepting it. A watchdog waits on that handle and
a private shutdown event; creator death terminates the owned Job and launcher.
Normal cleanup signals and joins the watchdog before closing any waited handle,
avoiding undefined wait/handle-reuse behaviour and exit-code races. The PID reuse
pre-open check assumes the trusted host clock is not deliberately moved backward;
once acquired, the original process handle supplies the lifetime identity.

Test barriers exist solely behind DSH_JOB_TEST_BARRIER. The production build
does not define it, and ignores barrier fields. Native fixtures cover exact
Unicode/empty/quote/newline/backslash argv, nonzero exit/normal cleanup, missing
entry, direct-child exit with a remaining descendant, the old failure, launcher
death after creation/resume, and actual creator death before creation/after
creation/while descendants run. Creation FILETIMEs remain decimal strings, not
lossy JSON numbers. Test programs are saved .mjs files.

This is cooperative process containment. It is not a separate Windows account,
AppContainer, filesystem boundary or a completed model-facing command backend.
Privileged host administrators remain trusted. Existing user desktop/profile
data and permissions are untouched.

Important handoff distinction: `packages/cli-runtime/src/native-peer.ps1` embeds
a separate Windows supervisor and still contains the older suspended-create then
Assign sequence. This stage has not changed or directly reproduced that helper's
creation-death window. The analogous gap is identified by source inspection;
successful installed-CLI initialization/MCP/normal close does not prove its
abrupt-startup-death robustness. Preserve this explicit next task rather than
assuming the Agent launcher's fix also changed the CLI supervisor.

Official API basis: [UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
documents Job-list support on Windows 10 and Windows Server 2016 or newer. The
supported test machines are Windows 10/11; no older-OS fallback is introduced.
