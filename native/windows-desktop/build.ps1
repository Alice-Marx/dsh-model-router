param([string]$OutputDirectory = "$PSScriptRoot/../../tmp/integration/agent-helper-build")
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.8 C# compiler is required; do not substitute Session 0 for desktop testing.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$output = [IO.Path]::GetFullPath((Join-Path $OutputDirectory 'dsh-desktop-helper.exe')).Replace('/', '\')
$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Program.cs')).Path.Replace('/', '\')
$leaseSource = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'DesktopLease.cs')).Path
& $compiler /nologo /optimize+ /target:winexe /platform:anycpu "/out:$output" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $source $leaseSource
if ($LASTEXITCODE -ne 0) { throw 'Desktop helper compilation failed' }
function Show-Sha256([string]$File) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { [PSCustomObject]@{ Algorithm = 'SHA256'; Hash = [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($File))).Replace('-', ''); Path = $File } } finally { $hash.Dispose() }
}
Show-Sha256 $output
$jobOutput = [IO.Path]::GetFullPath((Join-Path $OutputDirectory 'dsh-process-job.exe')).Replace('/', '\')
$jobSource = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'ProcessJob.cs')).Path.Replace('/', '\')
& $compiler /nologo /optimize+ /target:exe /platform:anycpu "/out:$jobOutput" /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll $jobSource
if ($LASTEXITCODE -ne 0) { throw 'Process Job helper compilation failed' }
Show-Sha256 $jobOutput
