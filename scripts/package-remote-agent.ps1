#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo 'tmp/integration/remote-agent-package' }
$agent = Join-Path $repo 'remote-computer-agent'
if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'A plain Windows x64 Node executable is required.' }
$runtime = & $NodePath -p 'JSON.stringify({platform:process.platform,arch:process.arch,major:parseInt(process.versions.node)})' | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $runtime.platform -ne 'win32' -or $runtime.arch -ne 'x64' -or $runtime.major -lt 22) { throw 'Use Windows x64 Node 22.19 or newer, matching the native SQLite dependency.' }
if (!$SkipBuild) {
  & $NodePath (Join-Path $agent 'build.mjs'); if ($LASTEXITCODE -ne 0) { throw 'Agent build failed.' }
  & (Join-Path $repo 'native/windows-desktop/build.ps1'); if (!$?) { throw 'Native helper build failed.' }
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)
$stage = Join-Path $OutputDirectory "DSH-RemoteAgent-windows-x64-$stamp"
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($name in @('dist','package.json','package-lock.json','start.cmd','setup.ps1','launch-agent.ps1','pair-device.ps1','README.md')) {
  Copy-Item -LiteralPath (Join-Path $agent $name) -Destination (Join-Path $stage $name) -Recurse
}
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $stage 'node.exe')
$runtimeLicense = Join-Path (Split-Path -Parent $NodePath) 'LICENSE'
if (!(Test-Path -LiteralPath $runtimeLicense)) { throw 'Node redistribution license was not found beside node.exe.' }
Copy-Item -LiteralPath $runtimeLicense -Destination (Join-Path $stage 'NODE-LICENSE.txt')
New-Item -ItemType Directory -Path (Join-Path $stage 'helpers') | Out-Null
foreach ($name in @('dsh-desktop-helper.exe','dsh-process-job.exe')) {
  Copy-Item -LiteralPath (Join-Path $repo "tmp/integration/agent-helper-build/$name") -Destination (Join-Path $stage "helpers/$name")
}
$npmCli = Join-Path (Split-Path -Parent $NodePath) 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $npmCli)) { throw 'npm-cli.js was not found beside Node.' }
& $NodePath $npmCli ci --prefix $stage --omit=dev --include=optional --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed; incomplete staging directory was retained for diagnosis.' }
@'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url), DB=require('better-sqlite3')
const db=new DB(':memory:');db.exec('CREATE TABLE verification(value TEXT)');db.close()
require('ws');require('playwright')
console.log('Portable SQLite, WebSocket and browser dependencies verified')
'@ | Set-Content -LiteralPath (Join-Path $stage 'verify-package.mjs') -Encoding UTF8
& $NodePath (Join-Path $stage 'verify-package.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Packaged plain-Node dependency probe failed.' }
@'
DSH Remote Computer Agent (Windows x64)

1. Extract the entire folder on your own Windows computer or cloud PC.
2. Sign into the Windows desktop, then double-click start.cmd.
3. Choose a shared workspace and one reachable local address.
4. Open the generated private/pairing.html, then scan or copy its short invitation
   into the Host app's Computers > Secure pairing panel and check the six-digit code.

The installer shows the exact installation and pairing-file paths. Windows must
stay signed into an interactive desktop for video and mouse/keyboard control.
Run pair-device.cmd to refresh an unredeemed invitation after two minutes.
Keep pairing pages/files private. Legacy mode still exports pairing.private.json.
Rerunning setup preserves existing configuration and credentials.
Full instructions and limitations: README.md.
'@ | Set-Content -LiteralPath (Join-Path $stage 'START-HERE.txt') -Encoding UTF8
$zip = "$stage.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
$zipStream = [IO.File]::OpenRead($zip)
try { $checksum = [BitConverter]::ToString($hashAlgorithm.ComputeHash($zipStream)).Replace('-', '') }
finally { $zipStream.Dispose(); $hashAlgorithm.Dispose() }
[pscustomobject]@{package=$zip;sha256=$checksum;bytes=(Get-Item -LiteralPath $zip).Length;stagingDirectory=$stage;node=(& $NodePath --version)} | ConvertTo-Json -Compress
