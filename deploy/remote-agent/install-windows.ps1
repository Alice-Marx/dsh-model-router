param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$AuthorizedRoot,
  [string]$Prefix = "$env:LOCALAPPDATA/DSH/remote-agent",
  [string]$DesktopTargetProcess
)
$ErrorActionPreference = 'Stop'
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$AuthorizedRoot = (Resolve-Path -LiteralPath $AuthorizedRoot).Path
& node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<19))process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Use an isolated Node >=22.19 runtime; the installer does not change global Node.' }
$version = (Get-Content -Raw -LiteralPath (Join-Path $SourceRoot 'remote-computer-agent/package.json') | ConvertFrom-Json).version
$target = [IO.Path]::GetFullPath((Join-Path $Prefix "versions/$version"))
if (Test-Path -LiteralPath $target) { throw 'Version directory exists; preserve it and select a new prefix/version.' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($name in @('package.json','package-lock.json','build.mjs','src')) { Copy-Item -LiteralPath (Join-Path $SourceRoot "remote-computer-agent/$name") -Destination $target -Recurse }
Push-Location $target
try { & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Native dependency install failed' }; & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed' } } finally { Pop-Location }
& (Join-Path $SourceRoot 'native/windows-desktop/build.ps1') -OutputDirectory (Join-Path $target 'native')
$configFile = [IO.Path]::GetFullPath((Join-Path $Prefix 'config.json'))
if (!(Test-Path -LiteralPath $configFile)) { & node (Join-Path $target 'dist/cli.mjs') init $configFile $AuthorizedRoot; if ($LASTEXITCODE -ne 0) { throw 'Initialization failed' } }
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$config | Add-Member -Force -NotePropertyName windowsJobRunner -NotePropertyValue (Join-Path $target 'native/dsh-process-job.exe')
if ($DesktopTargetProcess) {
  $pipeName = 'dsh-desktop-' + [Guid]::NewGuid().ToString('N')
  $secretFile = Join-Path $Prefix 'desktop.secret'
  $bytes = New-Object byte[] 32
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  [IO.File]::WriteAllText($secretFile,$secret,[Text.UTF8Encoding]::new($false))
  $config | Add-Member -Force -NotePropertyName desktop -NotePropertyValue @{ pipeName=$pipeName; secretFile=$secretFile }
  $helperArgs = @('--pipe',$pipeName,'--secret-file',$secretFile,'--allowed-process',$DesktopTargetProcess)
  [IO.File]::WriteAllText((Join-Path $Prefix 'desktop-start.json'),($helperArgs | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
}
[IO.File]::WriteAllText($configFile,($config | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
[IO.Directory]::SetAccessControl([IO.Path]::GetFullPath($Prefix),$acl)
& node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules},null,2))' (Join-Path $target 'runtime.json')
Write-Output "Installed $version. Configuration: $configFile. Pair with the local CLI, then start serve in the selected account. No task, service, VPN or firewall was changed."
