# Installed beside launch.json by setup.ps1. The scheduled task has an
# InteractiveToken principal; neither task nor launcher stores a Windows password.
$ErrorActionPreference = 'Stop'
$settings = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'launch.json') | ConvertFrom-Json
$arguments = '"' + $settings.cli + '" serve "' + $settings.config + '"'
$child = Start-Process -FilePath $settings.node -ArgumentList $arguments -WorkingDirectory $settings.packageRoot -WindowStyle Hidden -RedirectStandardOutput $settings.stdout -RedirectStandardError $settings.stderr -PassThru
$child.WaitForExit()
$child.Refresh()
exit $child.ExitCode
