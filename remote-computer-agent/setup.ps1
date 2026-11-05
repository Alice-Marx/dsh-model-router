#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'DSH/RemoteAgent'),
  [string]$PackageRoot = $PSScriptRoot,
  [string]$NodePath,
  [string]$HelperPath,
  [string]$AnswersFile,
  [switch]$NoStart,
  [string]$MockTaskRegistry
)
$ErrorActionPreference = 'Stop'
$setupAnswers = if ($AnswersFile) { Get-Content -Raw -LiteralPath $AnswersFile | ConvertFrom-Json } else { [PSCustomObject]@{} }
function Answer([string]$Key, [string]$Prompt, $Default) {
  $property = $setupAnswers.PSObject.Properties[$Key]
  if ($null -ne $property) { return $property.Value }
  if ($AnswersFile) { return $Default }
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value
}
function YesNo([string]$Key, [string]$Prompt, [bool]$Default = $false) {
  $value = Answer $Key $Prompt $(if ($Default) { 'y' } else { 'n' })
  if ($value -is [bool]) { return $value }
  if ($value -match '^(y|yes)$') { return $true }
  if ($value -match '^(n|no)$') { return $false }
  throw "Invalid yes/no answer for $Key."
}
function PrivateAcl([string]$Path, [bool]$Directory = $false) {
  $security = if ($Directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
  $security.SetAccessRuleProtection($true, $false)
  $inherit = if ($Directory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
  foreach ($sid in @($script:setupSid, 'S-1-5-18', 'S-1-5-32-544')) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
  }
  if ($Directory) { [IO.Directory]::SetAccessControl($Path, $security) } else { [IO.File]::SetAccessControl($Path, $security) }
}
function PrivateDirectory([string]$Path) { New-Item -ItemType Directory -Path $Path -Force | Out-Null; PrivateAcl $Path $true }
function PrivateText([string]$Path, [string]$Text) {
  if (Test-Path -LiteralPath $Path) { throw "Refusing to overwrite existing file: $Path" }
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
  PrivateAcl $Path
}
function PrivateJson([string]$Path, $Value) { PrivateText $Path (($Value | ConvertTo-Json -Depth 20) + "`n") }
function EscapeXml([string]$Value) { return [Security.SecurityElement]::Escape($Value) }
function TaskExists([string]$Name) {
  if ($MockTaskRegistry) { if (!(Test-Path -LiteralPath $MockTaskRegistry)) { return $false }; return @((Get-Content -Raw -LiteralPath $MockTaskRegistry | ConvertFrom-Json) | Where-Object { $_.name -eq $Name }).Count -gt 0 }
  return $null -ne (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue)
}
function TaskXml([string]$Executable, [string]$Arguments, [string]$Directory) {
  $exeXml = EscapeXml $Executable; $argsXml = EscapeXml $Arguments; $dirXml = EscapeXml $Directory
  return @"
<?xml version="1.0"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$script:setupSid</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Owner"><UserId>$script:setupSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
  <Actions Context="Owner"><Exec><Command>$exeXml</Command><Arguments>$argsXml</Arguments><WorkingDirectory>$dirXml</WorkingDirectory></Exec></Actions>
</Task>
"@
}
function RegisterTask([string]$Name, [string]$Xml, [string]$Role) {
  if (TaskExists $Name) { throw "Task already exists and was preserved: $Name" }
  if ($MockTaskRegistry) {
    $rows = if (Test-Path -LiteralPath $MockTaskRegistry) { @(Get-Content -Raw -LiteralPath $MockTaskRegistry | ConvertFrom-Json) } else { @() }
    $rows += [PSCustomObject]@{name=$Name;role=$Role;xml=$Xml;status='Ready'}
    [IO.File]::WriteAllText($MockTaskRegistry, (ConvertTo-Json -InputObject @($rows) -Depth 20), (New-Object Text.UTF8Encoding($false)))
  } else { Register-ScheduledTask -TaskName $Name -Xml $Xml | Out-Null }
}
try {
  $script:setupSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($MockTaskRegistry -and $env:DSH_AGENT_SETUP_TEST_MODE -ne '1') { throw 'Mock task registration is available only for isolated setup tests.' }
  if (!$MockTaskRegistry) {
    # Do not auto-load PowerShell 7 binary modules into Windows PowerShell 5.1
    # when setup was started by an application inheriting a different module path.
    $windowsModules=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules'
    $env:PSModulePath=$windowsModules+';'+$env:PSModulePath
    Import-Module (Join-Path $windowsModules 'ScheduledTasks/ScheduledTasks.psd1') -ErrorAction Stop
  }
  $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
  $PackageRoot = [IO.Path]::GetFullPath($PackageRoot)
  if ($InstallRoot.TrimEnd('\','/') -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\','/') -or $InstallRoot.TrimEnd('\','/') -eq $env:USERPROFILE.TrimEnd('\','/')) { throw 'Choose a dedicated installation directory.' }
  $configFile = Join-Path $InstallRoot 'config.json'
  if (Test-Path -LiteralPath $configFile) {
    # Rerunning setup never rotates an existing credential or rewrites its tasks.
    # Snapshot only installer-owned files, never the running SQLite database.
    $privateDir = Join-Path $InstallRoot 'private'; PrivateDirectory $privateDir
    $backupDir = Join-Path $privateDir ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,6)); PrivateDirectory $backupDir
    foreach ($relative in @('config.json','launch.json','connection.json','private/pairing.private.json','private/native.secret','private/ceiling.json')) {
      $source = Join-Path $InstallRoot $relative
      if (Test-Path -LiteralPath $source -PathType Leaf) { $target = Join-Path $backupDir ($relative.Replace('/','-')); Copy-Item -LiteralPath $source -Destination $target; PrivateAcl $target }
    }
    Write-Host "Existing configuration, pairing and tasks were preserved. Private backup: $backupDir"
    $next = Answer 'existingAction' 'Keep this installation, or create another directory? Enter keep or new' 'keep'
    if ($next -eq 'keep') { exit 0 }
    if ($next -ne 'new') { throw 'Existing installation preserved. Use keep or new.' }
    $InstallRoot = [IO.Path]::GetFullPath((Answer 'newInstallRoot' 'New installation directory' ($InstallRoot + '-new')))
    if ($InstallRoot.TrimEnd('\','/') -eq [IO.Path]::GetPathRoot($InstallRoot).TrimEnd('\','/') -or $InstallRoot.TrimEnd('\','/') -eq $env:USERPROFILE.TrimEnd('\','/')) { throw 'Choose a dedicated installation directory.' }
    $configFile = Join-Path $InstallRoot 'config.json'
  }
  if ((Test-Path -LiteralPath $InstallRoot) -and (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -gt 0)) { throw 'The new installation directory must be empty; existing files were preserved.' }
  if (!$NodePath) {
    foreach ($candidate in @((Join-Path $PackageRoot 'node.exe'), (Join-Path $PackageRoot 'node/node.exe'))) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { $NodePath = $candidate; break } }
    if (!$NodePath) { $command = Get-Command node.exe -ErrorAction SilentlyContinue; if ($command) { $NodePath = $command.Source } }
  }
  if (!$NodePath -or !(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Bundled Node was not found. Supply -NodePath or unpack the complete Windows package.' }
  $NodePath = [IO.Path]::GetFullPath($NodePath)
  $nodeVersion = (& $NodePath --version).TrimStart('v'); if ($LASTEXITCODE -ne 0 -or [Version]$nodeVersion -lt [Version]'22.19') { throw 'Node 22.19 or newer is required.' }
  $cliFile = Join-Path $PackageRoot 'dist/cli.mjs'; if (!(Test-Path -LiteralPath $cliFile -PathType Leaf)) { throw 'Agent dist/cli.mjs is missing from the package.' }
  if (!$HelperPath) { foreach ($candidate in @((Join-Path $PackageRoot 'helpers/dsh-desktop-helper.exe'),(Join-Path $PackageRoot 'dsh-desktop-helper.exe'))) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { $HelperPath=$candidate; break } } }
  if (!$HelperPath -or !(Test-Path -LiteralPath $HelperPath -PathType Leaf)) { throw 'The interactive desktop helper is missing from the package.' }
  $HelperPath = [IO.Path]::GetFullPath($HelperPath)
  $workspace = [IO.Path]::GetFullPath((Answer 'workspace' 'Workspace directory for this cloud computer' (Join-Path $env:USERPROFILE 'DSH-Workspace')))
  $bindAddress = [string](Answer 'bindAddress' 'Private VPN IP to listen on, or 127.0.0.1 for local use' '127.0.0.1')
  $parsedAddress = $null; if (![Net.IPAddress]::TryParse($bindAddress, [ref]$parsedAddress) -or $bindAddress -in @('0.0.0.0','::')) { throw 'Supply one concrete local/private VPN IP address.' }
  $loopbackBind = [Net.IPAddress]::IsLoopback($parsedAddress)
  $protectedTunnel = if ($loopbackBind) { $false } else { YesNo 'protectedTunnel' 'This address is on your configured private WireGuard/Tailscale network. Confirm y/n' }
  if (!$loopbackBind -and !$protectedTunnel) { throw 'Configure a private VPN or HTTPS reverse proxy before exposing this Agent.' }
  $port = [int](Answer 'port' 'Agent port' 9701); if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid port.' }
  $displayHost = if ($bindAddress.Contains(':')) { "[$bindAddress]" } else { $bindAddress }
  $endpoint = [string](Answer 'endpoint' 'Agent URL reachable from your Host computer' ("http://{0}:{1}" -f $displayHost,$port))
  $endpointUri = $null; if (![Uri]::TryCreate($endpoint, [UriKind]::Absolute, [ref]$endpointUri) -or $endpointUri.Scheme -notin @('http','https') -or $endpointUri.UserInfo -or $endpointUri.Query -or $endpointUri.Fragment -or $endpointUri.AbsolutePath -ne '/') { throw 'Supply an http(s) Agent base URL without credentials, query or path.' }
  if ($endpointUri.Scheme -eq 'http' -and !$endpointUri.IsLoopback -and !$protectedTunnel) { throw 'HTTP remote endpoints require your explicitly confirmed private VPN.' }
  $managed = YesNo 'hostManagedBots' 'Allow this trusted Host to manage all of its team Bots (recommended for automatic Bot setup)? Explicit y enables it'
  $botIds = @(); if (!$managed) { $botIds = @(([string](Answer 'botIds' 'Allowed Bot IDs, separated by commas' '')).Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }); if (!$botIds.Count) { throw 'At least one fixed Bot ID is required when team management is disabled.' } }
  $clientId = [string](Answer 'clientId' 'Name for this paired Host' 'desktop-host')
  foreach ($id in @($clientId) + $botIds) { if ($id -notmatch '^[-a-zA-Z0-9_.]{1,128}$') { throw 'Invalid Host/Bot ID.' } }
  $allowCommands = YesNo 'allowCommands' 'Allow this Host to run commands as your Windows user?'
  $browserOrigin = [string](Answer 'browserOrigin' 'Optional website origin for browser automation (blank disables browser navigation)' '')
  if ($browserOrigin) { $originUri = $null; if (![Uri]::TryCreate($browserOrigin, [UriKind]::Absolute, [ref]$originUri) -or $originUri.Scheme -notin @('http','https') -or $browserOrigin -ne $originUri.GetLeftPart([UriPartial]::Authority)) { throw 'Browser origin must be an exact http(s) origin.' } }
  $hash = [Security.Cryptography.SHA256]::Create(); try { $installationId = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.ToLowerInvariant()))).Replace('-','').Substring(0,12).ToLowerInvariant() } finally { $hash.Dispose() }
  $agentTask = "DSH-RemoteAgent-$installationId"; $desktopTask = "DSH-Desktop-$installationId"
  foreach ($taskName in @($agentTask,$desktopTask)) { if (TaskExists $taskName) { throw "Existing task was preserved: $taskName" } }
  PrivateDirectory $InstallRoot; $privateDir=Join-Path $InstallRoot 'private'; PrivateDirectory $privateDir
  if (!(Test-Path -LiteralPath $workspace)) { New-Item -ItemType Directory -Path $workspace -Force | Out-Null }
  $nativeSecret=Join-Path $privateDir 'native.secret'; $bytes=New-Object byte[] 32; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }; PrivateText $nativeSecret ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_'))
  $powershellExe=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $config=@{dataDir=(Join-Path $privateDir 'data');roots=@{project=$workspace};isolation='application';network=@{mode=$(if($loopbackBind){'loopback'}else{'wireguard'});host=$bindAddress;port=$port;allowedHosts=@(@($endpointUri.Authority,("{0}:{1}" -f $displayHost,$port))|Select-Object -Unique)};desktop=@{pipeName="dsh-desktop-$installationId";secretFile=$nativeSecret};browserOrigins=@();executables=@{}}
  if ($protectedTunnel) { $config.network.protectedTunnel=$true }
  if ($browserOrigin) { $config.browserOrigins=@($browserOrigin) }
  $jobHelper=Join-Path (Split-Path -Parent $HelperPath) 'dsh-process-job.exe'
  if ($allowCommands) { if (!(Test-Path -LiteralPath $jobHelper -PathType Leaf)) { throw 'Command execution requires the packaged dsh-process-job.exe.' }; $config.executables=@{node=$NodePath};$config.shell=$powershellExe;$config.windowsJobRunner=$jobHelper }
  PrivateJson $configFile $config
  $toolNames=@('machine_ping','fs_list','fs_read','fs_write','operation_status','operation_cancel','artifact_stat','artifact_read','worktree_create','worktree_diff','worktree_integrate','browser_open','browser_snapshot','browser_click','browser_type','browser_script','browser_upload','browser_download','browser_close','desktop_screenshot','desktop_click','desktop_type','desktop_key','desktop_scroll')
  if ($allowCommands) { $toolNames += 'shell_exec' }
  $ceilingFile=Join-Path $privateDir 'ceiling.json'; PrivateJson $ceilingFile @{botIds=$botIds;hostManagedBots=$managed;roots=@('project');tools=$toolNames}
  # Capture CLI pairing output in memory. A pairing token is never printed.
  $pairLines=@(& $NodePath $cliFile pair $configFile $clientId $ceilingFile);if($LASTEXITCODE -ne 0){throw 'Local pairing failed; check the complete package and private configuration.'}
  $paired=($pairLines -join "`n")|ConvertFrom-Json
  if ($paired.token -notmatch '^[A-Za-z0-9_-]{43}$' -or !$paired.machineId) { throw 'Invalid local pairing receipt.' }
  $pairFile=Join-Path $privateDir 'pairing.private.json'
  $pairExport=@{schemaVersion=1;agentApiMajor=1;machineId=$paired.machineId;clientId=$paired.clientId;secretRef=$paired.secretRef;token=$paired.token;endpoint=$endpoint.TrimEnd('/');protectedTunnel=$protectedTunnel;hostManagedBots=$managed;botIds=$botIds;rootIds=@('project');tools=$toolNames}
  PrivateJson $pairFile $pairExport
  PrivateJson (Join-Path $InstallRoot 'connection.json') @{schemaVersion=1;machineId=$paired.machineId;clientId=$clientId;endpoint=$pairExport.endpoint;protectedTunnel=$protectedTunnel;hostManagedBots=$managed;botIds=$botIds;rootIds=@('project');tools=$toolNames;pairingFile=$pairFile}
  PrivateJson (Join-Path $InstallRoot 'launch.json') @{node=$NodePath;cli=$cliFile;config=$configFile;packageRoot=$PackageRoot;stdout=(Join-Path $privateDir 'agent.stdout.log');stderr=(Join-Path $privateDir 'agent.stderr.log')}
  $launcher=Join-Path $InstallRoot 'launch-agent.ps1';Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'launch-agent.ps1') -Destination $launcher;PrivateAcl $launcher
  $agentXml=TaskXml $powershellExe ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$launcher+'"') $InstallRoot
  $desktopXml=TaskXml $HelperPath ('--desktop-mode full --pipe '+$config.desktop.pipeName+' --secret-file "'+$nativeSecret+'"') (Split-Path -Parent $HelperPath)
  PrivateText (Join-Path $privateDir 'agent-task.xml') $agentXml;PrivateText (Join-Path $privateDir 'desktop-task.xml') $desktopXml
  RegisterTask $desktopTask $desktopXml 'desktop';RegisterTask $agentTask $agentXml 'agent'
  PrivateJson (Join-Path $InstallRoot 'setup-result.json') @{config=$configFile;pairingFile=$pairFile;taskNames=@($desktopTask,$agentTask);hostManagedBots=$managed;registration=$(if($MockTaskRegistry){'mock'}else{'installed'})}
  if (!$NoStart -and (YesNo 'startNow' 'Start the desktop helper and Agent now?' $true)) {
    foreach($taskName in @($desktopTask,$agentTask)){if($MockTaskRegistry){continue};Start-ScheduledTask -TaskName $taskName}
  }
  Write-Host "Configured user-owned cloud computer at $InstallRoot"
  Write-Host "Import this private pairing file in your Host app: $pairFile"
  Write-Host 'The token stays in that protected file. Keep this Windows user signed in for full desktop access.'
} catch { Write-Error ('Setup stopped: ' + $_.Exception.Message); exit 1 }
