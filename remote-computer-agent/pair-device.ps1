# Regenerates an unredeemed invitation without rewriting tasks, roots or permissions.
[CmdletBinding()]
param([switch]$OpenPage,[switch]$ResetPairing)
$ErrorActionPreference = 'Stop'
try {
  $launch = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'launch.json') | ConvertFrom-Json
  $connection = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'connection.json') | ConvertFrom-Json
  if ($connection.pairingMode -ne 'secure') { throw 'This installation uses compatibility pairing.' }
  if ($ResetPairing) {
    & $launch.node $launch.cli revoke $launch.config $connection.clientId | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The old pairing could not be revoked; no new invitation was created.' }
    Write-Host 'The previous pairing was revoked. Its connections and grants are no longer valid.'
  }
  $page = Join-Path $PSScriptRoot 'private/pairing.html'
  $lines = @(& $launch.node $launch.cli invite-page $launch.config $connection.clientId $connection.ceilingFile $connection.endpoint $page)
  if ($LASTEXITCODE -ne 0) { throw 'Check paired devices on this computer. To revoke a pairing whose credential the Host lost, run: pair-device.cmd -ResetPairing. This disconnects the previous pairing.' }
  $result = ($lines -join "`n") | ConvertFrom-Json
  Write-Host ('Pairing page: ' + $result.pageFile)
  if ($OpenPage) { Start-Process -FilePath $result.pageFile -WindowStyle Normal }
} catch { Write-Error $_.Exception.Message; exit 1 }
